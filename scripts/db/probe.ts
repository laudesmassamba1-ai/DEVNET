/**
 * Point d'entrée : `npm run db:probe`.
 *
 * Sonde de capacités en **lecture seule** : version, TLS réellement négocié,
 * droits du rôle courant, extensions disponibles, taille, latence.
 * Les tests d'écriture (schéma, rôle, extension, publication) s'exécutent
 * dans une transaction **annulée** : rien n'est conservé sur la base.
 *
 * N'affiche jamais le mot de passe : l'hôte est masqué et seul le nom du
 * rôle est imprimé. Code de sortie : 0 si la connexion est chiffrée,
 * 1 si le TLS n'est pas négocié, 2 si la connexion échoue.
 */
import { Client } from "pg";
import { resolvePostgresConnection } from "../../platform/infrastructure/postgres/tls";
import { maskHost, parseEndpoint } from "./guard";
import { loadEnvFileFor, loadEnvFiles, parseFlag } from "./lib";

const SAMPLE_COUNT = 10;

interface WriteTest {
  label: string;
  sql: string;
}

const WRITE_TESTS: WriteTest[] = [
  { label: "créer un schéma", sql: "create schema devnet_probe_tmp" },
  { label: "créer un rôle", sql: "create role devnet_probe_tmp_role nologin" },
  { label: "installer pgcrypto", sql: "create extension if not exists pgcrypto" },
  { label: "créer une publication", sql: "create publication devnet_probe_tmp_pub" },
];

function resolveDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;

  loadEnvFiles();
  const fromFile = process.env.DATABASE_URL?.trim();
  if (fromFile) return fromFile;

  throw new Error(
    "DATABASE_URL absent : renseignez .env.local (modèle : .env.example) ou exportez la variable.",
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { code, message } = error as { code?: string; message?: string };
    const text = (message ?? String(error)).replace(/\s+/g, " ").slice(0, 160);
    return code ? `${code} — ${text}` : text;
  }
  return String(error).replace(/\s+/g, " ").slice(0, 160);
}

