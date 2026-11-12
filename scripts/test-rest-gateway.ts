/**
 * Passerelle REST — test d'intégration sur une base migrée.
 *
 * Exécuter avec : `npm run test:rest-gateway` (base locale migrée requise), ou
 * `CONFIRM_REMOTE=devnet npm run test:rest-gateway` pour la cible distante
 * explicitement confirmée.
 *
 * Ce test passe par les mêmes fonctions que `/api/rest/[...path]` :
 * `executeRest` et `executeRpc` sous `withUser` / `withAnon`. Il vérifie les
 * formes réellement utilisées par l'application, pas une API théorique :
 *
 * 1. les jointures `author:users`, `community:communities`, `user:users`,
 *    `profile:users` et les contraintes nommées ;
 * 2. `or`, `not`, `in`, `contains`, `overlaps`, `order`, `limit`, `offset`,
 *    `count=exact` et `Accept: vnd.pgrst.object+json` ;
 * 3. insert, upsert (`merge-duplicates`), upsert idempotent
 *    (`ignore-duplicates`), update, delete et `return=representation` ;
 * 4. le refus RLS d'une écriture anonyme ou au nom d'un autre.
 *
 * Il **écrit** des lignes de test et une table temporaire : il refuse toute
 * cible distante sans confirmation explicite et nettoie dans `finally`.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  executeRest,
  executeRpc,
  RestError,
  type RestInput,
  type RestOutput,
} from "../lib/rest/query";
import { restTarget, siteOrigin } from "../lib/rest/rewrite";
import { clearRestSchemaCache } from "../lib/rest/schema";
import { closePostgresPool, getPostgresPool } from "../platform/infrastructure/postgres/pool";
import { withAnon, withUser, type UserQuery } from "../platform/infrastructure/postgres/with-user";
import { assertSafeTarget, parseEndpoint, readTarget } from "./db/guard";
import { isLocalHost, loadEnvFiles } from "./db/lib";

const alice = randomUUID();
const bob = randomUUID();
const PROBE = "__rest_gateway_probe";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

/** Trace les étapes quand `DEVNET_TEST_TRACE=1`, pour localiser une coupure. */
function trace(step: string): void {
  if (process.env.DEVNET_TEST_TRACE) console.error(`[rest-gateway] ${step}`);
}

interface QueryCase {
  name: string;
  table: string;
  select?: string;
  params?: Record<string, string>;
  method?: string;
  prefer?: string;
  accept?: string;
  body?: unknown;
  as?: string | null;
  expectError?: string;
}

function input(testCase: QueryCase): RestInput {
  const searchParams = new URLSearchParams();
  if (testCase.select) searchParams.set("select", testCase.select);
  for (const [key, value] of Object.entries(testCase.params ?? {})) {
    searchParams.set(key, value);
  }
  return {
    table: testCase.table,
    method: testCase.method ?? "GET",
    searchParams,
    body: testCase.body,
    prefer: testCase.prefer ?? "",
    accept: testCase.accept ?? "application/json",
    query: async () => [],
  };
}

async function run(
  testCase: QueryCase,
  userId: string | null = alice,
): Promise<RestOutput> {
  const request = input(testCase);
  const execute = (query: UserQuery) =>
    executeRest({ ...request, query: query as unknown as RestInput["query"] });
  return userId ? withUser(userId, execute, getPostgresPool()) : withAnon(execute, getPostgresPool());
}

async function expectOk(testCase: QueryCase): Promise<RestOutput | null> {
  try {
    const output = await run(testCase);
    check(testCase.name, true);
    return output;
  } catch (error) {
    check(testCase.name, false, error instanceof Error ? error.message : error);
    return null;
  }
}

async function expectRefused(testCase: QueryCase): Promise<void> {
  try {
    await run(testCase);
    check(testCase.name, false, "aucune erreur");
  } catch (error) {
    const code = error instanceof RestError ? error.code : (error as { code?: string }).code;
    check(testCase.name, code === testCase.expectError, code);
  }
}

