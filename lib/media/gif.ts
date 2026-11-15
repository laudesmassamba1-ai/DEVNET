/**
 * Décodage GIF — images fixes et animations.
 *
 * `@napi-rs/image` ne décode pas le GIF (choix de son éditeur : les codecs
 * GIF ne sont pas compilés dans les binaires publiés). DEVNET, lui, accepte
 * les GIF : stickers animés, statuts animés, photos collées. On décode donc
 * le GIF ici avec `omggif` (MIT), puis on rend chaque image au pipeline
 * d'encodage WebP.
 *
 * Le module ne fait que deux choses, et il les fait explicitement :
 *
 * 1. lire l'en-tête (dimensions, nombre d'images, délais) ;
 * 2. composer l'état visuel de chaque image en respectant la transparence et
 *    la méthode de disposition du GIF.
 *
 * Les bornes de sécurité sont ici, pas chez l'appelant : un GIF peut annoncer
 * 10 000 images de 10 000 pixels de côté, et un décodeur qui obéit est un
 * déni de service.
 */
import { GifReader } from "omggif";

/**
 * Budget de décodage, en pixels **cumulés sur toutes les images**.
 *
 * Une image de 4 000 × 4 000 pixels pèse 64 Mo en RGBA. Multiplier cela par
 * cent images ferait tomber la fonction serverless avant tout message utile.
 * 64 millions de pixels cumulés laissent passer un GIF de 800 × 600 en
 * ~130 images — largement au-delà des plafonds métier (80 et 120).
 */
export const GIF_MAX_DECODED_PIXELS = 64_000_000;

export type GifHeader = {
  width: number;
  height: number;
  frames: number;
};

export type RgbaFrame = {
  /** Canevas complet, RGBA, `width * height * 4` octets. */
  pixels: Uint8Array;
  /** Durée d'affichage de cette image, en millisecondes. */
  durationMs: number;
};

/** Lit l'en-tête sans décoder les images. */
export function readGifHeader(bytes: Buffer | Uint8Array): GifHeader {
  const reader = new GifReader(bytes as Uint8Array);
  const header = { width: reader.width, height: reader.height, frames: reader.numFrames() };
  if (!(header.width > 0 && header.height > 0)) throw new Error("GIF sans dimension");
  if (header.frames < 1) throw new Error("GIF sans image");
  const budget = header.width * header.height * header.frames;
  if (budget > GIF_MAX_DECODED_PIXELS) {
    throw new Error("GIF trop volumineux à décoder");
  }
  return header;
}

function clearRect(
  canvas: Uint8Array,
  width: number,
  rect: { x: number; y: number; width: number; height: number },
): void {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    const row = y * width;
    canvas.fill(0, (row + rect.x) * 4, (row + rect.x + rect.width) * 4);
  }
}

function copyRect(
  source: Uint8Array,
  target: Uint8Array,
  width: number,
  rect: { x: number; y: number; width: number; height: number },
): void {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    const row = y * width;
    target.set(
      source.subarray((row + rect.x) * 4, (row + rect.x + rect.width) * 4),
      (row + rect.x) * 4,
    );
  }
}

/**
 * Compose chaque image du GIF.
 *
 * `omggif` dessine le rectangle de chaque image et applique sa transparence ;
 * la disposition (`disposal`) reste à notre charge :
 *
 * - `2` : le rectangle de l'image précédente est effacé avant la suivante ;
 * - `3` : l'état d'avant l'image précédente est restauré avant la suivante.
 *
 * Le délai est exprimé en centièmes de seconde. Un délai nul est traité comme
 * 100 ms : c'est ce que font les navigateurs, et un WebP à 0 ms défilerait à
 * une vitesse illisible.
 */
export function composeGifFrames(bytes: Buffer | Uint8Array): RgbaFrame[] {
  const reader = new GifReader(bytes as Uint8Array);
  const { width, height } = reader;
  const frames = reader.numFrames();
  if (!(width > 0 && height > 0)) throw new Error("GIF sans dimension");
  if (frames < 1) throw new Error("GIF sans image");
  if (width * height * frames > GIF_MAX_DECODED_PIXELS) {
    throw new Error("GIF trop volumineux à décoder");
  }

  const canvas = new Uint8Array(width * height * 4);
  const output: RgbaFrame[] = [];
  let previous: { disposal: number; rect: { x: number; y: number; width: number; height: number } } | null =
    null;
  let saved: Uint8Array | null = null;

  for (let index = 0; index < frames; index += 1) {
    const info = reader.frameInfo(index);

    if (previous) {
      if (previous.disposal === 2) clearRect(canvas, width, previous.rect);
      else if (previous.disposal === 3 && saved) copyRect(saved, canvas, width, previous.rect);
    }

    const rect = { x: info.x, y: info.y, width: info.width, height: info.height };
    // `disposal = 3` restaure l'écran tel qu'il était avant cette image.
    saved = info.disposal === 3 ? canvas.slice() : null;

    reader.decodeAndBlitFrameRGBA(index, canvas);

    output.push({
      pixels: canvas.slice(),
      durationMs: info.delay > 0 ? info.delay * 10 : 100,
    });
    previous = { disposal: info.disposal, rect };
  }

  return output;
}
