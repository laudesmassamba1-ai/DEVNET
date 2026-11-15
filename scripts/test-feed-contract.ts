import assert from "node:assert/strict";
import { createFeedService } from "../modules/feed/application/feed-service";
import { MemoryFeedRepository } from "../modules/feed/infrastructure/memory/memory-feed-repository";
import {
  FeedRepositoryError,
  hasNoFollowedAuthors,
  type FeedPageRequest,
  type FeedRepository,
} from "../modules/feed/ports/feed-repository";
import { demoFrom } from "../lib/demo/query";
import { resetStore } from "../lib/demo/store";

async function main(): Promise<void> {
  assert.equal(hasNoFollowedAuthors(null), false);
  assert.equal(hasNoFollowedAuthors([]), true);

  resetStore();
  const repository = new MemoryFeedRepository();

  const firstPage = await repository.fetchPage({
    scope: "all",
    readerId: null,
    before: null,
    pageSize: 3,
  });
  assert.equal(firstPage.rows.length, 3);
  assert.equal(firstPage.more, true);
  assert.equal(firstPage.emptyScope, false);
  assert.deepEqual(
    firstPage.rows.map((row) => row.created_at),
    [...firstPage.rows.map((row) => row.created_at)].sort().reverse(),
  );

  const followingLinks = await demoFrom("follows")
    .select("followee_id")
    .eq("follower_id", "u-koffi");
  const followedIds = new Set(
    ((followingLinks.data as { followee_id: string }[] | null) ?? []).map(
      (row) => row.followee_id,
    ),
  );
  const followedPage = await repository.fetchPage({
    scope: "followed",
    readerId: "u-koffi",
    before: null,
    pageSize: 12,
  });
  assert.equal(
    followedPage.rows.every((row) => followedIds.has(row.author_id)),
    true,
  );
  assert.equal(followedPage.emptyScope, followedIds.size === 0);

  const emptyPage = await repository.fetchPage({
    scope: "followed",
    readerId: "user-with-no-follows",
    before: null,
    pageSize: 12,
  });
  assert.deepEqual(emptyPage, { rows: [], more: false, emptyScope: true });

  const firstLike = await repository.addLike("p-1", "u-koffi");
  assert.equal(firstLike, "created");
  const duplicateLike = await repository.addLike("p-1", "u-koffi");
  assert.equal(duplicateLike, "already-exists");

  const likeService = createFeedService(() => repository, async (rows) => rows);
  assert.deepEqual(await likeService.toggleLike("p-1", "u-koffi"), {
    liked: false,
    error: null,
  });
  assert.deepEqual(await likeService.toggleLike("p-1", "u-koffi"), {
    liked: true,
    error: null,
  });
  const likeRows = await demoFrom("post_likes")
    .select("post_id")
    .eq("post_id", "p-1")
    .eq("user_id", "u-koffi");
  assert.equal((likeRows.data ?? []).length, 1);

  let received: FeedPageRequest | undefined;
  const contractRepository: FeedRepository = {
    async fetchPage(request) {
      received = request;
      return firstPage;
    },
    async addLike() {
      return "created";
    },
    async removeLike() {},
  };
  const service = createFeedService(
    () => contractRepository,
    async (rows) => rows,
  );
  const servicePage = await service.fetchPage();
  assert.deepEqual(received, {
    scope: "all",
    readerId: null,
    before: null,
    pageSize: 12,
  });
  assert.deepEqual(servicePage, firstPage);

  const failingRepository: FeedRepository = {
    async fetchPage() {
      throw new FeedRepositoryError("list-feed", "test-failure");
    },
    async addLike() {
      throw new FeedRepositoryError("add-like", "test-failure");
    },
    async removeLike() {
      throw new FeedRepositoryError("remove-like", "test-failure");
    },
  };
  await assert.rejects(
    () =>
      createFeedService(
        () => failingRepository,
        async (rows) => rows,
      ).fetchPage(),
    FeedRepositoryError,
  );
  assert.deepEqual(
    await createFeedService(
      () => failingRepository,
      async (rows) => rows,
    ).toggleLike("p-1", "u-koffi"),
    {
      liked: false,
      error: "Impossible de mettre à jour le J’aime. Réessaie dans un instant.",
    },
  );

  const failingRemovalRepository: FeedRepository = {
    async fetchPage() {
      return firstPage;
    },
    async addLike() {
      return "already-exists";
    },
    async removeLike() {
      throw new FeedRepositoryError("remove-like", "test-failure");
    },
  };
  assert.deepEqual(
    await createFeedService(
      () => failingRemovalRepository,
      async (rows) => rows,
    ).toggleLike("p-1", "u-koffi"),
    {
      liked: true,
      error: "Impossible de mettre à jour le J’aime. Réessaie dans un instant.",
    },
  );

  console.log("Contrat du fil : 16 vérifications réussies.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
