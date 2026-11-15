/**
 * Images côté serveur — un seul point d'entrée, sur `@napi-rs/image`.
 *
 * ## Pourquoi `@napi-rs/image` et pas `sharp`
 *
 * `sharp` est Apache-2.0, mais il n'est utilisable que parce qu'il embarque
 * `libvips`, publié sous **LGPL-3.0**, et `libheif` pour l'AVIF, publié sous
 * **LGPL-3.0**. Le paquet affiche Apache-2.0 ; les binaires qu'il télécharge
 * pour cette plateforme ne le sont pas. La politique de la CADEV 2026
 * (article 6) interdit LGPL : le remplacement n'est pas un confort, c'est la
 * condition de la conformité.
 *
 * `@napi-rs/image` est MIT, écrit en Rust : `image`, `image-webp`,
 * `zune-jpeg` (MIT/Apache-2.0/Zlib), `libavif` (BSD-2-Clause), `gif`
 * (MIT/Apache-2.0), `oxipng`/`lodepng`/`zlib-rs` (MIT/Zlib), `resvg`/`usvg`
 * (Apache-2.0 OR MIT) et `libjpeg-turbo` (IJG/BSD-3-Clause/Zlib) pour le
 * JPEG. L'inventaire complet et les obligations d'attribution sont dans
 * `docs/legal/DEPENDENCY_LICENSE_MATRIX.md`.
 *
 * ## Ce qui n'est pas dans `@napi-rs/image`
 *
 * Le GIF : les codecs ne sont pas compilés dans les binaires publiés, et
 * l'animation n'existe pas du tout. `lib/media/gif.ts` décode le GIF,
 * `lib/media/webp-animation.ts` assemble le WebP animé. Le reste — orientation
 * EXIF, redimensionnement, encodage WebP/PNG — est fait par le binaire.
 *
 * ## Bornes de sécurité
 *
 * `limitInputPixels` protège de la bombe de décompression (« 40 000 × 40 000 »
 * dans 12 octets). Chaque entrée est contrôlée **avant** décodage, et un
 * fichier tronqué lève une erreur que l'appelant traduit en refus.
 */
import { Transformer, ResizeFit } from "@napi-rs/image";
import { composeGifFrames, readGifHeader } from "./gif";
import {
  muxAnimatedWebp,
  readAnimatedWebp,
  standaloneFrame,
  type AnimationFrame,
} from "./webp-animation";

/** Plafond par défaut : 50 Mpx, la valeur qu'utilisait la route média. */
export const DEFAULT_PIXEL_LIMIT = 50_000_000;

export type ImageFormat =
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "avif"
  | "heic"
  | "tiff"
  | "bmp"
  | "ico"
  | "jxl"
  | "dds"
  | "hdr"
  | "pnm"
  | "tga"
  | "unknown";

export type ImageMetadata = {
  format: ImageFormat;
  width: number;
  height: number;
  /** Nombre d'images : 1 pour une image fixe. */
  pages: number;
  animated: boolean;
};

export type ImageOptions = {
  /** Pixels d'entrée acceptés. Au-delà : refus, avant tout décodage. */
  limitInputPixels?: number;
};

/** Vue `Buffer` sans copie, quel que soit le `Uint8Array` reçu. */
function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Signature binaire — jamais le type déclaré par le client. */
export function sniffImageFormat(input: Uint8Array): ImageFormat | null {
  const bytes = asBuffer(input);
  const at = (offset: number, length: number) =>
    bytes.toString("ascii", offset, offset + length);

  if (bytes.length < 12) return null;
  const hex = bytes.toString("hex", 0, 12);

  if (hex.startsWith("ffd8ff")) return "jpeg";
  if (hex.startsWith("89504e470d0a1a0a")) return "png";
  const ascii = at(0, 6);
  if (ascii === "GIF87a" || ascii === "GIF89a") return "gif";
  if (ascii.startsWith("RIFF") && at(8, 4) === "WEBP") return "webp";
  if (hex.startsWith("49492a00") || hex.startsWith("4d4d002a")) return "tiff";
  if (hex.startsWith("424d")) return "bmp";
  if (hex.startsWith("00000100")) return "ico";
  if (hex.startsWith("ff0a") || hex.startsWith("0000000c4a584c20")) return "jxl";
  if (hex.startsWith("44445320")) return "dds";
  if (ascii.startsWith("#?RADIANCE") || ascii.startsWith("#?RGBE")) return "hdr";

  // ISO-BMFF : le type réel est dans la boîte `ftyp`.
  if (at(4, 4) === "ftyp") {
    const brand = at(8, 4);
    if (brand === "avif" || brand === "avis") return "avif";
    if (brand === "heic" || brand === "heix" || brand === "heif" || brand === "mif1") return "heic";
  }
  return null;
}

