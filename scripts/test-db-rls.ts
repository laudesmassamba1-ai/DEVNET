/**
 * Tests RLS et du verrou `is_admin()` sur une base PostgreSQL migrée.
 *
 * Exécuter avec : `npm run test:db-rls` (base locale migrée requise), ou
 * `CONFIRM_REMOTE=devnet npm run test:db-rls` pour la cible distante
 * explicitement confirmée.
 *
 * Ce que ces tests prouvent, et que les tests de démonstration ne peuvent
 * pas prouver :
 *  · sans identité, `is_admin()` est faux ;
 *  · un membre ne peut pas s'auto-vérifier ni se nommer administrateur ;
 *  · un administrateur identifié le peut ;
 *  · une connexion de service (`current_user = session_user`) ou
 *    `service_role` contourne le verrou pour les migrations et le serveur.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  checkDatabase,
  closePostgresPool,
  getPostgresPool,
} from "../platform/infrastructure/postgres/pool";
import { resolvePostgresConnection } from "../platform/infrastructure/postgres/tls";
import { withUser } from "../platform/infrastructure/postgres/with-user";
import { assertSafeTarget, readTarget } from "./db/guard";
import { isLocalHost, loadEnvFiles, resolveDatabaseUrl } from "./db/lib";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

async function isAdmin(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ is_admin: boolean }>("select public.is_admin() as is_admin");
  return rows[0]?.is_admin === true;
}

async function inTransaction<T>(client: Client, run: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    return await run();
  } finally {
    await client.query("rollback");
  }
}

async function asUser<T>(client: Client, userId: string | null, run: () => Promise<T>): Promise<T> {
  return inTransaction(client, async () => {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
    if (userId) {
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    }
    return run();
  });
}

async function expectPermissionDenied(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    check(name, false, "aucune erreur levée");
  } catch (error) {
    const code = (error as { code?: string }).code;
    check(name, code === "42501", { code, message: (error as Error).message });
  }
}

/**
 * Supprimer un compte qui a notifié quelqu'un doit réussir.
 *
 * `notifications.actor_id` est `on delete set null` : effacer un compte ne
 * doit pas effacer le fait qu'un like ou un suivi a eu lieu, et l'écran
 * affiche « compte supprimé ». La migration 010 avait ajouté, dans le même
 * fichier, un `check (actor_id is not null)` qui rendait l'effacement
 * impossible (23514). Non-régression : la contrainte est devenue
 * `notifications_actor_distinct` (migration 045).
 */
async function verifyAccountDeletion(client: Client): Promise<void> {
  const actorId = randomUUID();
  const recipientId = randomUUID();

  await client.query(
    `insert into auth.users (id, email) values ($1, $2), ($3, $4)`,
    [
      actorId,
      `acteur-${actorId.slice(0, 8)}@devnet.test`,
      recipientId,
      `dest-${recipientId.slice(0, 8)}@devnet.test`,
    ],
  );
  await client.query(
    `insert into public.notifications (recipient_id, actor_id, kind)
     values ($1, $2, 'follow')`,
    [recipientId, actorId],
  );

  let failure: unknown = null;
  try {
    await client.query("delete from auth.users where id = $1", [actorId]);
  } catch (error) {
    failure = error;
  }
  check(
    "supprimer un compte qui a notifié quelqu'un réussit",
    failure === null,
    failure instanceof Error ? failure.message : failure,
  );

  const { rows } = await client.query<{ n: string; actor: string | null }>(
    `select count(*)::text as n, min(actor_id::text) as actor
       from public.notifications where recipient_id = $1`,
    [recipientId],
  );
  check("la notification de l'acteur supprimé subsiste", rows[0]?.n === "1", rows[0]?.n);
  check("la notification n'a plus d'acteur", rows[0]?.actor === null, rows[0]?.actor);

  await client.query("delete from auth.users where id = $1", [recipientId]);
}

