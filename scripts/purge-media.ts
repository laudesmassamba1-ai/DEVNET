/**
 * Purge manuelle des stories expirées.
 *
 * Utilisable en local ou par un ordonnanceur qui ne peut pas appeler une
 * route HTTP :
 *
 *   npx tsx scripts/purge-media.ts --hours=24
 *
 * Refuse une cible non locale ? Non : cette opération est précisément celle
 * qui doit pouvoir tourner en production. En revanche, elle ne fait rien
 * d'autre que la fonction SQL bornée, et elle journalise uniquement le
 * nombre de lignes supprimées.
 */
import { loadEnvFiles } from "./db/lib";
import { purgeExpiredStories } from "../lib/media-purge";
import { closePostgresPool } from "../platform/infrastructure/postgres/pool";

function hoursFromArgv(argv: string[]): number | null {
  const raw = argv.find((arg) => arg.startsWith("--hours="));
  if (!raw) return null;
  const value = Number(raw.slice("--hours=".length));
  return Number.isFinite(value) ? value : null;
}

async function main(): Promise<void> {
  loadEnvFiles();
  const requested = hoursFromArgv(process.argv.slice(2));
  if (requested !== null && (requested < 0 || requested > 168)) {
    throw new Error("--hours doit être compris entre 0 et 168.");
  }

  try {
    const removed = await purgeExpiredStories(requested ?? 24);
    console.log(JSON.stringify({ ok: true, removed, at: new Date().toISOString() }));
  } finally {
    await closePostgresPool();
  }
}

main().catch((error: unknown) => {
  console.error(
    `❌ purge impossible : ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
