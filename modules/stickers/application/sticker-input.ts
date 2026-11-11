/**
 * Validation et normalisation des stickers créés par les utilisateurs.
 *
 * Le studio ne décide de rien : il propose. Ce module est l'endroit où une
 * proposition devient acceptable — longueur du nom, glyphe borné, couleurs
 * prises dans les **jetons du thème** (jamais un hex), visibilité déclarée,
 * taille d'image. Un refus dit quoi corriger.
 */
const STICKER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const STICKER_NAME_MAX = 40;
export const STICKER_GLYPH_MAX = 8;
export const STICKER_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

/** Jetons de couleur acceptés — les mêmes que `app/globals.css`. */
export const STICKER_COLOR_TOKENS = [
  "signal",
  "phosphor",
  "ok",
  "danger",
  "warn",
  "info",
  "chalk",
  "surface",
  "surface-2",
  "surface-3",
  "void",
] as const;

export type StickerColorToken = (typeof STICKER_COLOR_TOKENS)[number];

export type StickerAction =
  | {
      action: "texte";
      name: string;
      glyph: string;
      fg: StickerColorToken;
      bg: StickerColorToken;
      visibility: "prive" | "public";
    }
  | { action: "image"; name: string; dataUrl: string; visibility: "prive" | "public" }
  | { action: "retire"; stickerId: string };

export type StickerActionRead = { ok: true; value: StickerAction } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function token(value: unknown): StickerColorToken | null {
  return typeof value === "string" &&
    (STICKER_COLOR_TOKENS as readonly string[]).includes(value)
    ? (value as StickerColorToken)
    : null;
}

/** Le glyphe est borné en points de code, pas en octets. */
function glyph(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (clean.length === 0) return null;
  if ([...clean].length > STICKER_GLYPH_MAX) return null;
  // Pas de balisage, pas de saut de ligne : un glyphe est un signe.
  if (/[<>&\n\r\t]/.test(clean)) return null;
  return clean.normalize("NFC");
}

function name(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/\s+/g, " ");
  if (clean.length === 0 || clean.length > STICKER_NAME_MAX) return null;
  if (/[<>&]/.test(clean)) return null;
  return clean;
}

function visibility(value: unknown): "prive" | "public" {
  return value === "public" ? "public" : "prive";
}

const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/;

export function readStickerAction(raw: unknown): StickerActionRead {
  if (!isRecord(raw)) return { ok: false, error: "corps de requête invalide" };

  if (raw.action === "retire") {
    const stickerId = typeof raw.stickerId === "string" ? raw.stickerId.trim() : "";
    if (!STICKER_ID.test(stickerId)) return { ok: false, error: "sticker inconnu" };
    return { ok: true, value: { action: "retire", stickerId } };
  }

  const stickerName = name(raw.name);
  if (!stickerName) {
    return { ok: false, error: `nom requis, ${STICKER_NAME_MAX} caractères maximum` };
  }

  if (raw.action === "texte") {
    const sign = glyph(raw.glyph);
    if (!sign) return { ok: false, error: "glyphe requis (un signe, huit au plus)" };
    const fg = token(raw.fg);
    const bg = token(raw.bg);
    if (!fg) return { ok: false, error: "couleur de signe inconnue" };
    if (!bg) return { ok: false, error: "couleur de fond inconnue" };
    return {
      ok: true,
      value: {
        action: "texte",
        name: stickerName,
        glyph: sign,
        fg,
        bg,
        visibility: visibility(raw.visibility),
      },
    };
  }

  if (raw.action === "image") {
    const dataUrl = typeof raw.dataUrl === "string" ? raw.dataUrl : "";
    if (!DATA_URL.test(dataUrl)) {
      return { ok: false, error: "image PNG, JPEG, WebP ou GIF attendue" };
    }
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    // Une chaîne base64 de 2 Mo d'image pèse ~2,7 Mo de texte : on borne la
    // chaîne avant de décoder, sinon le décodage lui-même est l'attaque.
    if (base64.length > Math.ceil((STICKER_UPLOAD_MAX_BYTES * 4) / 3)) {
      return { ok: false, error: "image trop lourde (2 Mo maximum)" };
    }
    return {
      ok: true,
      value: {
        action: "image",
        name: stickerName,
        dataUrl,
        visibility: visibility(raw.visibility),
      },
    };
  }

  return { ok: false, error: "action inconnue" };
}

/** Décode une data URL validée en octets, ou `null`. */
export function decodeDataUrl(dataUrl: string): { bytes: Buffer; mime: string } | null {
  const match = DATA_URL.exec(dataUrl);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > STICKER_UPLOAD_MAX_BYTES) return null;
  return { bytes, mime: `image/${match[1]}` };
}
