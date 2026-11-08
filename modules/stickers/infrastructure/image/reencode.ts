/**
 * Re-encodage serveur des stickers d'image.
 *
 * Le fichier d'origine n'est **jamais** publié tel quel : on le décode, on le
 * borne à 512 × 512, on le ré-encode en WebP (métadonnées retirées par le
 * décodeur), et on refuse ce qui reste trop lourd. Une image animée n'est pas
 * acceptée : un sticker animé viendra plus tard, avec sa propre limite de
 * durée, pas en laissant passer 200 images par accident.
 */
import sharp from "sharp";

/** Plafond du sticker produit, en octets. */
export const STICKER_OUTPUT_MAX_BYTES = 60 * 1024;
/** Côté maximal, en pixels. */
export const STICKER_MAX_SIDE = 512;

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

const ACCEPTED = new Set(["png", "jpeg", "webp"]);

type Pipeline = ReturnType<typeof sharp>;

export async function reencodeSticker(source: Buffer): Promise<ReencodeResult> {
  let pipeline: Pipeline;
  try {
    pipeline = sharp(source, { limitInputPixels: 16_000_000, animated: false });
    const metadata = await pipeline.metadata();
    if (!metadata.format || !ACCEPTED.has(metadata.format)) {
      return { ok: false, error: "format d’image non accepté" };
    }
    if ((metadata.pages ?? 1) > 1) {
      return { ok: false, error: "image animée non acceptée pour un sticker" };
    }
    if (!metadata.width || !metadata.height) {
      return { ok: false, error: "image illisible" };
    }
  } catch {
    return { ok: false, error: "image illisible" };
  }

  for (const quality of [72, 55, 40]) {
    try {
      const { data, info } = await sharp(source, { limitInputPixels: 16_000_000, animated: false })
        .rotate()
        .resize({
          width: STICKER_MAX_SIDE,
          height: STICKER_MAX_SIDE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality, alphaQuality: 80, effort: 4 })
        .toBuffer({ resolveWithObject: true });

      if (data.length <= STICKER_OUTPUT_MAX_BYTES) {
        const { createHash } = await import("node:crypto");
        return {
          ok: true,
          sticker: {
            bytes: data,
            mime: "image/webp",
            width: info.width,
            height: info.height,
            sha256: createHash("sha256").update(data).digest("hex"),
          },
        };
      }
    } catch {
      return { ok: false, error: "re-encodage impossible" };
    }
  }

  return { ok: false, error: "sticker trop lourd après re-encodage (60 Ko maximum)" };
}
