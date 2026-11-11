/**
 * Point d'entrée : `npm run db:migrate`.
 *
 * Simulation par défaut : affiche les migrations qui seraient appliquées.
 * `--apply` exécute réellement, après passage par les garde-fous.
 */
import path from "node:path";
import { assertSafeTarget, readTarget } from "./guard";
import {
  loadEnvFileFor,
  loadEnvFiles,
  MigrationError,
  parseFlag,
  resolveDatabaseUrl,
  runMigrations,
} from "./lib";

async function main(): Promise<void> {
  loadEnvFileFor(parseFlag(process.argv, "env"));
  loadEnvFiles();
  const databaseUrl = resolveDatabaseUrl(parseFlag(process.argv, "database-url"));
  const target = readTarget();
  const apply = process.argv.includes("--apply");
  const migrationsDir = path.resolve(parseFlag(process.argv, "dir") ?? "supabase");

  const description = assertSafeTarget({
    databaseUrl,
    target,
    // Une simulation ne lit que le registre : aucune confirmation requise.
    operation: apply ? "migrate" : "read",
    confirmRemote: process.env.CONFIRM_REMOTE,
  });
  console.log(`Migrations — ${description}`);
  console.log(`Mode : ${apply ? "application" : "simulation (ajoutez --apply pour agir)"}`);

  const report = await runMigrations({
    databaseUrl,
    migrationsDir,
    compatDir: path.resolve("db/compat"),
    apply,
  });

  if (!apply) {
    console.log(
      report.pending.length === 0
        ? `Rien à appliquer — ${report.skipped} migration(s) déjà en base.`
        : `${report.pending.length} migration(s) à appliquer, ${report.skipped} déjà en base.`,
    );
    if (report.pending.length > 0) console.log(`  ${report.pending.join(", ")}`);
    return;
  }

  console.log(
    report.applied.length === 0
      ? `Rien à appliquer — ${report.skipped} migration(s) déjà en base.`
      : `${report.applied.length} appliquée(s), ${report.skipped} déjà en base.`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ ${message}`);
  process.exitCode = error instanceof MigrationError ? 1 : 2;
});
