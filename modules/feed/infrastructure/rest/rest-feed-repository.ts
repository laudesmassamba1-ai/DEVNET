import { api } from "@/lib/api/client";
import type { PostWithAuthor } from "@/lib/types";
import { POST_AUTHOR_COLUMNS } from "@/lib/post-projections";
import type { FeedPage, FeedPageRequest, FeedRepository } from "../../ports/feed-repository";
import {
  FeedRepositoryError,
  hasNoFollowedAuthors,
} from "../../ports/feed-repository";

export class RestFeedRepository implements FeedRepository {
  async addLike(
    postId: string,
    userId: string,
  ): Promise<"created" | "already-exists"> {
    const { error } = await api.from("post_likes").insert({
      post_id: postId,
      user_id: userId,
    });
    if (!error) return "created";
    if (error.code === "23505") return "already-exists";
    throw new FeedRepositoryError("add-like", error.code ?? "unknown");
  }

  async removeLike(postId: string, userId: string): Promise<void> {
    const { error } = await api
      .from("post_likes")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", userId);
    if (error) {
      throw new FeedRepositoryError("remove-like", error.code ?? "unknown");
    }
  }

  async fetchPage(request: FeedPageRequest): Promise<FeedPage> {
    const followedIds = await this.getFollowedIds(request);
    if (hasNoFollowedAuthors(followedIds)) {
      return { rows: [], more: false, emptyScope: true };
    }

    let query = api
      .from("posts")
      .select(`*, author:${POST_AUTHOR_COLUMNS}`)
      .order("created_at", { ascending: false })
      .limit(request.pageSize + 1);

    if (request.before) query = query.lt("created_at", request.before);
    if (followedIds) query = query.in("author_id", followedIds);

    const { data, error } = await query;
    if (error) {
      throw new FeedRepositoryError("list-feed", error.code ?? "unknown");
    }

    const rows = (data as PostWithAuthor[] | null) ?? [];
    return {
      rows: rows.slice(0, request.pageSize),
      more: rows.length > request.pageSize,
      emptyScope: false,
    };
  }

  private async getFollowedIds(request: FeedPageRequest): Promise<string[] | null> {
    if (request.scope !== "followed") return null;

    const { data, error } = await api
      .from("follows")
      .select("followee_id")
      .eq("follower_id", request.readerId ?? "");

    if (error) {
      throw new FeedRepositoryError("list-followed-authors", error.code ?? "unknown");
    }

    return ((data as { followee_id: string }[] | null) ?? []).map((row) =>
      String(row.followee_id),
    );
  }
}
