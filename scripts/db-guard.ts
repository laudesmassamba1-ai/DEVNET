/**
 * `npm run db:guard` — affiche la cible et vérifie les garde-fous.
 *
 * N'ouvre aucune connexion. Utile avant un script base de données pour
 * voir quel hôte masqué et quel nom de base seraient touchés.
 */
import { assertSafeTarget, GuardError, readTarget } from "./db/guard";
import { loadEnvFiles, parseFlag, resolveDatabaseUrl } from "./db/lib";

type Operation = "read" | "migrate" | "write" | "destructive" | "reset";

function parseOperation(argv: string[]): Operation {
  const raw = parseFlag(argv, "operation") ?? "read";
  if (raw === "read" || raw === "migrate" || raw === "write" || raw === "destructive" || raw === "reset") {
    return raw;
  }
  throw new GuardError(`Opération inconnue : « ${raw} ».`);
}

async function main(): Promise<void> {
  loadEnvFiles();
  const databaseUrl = resolveDatabaseUrl(parseFlag(process.argv, "database-url"));
  const target = readTarget();
  const operation = parseOperation(process.argv);
  const description = assertSafeTarget({
    databaseUrl,
    target,
    operation,
    confirmRemote: process.env.CONFIRM_REMOTE,
  });
  console.log(`Garde-fous OK — ${description} opération=${operation}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ ${message}`);
  process.exitCode = error instanceof GuardError ? 1 : 2;
});
