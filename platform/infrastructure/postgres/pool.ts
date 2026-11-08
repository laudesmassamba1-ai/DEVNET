/**
 * Connexion PostgreSQL directe, partagée par les adaptateurs serveur.
 *
 * Sur Vercel, une instance peut traiter plusieurs requêtes : un pool unique et
 * volontairement petit évite d'épuiser les connexions de la base. Le pool est
 * créé au premier usage pour qu'un build sans `DATABASE_URL` ne tente jamais
 * de se connecter.
 *
 * Calcul de capacité : `max = 2` par instance. Avec 20 instances chaudes au
 * pire, cela fait 40 connexions. La cible Systalink `1x-1024-5120` annonce un
 * petit nœud ; on garde une marge pour la maintenance et les scripts. Le jour
 * où `max_connections` est mesuré, ce commentaire et la valeur sont mis à jour
 * ensemble.
 */
import { Pool } from "pg";
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
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 3_000,
    query_timeout: 5_000,
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
  let client;
  try {
    client = await getPostgresPool().connect();
    await client.query("begin");
    await client.query(`set local statement_timeout = '${Math.max(100, timeoutMs)}ms'`);
    await client.query("select 1");
    await client.query("commit");
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      reason: isDatabaseUnavailable(error) ? "unavailable" : "timeout",
    };
  } finally {
    client?.release();
  }
}

export async function closePostgresPool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
