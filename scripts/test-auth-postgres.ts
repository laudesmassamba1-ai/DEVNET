/**
 * Authentification PostgreSQL — test d'intégration sur la base **locale**.
 *
 * Exécuter avec : `npm run test:auth-postgres` (base locale migrée requise).
 *
 * Ce que ce test prouve, qu'un test de contrat ne peut pas prouver :
 * l'empreinte scrypt est bien celle qui est relue, le jeton n'est stocké que
 * haché, une session expirée disparaît, et la RLS rend les deux tables
 * invisibles à une identité d'utilisateur.
 *
 * Il **écrit** : il refuse donc toute cible distante et nettoie dans
 * `finally`.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  createAuthService,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "../modules/auth";
import { PostgresAuthRepository } from "../modules/auth/infrastructure/postgres/postgres-auth-repository";
import { closePostgresPool } from "../platform/infrastructure/postgres/pool";
import { withUser } from "../platform/infrastructure/postgres/with-user";
import { parseEndpoint } from "./db/guard";
import { isLocalHost, loadEnvFiles, resolveDatabaseUrl } from "./db/lib";

const PASSWORD = "mot-de-passe-de-test-046";
const alice = randomUUID();
const bob = randomUUID();

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
  for (const [id, label, email] of [
    [alice, "alice", `alice-${alice.slice(0, 8)}@probe.local`],
    [bob, "bob", `bob-${bob.slice(0, 8)}@probe.local`],
  ] as const) {
    await client.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    await client.query(
      "update public.users set pseudo = $2, prenom = $2, is_admin = false where id = $1",
      [id, `probe-${label}-${id.slice(0, 8)}`],
    );
  }

  await client.query(
    "insert into public.user_credentials (user_id, password_hash) values ($1, $2)",
    [alice, await hashPassword(PASSWORD)],
  );
}

async function cleanup(client: Client): Promise<void> {
  // `auth.users` cascade vers public.users puis credentials et sessions.
  await client.query("delete from auth.users where id = any($1::uuid[])", [[alice, bob]]);
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

  const client = new Client({ connectionString: databaseUrl, application_name: "devnet-test-auth" });
  await client.connect();

  const repository = new PostgresAuthRepository({
    query: async (sql: string, values?: unknown[]) => (await client.query(sql, values)).rows,
  });
  const service = createAuthService({ repository });

  try {
    await seed(client);

    // 1. Mot de passe correct.
    const signedIn = await service.signIn({
      email: `alice-${alice.slice(0, 8)}@probe.local`,
      password: PASSWORD,
      userAgent: "probe-test",
    });
    check("connexion : acceptée", signedIn.ok === true, signedIn.ok);
    if (!signedIn.ok) return;
    check("connexion : bon utilisateur", signedIn.userId === alice, signedIn.userId);
    check(
      "connexion : jeton opaque de 43 caractères",
      /^[A-Za-z0-9_-]{43}$/.test(signedIn.token),
      signedIn.token.length,
    );

    // 2. Mauvais mot de passe, compte inconnu : même refus.
    const wrong = await service.signIn({
      email: `alice-${alice.slice(0, 8)}@probe.local`,
      password: "mauvais-mot-de-passe",
    });
    check("mauvais mot de passe refusé", wrong.ok === false, wrong.ok);
    const unknown = await service.signIn({
      email: `inconnu-${randomUUID().slice(0, 8)}@probe.local`,
      password: PASSWORD,
    });
    check("compte inconnu refusé", unknown.ok === false, unknown.ok);

    // 3. Le jeton n'est stocké que haché.
    const stored = await client.query<{ token_hash: string; cleartext: string }>(
      `select token_hash, (token_hash = $1)::text as cleartext
         from public.sessions where id = $2::uuid`,
      [signedIn.token, signedIn.sessionId],
    );
    check("session : une ligne créée", stored.rows.length === 1, stored.rows.length);
    check(
      "session : seul le SHA-256 est stocké",
      stored.rows[0]?.token_hash === hashSessionToken(signedIn.token),
      "jeton en clair ?",
    );

    // 4. Résolution de session.
    const resolved = await service.resolveSession(signedIn.token);
    check("session : résolue", resolved?.userId === alice, resolved);
    check("session : jeton inconnu refusé", (await service.resolveSession("inconnu")) === null);

    // 5. Adresse insensible à la casse et aux espaces.
    const spaced = await service.signIn({
      email: `  ALICE-${alice.slice(0, 8)}@PROBE.LOCAL `,
      password: PASSWORD,
    });
    check("adresse normalisée : acceptée", spaced.ok === true, spaced.ok);

    // 6. Session expirée : refusée, puis supprimée.
    const shortLived = createAuthService({ repository, sessionTtlMs: -1_000 });
    const expired = await shortLived.signIn({
      email: `alice-${alice.slice(0, 8)}@probe.local`,
      password: PASSWORD,
    });
    if (expired.ok) {
      check("session expirée : refusée", (await service.resolveSession(expired.token)) === null);
      const remaining = await client.query<{ n: string }>(
        "select count(*)::text as n from public.sessions where id = $1::uuid",
        [expired.sessionId],
      );
      check("session expirée : supprimée", remaining.rows[0]?.n === "0", remaining.rows[0]?.n);
    } else {
      check("session expirée : connexion de test possible", false, expired.reason);
    }

    // 7. Déconnexion.
    await service.signOut(signedIn.token);
    check("déconnexion : session résolue à null", (await service.resolveSession(signedIn.token)) === null);

    // 8. Suppression du compte : sessions et empreinte suivent.
    const bobSession = await service.signIn({
      email: `bob-${bob.slice(0, 8)}@probe.local`,
      password: PASSWORD,
    });
    check("compte sans empreinte refusé", bobSession.ok === false, bobSession.ok);
    await client.query(
      "insert into public.user_credentials (user_id, password_hash) values ($1, $2)",
      [bob, await hashPassword(PASSWORD)],
    );
    const bobSignedIn = await service.signIn({
      email: `bob-${bob.slice(0, 8)}@probe.local`,
      password: PASSWORD,
    });
    check("second compte : connexion", bobSignedIn.ok === true);
    await client.query("delete from auth.users where id = $1", [bob]);
    const leftovers = await client.query<{ sessions: string; credentials: string }>(
      `select (select count(*) from public.sessions where user_id = $1)::text as sessions,
              (select count(*) from public.user_credentials where user_id = $1)::text as credentials`,
      [bob],
    );
    check("suppression : sessions parties", leftovers.rows[0]?.sessions === "0", leftovers.rows[0]?.sessions);
    check("suppression : empreinte partie", leftovers.rows[0]?.credentials === "0", leftovers.rows[0]?.credentials);

    // 9. La RLS cache les deux tables à une identité d'utilisateur.
    const visibleSessions = await withUser(alice, (query) =>
      query<{ n: string }>("select count(*)::text as n from public.sessions"),
    ).catch(() => [{ n: "refus" }]);
    check("RLS : sessions invisibles", visibleSessions[0]?.n === "0" || visibleSessions[0]?.n === "refus", visibleSessions[0]?.n);
    const visibleCredentials = await withUser(alice, (query) =>
      query<{ n: string }>("select count(*)::text as n from public.user_credentials"),
    ).catch(() => [{ n: "refus" }]);
    check(
      "RLS : empreintes invisibles",
      visibleCredentials[0]?.n === "0" || visibleCredentials[0]?.n === "refus",
      visibleCredentials[0]?.n,
    );

    // 10. Une empreinte corrompue est un refus, pas un plantage.
    check("empreinte invalide refusée", (await verifyPassword(PASSWORD, "bcrypt$x$y")) === false);
    check("empreinte sans sel refusée", (await verifyPassword(PASSWORD, "scrypt$16384$8$1$$")) === false);
  } finally {
    await cleanup(client).catch((error: unknown) => {
      console.error("Nettoyage impossible :", error);
    });
    await client.end();
    await closePostgresPool();
  }

  if (failures.length > 0) {
    console.error("\n✗ Authentification PostgreSQL :");
    for (const failure of failures) console.error(`  · ${failure}`);
    console.error(`\n${passed} vérifications passées, ${failures.length} en échec.\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`✓ Authentification PostgreSQL — ${passed} vérifications réussies.`);
}

main().catch(async (error: unknown) => {
  console.error(error);
  await closePostgresPool().catch(() => undefined);
  process.exitCode = 1;
});
