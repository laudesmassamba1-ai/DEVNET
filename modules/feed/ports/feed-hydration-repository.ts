/**
 * Port de l'hydratation du fil.
 *
 * Une page de fil arrive **anonyme** : les publications ne savent pas qui les
 * regarde. Les quatre états d'interaction du lecteur — aimé, republié,
 * réaction, signet — sont donc lus à part, pour un ensemble d'identifiants
 * déjà affichés.
 *
 * Ils sont servis ensemble parce qu'ils appartiennent au même lecteur et à la
 * même page : quatre allers-retours pour quatre colonnes différentes
 * multipliaient la latence et les occasions de divergence.
 */
export interface FeedHydration {
  likedPostIds: string[];
  repostedPostIds: string[];
  /** Émoji choisi par le lecteur, par publication. */
  reactions: Record<string, string>;
  bookmarkedPostIds: string[];
}

export function emptyHydration(): FeedHydration {
  return { likedPostIds: [], repostedPostIds: [], reactions: {}, bookmarkedPostIds: [] };
}

/** Plafond d'identifiants par requête : une page ne dépasse pas 30 lignes. */
export const MAX_HYDRATION_POSTS = 60;

export interface FeedHydrationRepository {
  fetchHydration(readerId: string | null, postIds: string[]): Promise<FeedHydration>;
}

export class FeedHydrationError extends Error {
  constructor(
    readonly operation: "fetch-hydration",
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super("Impossible de charger l’état des publications. Réessaie dans un instant.", options);
    this.name = "FeedHydrationError";
  }
}
