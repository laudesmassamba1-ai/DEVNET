/**
 * Audit TLS et privilèges de rôle, en lecture seule.
 *
 * `npm run db:tls-audit` lit `.env.local`.
 * `npm run db:tls-audit:remote` lit `.env.remote`.
 *
 * Le script force `sslmode=verify-full` : il ne se contente pas de dire
 * « le port répond », il vérifie la chaîne avec `DATABASE_CA_CERT` ou les
 * racines du système. Il vérifie ensuite si le rôle courant peut assumer
 * `service_role`, ce qui est précisément la révocation à prouver.
 *
 * Aucune écriture, aucun secret affiché. Code de sortie : 0 si TLS est
 * vérifié et `service_role` non assumable, 1 si l'un des deux échoue,
 * 2 si la connexion est impossible.
 */
import { Client } from "pg";
import { resolvePostgresConnection } from "../../platform/infrastructure/postgres/tls";
import { describeTarget, parseEndpoint, readTarget, assertSafeTarget } from "./guard";
import { existsSync } from "node:fs";
import { loadEnvFileFor, loadEnvFiles, parseFlag, resolveDatabaseUrl } from "./lib";

function withVerifyFull(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

function clientTls(client: Client): boolean {
  const stream = (client as unknown as { connection?: { stream?: { encrypted?: boolean } } })
    .connection?.stream;
  return stream?.encrypted === true;
}

async function roleAudit(client: Client): Promise<{
  user: string;
  serviceRoleExists: boolean;
  memberOfServiceRole: boolean;
  canSetRole: boolean;
  detail: string;
}> {
  const who = await client.query<{
    current_user: string;
    session_user: string;
    rolsuper: boolean;
    rolcreaterole: boolean;
  }>(
    `select current_user, session_user, r.rolsuper, r.rolcreaterole
       from pg_roles r where r.rolname = current_user`,
  );
  const row = who.rows[0];
  const exists = await client.query<{ exists: boolean }>(
    `select exists (select 1 from pg_roles where rolname = 'service_role') as exists`,
  );
  const serviceRoleExists = exists.rows[0]?.exists === true;
  let memberOfServiceRole = false;
  let canSetRole = false;
  let detail = "rôle absent";

  if (serviceRoleExists) {
    // `pg_has_role(..., 'MEMBER')` reste vrai quand l'appartenance existe
    // sans droit de SET. La question de sécurité est le droit effectif :
    // on lit `set_option`, puis on tente `SET LOCAL ROLE` pour confirmer.
    const membership = await client.query<{ can_set: boolean }>(
      `select exists (
         select 1
           from pg_auth_members a
           join pg_roles r on r.oid = a.roleid
           join pg_roles m on m.oid = a.member
          where r.rolname = 'service_role'
            and m.rolname = current_user
            and a.set_option
       ) as can_set`,
    );
    memberOfServiceRole = membership.rows[0]?.can_set === true;
    await client.query("begin");
    try {
      await client.query("set local role service_role");
      canSetRole = true;
      detail = "assumable par le rôle courant";
    } catch {
      detail = "refusé";
    } finally {
      await client.query("rollback").catch(() => undefined);
    }
  }

  return {
    user: row?.current_user ?? "inconnu",
    serviceRoleExists,
    memberOfServiceRole,
    canSetRole,
    detail,
  };
}

async function main(): Promise<void> {
  const envName = parseFlag(process.argv, "env");
  if (envName && existsSync(`.env.${envName}`)) {
    loadEnvFileFor(envName);
  } else {
    // `.env.remote` a été retiré volontairement ; la cible distante vit
    // maintenant dans `.env.local`, qui porte DB_TARGET=remote.
    loadEnvFiles();
  }
  const rawUrl = resolveDatabaseUrl(parseFlag(process.argv, "database-url"));
  const target = readTarget();
  const description = assertSafeTarget({ databaseUrl: rawUrl, target, operation: "read" });
  const endpoint = parseEndpoint(rawUrl);
  const config = resolvePostgresConnection(withVerifyFull(rawUrl));

  console.log(`Audit TLS et rôles — ${describeTarget(endpoint, target)}`);
  console.log(`  mode demandé            verify-full`);

  const client = new Client({
    connectionString: config.connectionString,
    ssl: config.ssl,
    connectionTimeoutMillis: 10_000,
    application_name: "devnet-tls-audit",
  });

  try {
    await client.connect();
    const server = await client.query<{ ssl: boolean; version: string | null; cipher: string | null }>(
      `select coalesce(ssl, false) as ssl, version, cipher
         from pg_stat_ssl where pid = pg_backend_pid()`,
    );
    const sslRow = server.rows[0];
    const encrypted = clientTls(client) || sslRow?.ssl === true;
    console.log(`  chiffré côté client     ${encrypted ? "oui" : "non"}`);
    console.log(`  TLS vu par le serveur   ${sslRow?.ssl ? "oui" : "non (terminé par le pooler)"}`);
    if (sslRow?.version) console.log(`  version TLS             ${sslRow.version}`);
    if (sslRow?.cipher) console.log(`  chiffrement             ${sslRow.cipher}`);

    const role = await roleAudit(client);
    console.log(`  rôle courant            ${role.user}`);
    console.log(`  service_role présent    ${role.serviceRoleExists ? "oui" : "non"}`);
    console.log(`  droit SET sur service_role ${role.memberOfServiceRole ? "oui" : "non"}`);
    console.log(`  SET ROLE service_role   ${role.canSetRole ? "ACCEPTÉ" : "refusé"} (${role.detail})`);

    if (!encrypted) {
      console.error("\n✗ TLS non chiffré : la vérification échoue.");
      process.exitCode = 1;
      return;
    }
    if (role.canSetRole) {
      console.error(
        "\n✗ service_role est encore assumable : révoquer l'appartenance avant de considérer le rôle durci.",
      );
      process.exitCode = 1;
      return;
    }
    console.log(`\n${description} : TLS vérifié, service_role non assumable.`);
  } catch (error) {
    console.error(
      `\n✗ Connexion verify-full impossible : ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
