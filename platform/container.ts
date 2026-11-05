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
import { createReportService } from "@/modules/moderation";
import { SupabaseReportRepository } from "@/modules/moderation/infrastructure/supabase/supabase-report-repository";
import { createMessageExtrasService } from "@/modules/messages";
import { SupabaseMessageExtrasRepository } from "@/modules/messages/infrastructure/supabase/supabase-message-extras-repository";

const feedService = createFeedService(getFeedRepository, withAuthorXp);

/**
 * Les signalements n'ont qu'un adaptateur : le client maison bascule lui-même
 * sur le backend de démonstration quand le vrai est absent. Le conteneur n'a
 * donc rien à choisir — mais la composition reste ici, au même endroit que
 * celle du fil, pour qu'un futur adaptateur PostgreSQL n'ait qu'un fichier à
 * toucher.
 */
export const reportService = createReportService(
  () => new SupabaseReportRepository(),
);

/**
 * Le domaine messages suit la même règle : un seul adaptateur, composé ici.
 * Les réactions, les épingles et la suppression passent par lui, que le
 * backend soit réel ou démontré.
 */
export const messageExtrasService = createMessageExtrasService(
  () => new SupabaseMessageExtrasRepository(),
);

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
