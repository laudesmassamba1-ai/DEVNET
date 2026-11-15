/**
 * Audience des stories — test d'intégration local.
 *
 * Prouve, sur une base migrée, que :
 *  · une story publique est lisible par un tiers et sans session ;
 *  · une story `followers` est lisible par un abonné, pas par un tiers ;
 *  · une story `private` n'est lisible que par son auteur ;
 *  · le fil du dépôt applique la même règle.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { PostgresStoriesRepository } from "../modules/stories/infrastructure/postgres/postgres-stories-repository";
import { closePostgresPool, getPostgresPool } from "../platform/infrastructure/postgres/pool";
import { withAnon, withUser, type UserQuery } from "../platform/infrastructure/postgres/with-user";
import { parseEndpoint } from "./db/guard";
import { isLocalHost, loadEnvFiles, resolveDatabaseUrl } from "./db/lib";

const users = { author: randomUUID(), follower: randomUUID(), stranger: randomUUID() };
const stories = {
  public: randomUUID(),
  followers: randomUUID(),
  private: randomUUID(),
  absolute: randomUUID(),
  expired: randomUUID(),
};
const media = {
  public: `probe-public-${randomUUID()}.webp`,
  followers: `probe-followers-${randomUUID()}.webp`,
  private: `probe-private-${randomUUID()}.webp`,
  absolute: `probe-absolute-${randomUUID()}.webp`,
  expired: `probe-expired-${randomUUID()}.webp`,
  foreign: `probe-foreign-${randomUUID()}.webp`,
};

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

async function seed(client: Client): Promise<void> {
  for (const [id, label] of [
    [users.author, "auteur"],
    [users.follower, "abonne"],
    [users.stranger, "tiers"],
  ] as const) {
    await client.query("insert into auth.users (id, email) values ($1, $2)", [
      id,
      `${label}-${id.slice(0, 8)}@probe.local`,
    ]);
    await client.query(
      "update public.users set pseudo = $2, prenom = $2, is_admin = false where id = $1",
      [id, `probe-${label}-${id.slice(0, 8)}`],
    );
  }

  await client.query(
    "insert into public.follows (follower_id, followee_id) values ($1, $2)",
    [users.follower, users.author],
  );

  await client.query(
    `insert into public.media_files (path, owner_id, mime, kind, bytes, byte_size)
     select p, $1, 'image/webp', 'image', decode('00', 'hex'), 1
       from unnest($2::text[]) as p`,
    [
      users.author,
      [media.public, media.followers, media.private, media.absolute, media.expired],
    ],
  );
  await client.query(
    `insert into public.media_files (path, owner_id, mime, kind, bytes, byte_size)
     values ($1, $2, 'image/webp', 'image', decode('00', 'hex'), 1)`,
    [media.foreign, users.stranger],
  );

  for (const [id, audience, path, expires] of [
    [stories.public, "public", media.public, null],
    [stories.followers, "followers", media.followers, null],
    [stories.private, "private", media.private, null],
    [stories.expired, "followers", media.expired, "2020-01-01T00:00:00Z"],
  ] as const) {
    await client.query(
      `insert into public.stories (id, author_id, caption, audience, media_url, expires_at)
       values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now() + interval '1 day'))`,
      [
        id,
        users.author,
        `probe-audience-${audience}-${id.slice(0, 8)}`,
        audience,
        `/api/media/${path}`,
        expires,
      ],
    );
  }

  // Forme absolue de même origine : le chemin doit être reconnu à l'identique.
  await client.query(
    `insert into public.stories (id, author_id, caption, audience, media_url)
     values ($1, $2, $3, 'followers', $4)`,
    [
      stories.absolute,
      users.author,
      `probe-audience-absolute-${stories.absolute.slice(0, 8)}`,
      `https://devnet.example/api/media/${media.absolute}`,
    ],
  );
}

async function cleanup(client: Client): Promise<void> {
  const ids = [users.author, users.follower, users.stranger];
  await client.query("delete from public.media_files where owner_id = any($1::uuid[])", [ids]);
  await client.query("delete from auth.users where id = any($1::uuid[])", [ids]);
}

async function main(): Promise<void> {
  loadEnvFiles();
  const databaseUrl = resolveDatabaseUrl();
  const { host } = parseEndpoint(databaseUrl);
  if (!isLocalHost(host)) {
    console.error("Refus : ce test écrit des lignes, il n'est autorisé que sur une base locale.");
    process.exitCode = 2;
    return;
  }

  const client = new Client({ connectionString: databaseUrl, application_name: "devnet-test-audience" });
  await client.connect();
  const repository = new PostgresStoriesRepository({
    asUser: (userId, run) => withUser(userId, run, getPostgresPool()),
  });

  try {
    await seed(client);

    const authorFeed = await repository.fetchFeed(users.author);
    check(
      "l'auteur voit ses quatre stories vivantes",
      new Set(authorFeed.stories.map((s) => s.id)).size === 4,
      authorFeed.stories.map((s) => ({ id: s.id, audience: s.audience })),
    );

    const followerFeed = await repository.fetchFeed(users.follower);
    const followerIds = new Set(followerFeed.stories.map((s) => s.id));
    check("l'abonné voit la story publique", followerIds.has(stories.public));
    check("l'abonné voit la story followers", followerIds.has(stories.followers));
    check("l'abonné ne voit pas la story privée", !followerIds.has(stories.private));

    const strangerFeed = await repository.fetchFeed(users.stranger);
    const strangerIds = new Set(strangerFeed.stories.map((s) => s.id));
    check("le tiers voit la story publique", strangerIds.has(stories.public));
    check("le tiers ne voit pas la story followers", !strangerIds.has(stories.followers));
    check("le tiers ne voit pas la story privée", !strangerIds.has(stories.private));

    const anonymous = await withAnon(
      (query) => query<{ id: string }>(
        "select id::text as id from public.stories where id = any($1::uuid[])",
        [[stories.public, stories.followers, stories.private]],
      ),
      getPostgresPool(),
    );
    check(
      "sans session, seule la story publique est visible",
      anonymous.length === 1 && anonymous[0]?.id === stories.public,
      anonymous,
    );

    /*
     * Médias : la décision `can_read_media_file` doit suivre l'audience de
     * la story, y compris pour une URL absolue de même origine. Sans
     * session, seule une story publique ouvre son média.
     */
    const canRead = async (userId: string | null, path: string): Promise<boolean> => {
      const run = (query: UserQuery) =>
        query<{ allowed: boolean }>(
          "select public.can_read_media_file($1) as allowed",
          [path],
        );
      const rows = userId
        ? await withUser(userId, run, getPostgresPool())
        : await withAnon(run, getPostgresPool());
      return rows[0]?.allowed === true;
    };

    for (const [label, path, expected] of [
      ["public / anonyme", media.public, true],
      ["public / tiers", media.public, true],
      ["followers / anonyme", media.followers, false],
      ["followers / tiers", media.followers, false],
      ["followers / abonné", media.followers, true],
      ["followers / auteur", media.followers, true],
      ["private / anonyme", media.private, false],
      ["private / abonné", media.private, false],
      ["private / auteur", media.private, true],
      ["absolue followers / tiers", media.absolute, false],
      ["absolue followers / abonné", media.absolute, true],
      ["expirée / abonné", media.expired, false],
      ["expirée / auteur", media.expired, true],
    ] as const) {
      const userId =
        label.endsWith("anonyme")
          ? null
          : label.endsWith("abonné")
            ? users.follower
            : label.endsWith("auteur")
              ? users.author
              : users.stranger;
      const actual = await canRead(userId, path);
      check(`média ${label}`, actual === expected, actual);
    }

    let foreignRejected = false;
    try {
      await client.query(
        `insert into public.stories (author_id, caption, audience, media_url)
         values ($1, 'probe-foreign-media', 'public', $2)`,
        [users.author, `/api/media/${media.foreign}`],
      );
    } catch (error) {
      foreignRejected =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "42501";
    }
    check("un média d'autrui est refusé à la publication", foreignRejected);

    // Pagination : 61 stories publiques supplémentaires, deux pages, zéro
    // doublon. Le curseur composite départage les créations simultanées.
    await client.query(
      `insert into public.stories (author_id, caption, audience, created_at, expires_at)
       select $1, 'paginate-' || g, 'public',
              now() - (g || ' seconds')::interval,
              now() + interval '1 day'
         from generate_series(1, 61) g`,
      [users.author],
    );
    const firstPage = await repository.fetchFeed(users.stranger);
    check("première page plafonnée à 60", firstPage.stories.length === 60, firstPage.stories.length);
    check("la première page annonce un curseur", firstPage.nextCursor !== null, firstPage.nextCursor);
    if (firstPage.nextCursor) {
      const secondPage = await repository.fetchFeed(users.stranger, firstPage.nextCursor);
      const firstIds = new Set(firstPage.stories.map((s) => s.id));
      check(
        "la seconde page ne répète aucune story",
        secondPage.stories.every((s) => !firstIds.has(s.id)),
        secondPage.stories.map((s) => s.id),
      );
      check("la seconde page progresse", secondPage.stories.length > 0, secondPage.stories.length);
    }
  } finally {
    await cleanup(client);
    await client.end();
    await closePostgresPool();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} vérification(s) en échec`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${passed} vérifications d'audience passent.`);
}

main().catch((error: unknown) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
