/**
 * Assurance locale légère.
 *
 * `npm run assurance` ne démarre pas Next et ne touche aucune base : il
 * agrège trois signaux qui doivent être vrais avant un déploiement.
 *
 *  1. **Environnements** : la cible distante et la secours ne doivent pas
 *     désigner le même hôte, et `.env.remote` ne doit pas rester sur
 *     l'ancienne Systalink.
 *  2. **Capacités** : le produit dit ce qui fonctionne en local, en
 *     notification interne, ou pas du tout. Aucun fournisseur absent n'est
 *     présenté comme disponible.
 *  3. **Dette UI** : le cliquet est exécuté, puis les premiers postes de
 *     réduction sont affichés pour éviter de traiter 489 valeurs à l'aveugle.
 *
 * Les preuves qui demandent une base ou un navigateur restent séparées :
 * `db:schema-contract`, `db:tls-audit` et `test:trust-safety-visual`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { maskHost } from "../db/guard";

const ROOT = process.cwd();
const failures: string[] = [];

function readEnv(file: string): Record<string, string> {
  if (!existsSync(join(ROOT, file))) return {};
  return Object.fromEntries(
    readFileSync(join(ROOT, file), "utf8")
      .split("\n")
      .filter((line) => line && !line.trimStart().startsWith("#") && line.includes("="))
      .map((line) => {
        const split = line.indexOf("=");
        return [line.slice(0, split), line.slice(split + 1).trim()];
      }),
  );
}

function hostOf(value: string | undefined): string {
  if (!value) return "";
  try {
    return new URL(value.replace(/^['"]|['"]$/g, "")).hostname;
  } catch {
    return "";
  }
}

function envAudit(): void {
  const local = readEnv(".env.local");
  const legacy = readEnv(".env.remote");
  const standby = readEnv(".env.standby");
  const remote = legacy.DATABASE_URL ? legacy : local;
  const remoteHost = hostOf(remote.DATABASE_URL);
  const standbyHost = hostOf(standby.DATABASE_URL);
  const legacyIsDisabled = existsSync(".env.remote.disabled-20261115");

  console.log("\nEnvironnements");
  const checks: [string, boolean, string][] = [
    ["cible distante définie", Boolean(remoteHost), "DATABASE_URL absente"],
    [
      "cible distante déclarée remote",
      remote.DB_TARGET === "remote" || local.DB_TARGET === "remote",
      `DB_TARGET=${remote.DB_TARGET ?? local.DB_TARGET ?? "absent"}`,
    ],
    [".env.standby existe", Boolean(standby.DATABASE_URL), "secours absente"],
    [
      "remote et secours distincts",
      Boolean(remoteHost) && Boolean(standbyHost) && remoteHost !== standbyHost,
      `remote=${maskHost(remoteHost)} secours=${maskHost(standbyHost)}`,
    ],
    [
      "l'ancienne Systalink n'est plus la cible distante",
      !remoteHost.includes("systalinkdatabases.com"),
      `remote=${maskHost(remoteHost)}`,
    ],
    [
      "l'ancien .env.remote est neutralisé",
      !legacy.DATABASE_URL || legacyIsDisabled,
      legacy.DATABASE_URL ? "fichier actif" : "fichier absent, archive désactivée",
    ],
  ];

  for (const [label, ok, detail] of checks) {
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` (${detail})`}`);
    if (!ok) failures.push(label);
  }
}

function capabilityAudit(): void {
  const local = readEnv(".env.local");
  const has = (key: string) => Boolean(local[key]?.trim());
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  const externalAi = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]
    .some(has);
  const emailConfigured =
    (has("EMAILJS_SERVICE_ID") && has("EMAILJS_TEMPLATE_ID") && has("EMAILJS_PUBLIC_KEY")) ||
    (has("RESEND_API_KEY") && has("EMAIL_FROM"));

  const rows: [string, string, string][] = [
    ["texte", "local", "règles, listes et accents, aucun appel réseau"],
    ["image", "local", "empreinte et heuristique de peau, revue humaine"],
    ["audio", "absent", "aucun modèle local ; ne pas prétendre analyser"],
    ["liens", "local", "forme de l'URL et liste de domaines, aucun accès sortant"],
    ["secrets", "local", "familles et confiance, valeur jamais recopiée"],
    ["comportement", "local", "volume, ancienneté et signalements agrégés"],
    ["vidéo", ffmpeg ? "ffmpeg local" : "client", ffmpeg ? "réencodage serveur disponible" : "transcodage navigateur, pas de worker"],
    ["notifications", has("VAPID_PUBLIC_KEY") ? "in-app + push" : "in-app", "aucune notification T&S par email"],
    [
      "email",
      emailConfigured ? "EmailJS/Resend" : "non configuré",
      "réinitialisation de mot de passe uniquement, pas de notification T&S",
    ],
    ["MFA", "absent", "pas de TOTP maison sans gestion de clé dédiée"],
    ["IA externe", externalAi ? "clé présente" : "absente", "les moteurs locaux restent la seule décision"],
  ];

  console.log("\nCapacités");
  for (const [name, mode, detail] of rows) {
    console.log(`  ${name.padEnd(12)} ${mode.padEnd(12)} ${detail}`);
  }
}

function uiAudit(): void {
  const dir = mkdtempSync(join(tmpdir(), "devnet-assurance-"));
  const metricsFile = join(dir, "metrics.json");
  const detailsFile = join(dir, "details.json");
  let checkFailed = false;
  try {
    try {
      execFileSync(
        process.execPath,
        [
          "scripts/ux-scan.mjs",
          "--json",
          metricsFile,
          "--details",
          detailsFile,
          "--check",
          "docs/ui/ratchet.json",
        ],
        { cwd: ROOT, stdio: "ignore" },
      );
    } catch {
      checkFailed = true;
    }

    const metrics = existsSync(metricsFile)
      ? (JSON.parse(readFileSync(metricsFile, "utf8")) as { metrics: Record<string, number> })
      : { metrics: {} };
    const details = existsSync(detailsFile)
      ? (JSON.parse(readFileSync(detailsFile, "utf8")) as {
          details: { metric: string; file: string }[];
        })
      : { details: [] };

    const perFile = new Map<string, number>();
    for (const item of details.details) {
      if (item.metric !== "arbitraryValues") continue;
      perFile.set(item.file, (perFile.get(item.file) ?? 0) + 1);
    }
    const top = [...perFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    console.log("\nDette UI");
    console.log(`  cliquet                ${checkFailed ? "ROMPU" : "tenu"}`);
    console.log(`  valeurs arbitraires    ${metrics.metrics.arbitraryValues ?? "?"}`);
    console.log(`  fichiers > 800 lignes  ${metrics.metrics.filesOver800Lines ?? "?"}`);
    for (const [file, count] of top) console.log(`    ${String(count).padStart(3)}  ${file}`);
    if (checkFailed) failures.push("cliquet UI rompu");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("DEVNET — assurance locale");
envAudit();
capabilityAudit();
uiAudit();

console.log("\nPreuves qui demandent une base ou un navigateur");
console.log("  npm run db:schema-contract");
console.log("  npm run db:tls-audit:remote");
console.log("  npm run test:trust-safety-visual");

if (failures.length > 0) {
  console.error(`\n✗ Assurance locale : ${failures.length} échec(s).`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\n✓ Assurance locale : environnements sûrs, capacités déclarées, cliquet tenu.");
}
