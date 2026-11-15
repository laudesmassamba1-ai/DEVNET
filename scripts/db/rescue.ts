/**
 * Point d'entrée : `npm run db:rescue`.
 *
 * Une base arrêtée ne se sauvegarde pas. Quand elle redémarre, la fenêtre
 * utile est courte — et personne n'est devant l'écran à ce moment-là. Ce
 * script attend qu'elle réponde, puis enchaîne **immédiatement** sur une
 * sauvegarde chiffrée : c'est le seul moyen de figer les données avant que
 * l'application ne réécrive dessus.
 *
 * Rien n'est modifié sur la source : la sonde fait `select 1` et la
 * sauvegarde est une lecture.
 *
 * Usage :
 *   npm run db:rescue                     # surveille .env.remote, 60 min
 *   npm run db:rescue -- --wait=240       # surveille 4 h
 *   npm run db:rescue -- --once           # une seule tentative
 *   npm run db:rescue -- --interval=15    # sonde toutes les 15 s
 *
 * Code de sortie : 0 si une sauvegarde a été produite, 1 si la base n'a
 * jamais répondu dans le délai, 2 en cas d'erreur d'exécution.
 */
import { spawn } from "node:child_process";
import { Client } from "pg";
import { loadEnvFileFor, loadEnvFiles, MigrationError, parseFlag, resolveDatabaseUrl } from "./lib";
import { maskHost, parseEndpoint } from "./guard";

/** Délai d'attente par défaut, en minutes. */
const DEFAULT_WAIT_MINUTES = 60;

/** Intervalle par défaut entre deux sondes, en secondes. */
const DEFAULT_INTERVAL_SECONDS = 30;

function positiveNumber(raw: string | undefined | null, fallback: number, flag: string): number {
  if (raw === undefined || raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new MigrationError(`${flag} doit être un nombre positif (reçu : ${raw}).`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Une tentative de connexion, bornée : `connectionTimeoutMillis` évite
 * d'attendre le délai TCP complet à chaque essai, et le `statement_timeout`
 * couvre une base qui accepte la connexion sans jamais répondre — le cas
 * exact de Systalink quand son compute est arrêté.
 */
async function reachable(databaseUrl: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 8_000,
  });
  try {
    await client.connect();
    await client.query("select 1");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message.replace(/\s+/g, " ").slice(0, 120) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Lance la sauvegarde dans un processus séparé pour réutiliser ses garde-fous. */
function backup(forwarded: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["tsx", "scripts/db/backup.ts", ...forwarded],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  // Les drapeaux lus par ce script ne doivent pas être rejoués tels quels
  // vers `backup.ts` : `--wait` et `--interval` ne le concernent pas.
  const env = parseFlag(process.argv, "env");
  loadEnvFileFor(env);
  loadEnvFiles();

  const databaseUrl = resolveDatabaseUrl(parseFlag(process.argv, "database-url"));
  const endpoint = parseEndpoint(databaseUrl);
  const waitMinutes = positiveNumber(parseFlag(process.argv, "wait"), DEFAULT_WAIT_MINUTES, "--wait");
  const intervalSeconds = Math.max(
    1,
    positiveNumber(parseFlag(process.argv, "interval"), DEFAULT_INTERVAL_SECONDS, "--interval"),
  );
  const once = process.argv.includes("--once");

  const deadline = Date.now() + waitMinutes * 60_000;
  console.log(
    `Reprise — hôte=${maskHost(endpoint.host)} base=${endpoint.database} ` +
      `délai=${once ? "une tentative" : `${waitMinutes} min`} sonde=${intervalSeconds} s`,
  );

  let attempt = 0;
  while (true) {
    attempt += 1;
    const state = await reachable(databaseUrl);
    if (state.ok) {
      console.log(`\n✅ Base joignable (tentative ${attempt}). Sauvegarde immédiate…\n`);
      break;
    }

    console.log(`  tentative ${attempt} : injoignable — ${state.reason}`);
    if (once || Date.now() + intervalSeconds * 1_000 > deadline) {
      console.log(
        `\n❌ Aucune réponse avant la fin du délai. Rien n'a été sauvegardé.\n` +
          `   Relancez plus tard : npm run db:rescue -- --wait=240`,
      );
      process.exitCode = 1;
      return;
    }
    await sleep(intervalSeconds * 1_000);
  }

  // On ne transmet que ce qui concerne la sauvegarde : l'URL et l'emplacement
  // de l'archive, ainsi que l'environnement déjà chargé par ce script.
  const forwarded: string[] = [];
  if (env) forwarded.push(`--env=${env}`);
  const explicitUrl = parseFlag(process.argv, "database-url");
  if (explicitUrl) forwarded.push(`--database-url=${explicitUrl}`);
  const outDir = parseFlag(process.argv, "out-dir");
  if (outDir) forwarded.push(`--out-dir=${outDir}`);

  const code = await backup(forwarded);
  if (code !== 0) {
    console.log(`\n❌ La sauvegarde a échoué (code ${code}). Les données restent sur place.`);
    process.exitCode = code;
    return;
  }

  console.log(
    `\n→ Restauration vers la base active une fois la décision prise :\n` +
      `    npm run db:restore -- --file=<archive ci-dessus> --database-url="$DATABASE_URL"\n` +
      `  (DB_TARGET=remote et CONFIRM_REMOTE=<nom de la base> sont exigés.)`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ ${message}`);
  process.exitCode = 2;
});
