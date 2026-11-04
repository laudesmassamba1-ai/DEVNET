import { getBackend, getSupabaseUrl, isDemoAllowed } from "@/lib/backend";
import { withAuthorXp } from "@/lib/author-xp";
import {
  createFeedService,
  type FetchFeedPageOptions,
  type FeedPage,
} from "@/modules/feed";
import { MemoryFeedRepository } from "@/modules/feed/infrastructure/memory/memory-feed-repository";
import { SupabaseFeedRepository } from "@/modules/feed/infrastructure/supabase/supabase-feed-repository";
import type { FeedRepository } from "@/modules/feed/ports/feed-repository";

const feedService = createFeedService(getFeedRepository, withAuthorXp);

export function fetchFeedPage(options: FetchFeedPageOptions = {}): Promise<FeedPage> {
  return feedService.fetchPage(options);
}

export function toggleFeedLike(
  postId: string,
  userId: string,
): Promise<{ liked: boolean; error: string | null }> {
  return feedService.toggleLike(postId, userId);
}

export function getFeedRepository(): FeedRepository {
  if (shouldUseMemoryFeed()) return new MemoryFeedRepository();
  return new SupabaseFeedRepository();
}

function shouldUseMemoryFeed(): boolean {
  if (process.env.NEXT_PUBLIC_FORCE_DEMO === "true" || !getSupabaseUrl()) {
    return true;
  }

  const backend = getBackend();
  return backend.state === "offline" && isDemoAllowed();
}
