/**
 * Re-encodage serveur des stickers d'image.
 *
 * Le fichier d'origine n'est **jamais** publié tel quel : on le décode, on le
 * borne à 512 × 512, on le ré-encode en WebP (métadonnées retirées par le
 * décodeur), et on refuse ce qui reste trop lourd. Une image animée n'est pas
 * acceptée : un sticker animé viendra plus tard, avec sa propre limite de
 * durée, pas en laissant passer 200 images par accident.
 */
import { imageMetadata, toWebp } from "@/lib/media/image";

/** Plafond d'un sticker fixe, en octets. */
export const STICKER_OUTPUT_MAX_BYTES = 60 * 1024;
/** Plafond d'un sticker animé (GIF), en octets. */
export const STICKER_ANIMATED_MAX_BYTES = 1_500_000;
/** Côté maximal, en pixels. */
export const STICKER_MAX_SIDE = 512;
/** Images maximales d'un GIF : au-delà, ce n'est plus un sticker. */
export const STICKER_MAX_FRAMES = 80;

export interface ReencodedSticker {
  bytes: Buffer;
  mime: string;
  width: number;
  height: number;
  sha256: string;
}

export type ReencodeResult =
  | { ok: true; sticker: ReencodedSticker }
  | { ok: false; error: string };

const ACCEPTED = new Set(["png", "jpeg", "webp", "gif"]);

export async function reencodeSticker(source: Buffer): Promise<ReencodeResult> {
  let animated = false;
  try {
    // `imageMetadata` lit l'en-tête seul : un GIF annonçant 200 images est
    // refusé avant que la première ne soit décodée.
    const metadata = await imageMetadata(source, { limitInputPixels: 16_000_000 });
    if (!ACCEPTED.has(metadata.format)) {
      return { ok: false, error: "format d’image non accepté" };
    }
    animated = metadata.animated;
    if (animated && metadata.pages > STICKER_MAX_FRAMES) {
      return { ok: false, error: `${STICKER_MAX_FRAMES} images maximum pour un GIF` };
    }
    if (!metadata.width || !metadata.height) {
      return { ok: false, error: "image illisible" };
    }
  } catch {
    return { ok: false, error: "image illisible" };
  }

  const maxBytes = animated ? STICKER_ANIMATED_MAX_BYTES : STICKER_OUTPUT_MAX_BYTES;
  const qualities = animated ? [70, 55, 40, 30] : [72, 55, 40];

  for (const quality of qualities) {
    try {
      const encoded = await toWebp(source, {
        maxWidth: STICKER_MAX_SIDE,
        maxHeight: STICKER_MAX_SIDE,
        quality,
        limitInputPixels: 16_000_000,
      });

      if (encoded.data.length <= maxBytes) {
        const { createHash } = await import("node:crypto");
        return {
          ok: true,
          sticker: {
            bytes: encoded.data,
            mime: "image/webp",
            width: encoded.width,
            height: encoded.height,
            sha256: createHash("sha256").update(encoded.data).digest("hex"),
          },
        };
      }
    } catch {
      return { ok: false, error: "re-encodage impossible" };
    }
  }

  return {
    ok: false,
    error: animated
      ? "sticker animé trop lourd après re-encodage (1,5 Mo maximum)"
      : "sticker trop lourd après re-encodage (60 Ko maximum)",
  };
}
