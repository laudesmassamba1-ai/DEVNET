/**
 * Met une base de secours au niveau de la base primaire.
 *
 * Pourquoi ce script existe : la bascule automatique refuse de promouvoir
 * une base en retard de migrations — et elle a raison, une base plus
 * ancienne accepterait des écritures en perdant des colonnes. Mais ce refus
 * laisse une question sans réponse : comment remettre la secours à niveau
 * sans risquer de casser la primaire ?
 *
 * Ce script répond à cette question, et à elle seule. Il applique les
 * migrations **manquantes** sur la cible, dans l'ordre, une par transaction,
 * et s'arrête au premier échec. Il ne copie aucune donnée : une secours à
 * jour de schéma mais vide reste une secours vide, et c'est un choix — copier
 * des données de production sans le dire serait pire.
 *
 * L'application passe par `runMigrations()` : le même code que la
 * production, donc le même verrou consultatif, les mêmes délais maximaux,
 * le même refus de rejouer une migration modifiée. Réécrire cette boucle ici
 * aurait été une seconde implémentation à maintenir, et la moins éprouvée.
 *
 *   npx tsx scripts/db/sync-standby.ts                 # simulation
 *   npx tsx scripts/db/sync-standby.ts --apply         # applique
 *   npx tsx scripts/db/sync-standby.ts --check         # sort en 1 si en retard
 *   npx tsx scripts/db/sync-standby.ts --from=URL --to=URL
 *
 * Par défaut : `DATABASE_URL` → `DATABASE_URL_STANDBY`.
 *
 * Garde-fous :
 *  - refuse si la cible porte une migration que la source n'a pas (elle est
 *    en avance : la synchroniser reviendrait à reculer, ce qui n'a pas de
 *    sens) ;
 *  - refuse si la cible est la même base que la source ;
 *  - simulation par défaut ;
 *  - n'affiche jamais une URL de connexion, seulement hôte masqué et base.
 */
import { Client } from "pg";
import {
  listMigrations,
  loadEnvFiles,
  MigrationError,
  runMigrations,
} from "./lib";
import { resolvePostgresConnection } from "../../platform/infrastructure/postgres/tls";

type Options = {
  from: string;
  to: string;
  apply: boolean;
  check: boolean;
  migrationsDir: string;
  compatDir: string;
};

function maskHost(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const masked = host.length > 12 ? `${host.slice(0, 6)}***${host.slice(-6)}` : "***";
    return `${masked}:${parsed.port || "5432"}/${parsed.pathname.replace(/^\//, "")}`;
  } catch {
    return "***";
  }
}

function parseArgs(argv: string[]): Options {
  const from =
    argv.find((arg) => arg.startsWith("--from="))?.slice("--from=".length) ??
    process.env.DATABASE_URL ??
    "";
  const to =
    argv.find((arg) => arg.startsWith("--to="))?.slice("--to=".length) ??
    process.env.DATABASE_URL_STANDBY ??
    "";
  return {
    from,
    to,
    apply: argv.includes("--apply"),
    check: argv.includes("--check"),
    migrationsDir: "db/migrations",
    compatDir: "db/compat",
  };
}

async function connect(url: string): Promise<Client> {
  const connection = resolvePostgresConnection(url);
  const client = new Client({
    connectionString: connection.connectionString,
    ssl: connection.ssl,
    application_name: "devnet-sync-standby",
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  return client;
}

/** Migrations inscrites au registre d'une base. Absent = base neuve. */
async function appliedNames(client: Client): Promise<Set<string>> {
  const { rows } = await client.query<{ present: string | null }>(
    "select to_regclass('public.schema_migrations')::text as present",
  );
  if (!rows[0]?.present) return new Set();

  const result = await client.query<{ name: string }>(
    "select name from public.schema_migrations",
  );
  return new Set(result.rows.map((row) => row.name));
}

async function main(): Promise<void> {
  loadEnvFiles();
  const options = parseArgs(process.argv.slice(2));

  if (!options.from) {
    throw new MigrationError("aucune source. Poser DATABASE_URL ou --from=URL.");
  }
  if (!options.to) {
    throw new MigrationError(
      "aucune cible. Poser DATABASE_URL_STANDBY ou --to=URL.",
    );
  }
  if (options.from === options.to) {
    throw new MigrationError("source et cible sont identiques.");
  }

  console.log("Synchronisation de schéma");
  console.log(`  source : ${maskHost(options.from)}`);
  console.log(`  cible  : ${maskHost(options.to)}`);
  console.log(`  mode   : ${options.apply ? "application" : "simulation"}`);

  const source = await connect(options.from);
  const target = await connect(options.to);

  let missing: string[];
  try {
    const sourceApplied = await appliedNames(source);
    const targetApplied = await appliedNames(target);

    const unknown = [...targetApplied].filter((name) => !sourceApplied.has(name));
    if (unknown.length > 0) {
      throw new MigrationError(
        `la cible porte ${unknown.length} migration(s) que la source n'a pas `
          + `(${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? "…" : ""}). `
          + "Elle est en avance : la synchroniser la ferait reculer.",
      );
    }

    const compat = await listMigrations(options.compatDir).catch(() => []);
    const migrations = await listMigrations(options.migrationsDir);
    const all = [...compat, ...migrations];

    missing = all
      .filter((migration) => !targetApplied.has(migration.name))
      .map((migration) => migration.name);

    if (missing.length === 0) {
      console.log(`\n✓ La cible est déjà à niveau (${targetApplied.size} migrations).`);
      return;
    }

    console.log(`\n${missing.length} migration(s) manquante(s) sur la cible :`);
    for (const name of missing) console.log(`  · ${name}`);

    if (!options.apply) {
      if (options.check) {
        console.error("\nÉCHEC : la cible est en retard (--check).");
        process.exitCode = 1;
        return;
      }
      console.log("\nSimulation : rien n'a été appliqué. Ajouter --apply pour agir.");
      return;
    }
  } finally {
    await target.end().catch(() => undefined);
    await source.end().catch(() => undefined);
  }

  const report = await runMigrations({
    databaseUrl: options.to,
    migrationsDir: options.migrationsDir,
    compatDir: options.compatDir,
    apply: true,
    log: (line) => console.log(line),
  });

  console.log(
    `\n✓ ${report.applied.length} migration(s) appliquée(s). `
      + `Cible à ${report.applied.length + report.skipped} migrations.`,
  );
}

main().catch((error) => {
  console.error("ÉCHEC :", error instanceof Error ? error.message : error);
  process.exit(1);
});
