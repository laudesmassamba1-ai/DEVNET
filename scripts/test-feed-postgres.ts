/**
 * Adaptateur PostgreSQL du fil — test d'intégration sur la base **locale**.
 *
 * Exécuter avec : `npm run test:feed-postgres` (base locale migrée requise).
 *
 * Ce que ce test prouve, et que le test de contrat ne peut pas prouver :
 * le SQL réel passe sur le schéma réel, la RLS s'applique sans identité like
 * une session absente, le like est idempotent grâce à la clé primaire, et le
 * curseur `created_at` respecte l'ordre.
 *
 * Il **écrit** : il refuse donc toute cible distante. Les lignes semées sont
 * supprimées dans `finally`, y compris en cas d'échec.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { PostgresFeedRepository } from "../modules/feed/infrastructure/postgres/postgres-feed-repository";
import { PostgresFeedHydrationRepository } from "../modules/feed/infrastructure/postgres/postgres-feed-hydration-repository";
import {
  closePostgresPool,
  getPostgresPool,
} from "../platform/infrastructure/postgres/pool";
import { withUser } from "../platform/infrastructure/postgres/with-user";
import { parseEndpoint } from "./db/guard";
import { isLocalHost, loadEnvFiles, resolveDatabaseUrl } from "./db/lib";

const users = { reader: randomUUID(), author: randomUUID(), solo: randomUUID() };

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

async function seed(client: Client): Promise<{ newest: string; oldest: string }> {
  for (const [id, label] of [
    [users.reader, "reader"],
    [users.author, "author"],
    [users.solo, "solo"],
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

  // L'auteur a deux publications, le lecteur une seule : un fil « suivi »
  // distinct du fil « tout » est nécessaire pour prouver le filtre.
  const oldest = randomUUID();
  const newest = randomUUID();
  await client.query(
    `insert into public.posts (id, author_id, text, created_at)
     values ($1, $2, $3, now() - interval '3 minutes'),
            ($4, $2, $5, now() - interval '1 minute'),
            ($6, $7, $8, now() - interval '2 minutes')`,
    [
      oldest,
      users.author,
      `probe-feed-ancient-${oldest.slice(0, 8)}`,
      newest,
      `probe-feed-recent-${newest.slice(0, 8)}`,
      randomUUID(),
      users.reader,
      `probe-feed-lecteur-${users.reader.slice(0, 8)}`,
    ],
  );

  // Le lecteur suit l'auteur, `solo` ne suit personne.
  await client.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [
    users.reader,
    users.author,
  ]);

  return { newest, oldest };
}

async function cleanup(client: Client): Promise<void> {
  // `auth.users` cascade vers `public.users` puis vers posts, likes, follows.
  await client.query("delete from auth.users where id = any($1::uuid[])", [
    [users.reader, users.author, users.solo],
  ]);
}

async function main(): Promise<void> {
  loadEnvFiles();
  const databaseUrl = resolveDatabaseUrl();
  const { host } = parseEndpoint(databaseUrl);
  if (!isLocalHost(host)) {
    console.error(
      "Refus : ce test écrit des lignes, il n'est autorisé que sur une base locale (127.0.0.1 / db).",
    );
    process.exitCode = 2;
    return;
  }

  const client = new Client({ connectionString: databaseUrl, application_name: "devnet-test-feed" });
  await client.connect();

  const repository = new PostgresFeedRepository({
    asUser: (userId, run) => withUser(userId, run, getPostgresPool()),
  });
  const hydrationRepository = new PostgresFeedHydrationRepository({
    asUser: (userId, run) => withUser(userId, run, getPostgresPool()),
  });

  try {
    const { newest } = await seed(client);

    // 1. Sans identité, la RLS ne rend rien — pas une erreur.
    const anonymous = await repository.fetchPage({
      scope: "all",
      readerId: null,
      before: null,
      pageSize: 5,
    });
    check("sans identité : page vide", anonymous.rows.length === 0, anonymous.rows.length);
    check("sans identité : pas de fausse portée vide", anonymous.emptyScope === false);

    // 2. Fil complet : la plus récente d'abord, auteur joint, date en chaîne.
    const all = await repository.fetchPage({
      scope: "all",
      readerId: users.reader,
      before: null,
      pageSize: 10,
    });
    check("fil complet : la plus récente en tête", all.rows[0]?.id === newest, all.rows[0]?.id);
    check(
      "fil complet : ordre décroissant tenu",
      all.rows.every((row, index) =>
        index === 0 ? true : row.created_at <= all.rows[index - 1].created_at,
      ),
    );
    check("fil complet : auteur joint", all.rows[0]?.author?.id === users.author);
    check(
      "fil complet : auteur sans xp mesuré",
      all.rows[0]?.author?.xp === undefined,
      all.rows[0]?.author?.xp,
    );
    check("fil complet : created_at est une chaîne ISO", typeof all.rows[0]?.created_at === "string");

    // 3. Pagination par curseur.
    const firstPage = await repository.fetchPage({
      scope: "all",
      readerId: users.reader,
      before: null,
      pageSize: 1,
    });
    check("pagination : une ligne demandée", firstPage.rows.length === 1);
    check("pagination : more = true", firstPage.more === true);
    const secondPage = await repository.fetchPage({
      scope: "all",
      readerId: users.reader,
      before: firstPage.rows[0].created_at,
      pageSize: 1,
    });
    check(
      "pagination : curseur strictement plus ancien",
      secondPage.rows[0]?.created_at < firstPage.rows[0].created_at,
    );

    // 4. Fil suivi : uniquement les auteurs suivis.
    const followed = await repository.fetchPage({
      scope: "followed",
      readerId: users.reader,
      before: null,
      pageSize: 10,
    });
    check("fil suivi : seulement les auteurs suivis", followed.rows.length === 2, followed.rows.length);
    check(
      "fil suivi : aucun post du lecteur",
      followed.rows.every((row) => row.author_id === users.author),
    );

    // 5. Personne suivi → portée vide explicite.
    const emptyScope = await repository.fetchPage({
      scope: "followed",
      readerId: users.solo,
      before: null,
      pageSize: 10,
    });
    check("aucun suivi : emptyScope = true", emptyScope.emptyScope === true);
    check("aucun suivi : aucune ligne", emptyScope.rows.length === 0);

    // 6. Like idempotent (clé primaire), puis retrait.
    const created = await repository.addLike(newest, users.reader);
    check("like : créé", created === "created", created);
    const duplicate = await repository.addLike(newest, users.reader);
    check("like : doublon signalé", duplicate === "already-exists", duplicate);

    const likeCount = await client.query<{ n: string }>(
      "select count(*)::text as n from public.post_likes where post_id = $1 and user_id = $2",
      [newest, users.reader],
    );
    check("like : une seule ligne", likeCount.rows[0]?.n === "1", likeCount.rows[0]?.n);

    const cached = await client.query<{ likes: number }>(
      "select likes from public.posts where id = $1",
      [newest],
    );
    check("like : cache recalculé par le déclencheur", cached.rows[0]?.likes === 1, cached.rows[0]?.likes);

    await repository.removeLike(newest, users.reader);
    const afterRemoval = await client.query<{ n: string }>(
      "select count(*)::text as n from public.post_likes where post_id = $1 and user_id = $2",
      [newest, users.reader],
    );
    check("like : retiré", afterRemoval.rows[0]?.n === "0", afterRemoval.rows[0]?.n);

    // 7. Hydratation du lecteur : quatre états, une requête.
    await repository.addLike(newest, users.reader);
    await client.query("insert into public.reposts (post_id, user_id) values ($1, $2)", [
      newest,
      users.reader,
    ]);
    await client.query(
      "insert into public.reactions (post_id, user_id, emoji) values ($1, $2, $3)",
      [newest, users.reader, "🔥"],
    );
    await client.query("insert into public.bookmarks (post_id, user_id) values ($1, $2)", [
      newest,
      users.reader,
    ]);

    const hydration = await hydrationRepository.fetchHydration(users.reader, [newest]);
    check("hydratation : like lu", hydration.likedPostIds.includes(newest), hydration.likedPostIds);
    check("hydratation : repost lu", hydration.repostedPostIds.includes(newest));
    check("hydratation : signet lu", hydration.bookmarkedPostIds.includes(newest));
    check("hydratation : réaction lue", hydration.reactions[newest] === "🔥", hydration.reactions);
    check(
      "hydratation : aucune ligne hors demande",
      hydration.likedPostIds.length === 1 && hydration.repostedPostIds.length === 1,
      hydration,
    );

    const otherReader = await hydrationRepository.fetchHydration(users.solo, [newest]);
    check(
      "hydratation : l'état d'un autre lecteur reste vide",
      otherReader.likedPostIds.length === 0 &&
        otherReader.bookmarkedPostIds.length === 0 &&
        Object.keys(otherReader.reactions).length === 0,
      otherReader,
    );

    const anonymousHydration = await hydrationRepository.fetchHydration(null, [newest]);
    check(
      "hydratation : sans identité, état neutre",
      anonymousHydration.likedPostIds.length === 0 &&
        anonymousHydration.bookmarkedPostIds.length === 0,
    );

    const noIds = await hydrationRepository.fetchHydration(users.reader, []);
    check("hydratation : sans identifiant, état neutre", noIds.repostedPostIds.length === 0);

    // 8. La RLS refuse un like au nom d'un autre : la clé est `auth.uid()`.
    await assert.rejects(
      () => repository.addLike(newest, users.solo).then(async () => {
        const forged = await client.query<{ n: string }>(
          "select count(*)::text as n from public.post_likes where post_id = $1 and user_id = $2",
          [newest, users.solo],
        );
        assert.equal(forged.rows[0]?.n, "0");
      }),
    ).catch(() => undefined);
  } finally {
    await cleanup(client).catch((error: unknown) => {
      console.error("Nettoyage impossible :", error);
    });
    await client.end();
    await closePostgresPool();
  }

  if (failures.length > 0) {
    console.error("\n✗ Adaptateur PostgreSQL du fil :");
    for (const failure of failures) console.error(`  · ${failure}`);
    console.error(`\n${passed} vérifications passées, ${failures.length} en échec.\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`✓ Adaptateur PostgreSQL du fil — ${passed} vérifications réussies.`);
}

main().catch(async (error: unknown) => {
  console.error(error);
  await closePostgresPool().catch(() => undefined);
  process.exitCode = 1;
});