async function seed(pool: Pool): Promise<void> {
  for (const [id, label] of [
    [alice, "alice"],
    [bob, "bob"],
  ] as const) {
    await pool.query("insert into auth.users (id, email) values ($1, $2)", [
      id,
      `${label}-${id.slice(0, 8)}@probe.local`,
    ]);
    await pool.query(
      "update public.users set pseudo = $2, prenom = $2, is_admin = false where id = $1",
      [id, `probe-${label}-${id.slice(0, 8)}`],
    );
  }

  await pool.query(`drop table if exists public.${PROBE}`);
  await pool.query(`
    create table public.${PROBE} (
      id uuid primary key,
      user_id uuid not null constraint ${PROBE}_user_id_fkey references public.users(id) on delete cascade,
      label text not null,
      tags text[] not null default '{}',
      created_at timestamptz not null default now()
    )
  `);
  await pool.query(`alter table public.${PROBE} enable row level security`);
  await pool.query(`
    create policy ${PROBE}_owner on public.${PROBE}
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid())
  `);
  await pool.query(`grant select, insert, update, delete on public.${PROBE} to authenticated`);
  await pool.query(`grant select, insert, update, delete on public.${PROBE} to anon`);
  clearRestSchemaCache();
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(`drop table if exists public.${PROBE}`);
  await pool.query("delete from auth.users where id = any($1::uuid[])", [[alice, bob]]);
  clearRestSchemaCache();
}

const AUTHOR = "id, prenom, pseudo, avatar_color, account_type, verified, is_admin, filiere, niveau";

const reads: QueryCase[] = [
  {
    name: "lecture simple + ordre + limite",
    table: "users",
    select: "id, prenom, pseudo",
    params: { order: "pseudo.asc", limit: "5" },
  },
  {
    name: "filtre in + not is null",
    table: "users",
    select: "id",
    params: { id: `in.(${alice})`, pseudo: "not.is.null" },
  },
  {
    name: "filtre or sur deux colonnes",
    table: "users",
    select: "id",
    params: { or: "(pseudo.ilike.%probe%,prenom.ilike.%probe%)" },
  },
  {
    name: "filtre ilike + neq",
    table: "users",
    select: "id",
    params: { pseudo: "ilike.%probe%", id: `neq.${bob}` },
  },
  {
    name: "jointure feed author:users!posts_author_id_fkey",
    table: "posts",
    select: `*, author:users!posts_author_id_fkey(${AUTHOR})`,
    params: { order: "created_at.desc", limit: "1" },
  },
  {
    name: "jointure commentaire author:users sans contrainte",
    table: "comments",
    select: `*, author:users(${AUTHOR})`,
    params: { limit: "1" },
  },
  {
    name: "jointure story author:users",
    table: "stories",
    select: `*, author:users(${AUTHOR})`,
    params: { limit: "1" },
  },
  {
    name: "jointure issue author:users!issues_author_id_fkey",
    table: "issues",
    select: `*, author:users!issues_author_id_fkey(${AUTHOR})`,
    params: { limit: "1" },
  },
  {
    name: "jointure page author:users",
    table: "project_pages",
    select: `*, author:users(${AUTHOR})`,
    params: { limit: "1" },
  },
  {
    name: "jointure presence user:users",
    table: "project_sessions",
    select:
      "project_id, user_id, file_path, cursor, color, seen_at, " +
      "user:users(id, prenom, pseudo, avatar_color, account_type, verified, filiere, niveau)",
    params: { order: "seen_at.desc", limit: "1" },
  },
  {
    name: "jointure membre user:users",
    table: "group_members",
    select:
      "group_id, user_id, role, joined_at, " +
      "user:users(id, prenom, pseudo, avatar_color, account_type, verified, is_admin)",
    params: { order: "joined_at.asc", limit: "1" },
  },
  {
    name: "jointure membre de projet profile:users",
    table: "project_members",
    select: "user_id, role, profile:users(prenom, pseudo, avatar_color)",
    params: { limit: "1" },
  },
  {
    name: "jointure candidature profile:users!project_applications_user_id_fkey",
    table: "project_applications",
    select:
      "id, user_id, role, status, " +
      "profile:users!project_applications_user_id_fkey(prenom, pseudo, avatar_color)",
    params: { limit: "1" },
  },
  {
    name: "jointure notification actor:users!notifications_actor_id_fkey",
    table: "notifications",
    select: `*, actor:users!notifications_actor_id_fkey(${AUTHOR})`,
    params: { limit: "1" },
  },
  {
    name: "jointure signalement reporter:users!reports_reporter_id_fkey",
    table: "reports",
    select: `*, reporter:users!reports_reporter_id_fkey(${AUTHOR})`,
    params: { limit: "1" },
  },
  {
    name: "jointure extension author:users!extensions_owner_id_fkey",
    table: "extensions",
    select: `*, author:users!extensions_owner_id_fkey(${AUTHOR})`,
    params: { limit: "1" },
  },
  {
    name: "jointure pull request author:users!pull_requests_author_id_fkey",
    table: "pull_requests",
    select: `*, author:users!pull_requests_author_id_fkey(${AUTHOR})`,
    params: { limit: "1" },
  },
  {
    name: "deux jointures posts author + community",
    table: "posts",
    select:
      `*, author:users!posts_author_id_fkey(${AUTHOR}), ` +
      "community:communities(id, slug, name, visibility)",
    params: { community_id: "not.is.null", order: "created_at.desc", limit: "1" },
  },
  {
    name: "contains sur un tableau",
    table: "conversations",
    select: "*",
    params: { participants: `cs.{${alice}}`, order: "last_message_at.desc", limit: "1" },
  },
  {
    name: "overlaps sur un tableau",
    table: "posts",
    select: "id, tags",
    params: { tags: "ov.{typescript}", order: "created_at.desc", limit: "1" },
  },
  {
    name: "range via offset + limit",
    table: "posts",
    select: "id",
    params: { order: "created_at.desc", offset: "0", limit: "2" },
  },
  {
    name: "compte exact en HEAD",
    table: "users",
    select: "id",
    method: "HEAD",
    prefer: "count=exact",
    params: { id: `in.(${alice},${bob})` },
  },
  {
    name: "objet unique",
    table: "users",
    select: "id, pseudo",
    accept: "application/vnd.pgrst.object+json",
    params: { id: `eq.${alice}` },
  },
];