/**
 * Dimensions lues dans l'en-tête, sans décoder.
 *
 * Le budget de pixels doit être appliqué **avant** que le décodeur
 * n'alloue : un PNG de 12 octets peut annoncer 30 000 × 30 000. Le décodeur
 * natif a sa propre limite mémoire, mais son message (« Memory limit
 * exceeded ») ne dit pas à l'utilisateur ce qui cloche, et il dépend de la
 * mémoire disponible de la fonction serverless.
 */
export function headerSize(input: Uint8Array): Size | null {
  const bytes = asBuffer(input);
  const format = sniffImageFormat(bytes);
  const read24 = (offset: number) =>
    bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);

  if (format === "png" && bytes.length >= 24) {
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (format === "gif" && bytes.length >= 10) {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }

  if (format === "bmp" && bytes.length >= 26) {
    return { width: Math.abs(bytes.readInt32LE(18)), height: Math.abs(bytes.readInt32LE(22)) };
  }

  if (format === "webp" && bytes.length >= 30) {
    const id = bytes.toString("ascii", 12, 16);
    if (id === "VP8X") return { width: read24(20) + 1, height: read24(23) + 1 };
    if (id === "VP8 " && bytes.length >= 30) {
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (id === "VP8L" && bytes.length >= 25) {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }

  if (format === "jpeg") {
    // Parcours des marqueurs jusqu'au premier SOF (début de trame), qui
    // porte les dimensions.
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) return null;
      const isStartOfFrame =
        marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isStartOfFrame) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }

  return null;
}

function assertPixelBudget(width: number, height: number, limit: number): void {
  if (!(width > 0 && height > 0)) throw new Error("image sans dimension");
  if (width * height > limit) throw new Error("image trop grande en pixels");
}

/**
 * Métadonnées d'une image, sans la décoder entièrement.
 *
 * Pour le GIF, `@napi-rs/image` ne sait rien dire : on lit l'en-tête GIF pour
 * connaître le nombre d'images. Pour le WebP, le drapeau d'animation est dans
 * `VP8X` et se lit dans l'en-tête RIFF.
 */
export async function imageMetadata(
  input: Uint8Array,
  options: ImageOptions = {},
): Promise<ImageMetadata> {
  const bytes = asBuffer(input);
  const limit = options.limitInputPixels ?? DEFAULT_PIXEL_LIMIT;
  const format = sniffImageFormat(bytes);

  // Refus avant toute allocation quand les dimensions sont dans l'en-tête.
  const declared = headerSize(bytes);
  if (declared) assertPixelBudget(declared.width, declared.height, limit);

  if (format === "gif") {
    const header = readGifHeader(bytes);
    assertPixelBudget(header.width, header.height, limit);
    return {
      format,
      width: header.width,
      height: header.height,
      pages: header.frames,
      animated: header.frames > 1,
    };
  }

  if (format === "webp") {
    const animation = readAnimatedWebp(bytes);
    if (animation) {
      assertPixelBudget(animation.width, animation.height, limit);
      return {
        format,
        width: animation.width,
        height: animation.height,
        pages: animation.frames.length,
        animated: animation.frames.length > 1,
      };
    }
  }

  const metadata = await new Transformer(bytes).metadata();
  assertPixelBudget(metadata.width, metadata.height, limit);
  return {
    format: (sniffImageFormat(bytes) ?? format ?? "unknown") as ImageFormat,
    width: metadata.width,
    height: metadata.height,
    pages: 1,
    animated: false,
  };
}

/* ── Redimensionnement ─────────────────────────────────────────────────── */

export type Size = { width: number; height: number };

/**
 * Taille cible pour « tenir dans une boîte », sans agrandir.
 *
 * `@napi-rs/image` ne connaît pas l'option `withoutEnlargement` de `sharp` :
 * on calcule la cible nous-mêmes, ce qui évite d'agrandir une vignette de
 * 120 px pour la « réduire » à 512.
 */
