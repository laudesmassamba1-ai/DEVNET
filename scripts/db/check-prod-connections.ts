/**
 * Prouve quelle base sert la production.
 *
 *   npx tsx scripts/db/check-prod-connections.ts
 *
 * Pourquoi ce script existe : la date des stickers ne prouve rien depuis que
 * l'import a copié Neon dans Systalink — les deux bases portent les mêmes
 * lignes. La seule preuve fiable est de regarder, depuis chaque base, si une
 * connexion applicative y arrive quand la production répond.
 *
 * Le script interroge les deux bases en lecture seule et n'affiche que des
 * noms d'application, des adresses et des états : aucun secret.
 */
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { resolvePostgresConnection } from "../../platform/infrastructure/postgres/tls";
import { loadEnvFiles } from "./lib";

const PROD_URL = "https://devnet-brown.vercel.app";

function urlFromEnvFile(file: string): string | null {
  try {
    const line = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    return line ? line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "").trim() : null;
  } catch {
    return null;
  }
}

async function connect(url: string): Promise<Client> {
  const config = resolvePostgresConnection(url);
  const client = new Client({ connectionString: config.connectionString, ssl: config.ssl });
  await client.connect();
  return client;
}

interface Row {
  application_name: string | null;
  client_addr: string | null;
  state: string | null;
}

async function webConnections(label: string, url: string | null): Promise<number | null> {
  if (!url) {
    console.log(`${label}: URL absente, ignorée`);
    return null;
  }
  let client: Client | undefined;
  try {
    client = await connect(url);
    const { rows } = await client.query<Row>(
      `select application_name, client_addr::text as client_addr, state
       from pg_stat_activity
       where datname = current_database() and pid <> pg_backend_pid()`,
    );
    const web = rows.filter((r) => r.application_name === "devnet-web");
    console.log(`${label}: ${web.length} connexion(s) « devnet-web »`);
    for (const r of web.slice(0, 4)) {
      console.log(`   ${r.client_addr ?? "local"} — ${r.state ?? "?"}`);
    }
    return web.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`${label}: injoignable (${message})`);
    return null;
  } finally {
    await client?.end();
  }
}

async function main(): Promise<void> {
  loadEnvFiles();

  // Une requête sur la prod pour provoquer l'ouverture d'une connexion.
  try {
    const response = await fetch(`${PROD_URL}/api/ready`, {
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.text();
    console.log(`Production ${PROD_URL}/api/ready → ${response.status} ${body.slice(0, 80)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Production injoignable : ${message}`);
  }

  // Laisse le pool de la fonction serverless s'établir avant de regarder.
  await new Promise((resolve) => setTimeout(resolve, 3_000));

  console.log("");
  const target = await webConnections("Systalink (cible)", process.env.DATABASE_URL ?? null);
  const neon = await webConnections("Neon (ancienne)", urlFromEnvFile(".env.remote-source"));

  console.log("");
  if (target && target > 0 && (!neon || neon === 0)) {
    console.log("CONCLUSION : la production sert Systalink. Bascule effective.");
  } else if (neon && neon > 0 && (!target || target === 0)) {
    console.log("CONCLUSION : la production sert encore Neon. Bascule non effective.");
  } else if (target && neon) {
    console.log("CONCLUSION : les deux bases reçoivent des connexions applicatives.");
    console.log("Vérifier s'il reste un ancien déploiement en service (vercel ls).");
  } else {
    console.log("CONCLUSION : indéterminée, aucune connexion applicative observée.");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ÉCHEC : ${message}`);
  process.exit(1);
});
