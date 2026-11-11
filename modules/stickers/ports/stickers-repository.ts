/**
 * Port des stickers créés par les utilisateurs.
 *
 * Le catalogue de la maison (glyphes) et les stickers personnels partagent
 * la même table, mais pas le même contrat : un sticker personnel porte un
 * propriétaire, une visibilité et un état ; une image porte des octets
 * re-encodés côté serveur, jamais le fichier d'origine.
 */
export interface StickerEntry {
  id: string;
  pack: string;
  kind: "texte" | "image" | "animé";
  glyph: string;
  name: string;
  visibility: "prive" | "public";
  status: "actif" | "retire";
  /** Jetons de couleur ; vides pour le catalogue de la maison. */
  fg: string;
  bg: string;
  /** Vrai si le sticker appartient au lecteur. */
  mine: boolean;
  /** Taille re-encodée, en octets — 0 pour un sticker de texte. */
  byteSize: number;
  createdAt: string;
}

export interface TextStickerInput {
  kind: "texte";
  name: string;
  glyph: string;
  /** Jetons de couleur du thème (`signal`, `phosphor`, …), jamais des hex. */
  fg: string;
  bg: string;
  visibility: "prive" | "public";
}

export interface ImageStickerInput {
  kind: "image";
  name: string;
  /** Octets d'origine, déjà limités en amont (2 Mo). */
  source: Buffer;
  visibility: "prive" | "public";
}

export type StickerInput = TextStickerInput | ImageStickerInput;

export interface StickerAsset {
  mime: string;
  bytes: Buffer;
  visibility: "prive" | "public";
}

export interface StickersRepository {
  list(readerId: string | null): Promise<StickerEntry[]>;
  create(readerId: string, input: StickerInput): Promise<StickerEntry>;
  /** Retire un sticker : il reste en base, il n'est plus proposé. */
  retire(readerId: string, stickerId: string): Promise<void>;
  fetchAsset(readerId: string | null, stickerId: string): Promise<StickerAsset | null>;
}

export class StickersRepositoryError extends Error {
  constructor(
    readonly operation: "list-stickers" | "create-sticker" | "retire-sticker" | "read-asset",
    readonly code: string,
    message?: string,
    options?: ErrorOptions,
  ) {
    super(message ?? "Impossible d’enregistrer ce sticker. Réessaie dans un instant.", options);
    this.name = "StickersRepositoryError";
  }
}
