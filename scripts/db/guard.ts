/**
 * Garde-fou commun à tous les scripts qui touchent la base.
 *
 * Règles (skill devnet-database-ops §3) :
 * 1. `DB_TARGET` vaut `local` par défaut ;
 * 2. une cible `remote` exige `CONFIRM_REMOTE=<nom_de_la_base>` ;
 * 3. `db:reset`, `TRUNCATE`, `DROP` sont refusés sur `remote` ;
 * 4. l'appelant décide de la simulation (`--apply` pour agir) ;
 * 5. l'URL de connexion n'est jamais imprimée.
 */

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}

export type DbTarget = "local" | "remote";
export type DbOperation = "read" | "migrate" | "write" | "destructive" | "reset";

const TARGETS = new Set<DbTarget>(["local", "remote"]);

export interface DatabaseEndpoint {
  host: string;
  database: string;
}

export function readTarget(env: Record<string, string | undefined> = process.env): DbTarget {
  const raw = (env.DB_TARGET ?? "local").trim().toLowerCase();
  if (!TARGETS.has(raw as DbTarget)) {
    throw new GuardError(`DB_TARGET invalide : « ${raw} ». Valeurs acceptées : local, remote.`);
  }
  return raw as DbTarget;
}

/** Extrait l'hôte et le nom de la base sans jamais conserver le mot de passe. */
export function parseEndpoint(databaseUrl: string): DatabaseEndpoint {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new GuardError("DATABASE_URL illisible : impossible d'identifier la cible.");
  }
  if (!url.hostname) {
    throw new GuardError("DATABASE_URL sans hôte : impossible d'identifier la cible.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "postgres";
  return { host: url.hostname, database };
}

/** Hôte affichable : garde le domaine, masque les éventuels identifiants. */
export function maskHost(host: string): string {
  if (host.length <= 4) return "***";
  return `${host.slice(0, 2)}***${host.slice(-2)}`;
}

export function describeTarget(endpoint: DatabaseEndpoint, target: DbTarget): string {
  return `cible=${target} hôte=${maskHost(endpoint.host)} base=${endpoint.database}`;
}

/**
 * Refuse les opérations destructrices distantes et exige une confirmation
 * explicite pour toute écriture distante. Retourne la description affichable.
 */
export function assertSafeTarget(options: {
  databaseUrl: string;
  target: DbTarget;
  operation: DbOperation;
  confirmRemote?: string;
}): string {
  const endpoint = parseEndpoint(options.databaseUrl);
  const description = describeTarget(endpoint, options.target);

  if (options.operation === "destructive" || options.operation === "reset") {
    if (options.target === "remote") {
      throw new GuardError(
        `Refus : ${options.operation} n'est jamais autorisé sur une cible distante (${description}).`,
      );
    }
    return description;
  }

  if (options.target === "remote") {
    if (options.operation !== "read" && !options.confirmRemote) {
      throw new GuardError(
        `Refus : écriture distante sans CONFIRM_REMOTE=${endpoint.database} (${description}).`,
      );
    }
    if (options.operation !== "read" && options.confirmRemote !== endpoint.database) {
      throw new GuardError(
        `Refus : CONFIRM_REMOTE ne correspond pas au nom de la base (${description}).`,
      );
    }
  }

  return description;
}
