export { decodeDataUrl, readStickerAction } from "./application/sticker-input";
export {
  STICKER_COLOR_TOKENS,
  STICKER_GLYPH_MAX,
  STICKER_NAME_MAX,
  STICKER_UPLOAD_MAX_BYTES,
} from "./application/sticker-input";
export type {
  StickerAction,
  StickerActionRead,
  StickerColorToken,
} from "./application/sticker-input";
/*
 * Le re-encodage n'est **pas** réexporté ici : l'index est importé par un
 * composant client, et `sharp` est un module natif de serveur. L'export
 * l'aurait tiré dans le paquet du navigateur. Le serveur l'importe
 * directement depuis `infrastructure/image/reencode`.
 */
export { StickersRepositoryError } from "./ports/stickers-repository";
export type {
  ImageStickerInput,
  StickerAsset,
  StickerEntry,
  StickerInput,
  StickersRepository,
  TextStickerInput,
} from "./ports/stickers-repository";
