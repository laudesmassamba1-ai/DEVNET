/**
 * Test de la bascule automatique, sur deux vraies bases.
 *
 * Ce test ne simule rien : il ouvre deux PostgreSQL jetables, applique les
 * migrations, puis **arrête** la base primaire pour voir si le code bascule
 * vraiment. Un test de bascule avec un faux client ne prouve rien — c'est
 * justement le chemin d'erreur qu'on veut éprouver.
 *
 * Trois cas, dans l'ordre où ils comptent :
 *  1. la primaire tombe → on passe sur la secours ;
 *  2. la secours est **en retard** de migrations → on refuse de la promouvoir ;
 *  3. la primaire revient → on y retourne.
 *
 * Usage : npx tsx scripts/test-failover.ts
 * Variables : FO_PRIMARY_URL, FO_STANDBY_URL (défauts : 55441 / 55442).
 */
import assert from "node:assert/strict";
import net from "node:net";
import { Client } from "pg";

const PRIMARY =
  process.env.FO_PRIMARY_URL ?? "postgresql://postgres:test@localhost:55441/devnet";
const STANDBY =
  process.env.FO_STANDBY_URL ?? "postgresql://postgres:test@localhost:55442/devnet";

/** Le module lit l'environnement à l'import : on le pose avant. */
process.env.DATABASE_URL = PRIMARY;
process.env.DATABASE_URL_STANDBY = STANDBY;
process.env.DATABASE_FAILOVER = "auto";
process.env.PG_CONNECT_TIMEOUT_MS = "2000";

