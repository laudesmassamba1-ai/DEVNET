/**
 * Exécuteur de migrations suivi.
 *
 * Trois garanties, chacune vérifiée par `scripts/db/test-migrate.ts` :
 * 1. une migration appliquée n'est jamais rejouée ;
 * 2. une migration appliquée qui a changé depuis (somme de contrôle
 *    différente) arrête l'exécution au lieu de diverger en silence ;
 * 3. chaque fichier s'exécute dans sa propre transaction, sous un
 *    verrou consultatif, donc deux exécutions simultanées ne peuvent
 *    pas s'entrelacer.
 *
 * Le SQL reste du SQL : aucune migration n'est traduite dans un DSL.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { resolvePostgresConnection } from "../../platform/infrastructure/postgres/tls";

/** Verrou consultatif arbitraire, propre à DevNet. */
const LOCK_ID = 7_270_707;

/** Bornes de sûreté : une migration ne doit pas bloquer la base indéfiniment. */
const LOCK_TIMEOUT = "5s";
const STATEMENT_TIMEOUT = "120s";

/** `001_schema.sql` oui ; `seed.sql` et `20261013…_my_schema.sql` non. */
const MIGRATION_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/i;

/** Hôtes sur lesquels un effacement de base est autorisé (`db:reset`). */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "db", "postgres"]);

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host);
}

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly file?: string,
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrateOptions {
  databaseUrl: string;
  migrationsDir: string;
  compatDir: string;
  apply?: boolean;
  log?: (line: string) => void;
}

export interface MigrateReport {
  mode: "simulate" | "apply";
  applied: string[];
  pending: string[];
  skipped: number;
  orphaned: string[];
}

function checksumOf(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export async function listMigrations(dir: string): Promise<Migration[]> {
  if (!existsSync(dir)) {
    throw new MigrationError(`Dossier de migrations introuvable : ${dir}`);
  }
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && MIGRATION_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(path.join(dir, name), "utf8");
      return { name, sql, checksum: checksumOf(sql) };
    }),
  );
}

async function ensureLedger(client: Client): Promise<void> {
  await client.query(`
    create table if not exists public.schema_migrations (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now(),
      duration_ms integer not null default 0
    )
  `);
}

async function loadApplied(client: Client): Promise<Map<string, string>> {
  const { rows: ledger } = await client.query<{ present: string | null }>(
    "select to_regclass('public.schema_migrations')::text as present",
  );
  if (!ledger[0]?.present) return new Map();

  const { rows } = await client.query<{ name: string; checksum: string }>(
    "select name, checksum from public.schema_migrations",
  );
  return new Map(rows.map((row) => [row.name, row.checksum]));
}

/**
 * Refuse d'avancer si une migration déjà appliquée a été modifiée :
 * l'état de la base ne correspondrait plus au dépôt.
 */
export function assertNoDrift(applied: Map<string, string>, migrations: Migration[]): void {
  const changed = migrations.filter(
    (migration) => applied.has(migration.name) && applied.get(migration.name) !== migration.checksum,
  );
  if (changed.length === 0) return;

  const names = changed.map((migration) => migration.name).join(", ");
  throw new MigrationError(
    `Migration(s) déjà appliquée(s) puis modifiée(s) : ${names}. ` +
      "Une migration appliquée ne se réécrit pas : créez-en une nouvelle.",
  );
}

async function applyOne(client: Client, migration: Migration, log: (line: string) => void): Promise<void> {
  const started = Date.now();
  await client.query("begin");
  try {
    await client.query(`set local lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`);
    await client.query(migration.sql);
    await client.query(
      `insert into public.schema_migrations (name, checksum, duration_ms)
       values ($1, $2, $3)`,
      [migration.name, migration.checksum, Date.now() - started],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    const reason = error instanceof Error ? error.message : String(error);
    throw new MigrationError(`${migration.name} a échoué : ${reason}`, migration.name);
  }
  log(`  ✅ ${migration.name} (${Date.now() - started} ms)`);
}

function planReport(
  all: Migration[],
  applied: Map<string, string>,
  log: (line: string) => void,
): MigrateReport {
  const known = new Set(all.map((migration) => migration.name));
  const orphaned = [...applied.keys()].filter((name) => !known.has(name)).sort();
  for (const name of orphaned) {
    log(`  ⚠️  ${name} est appliquée mais absente du dépôt`);
  }

  const pending = all.filter((migration) => !applied.has(migration.name)).map((migration) => migration.name);
  return {
    mode: "simulate",
    applied: [],
    pending,
    skipped: all.length - pending.length,
    orphaned,
  };
}

async function applyPending(
  client: Client,
  all: Migration[],
  report: MigrateReport,
  log: (line: string) => void,
): Promise<MigrateReport> {
  for (const name of report.pending) {
    const migration = all.find((candidate) => candidate.name === name);
    if (!migration) continue;
    await applyOne(client, migration, log);
    report.applied.push(migration.name);
  }
  return report;
}

export async function runMigrations(options: MigrateOptions): Promise<MigrateReport> {
  const log = options.log ?? ((line: string) => console.log(line));
  const apply = options.apply ?? false;
  const compat = await listMigrations(options.compatDir);
  const migrations = await listMigrations(options.migrationsDir);
  const all = [...compat, ...migrations];

  const connection = resolvePostgresConnection(options.databaseUrl);
  const client = new Client({
    connectionString: connection.connectionString,
    ssl: connection.ssl,
    application_name: "devnet-migrate",
  });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
    try {
      if (apply) await ensureLedger(client);
      const applied = await loadApplied(client);
      assertNoDrift(applied, all);
      const report = planReport(all, applied, log);
      if (!apply) return report;
      report.mode = "apply";
      return await applyPending(client, all, report, log);
    } finally {
      await client.query("select pg_advisory_unlock($1)", [LOCK_ID]);
    }
  } finally {
    await client.end();
  }
}

/** Charge `.env.local` puis `.env` s'ils existent, sans écraser l'environnement. */
export function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

/**
 * Charge un fichier d'environnement nommé : `--env=remote` lit `.env.remote`.
 * Évite de faire lire un fichier de secrets par le shell — `zsh` ne cherche
 * pas le répertoire courant pour `. fichier` sans barre oblique.
 */
export function loadEnvFileFor(target?: string): void {
  if (!target) return;
  const file = `.env.${target}`;
  if (!existsSync(file)) {
    throw new MigrationError(`Fichier ${file} introuvable à la racine du projet.`);
  }
  process.loadEnvFile(file);
}

export function resolveDatabaseUrl(flagValue?: string): string {
  const url = flagValue ?? process.env.DATABASE_URL;
  if (!url) {
    throw new MigrationError(
      "DATABASE_URL est absent. Copiez .env.example vers .env.local, ou passez --database-url.",
    );
  }
  return url;
}

export function parseFlag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