const invalid: QueryCase[] = [
  {
    name: "table inconnue → 42P01",
    table: "table_qui_n_existe_pas",
    expectError: "42P01",
  },
  {
    name: "colonne inconnue → 42703",
    table: "users",
    select: "id, colonne_absente",
    expectError: "42703",
  },
  {
    name: "opérateur inconnu → PGRST100",
    table: "users",
    select: "id",
    params: { pseudo: "presque.%probe%" },
    expectError: "PGRST100",
  },
  {
    name: "jointure ambiguë sans contrainte → PGRST201",
    table: "project_applications",
    select: "id, profile:users(pseudo)",
    expectError: "PGRST201",
  },
  {
    name: "jointure sans relation → PGRST200",
    table: "users",
    select: "id, post:posts(id)",
    expectError: "PGRST200",
  },
];

async function verifyWrites(pool: Pool): Promise<void> {
  const id = randomUUID();
  const base = { table: PROBE, select: "*" };

  const inserted = await run({
    ...base,
    name: "insert",
    method: "POST",
    prefer: "return=representation",
    accept: "application/vnd.pgrst.object+json",
    body: { id, user_id: alice, label: "un", tags: ["typescript", "postgres"] },
  });
  check("insert : une ligne", inserted.rows?.length === 1, inserted.rows);
  check("insert : propriétaire", inserted.rows?.[0]?.user_id === alice);

  const withAuthor = await run({
    ...base,
    name: "insert + select imbriqué",
    select: `*, author:users!${PROBE}_user_id_fkey(id, pseudo)`,
    method: "POST",
    prefer: "return=representation",
    accept: "application/vnd.pgrst.object+json",
    body: { id: randomUUID(), user_id: alice, label: "avec auteur" },
  });
  check(
    "insert + select imbriqué : auteur joint",
    (withAuthor.rows?.[0]?.author as { id?: string } | undefined)?.id === alice,
    withAuthor.rows,
  );

  await run({
    ...base,
    name: "upsert",
    method: "POST",
    prefer: "return=representation,resolution=merge-duplicates",
    accept: "application/vnd.pgrst.object+json",
    params: { on_conflict: "id" },
    body: { id, user_id: alice, label: "deux" },
  });
  const afterUpsert = await run({
    ...base,
    name: "relecture upsert",
    params: { id: `eq.${id}` },
    accept: "application/vnd.pgrst.object+json",
  });
  check("upsert : valeur remplacée", afterUpsert.rows?.[0]?.label === "deux", afterUpsert.rows);

  const ignored = await run({
    ...base,
    name: "upsert idempotent",
    method: "POST",
    prefer: "return=representation,resolution=ignore-duplicates",
    params: { on_conflict: "id" },
    body: { id, user_id: alice, label: "trois" },
  });
  check("upsert idempotent : aucune ligne", ignored.rows?.length === 0, ignored.rows);

  const patched = await run({
    ...base,
    name: "update",
    method: "PATCH",
    prefer: "return=representation",
    params: { id: `eq.${id}` },
    body: { label: "quatre" },
  });
  check("update : une ligne", patched.rows?.length === 1, patched.rows);
  check("update : nouvelle valeur", patched.rows?.[0]?.label === "quatre");

  const patchedWithAuthor = await run({
    ...base,
    name: "update + select imbriqué",
    select: `*, author:users!${PROBE}_user_id_fkey(id, pseudo)`,
    method: "PATCH",
    prefer: "return=representation",
    params: { id: `eq.${id}` },
    body: { label: "cinq" },
  });
  check(
    "update + select imbriqué : auteur joint",
    (patchedWithAuthor.rows?.[0]?.author as { id?: string } | undefined)?.id === alice,
    patchedWithAuthor.rows,
  );

  const contained = await run({
    ...base,
    name: "contains",
    params: { tags: "cs.{typescript,postgres}" },
  });
  check("contains : ligne trouvée", contained.rows?.length === 1, contained.rows);

  const overlapped = await run({
    ...base,
    name: "overlaps",
    params: { tags: "ov.{postgres}" },
  });
  check("overlaps : ligne trouvée", overlapped.rows?.length === 1, overlapped.rows);

  const counted = await run({
    ...base,
    name: "count",
    method: "HEAD",
    select: "id",
    prefer: "count=exact",
    params: { user_id: `eq.${alice}` },
  });
  check("count : 2", counted.count === 2 && counted.rows === null, counted);

  const notNull = await run({
    ...base,
    name: "not is null",
    params: { label: "not.is.null" },
  });
  check("not is null : lignes trouvées", notNull.rows?.length === 2, notNull.rows);

  const or = await run({
    ...base,
    name: "or",
    params: { or: "(label.eq.cinq,label.eq.autre)" },
  });
  check("or : ligne trouvée", or.rows?.length === 1, or.rows);

  const deleted = await run({
    ...base,
    name: "delete + select imbriqué",
    select: `*, author:users!${PROBE}_user_id_fkey(id, pseudo)`,
    method: "DELETE",
    prefer: "return=representation",
    params: { id: `eq.${id}` },
  });
  check(
    "delete + select imbriqué : auteur joint",
    (deleted.rows?.[0]?.author as { id?: string } | undefined)?.id === alice,
    deleted.rows,
  );
  const afterDelete = await run({
    ...base,
    name: "relecture delete",
    method: "HEAD",
    select: "id",
    prefer: "count=exact",
    params: { id: `eq.${id}` },
  });
  check("delete : 0 ligne", afterDelete.count === 0, afterDelete.count);

  const denied = await run(
    {
      ...base,
      name: "insert anonyme refusé",
      method: "POST",
      prefer: "return=representation",
      body: { id: randomUUID(), user_id: alice, label: "anon" },
    },
    null,
  ).catch((error: unknown) => error);
  check(
    "insert anonyme : 42501",
    denied instanceof RestError && denied.code === "42501",
    denied instanceof RestError ? denied.code : denied,
  );

  const other = await run(
    {
      ...base,
      name: "update au nom d'un autre",
      method: "PATCH",
      prefer: "return=representation",
      params: { user_id: `eq.${alice}` },
      body: { label: "vol" },
    },
    bob,
  );
  check("update au nom d'un autre : 0 ligne", other.rows?.length === 0, other.rows);

  const admin = await withUser(
    alice,
    (query) => executeRpc("admin_search_accounts", { term: "probe" }, query),
    getPostgresPool(),
  ).catch((error: unknown) => error);
  check(
    "rpc : non-admin sans ligne",
    !(admin instanceof RestError) && (admin as RestOutput).rows?.length === 0,
    admin,
  );

  await pool.query("update public.users set is_admin = true where id = $1", [alice]);
  try {
    const output = await withUser(
      alice,
      (query) => executeRpc("admin_search_accounts", { term: "probe" }, query),
      getPostgresPool(),
    );
    check("rpc : admin accepté", output.rows !== null && output.rows.length >= 1, output.rows);
  } catch (error) {
    check("rpc : admin accepté", false, error instanceof Error ? error.message : error);
  } finally {
    await pool.query("update public.users set is_admin = false where id = $1", [alice]);
  }
}

