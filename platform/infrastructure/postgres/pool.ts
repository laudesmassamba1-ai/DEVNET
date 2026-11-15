/**
 * Connexion PostgreSQL directe, partagée par les adaptateurs serveur.
 *
 * Sur Vercel, une instance peut traiter plusieurs requêtes : un pool unique et
 * volontairement petit évite d'épuiser les connexions de la base. Le pool est
 * créé au premier usage pour qu'un build sans `DATABASE_URL` ne tente jamais
 * de se connecter.
 *
 * Capacité : `PG_POOL_MAX` par instance (10 par défaut), `PG_CONNECT_TIMEOUT_MS`
 * pour l'établissement (4 s par défaut).
 *
 * Ces deux valeurs étaient calibrées pour un nœud Systalink local au réseau
 * (`max: 2`, connexion en 3 s). Sur une base distante, chaque connexion coûte
 * un aller-retour TCP puis une poignée de main TLS : un écran qui lance dix
 * requêtes en parallèle saturait deux emplacements et partait en timeout, ce
 * qui se voyait comme des 500 et un profil illisible. La latence mesurée vers
 * Neon est de ~185 ms, donc 3 s ne couvrent même pas une poignée de main sous
 * charge ; 4 s laissent une marge sans immobiliser la bascule. Le plafond reste réglable pour ne pas dépasser les connexions de
 * l'hébergeur.
 */
import type { Pool, PoolClient } from "pg";
import {
  activePool,
  activeTarget,
  closeFailoverPools,
  getFailoverState,
  markUnreachable,
  noteActiveHealthy,
  probeInactive,
} from "./failover";

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

/**
 * Pool de la base **active**.
 *
 * Depuis l'incident du 14 novembre, ce n'est plus forcément `DATABASE_URL` :
 * `failover.ts` tient l'endpoint courant et peut avoir promu la base de
 * secours. Les appelants ne changent pas — ils demandent « le pool » et
 * obtiennent celui qui répond.
 */
export function getPostgresPool(): Pool {
  return activePool();
}

/** Codes de connexion qui signifient « la base ne répond pas », pas « requête invalide ». */
export function isDatabaseUnavailable(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  if (!code) return false;
  return (
    ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "EPIPE", "ECONNRESET"].includes(code)
    || ["08001", "08004", "08006", "08P01", "57P01", "57P02", "57P03", "53300"].includes(code)
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
    /* Une sonde réussie est aussi le bon moment pour entretenir l'empreinte
       de schéma : c'est elle qui servira de référence le jour où la base ne
       répondra plus. Un échec ici ne doit pas faire échouer la sonde. */
    await noteActiveHealthy();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    broken = true;
    /* Un échec de connexion ici est le signal le plus fiable dont on
       dispose : la sonde de disponibilité passe par le même chemin que les
       requêtes réelles. `markUnreachable` et non `markUnavailable` : la sonde
       n'échoue que pour une raison de transport, même quand `pg` lève une
       erreur sans code (expiration dans la file du pool). */
    await markUnreachable().catch(() => undefined);
    return {
      ok: false,
      reason: isDatabaseUnavailable(error) ? "unavailable" : "timeout",
    };
  } finally {
    if (timer) clearTimeout(timer);
    client?.release(broken);
  }
}

/**
 * État de la bascule, pour `/api/ready` et la console d'administration.
 *
 * Sonde l'endpoint inactif au passage : c'est le seul endroit où l'on
 * vérifie régulièrement que la primaire est revenue, ce qui permet de
 * quitter la secours sans intervention.
 */
export async function checkFailover(): Promise<{
  active: "primary" | "standby";
  standbyConfigured: boolean;
  switchedAt: string | null;
  reason: string | null;
  /**
   * `true` si les deux bases ont le même schéma, `false` si elles diffèrent,
   * `null` si la comparaison est impossible.
   *
   * `null` n'est pas « tout va bien » : c'est « je ne sais pas ». Le
   * 14 novembre, la primaire était muette et la réponse affichait
   * `schemaMatches: null` sans explication — un trou qui ressemblait à une
   * absence de problème. Le champ `schemaNote` porte désormais la raison.
   */
  schemaMatches: boolean | null;
  /** Raison lisible quand `schemaMatches` vaut `null`. */
  schemaNote: string | null;
  /** Dernière erreur de la cible inactive, déjà nettoyée par le module de bascule. */
  standbyError: string | null;
}> {
  /* On ne fait pas attendre `/api/ready` derrière une cible morte : la
     sonde met à jour l'état en arrière-plan, et la réponse rend le dernier
     état connu. Un health check qui paie le timeout de la base absente
     n'est plus un health check. */
  void probeInactive().catch(() => undefined);
  const state = getFailoverState();
  const active = state.schema[state.active];
  const otherTarget = state.active === "primary" ? "standby" : "primary";
  const other = state.schema[otherTarget];

  let schemaNote: string | null = null;
  if (!active || !other) {
    const missing =
      !active && !other
        ? "les deux bases"
        : !active
          ? `la base ${state.active}`
          : `la base ${state.active === "primary" ? "de secours" : "primaire"}`;
    schemaNote =
      `schéma illisible sur ${missing} : la comparaison n'a pas pu être faite. `
      + "Ce n'est pas un feu vert.";
  }

  return {
    active: state.active,
    standbyConfigured: state.standbyConfigured,
    switchedAt: state.switchedAt,
    reason: state.reason,
    schemaMatches: active && other ? active === other : null,
    schemaNote,
    standbyError: state.lastError[otherTarget],
  };
}

export { activeTarget };

export async function closePostgresPool(): Promise<void> {
  await closeFailoverPools();
}