import type { PostWithAuthor } from "@/lib/types";
import type {
  FeedPage,
  FeedPageRequest,
  FeedRepository,
  FeedScope,
} from "../ports/feed-repository";
import { FeedRepositoryError } from "../ports/feed-repository";

export const DEFAULT_FEED_PAGE_SIZE = 12;

export interface FetchFeedPageOptions {
  scope?: FeedScope;
  me?: string | null;
  before?: string | null;
  pageSize?: number;
}

export function createFeedService(
  getRepository: () => FeedRepository,
  enrichAuthors: (rows: PostWithAuthor[]) => Promise<PostWithAuthor[]>,
) {
  return {
    async fetchPage(options: FetchFeedPageOptions = {}): Promise<FeedPage> {
      const request: FeedPageRequest = {
        scope: options.scope ?? "all",
        readerId: options.me ?? null,
        before: options.before ?? null,
        pageSize: options.pageSize ?? DEFAULT_FEED_PAGE_SIZE,
      };
      const page = await getRepository().fetchPage(request);
      return { ...page, rows: await enrichAuthors(page.rows) };
    },
    async toggleLike(
      postId: string,
      userId: string,
    ): Promise<{ liked: boolean; error: string | null }> {
      const repository = getRepository();
      let result: "created" | "already-exists";

      try {
        result = await repository.addLike(postId, userId);
      } catch (error) {
        if (!(error instanceof FeedRepositoryError)) throw error;
        return { liked: false, error: error.message };
      }

      if (result === "created") return { liked: true, error: null };

      try {
        await repository.removeLike(postId, userId);
        return { liked: false, error: null };
      } catch (error) {
        if (!(error instanceof FeedRepositoryError)) throw error;
        return { liked: true, error: error.message };
      }
    },
  };
}
