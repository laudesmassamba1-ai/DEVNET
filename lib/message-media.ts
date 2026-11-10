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
  | { kind: "sticker"; stickerId: string };

/** Colonnes média d'un message ; vides quand il n'y a pas de pièce jointe. */
export type AttachmentColumns = {
  gif_url: string;
  gif_alt: string;
  sticker_id: string | null;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Un message peut être vide de texte s'il porte une pièce jointe. */
export function canSendMessage(text: string, attachment?: MessageAttachment): boolean {
  if (text.trim().length > 0) return true;
  if (!attachment) return false;
  return attachment.kind === "gif"
    ? isAllowedGifUrl(attachment.gif.url)
    : UUID.test(attachment.stickerId);
}

export function attachmentColumns(attachment?: MessageAttachment): AttachmentColumns {
  if (!attachment) return { gif_url: "", gif_alt: "", sticker_id: null };
  if (attachment.kind === "sticker") {
    return {
      gif_url: "",
      gif_alt: "",
      sticker_id: UUID.test(attachment.stickerId) ? attachment.stickerId : null,
    };
  }
  const { url, alt } = attachment.gif;
  if (!isAllowedGifUrl(url)) return { gif_url: "", gif_alt: "", sticker_id: null };
  return {
    gif_url: url,
    gif_alt: String(alt ?? "").trim().slice(0, 300),
    sticker_id: null,
  };
}
