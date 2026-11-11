/**
 * Paramètres d'une page de fil, validés avant d'atteindre la base.
 *
 * Les bornes vivent ici, pas dans l'écran : un `pageSize=9999` venu d'un
 * client ne doit pas devenir une requête qui ramène la table entière.
 */
export const DEFAULT_FEED_PAGE_SIZE = 12;
export const MAX_FEED_PAGE_SIZE = 30;

export interface FeedQuery {
  scope: "all" | "followed";
  pageSize: number;
  before: string | null;
}

export function readFeedQuery(params: URLSearchParams): FeedQuery {
  const scope: FeedQuery["scope"] = params.get("scope") === "followed" ? "followed" : "all";

  const requested = Number(params.get("pageSize") ?? DEFAULT_FEED_PAGE_SIZE);
  const pageSize =
    Number.isFinite(requested) && requested >= 1
      ? Math.min(Math.floor(requested), MAX_FEED_PAGE_SIZE)
      : DEFAULT_FEED_PAGE_SIZE;

  const before = params.get("before");
  return { scope, pageSize, before: before && before.trim() ? before : null };
}