function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(26)} ${String(value)}`);
}

async function writeTests(client: Client): Promise<{ label: string; ok: boolean; detail: string }[]> {
  const results: { label: string; ok: boolean; detail: string }[] = [];
  await client.query("begin");
  try {
    for (const test of WRITE_TESTS) {
      await client.query("savepoint probe_test");
      try {
        await client.query(test.sql);
        results.push({ label: test.label, ok: true, detail: "autorisé" });
      } catch (error) {
        results.push({ label: test.label, ok: false, detail: describeError(error) });
      } finally {
        await client.query("rollback to savepoint probe_test");
      }
    }
  } finally {
    await client.query("rollback");
  }
  return results;
}

async function main(): Promise<void> {
  loadEnvFileFor(parseFlag(process.argv, "env"));
  const databaseUrl = resolveDatabaseUrl();
  const endpoint = parseEndpoint(databaseUrl);
  const requested = new URL(databaseUrl).searchParams.get("sslmode");
  const connection = resolvePostgresConnection(databaseUrl);
  const localTarget = ["localhost", "127.0.0.1", "::1", "[::1]", "db"].includes(
    new URL(databaseUrl).hostname,
  );

  console.log(
    `Sonde de capacités — hôte=${maskHost(endpoint.host)} base=${endpoint.database} tls=${connection.mode}`,
  );
  console.log(`  sslmode demandé : ${requested ?? "(absent)"}`);
  if (connection.mode === "disable") {
    console.log("  ⚠️  transport non chiffré : ne transmettez aucune donnée réelle.");
  }

  const client = new Client({
    connectionString: connection.connectionString,
    application_name: "devnet-probe",
    connectionTimeoutMillis: 15_000,
    ssl: connection.ssl,
  });
  await client.connect();

  try {
    await client.query("set statement_timeout = '10s'");

    const identity = (
      await client.query<{
        role: string;
        base: string;
        adresse: string | null;
        port: number | null;
        version: string;
      }>(`
        select current_user as role,
               current_database() as base,
               inet_server_addr()::text as adresse,
               inet_server_port() as port,
               current_setting('server_version') as version
      `)
    ).rows[0];

    console.log("\nIdentité");
    line("serveur", `${identity.adresse ?? "socket local"}:${identity.port ?? "-"}`);
    line("base", identity.base);
    line("rôle", identity.role);
    line("version", identity.version);

    const sslRow = (
      await client.query<{ ssl: boolean | null; tls: string | null; cipher: string | null }>(
        "select ssl, version as tls, cipher from pg_stat_ssl where pid = pg_backend_pid()",
      )
    ).rows[0];

    console.log("\nTransport");
    if (sslRow?.ssl) {
      line("chiffrement", `TLS ${sslRow.tls ?? "?"} / ${sslRow.cipher ?? "?"}`);
      line("certificat vérifié", connection.verified ? "oui" : "non");
    } else {
      line("chiffrement", "AUCUN — arrêt");
    }

    const settings = (
      await client.query<{ max_connections: string; wal_level: string }>(`
        select current_setting('max_connections') as max_connections,
               current_setting('wal_level') as wal_level
      `)
    ).rows[0];

    const role = (
      await client.query<{
        rolsuper: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
        rolbypassrls: boolean;
        rolconnlimit: number;
      }>(`
        select rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolconnlimit
          from pg_roles where rolname = current_user
      `)
    ).rows[0];

    const privileges = (
      await client.query<{
        can_create_schema: boolean;
        can_create_database: boolean;
        rls_roles: number;
        tables: string;
        size: string;
        publications: string;
        sessions: string;
      }>(`
        select has_schema_privilege(current_user, 'public', 'CREATE') as can_create_schema,
               has_database_privilege(current_user, current_database(), 'CREATE') as can_create_database,
               (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) as rls_roles,
               (select count(*) from information_schema.tables where table_schema = 'public') as tables,
               pg_size_pretty(pg_database_size(current_database())) as size,
               (select count(*) from pg_publication) as publications,
               (select count(*) from pg_stat_activity) as sessions
      `)
    ).rows[0];

    const extensions = (
      await client.query<{ name: string; available: string; installed: string | null }>(`
        select name, default_version as available, installed_version as installed
          from pg_available_extensions
         where name in ('pgcrypto', 'pg_trgm')
         order by name
      `)
    ).rows;

    console.log("\nCapacités");
    line("max_connections", settings.max_connections);
    line("wal_level", settings.wal_level);
    line("sessions ouvertes", privileges.sessions);
    line("tables public", privileges.tables);
    line("taille", privileges.size);
    line("publications", privileges.publications);
    line("superutilisateur", role.rolsuper ? "oui" : "non");
    line("CREATEROLE", role.rolcreaterole ? "oui" : "non");
    line("CREATEDB", role.rolcreatedb ? "oui" : "non");
    line("BYPASSRLS", role.rolbypassrls ? "oui" : "non");
    line("limite de connexions", role.rolconnlimit < 0 ? "illimitée" : role.rolconnlimit);
    line("CREATE schéma public", privileges.can_create_schema ? "oui" : "non");
    line("CREATE sur la base", privileges.can_create_database ? "oui" : "non");
    line("rôles anon/auth/service", `${privileges.rls_roles}/3 présents`);
    for (const extension of extensions) {
      line(`extension ${extension.name}`, extension.installed ? `installée ${extension.installed}` : `disponible ${extension.available}, non installée`);
    }

    console.log("\nTests d'écriture (transaction annulée, rien n'est conservé)");
    for (const result of await writeTests(client)) {
      console.log(`  ${result.ok ? "✅" : "❌"} ${result.label.padEnd(24)} ${result.detail}`);
    }

    const samples: number[] = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const started = performance.now();
      await client.query("select 1");
      samples.push(performance.now() - started);
    }
    console.log("\nLatence");
    line(`médiane (${SAMPLE_COUNT} appels)`, `${median(samples).toFixed(1)} ms`);
    line("pire cas", `${Math.max(...samples).toFixed(1)} ms`);

    if (!sslRow?.ssl && !localTarget) {
      console.log("\n❌ TLS non négocié : aucune donnée réelle sur cette connexion.");
      process.exitCode = 1;
    } else if (!sslRow?.ssl) {
      console.log("\nℹ️  Cible locale, sans TLS : normal en développement.");
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`❌ ${describeError(error)}`);
  process.exitCode = 2;
});
