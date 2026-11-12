/**
 * `npm run db:reset -- --yes` — repart d'une base vide, puis remigre.
 *
 * Garde-fou : refuse tout hôte qui n'est pas local. Un `DATABASE_URL`
 * distant recopié par erreur dans `.env.local` ne doit pas pouvoir
 * effacer une base réelle (jamais de reset en production).
 */
import path from "node:path";
import { Client } from "pg";
import { assertSafeTarget, readTarget } from "./guard";
import { loadEnvFiles, isLocalHost, MigrationError, parseFlag, resolveDatabaseUrl, runMigrations } from "./lib";

function assertLocal(databaseUrl: string): string {
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new MigrationError("DATABASE_URL illisible : impossible d'identifier l'hôte.");
  }
  if (!isLocalHost(host)) {
    throw new MigrationError(
      `Refus d'effacer la base : hôte « ${host} » n'est pas local. ` +
        "db:reset ne s'exécute que sur une base de développement.",
    );
  }
  return host;
}

async function dropSchemas(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      drop schema if exists public cascade;
      create schema public;
      drop schema if exists auth cascade;
      drop schema if exists extensions cascade;
    `);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  loadEnvFiles();
  const databaseUrl = resolveDatabaseUrl(parseFlag(process.argv, "database-url"));
  const target = readTarget();
  const description = assertSafeTarget({
    databaseUrl,
    target,
    operation: "reset",
    confirmRemote: process.env.CONFIRM_REMOTE,
  });
  const host = assertLocal(databaseUrl);
  console.log(`Réinitialisation — ${description}`);

  if (!process.argv.includes("--yes")) {
    if (!process.stdin.isTTY) {
      throw new MigrationError(
        "Confirmation absente : relancez avec --yes pour effacer la base locale.",
      );
    }
    const { createInterface } = await import("node:readline/promises");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Effacer toute la base sur ${host} ? (oui/non) `);
    rl.close();
    if (answer.trim().toLowerCase() !== "oui") {
      console.log("Annulé, rien n'a été touché.");
      return;
    }
  }

  await dropSchemas(databaseUrl);
  console.log(`Base vidée sur ${host}.`);

  const report = await runMigrations({
    databaseUrl,
    migrationsDir: path.resolve(parseFlag(process.argv, "dir") ?? "db/migrations"),
    compatDir: path.resolve("db/compat"),
    apply: true,
  });
  console.log(`${report.applied.length} migration(s) appliquée(s).`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ ${message}`);
  process.exitCode = error instanceof MigrationError ? 1 : 2;
});
