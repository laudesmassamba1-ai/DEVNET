/**
 * Identité par requête, dans une transaction, jamais au niveau session.
 *
 * `SET LOCAL ROLE` et `set_config(..., true)` sont annulés au commit ou au
 * rollback : une connexion rendue au pool ne peut pas conserver l'identité
 * de l'utilisateur précédent. C'est la raison d'être de ce helper unique :
 * aucune requête utilisateur ne doit poser son identité autrement.
 */
import type { Pool, PoolClient } from "pg";
import { isConnectionFailure } from "@/shared/postgres/connection-error";
import { DatabaseUnavailableError, getPostgresPool } from "./pool";
import { activePool, markUnavailable } from "./failover";

export type UserQuery = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  values?: unknown[],
) => Promise<T[]>;

async function withIdentity<T>(
  role: "authenticated" | "anon",
  userId: string | null,
  run: (query: UserQuery) => Promise<T>,
  pool: Pool,
  retryAfterFailover = true,
): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    /*
     * Une connexion impossible est le signal de bascule le plus direct.
     * Sans cet appel, il fallait attendre qu'un client inactif du pool
     * émette `error` ou qu'une sonde `/api/ready` passe : une requête
     * pouvait échouer en 500 alors que la secours était disponible.
     * `markUnavailable` ne réagit qu'aux vraies pannes de transport ;
     * un mot de passe refusé ou une requête invalide ne bascule rien.
     */
    if (isConnectionFailure(error)) {
      await markUnavailable(error).catch(() => undefined);
      /*
       * Si la bascule a réussi, la requête n'a pas encore été exécutée :
       * la rejouer sur la secours est sûr et évite un 500 au premier
       * visiteur de l'incident. On ne retente qu'une fois, et seulement
       * quand le pool a réellement changé — une secours elle aussi muette
       * ne doit pas boucler.
       */
      const next = activePool();
      if (retryAfterFailover && next !== pool) {
        return withIdentity(role, userId, run, next, false);
      }
    }
    throw new DatabaseUnavailableError("Connexion PostgreSQL impossible.", { cause: error });
  }

  try {
    /*
     * Une seule requête au lieu de cinq.
     *
     * La version précédente faisait `begin`, `set local role`,
     * `set_config(role)`, `set_config(sub)`, puis la requête, puis `commit` :
     * six allers-retours avant la moindre donnée. Mesuré vers Neon depuis
     * cdg1 : **1392 ms pour un `withUser` vide**, contre 186 ms pour une
     * requête seule. Sur un fil qui ouvre deux transactions (page puis
     * hydratation), cela faisait près de trois secondes de pur protocole.
     *
     * Les instructions sont maintenant groupées en une seule requête
     * multi-instructions. `pg` refuse les paramètres liés dans une requête
     * multi-instructions, donc l'identité passe par `set_config` avec des
     * littéraux — et elle est **échappée** : une valeur d'identité vient
     * d'une session, jamais d'une saisie libre, mais on ne construit pas de
     * SQL par concaténation sans la traiter.
     *
     * `set local` et `set_config(..., true)` restent locaux à la
     * transaction : une connexion rendue au pool ne conserve aucune
     * identité. C'est la propriété qui compte, et elle est préservée.
     */
    const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;
    await client.query(
      `begin;
       set local role ${role};
       select set_config('request.jwt.claim.role', ${literal(role)}, true),
              set_config('request.jwt.claim.sub', ${literal(userId ?? "")}, true)`,
    );

    const query: UserQuery = async <T extends Record<string, unknown>>(sql: string, values?: unknown[]) => {
      const result = await client.query<T>(sql, values);
      return result.rows;
    };

    const value = await run(query);
    await client.query("commit");
    return value;
  } catch (error) {
    /* Même logique pour une connexion qui meurt en cours de transaction :
       le client suivant doit trouver la secours déjà promue. */
    if (isConnectionFailure(error)) {
      await markUnavailable(error).catch(() => undefined);
    }
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function withUser<T>(
  userId: string,
  run: (query: UserQuery) => Promise<T>,
  pool: Pool = getPostgresPool(),
): Promise<T> {
  return withIdentity("authenticated", userId, run, pool);
}

export async function withAnon<T>(
  run: (query: UserQuery) => Promise<T>,
  pool: Pool = getPostgresPool(),
): Promise<T> {
  return withIdentity("anon", null, run, pool);
}
