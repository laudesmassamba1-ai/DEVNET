/**
 * Sonde de **joignabilité** pour les minuteries d'exploitation.
 *
 * Les scripts bash utilisaient `new Client({ connectionString })` brut. Avec
 * le certificat auto-signé de Systalink, `pg` interprète `sslmode=require`
 * comme une vérification stricte et échoue avant même d'envoyer les
 * identifiants : la minuterie annonçait « injoignable » alors que la base
 * répondait et refusait seulement le login. Ici on réutilise
 * `resolvePostgresConnection`, donc on voit la vraie cause.
 *
 * Sortie : rien sur stdout en cas de succès, une famille lisible sur stderr
 * en cas d'échec. Jamais d'URL, d'hôte complet ni de mot de passe.
 *
 *   npx tsx scripts/db/reachability.ts 'postgresql://…'
 */
import { Client } from "pg";
import { resolvePostgresConnection } from "../../platform/infrastructure/postgres/tls";

function family(message: string): string {
  if (/server login has been failing/i.test(message)) {
    return "identifiants refusés par la base (08P01) — rotation du mot de passe requise";
  }
  if (/password authentication failed/i.test(message)) return "mot de passe refusé";
  if (/self-signed|certificate/i.test(message)) return "certificat TLS refusé";
  if (/timeout/i.test(message)) return "délai de connexion dépassé";
  if (/ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|ETIMEDOUT/i.test(message)) return "hôte injoignable";
  if (/does not exist|n'existe pas/i.test(message)) return "base ou schéma absent";
  return "connexion impossible";
}

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error("URL absente");
    process.exit(2);
  }
  let connection: ReturnType<typeof resolvePostgresConnection>;
  try {
    connection = resolvePostgresConnection(url);
  } catch {
    /* `new URL` peut citer l'entrée complète — donc le mot de passe — dans
       son erreur. On ne la laisse jamais remonter telle quelle. */
    console.error("URL de connexion invalide");
    process.exit(2);
  }
  const client = new Client({
    connectionString: connection.connectionString,
    ssl: connection.ssl,
    application_name: "devnet-reachability",
    connectionTimeoutMillis: 8_000,
  });
  try {
    await client.connect();
    await client.query("select 1");
  } catch (error) {
    console.error(family(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

void main();
