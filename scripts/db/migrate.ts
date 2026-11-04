/**
 * Point d'entrée : `npm run db:migrate`.
 *
 * Applique `db/compat/000_compat.sql` puis les migrations, et refuse
 * de continuer si une migration déjà appliquée a été réécrite.
 */
import path from "node:path";
import { loadEnvFiles, MigrationError, parseFlag, resolveDatabaseUrl, runMigrations } from "./lib";

async function main(): Promise<void> {
  loadEnvFiles();
  const databaseUrl = resolveDatabaseUrl(parseFlag(process.argv, "database-url"));
  const migrationsDir = path.resolve(parseFlag(process.argv, "dir") ?? "supabase");

  console.log(`Migrations depuis ${migrationsDir}`);
  const report = await runMigrations({
    databaseUrl,
    migrationsDir,
    compatDir: path.resolve("db/compat"),
  });

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
