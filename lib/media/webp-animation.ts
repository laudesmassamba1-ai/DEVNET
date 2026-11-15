/**
 * Assemblage d'un WebP animé — sans dépendance non permissive.
 *
 * ## Pourquoi ce fichier existe
 *
 * `sharp` savait convertir un GIF animé en WebP animé. Son remplaçant
 * (`@napi-rs/image`) encode des images **fixes** et ne connaît ni le GIF ni
 * l'animation : c'est écrit noir sur blanc dans son README. Or DEVNET accepte
 * des stickers et des statuts animés. Perdre l'animation serait une
 * régression fonctionnelle, pas un détail d'implémentation.
 *
 * Le GIF est donc décodé image par image (`omggif`, MIT), chaque image est
 * composée puis encodée en WebP par `@napi-rs/image` (MIT), et ce module
 * assemble le conteneur animé : c'est du format RIFF, décrit par la
 * spécification WebP (VP8X, ANIM, ANMF). Aucun code de `libwebp` n'est copié :
 * on écrit les en-têtes, pas les codecs.
 *
 * ## Sémantique de composition GIF
 *
 * Un GIF n'est pas une suite d'images pleines : chaque image est un rectangle
 * posé sur un canevas, avec une méthode de disposition (`disposal`) qui dit
 * quoi faire du rectangle avant l'image suivante. `omggif` applique la
 * transparence et le rectangle, pas la disposition. Les trois valeurs utiles :
 *
 * - `0` / `1` : on garde ce qui est dessiné ;
 * - `2` : on efface le rectangle (retour au fond) ;
 * - `3` : on restaure l'état d'avant l'image.
 *
 * On compose donc **l'état visuel complet** de chaque image, ce qui rend le
 * fichier WebP lisible sans rejouer la logique du GIF.
 */

/** Une image du conteneur : octets WebP complets et durée d'affichage. */
export type AnimationFrame = {
  data: Buffer;
  durationMs: number;
};

const RIFF_HEADER = 12;
/** Chunk pair : un bourrage d'un octet suit une charge impaire. */
const padded = (size: number) => size + (size % 2);

/** Découpe un fichier WebP en chunks (`VP8X` exclu : il décrit le fichier). */
function frameChunks(webp: Buffer): Buffer[] {
  if (
    webp.length < RIFF_HEADER ||
    webp.toString("ascii", 0, 4) !== "RIFF" ||
    webp.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new Error("image WebP invalide");
  }

  const chunks: Buffer[] = [];
  let offset = RIFF_HEADER;
  while (offset + 8 <= webp.length) {
    const id = webp.toString("ascii", offset, offset + 4);
    const size = webp.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > webp.length) break;
    // `VP8X` porte la taille du canevas : dans une image de `ANMF`, c'est
    // celui du cadre qui compte, pas le fichier d'origine.
    if (id !== "VP8X") {
      const payload = webp.subarray(offset + 8, end);
      const chunk = Buffer.alloc(8 + padded(size));
      chunk.write(id, 0, 4, "ascii");
      chunk.writeUInt32LE(size, 4);
      payload.copy(chunk, 8);
      chunks.push(chunk);
    }
    offset = end + (size % 2);
  }

  if (chunks.length === 0) throw new Error("image WebP sans données");
  return chunks;
}

function chunk(id: string, payload: Buffer): Buffer {
  const buffer = Buffer.alloc(8 + padded(payload.length));
  buffer.write(id, 0, 4, "ascii");
  buffer.writeUInt32LE(payload.length, 4);
  payload.copy(buffer, 8);
  return buffer;
}

/** Entier 24 bits little-endian, l'unité du format. */
function write24(target: Buffer, value: number, offset: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >> 8) & 0xff;
  target[offset + 2] = (value >> 16) & 0xff;
}

export type MuxOptions = {
  width: number;
  height: number;
  /** `0` = boucle infinie, comme la quasi-totalité des GIF de l'application. */
  loopCount?: number;
};

/**
 * Assemble les images en un WebP animé.
 *
 * Chaque image est pleine (tout le canevas) et composée. Elle est donc posée
 * en « remplacer » (`blend = 0` avec `disposal = restore to background`) sur
 * un fond transparent : ce que montre la dernière image est exactement ce que
 * montre le GIF au même instant, transparence comprise.
 */
export function muxAnimatedWebp(
  frames: AnimationFrame[],
  options: MuxOptions,
): Buffer {
  if (frames.length === 0) throw new Error("animation sans image");
  const { width, height } = options;
  if (!(width > 0 && height > 0)) throw new Error("dimensions d'animation invalides");
  if (frames.length > 0xffff) throw new Error("trop d'images pour un WebP animé");

  // VP8X : drapeau « animation », canevas moins un (le format stocke w-1).
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x02; // animation
  write24(vp8x, width - 1, 4);
  write24(vp8x, height - 1, 7);

  // ANIM : fond transparent (BGRA) puis nombre de boucles.
  const anim = Buffer.alloc(6);
  anim.writeUInt16LE(options.loopCount ?? 0, 4);

  const parts: Buffer[] = [chunk("VP8X", vp8x), chunk("ANIM", anim)];

  for (const frame of frames) {
    const payload: Buffer[] = [];
    const header = Buffer.alloc(16);
    // x = 0, y = 0, largeur - 1, hauteur - 1, durée (ms)
    write24(header, 0, 0);
    write24(header, 0, 3);
    write24(header, width - 1, 6);
    write24(header, height - 1, 9);
    write24(header, Math.max(0, Math.min(0xffffff, Math.round(frame.durationMs))), 12);
    // bit 0 : disposal (1 = restaurer le fond) ; bit 1 : blending
    // (0 = composition alpha sur fond transparent).
    header[15] = 0x01;
    payload.push(header, ...frameChunks(frame.data));
    parts.push(chunk("ANMF", Buffer.concat(payload)));
  }

  const body = Buffer.concat(parts);
  const riff = Buffer.alloc(RIFF_HEADER);
  riff.write("RIFF", 0, 4, "ascii");
  riff.writeUInt32LE(body.length + RIFF_HEADER - 8, 4);
  riff.write("WEBP", 8, 4, "ascii");
  return Buffer.concat([riff, body]);
}

