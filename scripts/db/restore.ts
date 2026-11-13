/**
 * Restauration d'une sauvegarde DevNet dans la base visée par `DATABASE_URL`.
 *
 * C'est la moitié manquante de `db:backup` : sans elle, on sait copier une
 * base mais pas la remettre en place, donc aucun retour arrière n'est
 * possible. Le cas d'usage réel est la bascule d'hébergeur — sauvegarde de
 * la base active, restauration chez la cible, puis bascule de `DATABASE_URL`.
 *
 * Le fichier attendu est celui que produit `backup.ts` :
 * `devnet-<target>-<horodatage>.dump.gpg`, accompagné de son `.sha256`.
 * Un dump non chiffré (`.dump`) est accepté pour les essais.
 *
 * Sans `--apply`, rien n'est écrit : le script vérifie l'empreinte, liste le
 * contenu du dump et s'arrête. Toute écriture distante exige
 * `DB_TARGET=remote` et `CONFIRM_REMOTE=<nom de la base>`.
 */
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { assertSafeTarget, maskHost, parseEndpoint, readTarget } from "./guard";
import { loadEnvFileFor, loadEnvFiles, MigrationError, parseFlag, resolveDatabaseUrl } from "./lib";

const DEFAULT_PASSPHRASE_FILE = path.join(homedir(), ".config", "devnet", "backup-passphrase");
const DEFAULT_CONTAINER_IMAGE = "postgres:18.3-alpine";

process.umask(0o077);

interface CommandResult {
  code: number;
  stderr: string;
}

