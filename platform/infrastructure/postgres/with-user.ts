/**
 * Identité par requête, dans une transaction, jamais au niveau session.
 *
 * `SET LOCAL ROLE` et `set_config(..., true)` sont annulés au commit ou au
 * rollback : une connexion rendue au pool ne peut pas conserver l'identité
 * de l'utilisateur précédent. C'est la raison d'être de ce helper unique :
 * aucune requête utilisateur ne doit poser son identité autrement.
 */
import type { Pool, PoolClient } from "pg";
import { DatabaseUnavailableError, getPostgresPool } from "./pool";

export type UserQuery = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  values?: unknown[],
) => Promise<T[]>;

export async function withUser<T>(
  userId: string,
  run: (query: UserQuery) => Promise<T>,
  pool: Pool = getPostgresPool(),
): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw new DatabaseUnavailableError("Connexion PostgreSQL impossible.", { cause: error });
  }

  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);

    const query: UserQuery = async <T extends Record<string, unknown>>(sql: string, values?: unknown[]) => {
      const result = await client.query<T>(sql, values);
      return result.rows;
    };

    const value = await run(query);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