/* ── Lecture : un WebP animé est aussi une entrée possible ───────────────
 *
 * Un GIF n'est pas le seul média animé qu'un navigateur produit : « copier
 * l'image » d'un GIF dans Chrome donne un WebP animé, et les outils de
 * création en exportent. `sharp` savait le réencoder ; on doit donc savoir le
 * relire, sinon ces fichiers seraient silencieusement aplatis sur leur
 * première image.
 */

export type AnimatedWebpFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  durationMs: number;
  /** Méthode de disposition : 0 = aucune, 1 = restaurer le fond. */
  disposeToBackground: boolean;
  /** Vrai = la image remplace le canevas au lieu de s'y composer. */
  noBlend: boolean;
  /** Chunks de l'image (`ALPH`, `VP8 ` ou `VP8L`), sans en-tête RIFF. */
  chunks: Buffer;
};

export type AnimatedWebp = {
  width: number;
  height: number;
  loopCount: number;
  frames: AnimatedWebpFrame[];
};

function readChunks(webp: Buffer): { id: string; payload: Buffer }[] {
  if (
    webp.length < RIFF_HEADER ||
    webp.toString("ascii", 0, 4) !== "RIFF" ||
    webp.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return [];
  }
  const chunks: { id: string; payload: Buffer }[] = [];
  let offset = RIFF_HEADER;
  while (offset + 8 <= webp.length) {
    const id = webp.toString("ascii", offset, offset + 4);
    const size = webp.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > webp.length) break;
    chunks.push({ id, payload: webp.subarray(offset + 8, end) });
    offset = end + (size % 2);
  }
  return chunks;
}

const read24 = (buffer: Buffer, offset: number) =>
  buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);

/**
 * Décrit un WebP animé, ou rend `null` si le fichier est fixe.
 *
 * On lit les en-têtes seulement : le décodage des images est fait par
 * l'appelant, avec le décodeur natif.
 */
export function readAnimatedWebp(bytes: Buffer): AnimatedWebp | null {
  const chunks = readChunks(bytes);
  if (chunks.length === 0) return null;

  const vp8x = chunks.find((entry) => entry.id === "VP8X");
  const anim = chunks.find((entry) => entry.id === "ANIM");
  if (!vp8x || !anim || vp8x.payload.length < 10) return null;
  if ((vp8x.payload[0] & 0x02) === 0) return null; // drapeau animation absent

  const width = read24(vp8x.payload, 4) + 1;
  const height = read24(vp8x.payload, 7) + 1;
  const loopCount = anim.payload.length >= 6 ? anim.payload.readUInt16LE(4) : 0;

  const frames: AnimatedWebpFrame[] = [];
  for (const entry of chunks) {
    if (entry.id !== "ANMF" || entry.payload.length < 16) continue;
    const payload = entry.payload;
    const header = payload.subarray(0, 16);
    const frameWidth = read24(header, 6) + 1;
    const frameHeight = read24(header, 9) + 1;
    const flags = header[15];
    frames.push({
      x: read24(header, 0) * 2,
      y: read24(header, 3) * 2,
      width: frameWidth,
      height: frameHeight,
      durationMs: read24(header, 12),
      disposeToBackground: (flags & 0x01) === 0x01,
      noBlend: (flags & 0x02) === 0x02,
      chunks: payload.subarray(16),
    });
  }

  if (frames.length === 0) return null;
  return { width, height, loopCount, frames };
}

/**
 * Fabrique un fichier WebP autonome pour une image de l'animation.
 *
 * Le décodeur natif lit un fichier WebP, pas un chunk `ANMF` : on recompose
 * l'en-tête autour des chunks de l'image. `VP8X` porte le drapeau alpha pour
 * que le canal de transparence soit lu même quand il est entièrement opaque.
 */
export function standaloneFrame(
  frame: AnimatedWebpFrame,
  canvasWidth: number,
  canvasHeight: number,
): Buffer {
  const vp8x = Buffer.alloc(10);
  // Le drapeau alpha ne se pose que si l'image porte réellement un chunk
  // `ALPH` : un décodeur qui l'attend et ne le trouve pas rejette le fichier.
  if (frame.chunks.subarray(0, 4).toString("ascii") === "ALPH") vp8x[0] = 0x10;
  write24(vp8x, canvasWidth - 1, 4);
  write24(vp8x, canvasHeight - 1, 7);
  const body = Buffer.concat([chunk("VP8X", vp8x), frame.chunks]);
  const riff = Buffer.alloc(RIFF_HEADER);
  riff.write("RIFF", 0, 4, "ascii");
  riff.writeUInt32LE(body.length + RIFF_HEADER - 8, 4);
  riff.write("WEBP", 8, 4, "ascii");
  return Buffer.concat([riff, body]);
}
