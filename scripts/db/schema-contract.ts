/**
 * Vérifie le contrat de schéma sur une cible, sans écrire.
 *
 * `npm run db:schema-contract` lit `.env.local`.
 * `npm run db:schema-contract:remote` lit `.env.remote`.
 *
 * C'est la preuve courte que `/api/ready` peut afficher `activeSchema: ok`
 * même quand la secours est illisible. Le script ne fait aucune requête
 * d'écriture et n'affiche jamais l'URL complète.
 */
import { existsSync } from "node:fs";
import { loadEnvFileFor, loadEnvFiles, parseFlag, resolveDatabaseUrl } from "./lib";
import { checkActiveSchema } from "../../platform/infrastructure/postgres/schema-contract";
import { assertSafeTarget, describeTarget, parseEndpoint, readTarget } from "./guard";

async function main(): Promise<void> {
  const envName = parseFlag(process.argv, "env");
  if (envName && existsSync(`.env.${envName}`)) {
    loadEnvFileFor(envName);
  } else {
    // `.env.remote` a été retiré volontairement ; la cible distante vit
    // maintenant dans `.env.local`, qui porte DB_TARGET=remote.
    loadEnvFiles();
  }
  const databaseUrl = resolveDatabaseUrl(parseFlag(process.argv, "database-url"));
  const target = readTarget();
  const description = assertSafeTarget({
    databaseUrl,
    target,
    operation: "read",
  });

  process.env.DATABASE_URL = databaseUrl;
  const contract = await checkActiveSchema();
  const endpoint = parseEndpoint(databaseUrl);

  console.log(`Contrat de schéma — ${describeTarget(endpoint, target)}`);
  console.log(`  vérifié le              ${contract.checkedAt}`);
  console.log(`  état                    ${contract.ok ? "ok" : "incomplet"}`);
  if (!contract.ok) {
    console.log(`  manquant                ${contract.missing.length}`);
    for (const item of contract.missing.slice(0, 30)) console.log(`    · ${item}`);
    process.exitCode = 1;
    return;
  }
  console.log(`  tables, colonnes        ok`);
  console.log(`  fonctions T&S           ok`);
  console.log(`\n${description} : contrat respecté.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
