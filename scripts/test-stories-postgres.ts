/**
 * Stories PostgreSQL — test d'intégration sur la base **locale**.
 *
 * Exécuter avec : `npm run test:stories-postgres` (base locale migrée).
 *
 * Ce que ce test prouve, et qu'un test de validation ne peut pas prouver :
 * une story expirée disparaît, un like se bascule et son compteur ne remonte
 * qu'à l'auteur, une vue se marque sans doublon et reste illisible par les
 * autres, une réponse ne peut pas viser sa propre story, un sticker hors
 * bornes est refusé par la base, et la RLS cache les vues des autres.
 *
 * Il **écrit** : il refuse toute cible distante et nettoie dans `finally`.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { PostgresStoriesRepository } from "../modules/stories/infrastructure/postgres/postgres-stories-repository";
import { closePostgresPool, getPostgresPool } from "../platform/infrastructure/postgres/pool";
import { withUser } from "../platform/infrastructure/postgres/with-user";
import { parseEndpoint } from "./db/guard";
import { isLocalHost, loadEnvFiles, resolveDatabaseUrl } from "./db/lib";

const users = { author: randomUUID(), reader: randomUUID(), solo: randomUUID() };
const story = { live: randomUUID(), expired: randomUUID() };

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
    [users.reader, "lecteur"],
    [users.solo, "tiers"],
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
    `insert into public.stories (id, author_id, caption, created_at)
     values ($1, $2, $3, now() - interval '1 minute')`,
    [story.live, users.author, `probe-story-vivante-${story.live.slice(0, 8)}`],
  );

  // Story expirée posée directement : la contrainte est l'horloge, pas l'écran.
  await client.query(
    `insert into public.stories (id, author_id, caption, created_at, expires_at)
     values ($1, $2, $3, now() - interval '2 days', now() - interval '1 day')`,
    [story.expired, users.author, `probe-story-perimee-${story.expired.slice(0, 8)}`],
  );
}

async function cleanup(client: Client): Promise<void> {
  await client.query("delete from auth.users where id = any($1::uuid[])", [
    [users.author, users.reader, users.solo],
  ]);
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

  const client = new Client({ connectionString: databaseUrl, application_name: "devnet-test-stories" });
  await client.connect();

  const repository = new PostgresStoriesRepository({
    asUser: (userId, run) => withUser(userId, run, getPostgresPool()),
  });

  try {
    await seed(client);

    // 1. Catalogue de base : public, stable.
    const anonymous = await repository.fetchFeed(null);
    check("catalogue : au moins huit stickers", anonymous.catalog.length >= 8, anonymous.catalog.length);
    check("catalogue : clés stables", anonymous.catalog.some((s) => s.id === "feu"));
    check("sans identité : aucune story", anonymous.stories.length === 0);

    // 2. Fil : les vivantes seulement, état du lecteur inclus.
    const readerFeed = await repository.fetchFeed(users.reader);
    const live = readerFeed.stories.find((s) => s.id === story.live);
    check("fil : story vivante présente", live !== undefined);
    check("fil : story expirée absente", !readerFeed.stories.some((s) => s.id === story.expired));
    check("fil : auteur joint", live?.author?.id === users.author, live?.author);
    check("fil : pas encore aimée", live?.liked === false);
    check("fil : compteur caché au lecteur", live?.likes === 0, live?.likes);

    // 3. Like : bascule, compteur réservé à l'auteur.
    const like = await repository.toggleLike(users.reader, story.live);
    check("like : posé", like.liked === true);
    check("like : compteur à un", like.likes === 1, like.likes);

    const authorFeed = await repository.fetchFeed(users.author);
    check(
      "like : compteur visible par l'auteur",
      authorFeed.stories.find((s) => s.id === story.live)?.likes === 1,
    );
    const readerFeed2 = await repository.fetchFeed(users.reader);
    check(
      "like : compteur toujours caché au lecteur",
      readerFeed2.stories.find((s) => s.id === story.live)?.likes === 0,
    );

    const unlike = await repository.toggleLike(users.reader, story.live);
    check("like : retiré", unlike.liked === false, unlike.liked);
    check("like : compteur à zéro", unlike.likes === 0, unlike.likes);

    // 4. Vue : une seule ligne, lisible par l'auteur seulement.
    await repository.markSeen(users.reader, story.live);
    await repository.markSeen(users.reader, story.live);
    const views = await client.query<{ n: string }>(
      "select count(*)::text as n from public.story_views where story_id = $1 and viewer_id = $2",
      [story.live, users.reader],
    );
    check("vue : pas de doublon", views.rows[0]?.n === "1", views.rows[0]?.n);

    const authorViews = await repository.fetchFeed(users.author);
    check(
      "vue : compteur visible par l'auteur",
      authorViews.stories.find((s) => s.id === story.live)?.views === 1,
    );
    const readerViews = await repository.fetchFeed(users.reader);
    check(
      "vue : compteur caché au lecteur",
      readerViews.stories.find((s) => s.id === story.live)?.views === 0,
    );

    // 5. Réponse privée : écrite, lisible, et jamais sur sa propre story.
    const reply = await repository.reply(users.reader, story.live, "Bravo pour cette story");
    check("réponse : enregistrée", typeof reply.id === "string" && reply.id.length > 0);
    const stored = await client.query<{ n: string; to_id: string }>(
      `select count(*)::text as n,
              (select to_id::text from public.story_replies
                where story_id = $1 and from_id = $2 limit 1) as to_id
         from public.story_replies
        where story_id = $1 and from_id = $2`,
      [story.live, users.reader],
    );
    check("réponse : destinataire = auteur", stored.rows[0]?.to_id === users.author);

    // La réponse doit arriver dans le fil privé, pas seulement dans la table.
    const conversationId = [users.reader, users.author].sort().join("|");
    const delivered = await client.query<{ n: string; author_id: string; text: string }>(
      `select count(*)::text as n,
              (select author_id::text from public.direct_messages
                where conversation_id = $1 order by created_at desc limit 1) as author_id,
              (select text from public.direct_messages
                where conversation_id = $1 order by created_at desc limit 1) as text
         from public.direct_messages where conversation_id = $1`,
      [conversationId],
    );
    check("réponse : livrée dans la conversation", delivered.rows[0]?.n === "1", delivered.rows[0]?.n);
    check("réponse : message signé par le lecteur", delivered.rows[0]?.author_id === users.reader);
    check(
      "réponse : texte contextué",
      (delivered.rows[0]?.text ?? "").includes("Bravo pour cette story"),
      delivered.rows[0]?.text,
    );

    const conv = await client.query<{ participants: string[]; last_message: string }>(
      "select participants, last_message from public.conversations where id = $1",
      [conversationId],
    );
    check("conversation : créée avec les deux personnes", conv.rows[0]?.participants.length === 2);
    check("conversation : aperçu à jour", (conv.rows[0]?.last_message ?? "").includes("Bravo"));

    const members = await client.query<{ n: string }>(
      "select count(*)::text as n from public.conversation_members where conversation_id = $1",
      [conversationId],
    );
    check("conversation : deux membres (déclencheur)", members.rows[0]?.n === "2", members.rows[0]?.n);

    // Une seconde réponse réutilise le fil au lieu d'en ouvrir un second.
    await repository.reply(users.reader, story.live, "Et encore bravo");
    const convs = await client.query<{ n: string }>(
      "select count(*)::text as n from public.conversations where id = $1",
      [conversationId],
    );
    check("conversation : une seule par paire", convs.rows[0]?.n === "1", convs.rows[0]?.n);

    // L'auteur lit bien le message reçu, sous son identité.
    const received = await withUser(
      users.author,
      (query) =>
        query<{ n: string }>(
          "select count(*)::text as n from public.direct_messages where conversation_id = $1",
          [conversationId],
        ),
      getPostgresPool(),
    );
    check("conversation : l'auteur lit les réponses", received[0]?.n === "2", received[0]?.n);
    await repository
      .reply(users.author, story.live, "Je me réponds à moi-même")
      .then(() => check("réponse à soi : refusée", false))
      .catch(() => check("réponse à soi : refusée", true));

    // 6. Sticker : posé par l'auteur, refusé aux autres, bornes en base.
    const placed = await repository.placeSticker(users.author, story.live, {
      stickerId: "feu",
      x: 0.5,
      y: 0.5,
      scale: 1,
      rotation: 0,
    });
    check("sticker : posé", placed.glyph === "🔥", placed.glyph);
    check("sticker : nom renvoyé", placed.name.length > 0);

    const authorFeed2 = await repository.fetchFeed(users.author);
    check(
      "sticker : rendu avec la story",
      (authorFeed2.stories.find((s) => s.id === story.live)?.stickers.length ?? 0) === 1,
    );

    await repository
      .placeSticker(users.reader, story.live, {
        stickerId: "feu",
        x: 0.2,
        y: 0.2,
        scale: 1,
        rotation: 0,
      })
      .then(() => check("sticker d'autrui : refusé", false))
      .catch(() => check("sticker d'autrui : refusé", true));

    await repository
      .placeSticker(users.author, story.live, {
        stickerId: "feu",
        x: 2,
        y: 0.5,
        scale: 1,
        rotation: 0,
      })
      .then(() => check("sticker hors bornes : refusé", false))
      .catch(() => check("sticker hors bornes : refusé", true));

    // 7. RLS : les vues des autres ne sont pas lisibles par un tiers.
    const snooped = await withUser(
      users.reader,
      (query) => query<{ n: string }>("select count(*)::text as n from public.story_views"),
      getPostgresPool(),
    );
    check("RLS : vues d'autrui invisibles", snooped[0]?.n === "0", snooped[0]?.n);

    // 8. Une story expirée ne reçoit plus de geste.
    await repository
      .toggleLike(users.reader, story.expired)
      .then(() => check("story expirée : like refusé", false))
      .catch(() => check("story expirée : like refusé", true));
  } finally {
    await cleanup(client).catch((error: unknown) => {
      console.error("Nettoyage impossible :", error);
    });
    await client.end();
    await closePostgresPool();
  }

  if (failures.length > 0) {
    console.error("\n✗ Stories PostgreSQL :");
    for (const failure of failures) console.error(`  · ${failure}`);
    console.error(`\n${passed} vérifications passées, ${failures.length} en échec.\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`✓ Stories PostgreSQL — ${passed} vérifications réussies.`);
}

main().catch(async (error: unknown) => {
  console.error(error);
  await closePostgresPool().catch(() => undefined);
  process.exitCode = 1;
});