async function main(): Promise<void> {
  loadEnvFiles();
  const databaseUrl = resolveDatabaseUrl();
  const target = readTarget();
  const description = assertSafeTarget({
    databaseUrl,
    target,
    operation: "write",
    confirmRemote: process.env.CONFIRM_REMOTE,
  });
  const host = new URL(databaseUrl).hostname;
  if (!isLocalHost(host) && target !== "remote") {
    throw new Error(
      `Refus : test:db-rls écrit des lignes ; sur un hôte distant il exige DB_TARGET=remote et CONFIRM_REMOTE=${description.split("base=")[1] ?? "<base>"}.`,
    );
  }
  console.log(`Tests RLS — ${description}`);

  const connection = resolvePostgresConnection(databaseUrl);
  const client = new Client({
    connectionString: connection.connectionString,
    ssl: connection.ssl,
    application_name: "devnet-test-rls",
  });
  await client.connect();

  const adminId = randomUUID();
  const memberId = randomUUID();
  const ids = [adminId, memberId];

  try {
    await client.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1, $2, $3), ($4, $5, $6)`,
      [
        adminId,
        `admin-${adminId}@devnet.test`,
        JSON.stringify({ prenom: "Admin", pseudo: `admin_${adminId.slice(0, 8)}` }),
        memberId,
        `member-${memberId}@devnet.test`,
        JSON.stringify({ prenom: "Membre", pseudo: `membre_${memberId.slice(0, 8)}` }),
      ],
    );
    await client.query("update public.users set is_admin = true where id = $1", [adminId]);

    check(
      "sans identité, is_admin() est faux",
      await inTransaction(client, async () => {
        await client.query("set local role authenticated");
        return isAdmin(client);
      }) === false,
    );
    check("un administrateur identifié est admin", await asUser(client, adminId, () => isAdmin(client)) === true);
    check("un membre identifié n'est pas admin", await asUser(client, memberId, () => isAdmin(client)) === false);

    await expectPermissionDenied(
      "un membre ne peut pas s'auto-vérifier",
      () => asUser(client, memberId, () => client.query("update public.users set verified = true where id = $1", [memberId])),
    );
    check(
      "sans identité, une écriture protégée ne touche aucune ligne",
      await asUser(client, null, async () => {
        const result = await client.query("update public.users set verified = true where id = $1", [memberId]);
        return result.rowCount === 0;
      }),
    );
    await expectPermissionDenied(
      "un membre ne peut pas se nommer administrateur",
      () => asUser(client, memberId, () => client.query("update public.users set is_admin = true where id = $1", [memberId])),
    );

    check(
      "un membre peut encore modifier son profil",
      await asUser(client, memberId, async () => {
        await client.query("update public.users set bio = 'test rls' where id = $1", [memberId]);
        return true;
      }),
    );
    check(
      "un administrateur identifié vérifie un membre",
      await asUser(client, adminId, async () => {
        await client.query("update public.users set verified = true where id = $1", [memberId]);
        return true;
      }),
    );
    check(
      "une connexion de service contourne le verrou",
      await inTransaction(client, async () => {
        await client.query("update public.users set verified = false where id = $1", [memberId]);
        return true;
      }),
    );
    check(
      "service_role contourne le verrou",
      await inTransaction(client, async () => {
        await client.query("set local role service_role");
        await client.query("update public.users set verified = true where id = $1", [memberId]);
        return true;
      }),
    );

    await verifyAccountDeletion(client);

    const health = await checkDatabase(2_000);
    check("checkDatabase répond", health.ok, health);

    check(
      "withUser pose le rôle et l'identité",
      await withUser(adminId, async (query) => {
        const [row] = await query<{ current_user: string; uid: string; role: string; admin: boolean }>(
          "select current_user, auth.uid()::text as uid, auth.role() as role, public.is_admin() as admin",
        );
        return row.current_user === "authenticated"
          && row.uid === adminId
          && row.role === "authenticated"
          && row.admin === true;
      }),
    );
    check(
      "withUser distingue deux utilisateurs successifs",
      await withUser(memberId, async (query) => {
        const [row] = await query<{ uid: string; admin: boolean }>(
          "select auth.uid()::text as uid, public.is_admin() as admin",
        );
        return row.uid === memberId && row.admin === false;
      }),
    );
    const { rows: residual } = await getPostgresPool().query<{ current_user: string; sub: string | null }>(
      "select current_user, nullif(current_setting('request.jwt.claim.sub', true), '') as sub",
    );
    check(
      "withUser ne laisse pas d'identité dans le pool",
      residual[0]?.current_user !== "authenticated" && !residual[0]?.sub,
      residual[0],
    );
  } finally {
    await client.query("delete from public.event_outbox where actor = any($1::uuid[])", [ids]);
    await client.query("delete from public.users where id = any($1::uuid[])", [ids]);
    await client.query("delete from auth.users where id = any($1::uuid[])", [ids]);
    await client.end();
    await closePostgresPool();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} vérification(s) en échec`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${passed} vérifications passent.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ ${message}`);
  process.exitCode = 1;
});
