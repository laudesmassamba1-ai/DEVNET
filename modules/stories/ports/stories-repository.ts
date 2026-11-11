/**
 * Port des stories et de leurs interactions.
 *
 * Une story se lit **avec** son état pour le lecteur : a-t-il aimé, l'a-t-il
 * vue, combien de personnes l'ont aimée, quels stickers sont posés. Cet état
 * voyage avec la story, dans une seule réponse : quatre appels pour quatre
 * colonnes multiplieraient les occasions de divergence.
 *
 * Le compteur de likes et celui des vues ne sont renseignés que pour
 * l'auteur ; pour tout le monde d'autre, `likes` vaut `0` et `views` vaut
 * `0`. Ce n'est pas un oubli : une story n'affiche pas de métrique publique.
 */
import type { StoryWithAuthor } from "@/lib/types";

export interface StickerCatalogEntry {
  id: string;
  pack: string;
  kind: "texte" | "image" | "animé";
  glyph: string;
  name: string;
  /** Jetons de couleur ; vides pour le catalogue de la maison. */
  fg: string;
  bg: string;
}

export interface PlacedSticker {
  id: string;
  stickerId: string;
  kind: "texte" | "image" | "animé";
  glyph: string;
  name: string;
  fg: string;
  bg: string;
  /** Centre du sticker, en fraction de la surface (0–1). */
  x: number;
  y: number;
  scale: number;
  rotation: number;
  z: number;
}

export interface StoryEntry extends StoryWithAuthor {
  /**
   * Média de la story, s'il y en a un. Seul le type voyage avec le fil :
   * les octets sont servis par une route dédiée, jamais dans la liste.
   */
  media: { mime: string } | null;
  /** Nombre de likes — renseigné pour l'auteur seulement. */
  likes: number;
  /** Nombre de vues — renseigné pour l'auteur seulement. */
  views: number;
  liked: boolean;
  seen: boolean;
  stickers: PlacedSticker[];
}

export interface StoryFeed {
  stories: StoryEntry[];
  catalog: StickerCatalogEntry[];
}

export interface PlaceStickerInput {
  stickerId: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface StoriesRepository {
  fetchFeed(readerId: string | null): Promise<StoryFeed>;
  /** Bascule le like : `liked` est l'état **après** l'appel. */
  toggleLike(readerId: string, storyId: string): Promise<{ liked: boolean; likes: number }>;
  markSeen(readerId: string, storyId: string): Promise<void>;
  /**
   * Réponse privée. Elle est enregistrée deux fois, volontairement : comme
   * réponse de story (contexte) et comme message dans la conversation
   * privée entre les deux personnes, pour qu'elle apparaisse là où l'on
   * parle vraiment.
   */
  reply(
    readerId: string,
    storyId: string,
    body: string,
  ): Promise<{ id: string; conversationId: string; messageId: string }>;
  placeSticker(
    readerId: string,
    storyId: string,
    input: PlaceStickerInput,
  ): Promise<PlacedSticker>;
  /**
   * Déplace, tourne ou redimensionne un sticker déjà posé. Réservé à
   * l'auteur de la story, tant qu'elle est vivante.
   */
  moveSticker(
    readerId: string,
    storyId: string,
    placedId: string,
    input: Omit<PlaceStickerInput, "stickerId">,
  ): Promise<PlacedSticker>;
  /** Retire un sticker posé — la story, elle, reste. */
  removeSticker(readerId: string, storyId: string, placedId: string): Promise<void>;
  /** Publie une story, avec ou sans média déjà re-encodé. */
  createStory(
    authorId: string,
    input: {
      caption: string;
      media?: {
        bytes: Buffer;
        mime: string;
        width: number | null;
        height: number | null;
        durationMs: number | null;
      };
    },
  ): Promise<{ id: string }>;
  /** Octets du média, sous les droits du lecteur. */
  fetchStoryMedia(
    readerId: string | null,
    storyId: string,
  ): Promise<{ mime: string; bytes: Buffer } | null>;
}

export class StoriesRepositoryError extends Error {
  constructor(
    readonly operation:
      | "list-stories"
      | "toggle-like"
      | "mark-seen"
      | "reply"
      | "move-sticker"
      | "remove-sticker"
      | "place-sticker"
      | "create-story"
      | "read-story-media",
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(
      operation === "list-stories"
        ? "Impossible de charger les stories. Réessaie dans un instant."
        : operation === "create-story"
          ? "Impossible de publier la story. Réessaie dans un instant."
          : operation === "read-story-media"
            ? "Impossible de charger le média. Réessaie dans un instant."
            : "Impossible d’enregistrer ce geste. Réessaie dans un instant.",
      options,
    );
    this.name = "StoriesRepositoryError";
  }
}
