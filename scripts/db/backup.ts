import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { assertSafeTarget, maskHost, parseEndpoint, readTarget } from "./guard";
import { loadEnvFileFor, loadEnvFiles, MigrationError, parseFlag, resolveDatabaseUrl } from "./lib";

const DEFAULT_BACKUP_DIR = path.join(homedir(), ".local", "share", "devnet", "backups");
const DEFAULT_PASSPHRASE_FILE = path.join(homedir(), ".config", "devnet", "backup-passphrase");
const DEFAULT_CONTAINER_IMAGE = "postgres:18.3-alpine";
const BACKUP_PATTERN = /^devnet-(local|remote)-\d{8}T\d{6}Z\.dump\.gpg$/;

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

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sqlModeFor(target: "local" | "remote", url: URL): string | undefined {
  const mode = url.searchParams.get("sslmode") ?? undefined;
  if (target === "remote" && (mode === "disable" || mode === "allow" || mode === "prefer")) {
    throw new MigrationError(`sslmode=${mode} est interdit pour une sauvegarde distante.`);
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

function assertPassphrase(file: string): void {
  if (!existsSync(file)) {
    throw new MigrationError(
      `Clé de sauvegarde absente : ${file}. Créez-la avec umask 077 et chmod 600, sans l'afficher.`,
    );
  }
  const mode = statSync(file).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new MigrationError(`La clé ${file} doit être en permissions 600 (actuel : ${mode.toString(8)}).`);
  }
}

async function dump(url: URL, target: "local" | "remote", output: number, image: string): Promise<void> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "devnet-backup-"));
  const envFile = path.join(tempDir, "pg.env");
  const password = decodeURIComponent(url.password);
  const sslmode = sqlModeFor(target, url);
  const verify = sslmode === "verify-full" || sslmode === "verify-ca";
  const ca = verify ? caCertificate() : undefined;
  if (verify && !ca) {
    throw new MigrationError(
      `sslmode=${sslmode} exige DATABASE_CA_CERT (contenu PEM ou chemin du root.crt).`,
    );
  }
  const envLines = [`PGPASSWORD=${password}`];
  if (sslmode) envLines.push(`PGSSLMODE=${sslmode}`);
  if (ca) envLines.push("PGSSLROOTCERT=/certs/root.crt");

  try {
    writeFileSync(envFile, `${envLines.join("\n")}\n`, { mode: 0o600 });
    if (ca) writeFileSync(path.join(tempDir, "root.crt"), ca, { mode: 0o600 });
    const args = ["run", "--rm", "-i", "--network", "host", "--env-file", envFile];
    if (ca) args.push("-v", `${tempDir}:/certs:ro`);
    args.push(
      image,
      "pg_dump",
      "--format=custom",
      "--no-owner",
      "--no-password",
      `--host=${url.hostname}`,
      `--port=${url.port || "5432"}`,
      `--username=${decodeURIComponent(url.username)}`,
      `--dbname=${decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "postgres"}`,
    );
    const result = await run("docker", args, process.env, output);
    if (result.code !== 0) {
      throw new MigrationError(`pg_dump a échoué (code ${result.code}) : ${result.stderr.trim()}`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function prune(directory: string, keep: number): string[] {
  const files = readdirSync(directory)
    .filter((name) => BACKUP_PATTERN.test(name))
    .sort()
    .reverse();
  const removed: string[] = [];
  for (const name of files.slice(keep)) {
    unlinkSync(path.join(directory, name));
    const sidecar = path.join(directory, `${name}.sha256`);
    if (existsSync(sidecar)) unlinkSync(sidecar);
    removed.push(name);
  }
  return removed;
}

async function main(): Promise<void> {
  loadEnvFileFor(parseFlag(process.argv, "env"));
  loadEnvFiles();
  const databaseUrl = resolveDatabaseUrl(parseFlag(process.argv, "database-url"));
  const target = readTarget();
  const description = assertSafeTarget({ databaseUrl, target, operation: "read" });
  const endpoint = parseEndpoint(databaseUrl);
  const url = new URL(databaseUrl);

  const outDir = path.resolve(parseFlag(process.argv, "out-dir") ?? process.env.DEVNET_BACKUP_DIR ?? DEFAULT_BACKUP_DIR);
  const passphraseFile = path.resolve(
    parseFlag(process.argv, "passphrase-file") ?? process.env.DEVNET_BACKUP_PASSPHRASE_FILE ?? DEFAULT_PASSPHRASE_FILE,
  );
  const image = parseFlag(process.argv, "image") ?? DEFAULT_CONTAINER_IMAGE;
  const keepRaw = parseFlag(process.argv, "keep") ?? "14";
  const keep = Number(keepRaw);
  if (!Number.isInteger(keep) || keep < 1) {
    throw new MigrationError(`--keep doit être un entier supérieur ou égal à 1 (reçu : ${keepRaw}).`);
  }

  assertPassphrase(passphraseFile);
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  chmodSync(outDir, 0o700);

  const base = `devnet-${target}-${timestamp()}`;
  const dumpPath = path.join(outDir, `${base}.dump`);
  const encryptedPath = `${dumpPath}.gpg`;
  const sidecarPath = `${encryptedPath}.sha256`;
  const fd = openSync(dumpPath, "w", 0o600);

  console.log(`Sauvegarde — ${description}`);
  console.log(`Hôte ${maskHost(endpoint.host)} · base ${endpoint.database} · lecture seule`);

  let closed = false;
  try {
    await dump(url, target, fd, image);
  } catch (error) {
    closeSync(fd);
    closed = true;
    if (existsSync(dumpPath)) unlinkSync(dumpPath);
    throw error;
  } finally {
    if (!closed) closeSync(fd);
  }

  const plainSize = statSync(dumpPath).size;
  if (plainSize === 0) {
    unlinkSync(dumpPath);
    throw new MigrationError("Le dump est vide : sauvegarde refusée.");
  }

  try {
    const encrypted = await run("gpg", [
      "--batch",
      "--yes",
      "--quiet",
      "--pinentry-mode",
      "loopback",
      "--passphrase-file",
      passphraseFile,
      "--symmetric",
      "--cipher-algo",
      "AES256",
      "--output",
      encryptedPath,
      dumpPath,
    ]);
    if (encrypted.code !== 0) {
      throw new MigrationError(`Chiffrement GPG échoué (code ${encrypted.code}) : ${encrypted.stderr.trim()}`);
    }
  } finally {
    if (existsSync(dumpPath)) unlinkSync(dumpPath);
  }

  const size = statSync(encryptedPath).size;
  const digest = await sha256(encryptedPath);
  writeFileSync(sidecarPath, `${digest}  ${path.basename(encryptedPath)}\n`, { mode: 0o600 });
  const removed = prune(outDir, keep);

  console.log(`Fichier : ${encryptedPath}`);
  console.log(`Taille : ${size} octets`);
  console.log(`SHA-256 : ${digest}`);
  console.log(`Chiffrement : GPG AES-256 (phrase ${passphraseFile})`);
  if (removed.length > 0) console.log(`Rotation : ${removed.length} ancienne(s) sauvegarde(s) supprimée(s).`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ ${message}`);
  process.exitCode = error instanceof MigrationError ? 1 : 2;
});
