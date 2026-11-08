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
}

export interface PlacedSticker {
  id: string;
  stickerId: string;
  glyph: string;
  name: string;
  /** Centre du sticker, en fraction de la surface (0–1). */
  x: number;
  y: number;
  scale: number;
  rotation: number;
  z: number;
}

export interface StoryEntry extends StoryWithAuthor {
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
  reply(readerId: string, storyId: string, body: string): Promise<{ id: string }>;
  placeSticker(
    readerId: string,
    storyId: string,
    input: PlaceStickerInput,
  ): Promise<PlacedSticker>;
}

export class StoriesRepositoryError extends Error {
  constructor(
    readonly operation:
      | "list-stories"
      | "toggle-like"
      | "mark-seen"
      | "reply"
      | "place-sticker",
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(
      operation === "list-stories"
        ? "Impossible de charger les stories. Réessaie dans un instant."
        : "Impossible d’enregistrer ce geste. Réessaie dans un instant.",
      options,
    );
    this.name = "StoriesRepositoryError";
  }
}