function verifyRewrite(): void {
  const origin = "https://devnet.example";

  check(
    "rewrite : /rest/v1 → /api/rest",
    restTarget("https://abc.supabase.co/rest/v1/users?select=id&id=eq.1", origin)?.href ===
      "https://devnet.example/api/rest/users?select=id&id=eq.1",
  );
  check(
    "rewrite : URL absolue acceptée",
    restTarget(new URL("https://abc.supabase.co/rest/v1/stories?limit=2"), origin)?.href ===
      "https://devnet.example/api/rest/stories?limit=2",
  );
  check(
    "rewrite : auth non détournée",
    restTarget("https://abc.supabase.co/auth/v1/user", origin) === null,
  );
  check(
    "rewrite : origine locale en http",
    siteOrigin({ get: (name) => (name === "host" ? "localhost:3000" : null) }) ===
      "http://localhost:3000",
  );
  check(
    "rewrite : proxy Vercel respecté",
    siteOrigin({
      get: (name) =>
        name === "x-forwarded-host"
          ? "devnet.example"
          : name === "x-forwarded-proto"
            ? "https,http"
            : null,
    }) === "https://devnet.example",
  );
}

async function main(): Promise<void> {
  verifyRewrite();
  if (failures.length > 0) {
    console.error(`\n${failures.length} vérification(s) en échec`);
    for (const failure of failures) console.error(`  · ${failure}`);
    process.exitCode = 1;
    return;
  }

  if (!process.env.DATABASE_URL) loadEnvFiles();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL est absent.");
    process.exitCode = 2;
    return;
  }
  const { host } = parseEndpoint(databaseUrl);
  const target = readTarget();
  const description = assertSafeTarget({
    databaseUrl,
    target,
    operation: "write",
    confirmRemote: process.env.CONFIRM_REMOTE,
  });
  if (!isLocalHost(host) && target !== "remote") {
    console.error(
      `Refus : ce test écrit des lignes ; sur un hôte distant il exige DB_TARGET=remote et CONFIRM_REMOTE=${description.split("base=")[1] ?? "<base>"}.`,
    );
    process.exitCode = 2;
    return;
  }

  process.env.DATABASE_URL = databaseUrl;
  const pool = getPostgresPool();
  pool.on("error", (error: Error) => {
    // Une connexion inactive coupée par l'hôte distant ne doit pas tuer le processus :
    // le pool en ouvre une autre à la prochaine demande.
    console.error("Connexion inactive interrompue :", error.message);
  });

  try {
    trace("seed");
    await seed(pool);

    trace("lectures");
    for (const testCase of reads) await expectOk(testCase);
    trace("requêtes invalides");
    for (const testCase of invalid) await expectRefused(testCase);
    trace("écritures");
    await verifyWrites(pool);
    trace("fin des vérifications");

    if (failures.length > 0) {
      console.error(`\n${failures.length} vérification(s) en échec`);
      for (const failure of failures) console.error(`  · ${failure}`);
      process.exitCode = 1;
      return;
    }
    console.log(`\n✓ Passerelle REST — ${passed} vérifications réussies.`);
  } finally {
    trace("nettoyage");
    await cleanup(pool).catch((error: unknown) => {
      console.error("Nettoyage impossible :", error instanceof Error ? error.message : error);
    });
    await closePostgresPool();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