export function insideSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): Size {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  if (!Number.isFinite(scale) || scale >= 1) return { width, height };
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/* ── Encodage WebP ─────────────────────────────────────────────────────── */

export type WebpOptions = {
  /** Côté maximal : l'image tient dans `maxWidth × maxHeight`. */
  maxWidth: number;
  maxHeight: number;
  /** Qualité WebP avec perte, 0–100. */
  quality: number;
  limitInputPixels?: number;
};

export type WebpResult = {
  data: Buffer;
  width: number;
  height: number;
  /** Images du fichier produit : > 1 quand l'entrée était animée. */
  pages: number;
};

/**
 * Convertit n'importe quelle image acceptée en WebP.
 *
 * L'orientation EXIF est appliquée avant le redimensionnement (une photo
 * d'iPhone est stockée en paysage avec un drapeau « tourner à 90° » : la
 * retourner d'abord évite de réduire le mauvais côté). Les métadonnées ne
 * sont pas recopiées : l'encodeur repart des pixels.
 */
export async function toWebp(input: Uint8Array, options: WebpOptions): Promise<WebpResult> {
  const bytes = asBuffer(input);
  const limit = options.limitInputPixels ?? DEFAULT_PIXEL_LIMIT;
  const metadata = await imageMetadata(bytes, { limitInputPixels: limit });

  if (metadata.animated) {
    return toAnimatedWebp(bytes, metadata, options);
  }

  const target = insideSize(metadata.width, metadata.height, options.maxWidth, options.maxHeight);
  const pipeline = new Transformer(bytes).rotate();
  if (target.width !== metadata.width || target.height !== metadata.height) {
    pipeline.resize({ width: target.width, height: target.height, fit: ResizeFit.Fill });
  }
  const data = await pipeline.webp(options.quality);
  return { data, width: target.width, height: target.height, pages: 1 };
}

/**
 * WebP animé à partir d'un GIF ou d'un WebP animé.
 *
 * L'ordre est celui de `sharp` : orientation, puis redimensionnement de
 * chaque image, puis encodage, puis assemblage. Chaque image est composée en
 * pleine taille — c'est le prix d'un assembleur simple et d'un rendu
 * exact, transparence comprise.
 */
async function toAnimatedWebp(
  bytes: Buffer,
  metadata: ImageMetadata,
  options: WebpOptions,
): Promise<WebpResult> {
  const target = insideSize(metadata.width, metadata.height, options.maxWidth, options.maxHeight);
  const frames: AnimationFrame[] = [];

  if (metadata.format === "gif") {
    for (const frame of composeGifFrames(bytes)) {
      const pipeline = Transformer.fromRgbaPixels(
        frame.pixels,
        metadata.width,
        metadata.height,
      ).resize({ width: target.width, height: target.height, fit: ResizeFit.Fill });
      frames.push({ data: await pipeline.webp(options.quality), durationMs: frame.durationMs });
    }
  } else {
    const animation = readAnimatedWebp(bytes);
    if (!animation) throw new Error("animation WebP illisible");
    const canvas = new Uint8Array(animation.width * animation.height * 4);
    for (const frame of animation.frames) {
      const standalone = standaloneFrame(frame, animation.width, animation.height);
      const decoded = await new Transformer(standalone).rawPixels();
      const channels = decoded.length / (frame.width * frame.height);
      if (![3, 4].includes(channels)) throw new Error("image d'animation illisible");
      blit(canvas, animation.width, animation.height, frame, decoded, channels);
      const pipeline = Transformer.fromRgbaPixels(
        canvas,
        animation.width,
        animation.height,
      ).resize({ width: target.width, height: target.height, fit: ResizeFit.Fill });
      frames.push({ data: await pipeline.webp(options.quality), durationMs: frame.durationMs });
    }
  }

  return {
    data: muxAnimatedWebp(frames, { width: target.width, height: target.height }),
    width: target.width,
    height: target.height,
    pages: frames.length,
  };
}

/** Pose une image de WebP animé sur le canevas, selon ses drapeaux. */
function blit(
  canvas: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  frame: { x: number; y: number; width: number; height: number; noBlend: boolean },
  pixels: Buffer,
  channels: number,
): void {
  for (let row = 0; row < frame.height; row += 1) {
    const y = frame.y + row;
    if (y < 0 || y >= canvasHeight) continue;
    for (let column = 0; column < frame.width; column += 1) {
      const x = frame.x + column;
      if (x < 0 || x >= canvasWidth) continue;
      const source = (row * frame.width + column) * channels;
      const destination = (y * canvasWidth + x) * 4;
      const alpha = channels === 4 ? pixels[source + 3] / 255 : 1;
      if (alpha === 0) continue;
      if (alpha === 1 || frame.noBlend) {
        canvas[destination] = pixels[source];
        canvas[destination + 1] = pixels[source + 1];
        canvas[destination + 2] = pixels[source + 2];
        canvas[destination + 3] = channels === 4 ? pixels[source + 3] : 255;
        continue;
      }
      // Composition « source over » sur un canevas transparent.
      const backdrop = canvas[destination + 3] / 255;
      const out = alpha + backdrop * (1 - alpha);
      if (out === 0) continue;
      for (let channelIndex = 0; channelIndex < 3; channelIndex += 1) {
        canvas[destination + channelIndex] = Math.round(
          (pixels[source + channelIndex] * alpha +
            canvas[destination + channelIndex] * backdrop * (1 - alpha)) /
            out,
        );
      }
      canvas[destination + 3] = Math.round(out * 255);
    }
  }
}

/* ── Pixels bruts ──────────────────────────────────────────────────────── */

export type RawOptions = {
  width: number;
  height: number;
  /** `fill` étire ; `inside` conserve les proportions. */
  fit: "fill" | "inside";
  limitInputPixels?: number;
};

export type RawPixels = {
  /** Canaux entrelacés, 8 bits : 4 (RGBA) ou 3 (RGB). */
  data: Buffer;
  width: number;
  height: number;
  channels: number;
};

/**
 * Pixels d'une image redimensionnée.
 *
 * Sert à deux analyses qui n'ont pas besoin de couleurs exactes : l'empreinte
 * perceptuelle (9 × 8) et la proportion de tons chair (64 px). Le décodeur
 * rend RGBA ou RGB selon l'entrée : l'appelant lit `channels`.
 */
export async function rawPixels(input: Uint8Array, options: RawOptions): Promise<RawPixels> {
  const bytes = asBuffer(input);
  const metadata = await imageMetadata(bytes, {
    limitInputPixels: options.limitInputPixels ?? DEFAULT_PIXEL_LIMIT,
  });

  let width = options.width;
  let height = options.height;
  if (options.fit === "inside") {
    const target = insideSize(metadata.width, metadata.height, options.width, options.height);
    width = target.width;
    height = target.height;
  }

  const data = await new Transformer(bytes)
    .rotate()
    .resize({ width, height, fit: ResizeFit.Fill })
    .rawPixels();

  const channels = data.length / (width * height);
  return { data, width, height, channels };
}

/* ── Fabriques (tests et icônes) ───────────────────────────────────────── */

/** PNG uni — remplace les `sharp({ create })` des tests. */
export async function solidPng(
  width: number,
  height: number,
  color: { r: number; g: number; b: number; alpha?: number } = { r: 0, g: 0, b: 0 },
): Promise<Buffer> {
  const alpha = color.alpha ?? 255;
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 4] = color.r;
    pixels[index * 4 + 1] = color.g;
    pixels[index * 4 + 2] = color.b;
    pixels[index * 4 + 3] = alpha;
  }
  return Transformer.fromRgbaPixels(pixels, width, height).png();
}

/**
 * Rasterise un SVG à la largeur demandée.
 *
 * Utilisé par `scripts/pwa/generate-assets.mjs`. `sharp` rendait à une densité
 * de 384 dpi ; ici on demande directement la taille finale, ce qui donne le
 * même nombre de pixels sans dépendre d'un facteur de densité.
 */
export async function rasterizeSvg(svg: string, width: number): Promise<Buffer> {
  const transformer = Transformer.fromSvg(svg);
  const metadata = await transformer.metadata();
  if (!(metadata.width > 0)) throw new Error("SVG sans dimension");
  const height = Math.max(1, Math.round((width * metadata.height) / metadata.width));
  return transformer.resize({ width, height, fit: ResizeFit.Fill }).png();
}
