import type { PostWithAuthor } from "@/lib/types";

export type FeedScope = "all" | "followed";

export function hasNoFollowedAuthors(followedIds: string[] | null): boolean {
  return followedIds !== null && followedIds.length === 0;
}

export interface FeedPageRequest {
  scope: FeedScope;
  readerId: string | null;
  before: string | null;
  pageSize: number;
}

export interface FeedPage {
  rows: PostWithAuthor[];
  more: boolean;
  emptyScope: boolean;
}

export interface FeedRepository {
  fetchPage(request: FeedPageRequest): Promise<FeedPage>;
  addLike(postId: string, userId: string): Promise<"created" | "already-exists">;
  removeLike(postId: string, userId: string): Promise<void>;
}

export class FeedRepositoryError extends Error {
  constructor(
    readonly operation:
      | "list-feed"
      | "list-followed-authors"
      | "add-like"
      | "remove-like",
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(
      operation === "add-like" || operation === "remove-like"
        ? "Impossible de mettre à jour le J’aime. Réessaie dans un instant."
        : "Impossible de charger le fil. Réessaie dans un instant.",
      options,
    );
    this.name = "FeedRepositoryError";
  }
}