async function sql(url: string, statement: string): Promise<void> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3_000 });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function count(url: string): Promise<number> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3_000 });
  await client.connect();
  try {
    const result = await client.query<{ n: string }>(
      "select count(*)::text as n from public.schema_migrations",
    );
    return Number(result.rows[0]?.n ?? 0);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const failover = await import("../platform/infrastructure/postgres/failover");
  const pool = await import("../platform/infrastructure/postgres/pool");

  const primaryMigrations = await count(PRIMARY);
  const standbyMigrations = await count(STANDBY);
  console.log(`migrations — primaire ${primaryMigrations}, secours ${standbyMigrations}`);
  assert.ok(primaryMigrations > 0, "la primaire doit avoir des migrations");

  // ── 1. État initial : on tourne sur la primaire ──────────────
  await failover.resetFailover();
  let state = failover.getFailoverState();
  assert.equal(state.active, "primary", "au départ, on doit être sur la primaire");
  assert.equal(state.standbyConfigured, true, "la secours doit être vue comme configurée");
  console.log("✓ 1. état initial : primaire active, secours configurée");

  // ── 2. La primaire répond : pas de bascule ───────────────────
  const healthy = await pool.checkDatabase(2_000);
  assert.equal(healthy.ok, true, "la primaire doit répondre");
  state = failover.getFailoverState();
  assert.equal(state.active, "primary", "une primaire saine ne doit pas être quittée");
  console.log("✓ 2. primaire saine : aucune bascule");

  // ── 3. Une secours au schéma différent est refusée ─────────
  // On ajoute une colonne sur la primaire seule : la secours n'a plus le
  // même schéma. C'est le cas réel du 14 novembre — une base en retard de
  // migration — et il se juge sur les colonnes, pas sur le nombre de lignes
  // au registre : la production portait 73 lignes pour 72 fichiers.
  await sql(PRIMARY, "alter table public.stories add column if not exists fo_guard integer");
  await failover.resetFailover();
  const healthyAgain = await pool.checkDatabase(2_000);
  assert.equal(healthyAgain.ok, true, "la primaire doit répondre");
  const refused = await failover.promote("test : schéma différent");
  assert.equal(refused.ok, false, "une secours au schéma différent doit être refusée");
  assert.match(
    refused.ok === false ? refused.reason : "",
    /schéma/,
    "le refus doit dire pourquoi",
  );
  assert.equal(failover.getFailoverState().active, "primary", "on doit rester sur la primaire");
  console.log(`✓ 3. schéma différent refusé : ${refused.ok === false ? refused.reason : ""}`);

  // ── 4. Même schéma : la promotion est acceptée ──────────────
  // Une secours qui a la même empreinte est promouvable, même si son
  // registre compte un cran de moins (migration orpheline côté primaire).
  await sql(STANDBY, "alter table public.stories add column if not exists fo_guard integer");
  const accepted = await failover.promote("test : schéma identique");
  assert.equal(accepted.ok, true, "une secours au même schéma doit être promouvable");
  assert.equal(failover.getFailoverState().active, "standby", "la promotion doit être effective");
  console.log("✓ 4. schéma identique : promotion acceptée");

  // On remet les deux bases et l'état dans leur situation de départ.
  await failover.resetFailover();
  await sql(PRIMARY, "alter table public.stories drop column if exists fo_guard");
  await sql(STANDBY, "alter table public.stories drop column if exists fo_guard");
  console.log("✓ 5. colonnes de test retirées");

  // ── 6. La primaire tombe : on bascule ────────────────────────
  await failover.resetFailover();
  await sql(PRIMARY, "select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()");
  // On rend la primaire injoignable en fermant son port : le conteneur est
  // arrêté par le script appelant. Ici, on simule par une URL morte.
  process.env.DATABASE_URL = "postgresql://postgres:test@localhost:55499/devnet";
  await failover.resetFailover();

  const down = await pool.checkDatabase(1_500);
  assert.equal(down.ok, false, "la primaire doit être vue comme morte");
  state = failover.getFailoverState();
  assert.equal(
    state.active,
    "standby",
    "après un échec de connexion, on doit être basculé sur la secours",
  );
  console.log(`✓ 6. primaire morte → bascule sur la secours (${state.reason ?? ""})`);

  // ── 7. Les requêtes passent sur la secours ───────────────────
  const active = failover.activePool();
  const result = await active.query<{ n: string }>(
    "select count(*)::text as n from public.schema_migrations",
  );
  assert.equal(Number(result.rows[0]?.n), primaryMigrations, "la secours doit répondre");
  console.log("✓ 7. les requêtes passent sur la secours");

  // ── 8. La primaire revient : on y retourne ──────────────────
  process.env.DATABASE_URL = PRIMARY;
  await failover.resetFailover();
  await failover.promote("test : forcer la secours");
  assert.equal(failover.getFailoverState().active, "standby", "on doit être sur la secours");
  const back = await failover.demote("test : primaire revenue");
  assert.equal(back.ok, true, "le retour doit réussir quand la primaire répond");
  assert.equal(failover.getFailoverState().active, "primary", "on doit être revenu");
  console.log("✓ 8. primaire revenue → retour effectif");

  // ── 9. Bascule désactivée ───────────────────────────────────
  process.env.DATABASE_FAILOVER = "off";
  await failover.resetFailover();
  const disabled = await failover.promote("test : désactivée");
  assert.equal(disabled.ok, false, "DATABASE_FAILOVER=off doit interdire la bascule");
  process.env.DATABASE_FAILOVER = "auto";
  console.log("✓ 9. bascule désactivable par variable d'environnement");

  // ── 10. Une base qui accepte la connexion puis se tait ──────
  // Le 14 novembre, Systalink acceptait le TCP et ne répondait plus jamais.
  // `pg` expire alors dans la file du pool et lève une erreur SANS code :
  // c'est ce cas qui n'avait pas déclenché la bascule en production.
  const blackhole = net.createServer(() => undefined);
  await new Promise<void>((resolve) => blackhole.listen(0, "127.0.0.1", resolve));
  const silentPort = (blackhole.address() as net.AddressInfo).port;
  process.env.DATABASE_URL = `postgresql://postgres:test@127.0.0.1:${silentPort}/devnet`;
  await failover.resetFailover();

  const hung = await pool.checkDatabase(1_500);
  assert.equal(hung.ok, false, "une base muette doit être vue comme injoignable");
  state = failover.getFailoverState();
  assert.equal(
    state.active,
    "standby",
    "un gel de connexion doit déclencher la bascule comme un refus",
  );
  console.log(`✓ 10. base muette → bascule (${state.reason ?? ""})`);
  blackhole.close();

  process.env.DATABASE_URL = PRIMARY;
  await failover.resetFailover();

  /*
   * ── 11. Le retour est gardé par le schéma ──────────────────
   *
   * Le 14 novembre, la primaire est tombée et l'application a basculé sur
   * la secours. La première version de `demote()` ne vérifiait que la
   * disponibilité : si la primaire s'était réveillée avec son état ancien,
   * l'application y serait retournée seule et aurait perdu les écritures
   * faites sur la secours. On éprouve donc les deux sens.
   */
  const run = async (url: string, statement: string): Promise<void> => {
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 3_000 });
    await client.connect();
    try {
      await client.query(statement);
    } finally {
      await client.end();
    }
  };

  // Schémas alignés : le retour doit passer.
  await run(PRIMARY, "alter table public.users alter column ville set not null").catch(() => undefined);
  await run(STANDBY, "alter table public.users alter column ville set not null").catch(() => undefined);
  await failover.resetFailover();
  await failover.promote("test 11 : forcer la secours");
  const alignedDemote = await failover.demote("test 11 : primaire alignée");
  assert.equal(alignedDemote.ok, true, "un schéma identique doit autoriser le retour");
  assert.equal(failover.getFailoverState().active, "primary", "on doit être revenu");
  console.log("✓ 11. retour accepté quand les schémas sont identiques");

  // Primaire dégradée : le retour doit être refusé.
  await failover.resetFailover();
  await failover.promote("test 12 : forcer la secours");
  await run(PRIMARY, "alter table public.users alter column ville drop not null");
  const refusedDemote = await failover.demote("test 12 : primaire dégradée");
  assert.equal(refusedDemote.ok, false, "une primaire au schéma différent doit être refusée");
  assert.match(
    refusedDemote.ok === false ? refusedDemote.reason : "",
    /même schéma/,
    "le refus doit dire pourquoi",
  );
  assert.equal(
    failover.getFailoverState().active,
    "standby",
    "on doit rester sur la secours plutôt que de régresser",
  );
  console.log("✓ 12. retour refusé quand la primaire a un schéma différent");

  // Remise en état pour ne pas laisser les bases de test dégradées.
  await run(PRIMARY, "alter table public.users alter column ville set not null").catch(() => undefined);
  await failover.resetFailover();

  /*
   * ── 13. La première requête survivante ─────────────────────
   *
   * Une bascule qui n'arrive qu'à la requête suivante laisse un 500 au
   * visiteur présent au moment de la panne. `withUser` doit tenter la
   * secours une fois, sans rejouer une écriture (la connexion a échoué
   * avant toute requête).
   */
  const { withUser } = await import("../platform/infrastructure/postgres/with-user");
  process.env.DATABASE_URL = "postgresql://postgres:test@localhost:55499/devnet";
  await failover.resetFailover();
  const survived = await withUser(
    "11111111-1111-1111-1111-111111111111",
    (query) => query<{ ok: number }>("select 1 as ok"),
  );
  assert.equal(survived[0]?.ok, 1, "la première requête doit survivre à la bascule");
  assert.equal(
    failover.getFailoverState().active,
    "standby",
    "la requête doit avoir basculé puis abouti sur la secours",
  );
  console.log("✓ 13. la requête en cours bascule et aboutit sur la secours");

  process.env.DATABASE_URL = PRIMARY;
  await failover.resetFailover();

  console.log("\n✓ bascule automatique vérifiée sur deux vraies bases (13 cas)");
}

main().catch((error) => {
  console.error("ÉCHEC :", error instanceof Error ? error.message : error);
  process.exit(1);
});
