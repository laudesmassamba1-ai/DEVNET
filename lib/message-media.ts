/**
 * Pièces jointes d'un message : sticker ou GIF.
 *
 * Ce module ne rend rien et ne parle à aucune base : il décide **ce qui
 * a le droit de partir**. Un GIF dont l'URL n'est pas un lien https d'un
 * fournisseur connu, ou un identifiant de sticker qui n'est pas un uuid,
 * est écarté avant l'insertion. Les deux écrans de messagerie passent
 * par ici, pour que le privé et le canal aient exactement la même règle.
 */
import { isAllowedGifUrl, type Gif } from "./gifs";

export type MessageAttachment =
  | { kind: "gif"; gif: Gif }
  | { kind: "sticker"; stickerId: string }
  | { kind: "media"; url: string; mediaType: "image" | "video" };

/** Colonnes média d'un message ; vides quand il n'y a pas de pièce jointe. */
export type AttachmentColumns = {
  gif_url: string;
  gif_alt: string;
  sticker_id: string | null;
  media_url: string;
  media_type: "" | "image" | "video";
};

/**
 * Un média est soit une URL https (production, bucket `media`), soit une
 * data URL d'image ou de vidéo (démonstration, rangée avec la ligne).
 * Tout le reste — `javascript:`, un schéma inconnu — est écarté.
 */
export function isAllowedMediaUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  if (/^data:(image|video)\/[a-z0-9.+-]+;base64,/i.test(raw)) return true;
  try {
    const url = new URL(raw);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Un message peut être vide de texte s'il porte une pièce jointe. */
const EMPTY: AttachmentColumns = {
  gif_url: "",
  gif_alt: "",
  sticker_id: null,
  media_url: "",
  media_type: "",
};

export function canSendMessage(text: string, attachment?: MessageAttachment): boolean {
  if (text.trim().length > 0) return true;
  if (!attachment) return false;
  if (attachment.kind === "gif") return isAllowedGifUrl(attachment.gif.url);
  if (attachment.kind === "media") return isAllowedMediaUrl(attachment.url);
  return UUID.test(attachment.stickerId);
}

export function attachmentColumns(attachment?: MessageAttachment): AttachmentColumns {
  if (!attachment) return EMPTY;
  if (attachment.kind === "sticker") {
    return {
      ...EMPTY,
      sticker_id: UUID.test(attachment.stickerId) ? attachment.stickerId : null,
    };
  }
  if (attachment.kind === "media") {
    if (!isAllowedMediaUrl(attachment.url)) return EMPTY;
    return {
      ...EMPTY,
      media_url: attachment.url,
      media_type: attachment.mediaType === "video" ? "video" : "image",
    };
  }
  const { url, alt } = attachment.gif;
  if (!isAllowedGifUrl(url)) return EMPTY;
  return {
    ...EMPTY,
    gif_url: url,
    gif_alt: String(alt ?? "").trim().slice(0, 300),
  };
}