function run(command: string, args: string[], env?: NodeJS.ProcessEnv, output?: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: env ?? process.env,
      stdio: ["ignore", output ?? "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function sqlModeFor(target: "local" | "remote", url: URL): string | undefined {
  const mode = url.searchParams.get("sslmode") ?? undefined;
  if (target === "remote" && (mode === "disable" || mode === "allow" || mode === "prefer")) {
    throw new MigrationError(`sslmode=${mode} est interdit pour une restauration distante.`);
  }
  if (mode) return mode;
  return target === "remote" ? "require" : undefined;
}

function caCertificate(): string | undefined {
  const value = process.env.DATABASE_CA_CERT?.trim();
  if (!value) return undefined;
  if (value.includes("-----BEGIN CERTIFICATE-----")) return value;
  try {
    return readFileSync(value, "utf8");
  } catch {
    throw new MigrationError(`Certificat CA introuvable ou illisible : ${value}.`);
  }
}

/** Le dump est chiffré quand l'extension est `.gpg`, sinon il est pris tel quel. */
async function plainDump(archive: string, passphraseFile: string): Promise<{ file: string; cleanup: () => void }> {
  if (!archive.endsWith(".gpg")) return { file: archive, cleanup: () => undefined };

  if (!existsSync(passphraseFile)) {
    throw new MigrationError(
      `Clé de sauvegarde absente : ${passphraseFile}. Elle est indispensable pour déchiffrer ${path.basename(archive)}.`,
    );
  }

  const tempDir = mkdtempSync(path.join(tmpdir(), "devnet-restore-"));
  const output = path.join(tempDir, "restore.dump");
  const result = await run(
    "gpg",
    [
      "--batch",
      "--quiet",
      "--yes",
      "--pinentry-mode",
      "loopback",
      "--passphrase-file",
      passphraseFile,
      "--decrypt",
      "--output",
      output,
      archive,
    ],
    process.env,
  );
  if (result.code !== 0) {
    rmSync(tempDir, { recursive: true, force: true });
    throw new MigrationError(`Déchiffrement GPG échoué (code ${result.code}) : ${result.stderr.trim()}`);
  }
  return { file: output, cleanup: () => rmSync(tempDir, { recursive: true, force: true }) };
}

async function restore(url: URL, target: "local" | "remote", archive: string, image: string): Promise<void> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "devnet-restore-"));
  const envFile = path.join(tempDir, "pg.env");
  const sslmode = sqlModeFor(target, url);
  const verify = sslmode === "verify-full" || sslmode === "verify-ca";
  const ca = verify ? caCertificate() : undefined;
  if (verify && !ca) {
    throw new MigrationError(
      `sslmode=${sslmode} exige DATABASE_CA_CERT (contenu PEM ou chemin du root.crt).`,
    );
  }
  const envLines = [`PGPASSWORD=${decodeURIComponent(url.password)}`];
  if (sslmode) envLines.push(`PGSSLMODE=${sslmode}`);
  if (ca) envLines.push("PGSSLROOTCERT=/certs/root.crt");

  try {
    // Le dump est monté en lecture seule : `pg_restore` lit un fichier, il ne
    // doit pas pouvoir le modifier, et l'archive reste hors du conteneur.
    const archiveDir = path.dirname(archive);
    const archiveName = path.basename(archive);
    writeFileSync(envFile, `${envLines.join("\n")}\n`, { mode: 0o600 });
    if (ca) writeFileSync(path.join(tempDir, "root.crt"), ca, { mode: 0o600 });
    const args = [
      "run",
      "--rm",
      "-i",
      "--network",
      "host",
      "--env-file",
      envFile,
      "-v",
      `${archiveDir}:/dump:ro`,
    ];
    if (ca) args.push("-v", `${tempDir}:/certs:ro`);
    args.push(
      image,
      "pg_restore",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--single-transaction",
      "--no-password",
      `--host=${url.hostname}`,
      `--port=${url.port || "5432"}`,
      `--username=${decodeURIComponent(url.username)}`,
      `--dbname=${decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "postgres"}`,
      `/dump/${archiveName}`,
    );
    const result = await run("docker", args);
    // `pg_restore --clean` signale en code 1 les objets absents à supprimer ;
    // ce n'est pas une restauration ratée, seulement un premier passage.
    if (result.code !== 0) {
      throw new MigrationError(`pg_restore a échoué (code ${result.code}) : ${result.stderr.trim()}`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  loadEnvFileFor(parseFlag(process.argv, "env"));
  loadEnvFiles();
  const databaseUrl = resolveDatabaseUrl(parseFlag(process.argv, "database-url"));
  const target = readTarget();
  const description = assertSafeTarget({
    databaseUrl,
    target,
    operation: "write",
    confirmRemote: process.env.CONFIRM_REMOTE,
  });
  const endpoint = parseEndpoint(databaseUrl);

  const file = parseFlag(process.argv, "file");
  if (!file) {
    throw new MigrationError(
      "Indiquez l'archive à restaurer : --file=<chemin.dump.gpg> (voir db:backup pour en produire une).",
    );
  }
  const archive = path.resolve(file);
  if (!existsSync(archive)) throw new MigrationError(`Archive introuvable : ${archive}`);
  if (statSync(archive).size === 0) throw new MigrationError("Archive vide : restauration refusée.");

  const passphraseFile = path.resolve(
    parseFlag(process.argv, "passphrase-file") ?? process.env.DEVNET_BACKUP_PASSPHRASE_FILE ?? DEFAULT_PASSPHRASE_FILE,
  );
  const image = parseFlag(process.argv, "image") ?? DEFAULT_CONTAINER_IMAGE;
  const apply = process.argv.includes("--apply");

  const sidecar = `${archive}.sha256`;
  if (existsSync(sidecar)) {
    const expected = readFileSync(sidecar, "utf8").trim().split(/\s+/)[0];
    const actual = await sha256(archive);
    if (expected && expected !== actual) {
      throw new MigrationError("Empreinte SHA-256 différente : l'archive a été modifiée, restauration refusée.");
    }
    console.log(`Empreinte : ${actual.slice(0, 16)}… (conforme au .sha256)`);
  } else {
    console.log("Empreinte : pas de .sha256 à côté de l'archive, contrôle ignoré.");
  }

  console.log(`Restauration — ${description}`);
  console.log(`Hôte ${maskHost(endpoint.host)} · base ${endpoint.database} · archive ${path.basename(archive)}`);

  const decrypted = await plainDump(archive, passphraseFile);
  try {
    if (!apply) {
      console.log("Simulation : rien n'a été écrit. Relancez avec --apply pour restaurer.");
      return;
    }
    console.log("Restauration en cours (--clean : les objets existants sont remplacés)…");
    await restore(new URL(databaseUrl), target, decrypted.file, image);
    console.log("Restauration terminée.");
  } finally {
    decrypted.cleanup();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ ${message}`);
  process.exitCode = error instanceof MigrationError ? 1 : 2;
});
