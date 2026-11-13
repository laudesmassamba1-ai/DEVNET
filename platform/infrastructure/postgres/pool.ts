/**
 * Connexion PostgreSQL directe, partagée par les adaptateurs serveur.
 *
 * Sur Vercel, une instance peut traiter plusieurs requêtes : un pool unique et
 * volontairement petit évite d'épuiser les connexions de la base. Le pool est
 * créé au premier usage pour qu'un build sans `DATABASE_URL` ne tente jamais
 * de se connecter.
 *
 * Capacité : `PG_POOL_MAX` par instance (10 par défaut), `PG_CONNECT_TIMEOUT_MS`
 * pour l'établissement (10 s par défaut).
 *
 * Ces deux valeurs étaient calibrées pour un nœud Systalink local au réseau
 * (`max: 2`, connexion en 3 s). Sur une base distante, chaque connexion coûte
 * un aller-retour TCP puis une poignée de main TLS : un écran qui lance dix
 * requêtes en parallèle saturait deux emplacements et partait en timeout, ce
 * qui se voyait comme des 500 et un profil illisible. La latence mesurée vers
 * Neon est de ~185 ms, donc 3 s ne couvrent même pas une poignée de main sous
 * charge. Le plafond reste réglable pour ne pas dépasser les connexions de
 * l'hébergeur.
 */
import { Pool, type PoolClient } from "pg";
import { resolvePostgresConnection } from "./tls";

let pool: Pool | null = null;

/** Exécute une requête de disponibilité et renvoie un état public sûr. */
export type DatabaseHealth =
  | { ok: true; latencyMs: number }
  | { ok: false; reason: "not_configured" | "timeout" | "unavailable" };

export class DatabaseUnavailableError extends Error {
  constructor(message = "La base de données est indisponible.", options?: ErrorOptions) {
    super(message, options);
    this.name = "DatabaseUnavailableError";
  }
}

/** Entier strictement positif issu de l'environnement, sinon la valeur par défaut. */
function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPostgresPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new DatabaseUnavailableError(
      "DATABASE_URL est absent : le drainage des événements et l'état des plugins exigent PostgreSQL direct.",
    );
  }

  const connection = resolvePostgresConnection(connectionString);
  pool ??= new Pool({
    connectionString: connection.connectionString,
    ssl: connection.ssl,
    application_name: "devnet-web",
    max: positiveInt(process.env.PG_POOL_MAX, 10),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: positiveInt(process.env.PG_CONNECT_TIMEOUT_MS, 10_000),
    query_timeout: 15_000,
  });
  return pool;
}

/** Codes de connexion qui signifient « la base ne répond pas », pas « requête invalide ». */
export function isDatabaseUnavailable(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  if (!code) return false;
  return (
    ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH"].includes(code)
    || ["08001", "08004", "08006", "57P01", "57P02", "57P03", "53300"].includes(code)
  );
}

/** Sonde courte pour `/api/ready` : jamais de détail interne dans la réponse. */
export async function checkDatabase(timeoutMs = 2_000): Promise<DatabaseHealth> {
  if (!hasDatabaseUrl()) return { ok: false, reason: "not_configured" };

  const started = Date.now();
  let client: PoolClient | undefined;
  let broken = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Un seul aller-retour : `begin` + `set local` + `select` + `commit`
    // coûtaient quatre fois la latence réseau de la base. Une course
    // explicite borne la requête, puis un client expiré est détruit au
    // lieu d'être remis dans le pool.
    client = await getPostgresPool().connect();
    await Promise.race([
      client.query("select 1"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("database_timeout")),
          Math.max(100, timeoutMs),
        );
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    broken = true;
    return {
      ok: false,
      reason: isDatabaseUnavailable(error) ? "unavailable" : "timeout",
    };
  } finally {
    if (timer) clearTimeout(timer);
    client?.release(broken);
  }
}

export async function closePostgresPool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
