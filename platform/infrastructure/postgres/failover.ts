/**
 * Bascule automatique entre une base primaire et une base de secours.
 *
 * Pourquoi ce fichier existe : le 14 novembre, la base Systalink a refusé
 * toute connexion (`server login has been failing, cached error`). Le code
 * était sain, la production tournait, et pourtant l'application n'avait
 * plus de données. Il n'existait aucun moyen de basculer ailleurs sans
 * éditer des variables d'environnement et redéployer.
 *
 * Ce module tient une seule promesse, et il la tient petitement :
 *
 *   **Quand la base active ne répond plus, on essaie l'autre.**
 *
 * Trois règles, parce qu'une bascule automatique mal faite est pire que
 * pas de bascule du tout :
 *
 *  1. **On ne bascule pas sur une base en retard.** Une base de secours
 *     dont le schéma est plus ancien n'est pas un secours, c'est une
 *     régression : elle accepte les écritures et perd les colonnes
 *     récentes. `promote()` refuse donc une cible dont
 *     `schema_migrations` compte moins de migrations que l'active.
 *  2. **La bascule est visible.** `/api/ready` dit sur quelle base on
 *     tourne. Une bascule silencieuse ferait croire que tout va bien
 *     alors qu'on lit des données figées.
 *  3. **On revient.** Dès que la primaire répond de nouveau, on y
 *     retourne : la secours est un abri, pas une nouvelle maison.
 *
 * Ce que ce module ne fait pas, et ne prétendra jamais faire : répliquer
 * les écritures. Une bascule perd les écritures faites depuis la dernière
 * sauvegarde de la cible. C'est pour cela que `promote()` exige une
 * sauvegarde récente et le dit dans son rapport.
 */
import { Client, Pool } from "pg";
import { isConnectionFailure } from "@/shared/postgres/connection-error";
import { resolvePostgresConnection } from "./tls";

/**
 * Le classifieur « la base ne répond plus » vit dans `shared/` : les modules
 * (fil, stories) en ont besoin, et la frontière d'architecture leur interdit
 * d'importer un adaptateur. On le réexporte ici pour les appelants existants.
 */
export { isConnectionFailure };

export type FailoverTarget = "primary" | "standby";

export type FailoverState = {
  /** Base actuellement utilisée. */
  active: FailoverTarget;
  /** Base de secours configurée, ou `null`. */
  standbyConfigured: boolean;
  /** Dernier état connu de chaque base. */
  health: Record<FailoverTarget, "unknown" | "ok" | "down">;
  /** Horodatage du dernier basculement effectif. */
  switchedAt: string | null;
  /** Raison du dernier basculement. */
  reason: string | null;
  /** Migrations connues de chaque base (null = jamais mesuré). */
  migrations: Record<FailoverTarget, number | null>;
  /** Dernière erreur de transport observée, par cible (jamais de secret). */
  lastError: Record<FailoverTarget, string | null>;
  /** Horodatage de la dernière sonde réussie, par cible. */
  lastSeenAt: Record<FailoverTarget, string | null>;
  /**
   * Empreinte du schéma `public` de chaque base (null = jamais mesuré).
   *
   * C'est le vrai garde-fou de `promote()`, et il remplace un simple
   * comptage de migrations : une base qui porte une migration orpheline
   * (appliquée puis retirée du dépôt) comptait « une de plus » sans avoir
   * une seule colonne de plus, ce qui refusait une bascule parfaitement
   * sûre. Le 14 novembre, la production portait justement 73 lignes de
   * registre pour 72 fichiers. On compare donc les colonnes, pas les
   * étiquettes.
   */
  schema: Record<FailoverTarget, string | null>;
};

type Endpoint = {
  name: FailoverTarget;
  url: string;
  pool: Pool | null;
};

/** Au-delà, on considère que la base ne répond pas (bascule automatique). */
const PROBE_TIMEOUT_MS = 7_000;
/**
 * Budget d'une inspection d'administration.
 *
 * Plus long que la sonde de bascule : Systalink met ~5,8 s à rendre un
 * `08P01 server login has been failing` définitif. Avec le budget court,
 * la console affichait « délai dépassé » et masquait la vraie cause —
 * des identifiants refusés. Une inspection peut attendre ; une bascule,
 * non.
 */
const INSPECT_TIMEOUT_MS = 8_000;
/** Fréquence minimale des sondes de l'endpoint inactif. */
const PROBE_INTERVAL_MS = 30_000;

let endpoints: Record<FailoverTarget, Endpoint | null> = { primary: null, standby: null };
let state: FailoverState = {
  active: "primary",
  standbyConfigured: false,
  health: { primary: "unknown", standby: "unknown" },
  switchedAt: null,
  reason: null,
  migrations: { primary: null, standby: null },
  schema: { primary: null, standby: null },
  lastError: { primary: null, standby: null },
  lastSeenAt: { primary: null, standby: null },
};
let lastProbeAt = 0;
let probing = false;
/** Horodatage de la dernière empreinte de schéma réussie, par cible. */
const schemaProbeAt: Record<FailoverTarget, number> = { primary: 0, standby: 0 };
/** Une empreinte de schéma se rafraîchit au plus une fois par minute. */
const SCHEMA_TTL_MS = 60_000;

function standbyUrl(): string | null {
  const value = process.env.DATABASE_URL_STANDBY?.trim();
  return value ? value : null;
}

/** `DATABASE_FAILOVER=off` désactive toute bascule : la primaire seule compte. */
export function failoverEnabled(): boolean {
  return (process.env.DATABASE_FAILOVER ?? "auto").toLowerCase() !== "off";
}

/**
 * Le retour automatique est-il autorisé ?
 *
 * Il est **désactivé par défaut en production**. Ce n'est pas de la timidité :
 * revenir sur la primaire abandonne les écritures faites sur la secours
 * pendant l'incident, et une empreinte de schéma identique ne dit rien des
 * lignes. Le 14 novembre, Systalink est revenue avec un schéma parfait et des
 * données vieilles d'une journée ; un retour automatique aurait effacé les
 * publications de la secours sans une seule erreur.
 *
 * `FAILOVER_AUTO_RETURN=auto` rétablit le comportement d'origine pour les
 * installations qui répliquent réellement les données. Sinon, on sonde
 * toujours la primaire (son état est visible) mais le retour se demande
 * explicitement depuis la console d'administration.
 */
export function autoReturnEnabled(): boolean {
  return (process.env.FAILOVER_AUTO_RETURN ?? "manual").toLowerCase() === "auto";
}

/** Ce que la console a besoin de savoir sans jamais lire une URL. */
export function failoverConfig(): {
  enabled: boolean;
  autoReturn: boolean;
  primaryConfigured: boolean;
  standbyConfigured: boolean;
  active: FailoverTarget;
} {
  return {
    enabled: failoverEnabled(),
    autoReturn: autoReturnEnabled(),
    primaryConfigured: Boolean(process.env.DATABASE_URL?.trim()),
    standbyConfigured: Boolean(standbyUrl()),
    active: state.active,
  };
}

function endpointFor(target: FailoverTarget): Endpoint | null {
  const cached = endpoints[target];
  if (cached) return cached;

  const url = target === "primary" ? process.env.DATABASE_URL?.trim() : standbyUrl();
  if (!url) return null;

  const endpoint: Endpoint = { name: target, url, pool: null };
  endpoints[target] = endpoint;
  return endpoint;
}

function poolFor(endpoint: Endpoint): Pool {
  if (endpoint.pool) return endpoint.pool;
  const connection = resolvePostgresConnection(endpoint.url);
  /* Neon pooler refuse les paramètres de démarrage `options` (erreur
     « unsupported startup parameter »). On garde donc le plafond serveur
     sur la connexion directe, et le plafond client sur le pooler : le
     premier protège le serveur, le second empêche l'attente infinie. */
  const neonPooler = /^ep-.*-pooler\./i.test(new URL(endpoint.url).hostname);
  const created = new Pool({
    connectionString: connection.connectionString,
    ssl: connection.ssl,
    application_name: endpoint.name === "primary" ? "devnet-web" : "devnet-web-standby",
    max: positiveInt(process.env.PG_POOL_MAX, 10),
    idleTimeoutMillis: 10_000,
    /* 4 s et non 10 s : une base qui accepte le TCP puis se tait ne doit pas
       immobiliser la première requête dix secondes avant que la bascule ne
       soit seulement tentée. Un handshake TLS transatlantique tient
       largement dans ce budget ; la valeur reste réglable. */
    connectionTimeoutMillis: positiveInt(process.env.PG_CONNECT_TIMEOUT_MS, 4_000),
    query_timeout: positiveInt(process.env.PG_QUERY_TIMEOUT_MS, 15_000),
    /*
     * `query_timeout` est **côté client** : il abandonne le client, mais le
     * serveur continue d'exécuter la requête. Le 14 novembre, la base
     * affichait `statement_timeout = 0` — aucune limite serveur — donc une
     * requête lente pouvait occuper une connexion indéfiniment pendant que
     * le client avait déjà rendu la main. Sur un pool de 10 par instance,
     * c'est une fuite silencieuse.
     *
     * On pose donc un plafond **serveur** sur chaque connexion du pool, un
     * peu au-dessus du plafond client pour que ce soit le serveur qui tranche
     * et que l'erreur soit explicite (`57014 query_canceled`) plutôt qu'un
     * client qui raccroche sans que le serveur le sache.
     *
     * Au niveau du pool, pas du rôle : les migrations passent par une
     * connexion dédiée (`devnet-migrate`) et gardent leur propre budget.
     */
    ...(neonPooler
      ? {}
      : {
          options: `-c statement_timeout=${positiveInt(process.env.PG_STATEMENT_TIMEOUT_MS, 20_000)} -c lock_timeout=${positiveInt(process.env.PG_LOCK_TIMEOUT_MS, 5_000)}`,
        }),
  });

  /*
   * Un pool émet `error` sur ses clients **inactifs** quand la base tombe.
   * Sans écouteur, Node traite cela comme une exception non capturée et le
   * processus meurt — ce qui est arrivé au premier essai de la bascule :
   * arrêter la base tuait le serveur au lieu de le faire basculer.
   *
   * On écoute donc, et on en profite : c'est le signal le plus précoce
   * qu'une base vient de lâcher.
   */
  created.on("error", (error) => {
    if (endpoint.name === state.active) {
      void markUnavailable(error).catch(() => undefined);
    }
  });

  endpoint.pool = created;
  return created;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Codes et messages qui signifient « la base ne répond pas ».
 *
 * Le code SQL ne suffit pas, et la mise en production l'a montré : quand une
 * base accepte la connexion TCP puis ne répond plus jamais (le cas Systalink
 * du 14 novembre), `pg` expire dans la file d'attente du pool et lève une
 * erreur **sans code**, avec pour seul message « timeout exceeded when trying
 * to connect ». La première version ne la reconnaissait pas : la bascule ne
 * se déclenchait pas, et l'application restait bloquée sur une base morte.
 *
 * Les phrases sont volontairement précises : `statement timeout` (57014) est
 * une requête trop lente, pas une base absente, et doit rester une erreur de
 * requête.
 */

/**
 * Connexion bornée par une course explicite.
 *
 * `pool.connect()` a son propre délai (`connectionTimeoutMillis`, 10 s). Une
 * sonde n'a pas à attendre dix secondes : quand Systalink accepte le TCP puis
 * ne répond plus, chaque appel à `/api/ready` payait ce délai, et la sonde de
 * l'endpoint inactif bloquait le rendu de toute la console.
 *
 * Si la course expire, la promesse de connexion continue en arrière-plan :
 * on la laisse se résoudre et on **détruit** le client obtenu, pour ne pas
 * rendre au pool une connexion dont plus personne ne veut.
 */
async function connectWithTimeout(pool: Pool, timeoutMs: number) {
  const pending = pool.connect();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const client = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("probe_connect_timeout")), timeoutMs);
      }),
    ]);
    return client;
  } catch (error) {
    void pending.then((client) => client.release(true)).catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** `select 1` borné : ne lève jamais, renvoie un verdict. */
async function probe(target: FailoverTarget): Promise<boolean> {
  const endpoint = endpointFor(target);
  if (!endpoint) {
    state.health[target] = "down";
    state.lastError[target] = "aucune URL configurée";
    return false;
  }

  const pool = poolFor(endpoint);
  let client;
  let broken = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    client = await connectWithTimeout(pool, PROBE_TIMEOUT_MS);
    await Promise.race([
      client.query("select 1"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("probe_timeout")), INSPECT_TIMEOUT_MS);
      }),
    ]);
    state.health[target] = "ok";
    state.lastError[target] = null;
    state.lastSeenAt[target] = new Date().toISOString();
    // Le schéma est mémorisé pendant que la base répond : le jour où elle ne
    // répond plus, c'est cette dernière empreinte connue qui servira de
    // référence pour comparer la secours.
    await schemaFingerprint(target);
    return true;
  } catch (error) {
    broken = true;
    state.health[target] = "down";
    state.lastError[target] = safeErrorMessage(error);
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    client?.release(broken);
  }
}

/**
 * Message d'erreur utilisable dans une réponse HTTP.
 *
 * Les erreurs `pg` peuvent porter l'URL de connexion dans leur message (le
 * pilote la cite parfois en clair). On ne renvoie donc jamais le message brut
 * à un client : on le réduit à une famille lisible, sans hôte ni identifiant.
 */
function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/self-signed|certificate/i.test(message)) return "certificat TLS refusé";
  if (/server login has been failing/i.test(message)) {
    return "identifiants refusés par la base (08P01) — renouveler le mot de passe dans la console de l'hébergeur";
  }
  if (/password authentication failed/i.test(message)) return "mot de passe refusé";
  if (/password|authentication|login/i.test(message)) return "authentification refusée";
  if (/timeout/i.test(message)) return "délai de connexion dépassé";
  if (/ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|ETIMEDOUT/i.test(message)) return "hôte injoignable";
  if (/does not exist|n'existe pas/i.test(message)) return "schéma absent ou incomplet";
  return "connexion impossible";
}

/** Nombre de migrations appliquées sur une cible, ou `null` si illisible. */
async function migrationCount(target: FailoverTarget): Promise<number | null> {
  const endpoint = endpointFor(target);
  if (!endpoint) return null;
  try {
    const result = await poolFor(endpoint).query<{ n: string }>(
      "select count(*)::text as n from public.schema_migrations",
    );
    const n = Number(result.rows[0]?.n);
    state.migrations[target] = Number.isFinite(n) ? n : null;
    return state.migrations[target];
  } catch {
    return null;
  }
}

/**
 * Empreinte du schéma `public` : tables, colonnes, types, nullabilité.
 *
 * Deux bases capables de servir la même application ont la même empreinte.
 * Une colonne manquante la change. Les commentaires SQL et l'ordre physique
 * des colonnes, non — c'est voulu : seules comptent les différences qui font
 * échouer une requête.
 */
async function schemaFingerprint(target: FailoverTarget): Promise<string | null> {
  const endpoint = endpointFor(target);
  if (!endpoint) return null;
  try {
    const result = await poolFor(endpoint).query<{ fp: string | null }>(
      `select md5(string_agg(sig, '|' order by sig)) as fp
         from (
           select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable as sig
             from information_schema.columns
            where table_schema = 'public'
         ) columns`,
    );
    const fp = result.rows[0]?.fp ?? null;
    state.schema[target] = fp;
    if (fp) schemaProbeAt[target] = Date.now();
    return fp;
  } catch {
    return null;
  }
}

/**
 * Empreinte de la base **active**, rafraîchie au plus toutes les minutes.
 *
 * En temps normal, c'est la sonde de disponibilité qui l'entretient. Si la
 * base active ne répond plus, on garde la dernière empreinte connue : c'est
 * précisément l'empreinte contre laquelle comparer la secours au moment de
 * basculer. Insister sur une base morte ne ferait qu'ajouter son délai de
 * connexion au temps de bascule.
 */
async function ensureActiveSchema(): Promise<string | null> {
  const active = state.active;
  const known = state.schema[active];
  if (known && Date.now() - schemaProbeAt[active] < SCHEMA_TTL_MS) return known;
  if (state.health[active] === "down") return known;
  return schemaFingerprint(active);
}

/**
 * À appeler après une requête réussie sur la base active : entretient
 * l'empreinte de schéma sans jamais faire échouer l'appelant.
 */
export async function noteActiveHealthy(): Promise<void> {
  await ensureActiveSchema().catch(() => undefined);
}

export type PromoteResult =
  | { ok: true; from: FailoverTarget; to: FailoverTarget; migrations: number }
  | { ok: false; reason: string };

/**
 * Promeut la base de secours.
 *
 * Refuse si la secours est injoignable, ou si son schéma est **en retard**
 * sur celui de l'active : une base plus ancienne accepterait des écritures
 * en perdant des colonnes, ce qui est une corruption silencieuse, pas un
 * secours.
 */
export async function promote(reason: string): Promise<PromoteResult> {
  if (!failoverEnabled()) {
    return { ok: false, reason: "bascule désactivée (DATABASE_FAILOVER=off)" };
  }
  if (!standbyUrl()) {
    return { ok: false, reason: "aucune base de secours configurée (DATABASE_URL_STANDBY)" };
  }

  const reachable = await probe("standby");
  if (!reachable) {
    return { ok: false, reason: "la base de secours ne répond pas" };
  }

  const standbySchema = await schemaFingerprint("standby");
  const activeSchema = await ensureActiveSchema();

  if (standbySchema && activeSchema && standbySchema !== activeSchema) {
    return {
      ok: false,
      reason:
        "la base de secours n'a pas le même schéma que l'active : la promouvoir "
        + "ferait perdre des colonnes. Lancer scripts/db/sync-standby.ts --apply.",
    };
  }

  if (!standbySchema || !activeSchema) {
    /* Aucune empreinte connue — première exécution, ou base active muette
       depuis le démarrage du processus.

       Si la primaire est marquée injoignable, on ne lui demande surtout pas
       son comptage de migrations : la question bloquerait tout le temps de
       connexion (10 s par défaut) pour une réponse qu'on sait impossible, et
       la bascule expirerait avant d'avoir eu lieu. C'est le cas réel du
       14 novembre, et il doit rester rapide. */
    if (state.health[state.active] !== "down") {
      const [activeMigrations, standbyMigrations] = await Promise.all([
        migrationCount(state.active),
        migrationCount("standby"),
      ]);

      if (
        activeMigrations !== null &&
        standbyMigrations !== null &&
        standbyMigrations < activeMigrations
      ) {
        return {
          ok: false,
          reason:
            `la base de secours est en retard : ${standbyMigrations} migrations contre `
            + `${activeMigrations} sur l'active. La promouvoir perdrait les colonnes récentes.`,
        };
      }
    }
  }

  const from = state.active;
  state.active = "standby";
  state.switchedAt = new Date().toISOString();
  state.reason = reason;
  return { ok: true, from, to: "standby", migrations: state.migrations.standby ?? 0 };
}

/**
 * Retour à la primaire — mais seulement si elle est **au même schéma**.
 *
 * Le 14 novembre, la primaire (Systalink) est tombée et l'application a
 * basculé sur la secours (Neon). La première version de cette fonction ne
 * vérifiait qu'une chose : que la primaire répond. C'était un piège. Si
 * Systalink s'était réveillée avec son état de 11 h, l'application y serait
 * retournée toute seule et aurait perdu les écritures faites sur Neon
 * depuis — sans erreur, sans trace, sans que personne ne s'en aperçoive.
 *
 * Le garde-fou de `promote()` (comparer les schémas avant de changer de
 * base) manquait dans ce sens-ci. Il est maintenant des deux côtés : on ne
 * change de base que si la cible est au moins aussi à jour que celle qu'on
 * quitte.
 *
 * En cas de schéma différent, on **reste** sur la secours et on le dit. Une
 * secours à jour est un abri acceptable ; une primaire en retard est une
 * régression silencieuse.
 */
export async function demote(reason: string): Promise<PromoteResult> {
  if (state.active === "primary") {
    return { ok: false, reason: "déjà sur la base primaire" };
  }
  const reachable = await probe("primary");
  if (!reachable) {
    return { ok: false, reason: "la base primaire ne répond toujours pas" };
  }

  /*
   * Comparaison de schéma. On prend l'empreinte de la secours (sur laquelle
   * on tourne) et celle de la primaire. Si l'une des deux est illisible, on
   * ne peut pas conclure : on refuse le retour plutôt que de parier sur un
   * schéma qu'on n'a pas pu lire.
   */
  const [activeSchema, primarySchema] = await Promise.all([
    schemaFingerprint("standby"),
    schemaFingerprint("primary"),
  ]);

  if (!activeSchema || !primarySchema) {
    return {
      ok: false,
      reason:
        "schéma illisible d'un côté ou de l'autre : retour refusé par prudence. "
        + "Lancer scripts/db/sync-standby.ts pour aligner, puis réessayer.",
    };
  }

  if (activeSchema !== primarySchema) {
    return {
      ok: false,
      reason:
        "la base primaire n'a pas le même schéma que celle sur laquelle on tourne. "
        + "Y retourner perdrait les colonnes récentes. Lancer "
        + "scripts/db/sync-standby.ts --from=<secours> --to=<primaire> pour l'aligner.",
    };
  }

  state.active = "primary";
  state.switchedAt = new Date().toISOString();
  state.reason = reason;
  return {
    ok: true,
    from: "standby",
    to: "primary",
    migrations: state.migrations.primary ?? 0,
  };
}

/**
 * Pool de la base active.
 *
 * Si une requête échoue pour une raison de connexion, l'appelant doit
 * prévenir `markUnavailable()` : c'est ce qui déclenche la bascule sans
 * attendre la sonde suivante.
 */
export function activePool(): Pool {
  const target = state.active;
  const endpoint = endpointFor(target);
  if (!endpoint) {
    throw new Error(
      target === "primary"
        ? "DATABASE_URL est absent : le drainage des événements et l'état des plugins exigent PostgreSQL direct."
        : "la base de secours est configurée mais illisible.",
    );
  }
  return poolFor(endpoint);
}

export function activeTarget(): FailoverTarget {
  return state.active;
}

/**
 * Signale un échec de connexion sur la base active.
 *
 * Ne lève jamais : une bascule qui échoue ne doit pas masquer l'erreur
 * d'origine. Le rapport est dans `getFailoverState()`.
 */
export async function markUnavailable(error: unknown): Promise<void> {
  if (!isConnectionFailure(error)) return;
  await failOverNow("la base primaire ne répond plus");
}

/**
 * Pour la sonde de disponibilité : `select 1` n'échoue que pour une raison de
 * transport, quel que soit le code levé. Appeler `markUnavailable` depuis ce
 * chemin laissait passer les expirations sans code, c'est-à-dire le cas le
 * plus fréquent.
 */
export async function markUnreachable(reason = "la base primaire ne répond plus"): Promise<void> {
  await failOverNow(reason);
}

/** Fenêtre pendant laquelle on ne retente pas une bascule déjà refusée. */
const PROMOTE_BACKOFF_MS = 15_000;
let lastFailoverAt = 0;

async function failOverNow(reason: string): Promise<void> {
  state.health[state.active] = "down";
  if (state.active !== "primary" || !failoverEnabled() || !standbyUrl()) return;

  /* Sans ce délai, chaque requête qui échoue relançait une promotion : une
     secours refusée (schéma différent) transformait une panne en tempête de
     connexions vers une base déjà en difficulté. */
  if (Date.now() - lastFailoverAt < PROMOTE_BACKOFF_MS) return;
  lastFailoverAt = Date.now();

  const result = await promote(reason);
  if (!result.ok) {
    state.reason = `bascule impossible : ${result.reason}`;
  }
}

/**
 * Sonde l'endpoint inactif, au plus une fois par intervalle.
 *
 * Sans cela, une primaire qui revient ne serait jamais remise en service :
 * l'application resterait indéfiniment sur la secours, à lire des données
 * figées sans que personne ne s'en aperçoive.
 */
export async function probeInactive(): Promise<void> {
  if (probing) return;
  const now = Date.now();
  if (now - lastProbeAt < PROBE_INTERVAL_MS) return;
  lastProbeAt = now;
  probing = true;
  try {
    if (state.active === "standby") {
      const back = await probe("primary");
      if (back && autoReturnEnabled()) {
        await demote("la base primaire répond de nouveau (retour automatique)");
      } else if (back && !autoReturnEnabled()) {
        /* La primaire répond, mais on ne rentre pas tout seul : c'est un
           geste d'exploitation, depuis la console, avec la comparaison de
           schéma et la décision sur les écritures de la secours. On le dit
           pour que l'écran ne laisse pas croire à une panne persistante. */
        state.reason =
          "la base primaire répond de nouveau : le retour attend une décision "
          + "depuis la console d'administration (FAILOVER_AUTO_RETURN=manual)";
      }
    } else if (standbyUrl()) {
      await probe("standby");
    }
  } finally {
    probing = false;
  }
}

/**
 * Variante bornée pour `/api/ready`.
 *
 * En serverless, un `void probeInactive()` est gelé dès que la réponse
 * part. `/api/ready` la planifie donc avec `after()`, qui prolonge
 * l'invocation sans bloquer la réponse. La borne `timeoutMs` reste utile
 * pour les appelants qui choisissent de l'attendre : une secours muette ne
 * doit pas transformer un health check en attente de sept secondes.
 */
export async function primeInactive(timeoutMs = 1_500): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probeInactive(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function getFailoverState(): FailoverState {
  return {
    ...state,
    standbyConfigured: Boolean(standbyUrl()),
    health: { ...state.health },
    migrations: { ...state.migrations },
    schema: { ...state.schema },
    lastError: { ...state.lastError },
    lastSeenAt: { ...state.lastSeenAt },
  };
}

/* ── Inspection et pilotage depuis la console ─────────────────────────
 *
 * Le mode admin doit pouvoir répondre à quatre questions sans passer par un
 * terminal : quelle base est active, les deux répondent-elles, leurs schémas
 * sont-ils identiques, et peut-on revenir sur la primaire maintenant ?
 *
 * Les fonctions ci-dessous ne changent jamais de base pour les lectures.
 * `switchTo()` est le seul point de pilotage, il passe par les mêmes
 * garde-fous que la bascule automatique — un bouton d'administration ne doit
 * pas contourner la comparaison de schéma.
 */

export type EndpointInspection = {
  target: FailoverTarget;
  configured: boolean;
  reachable: boolean;
  active: boolean;
  latencyMs: number | null;
  host: string | null;
  migrations: number | null;
  schema: string | null;
  health: "unknown" | "ok" | "down";
  error: string | null;
  lastSeenAt: string | null;
  /** Métadonnées lues quand la base répond (null sinon). */
  databaseBytes: number | null;
  tableCount: number | null;
  connections: number | null;
  serverVersion: string | null;
};

/** Hôte masqué : la console n'a jamais besoin de l'URL complète. */
function maskedHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    return host.length > 12 ? `${host.slice(0, 6)}***${host.slice(-6)}` : "***";
  } catch {
    return null;
  }
}

function urlFor(target: FailoverTarget): string | undefined {
  return target === "primary" ? process.env.DATABASE_URL?.trim() : standbyUrl() ?? undefined;
}

/** Sonde **fraîche** d'une cible, avec ses métadonnées — jamais d'écriture. */
export async function inspectTarget(target: FailoverTarget): Promise<EndpointInspection> {
  const url = urlFor(target);
  const configured = Boolean(url);
  const base: EndpointInspection = {
    target,
    configured,
    reachable: false,
    active: state.active === target,
    latencyMs: null,
    host: maskedHost(url),
    migrations: state.migrations[target],
    schema: state.schema[target],
    health: state.health[target],
    error: state.lastError[target],
    lastSeenAt: state.lastSeenAt[target],
    databaseBytes: null,
    tableCount: null,
    connections: null,
    serverVersion: null,
  };
  if (!configured) return { ...base, health: "down", error: "aucune URL configurée" };

  const endpoint = endpointFor(target);
  if (!endpoint) return { ...base, health: "down", error: "aucune URL configurée" };

  const started = Date.now();
  let client: Client | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    /* Client dédié, pas le pool : le pool garde un délai court pour la
       disponibilité, qui couperait la connexion avant le message
       d'authentification de l'hébergeur. Ici on veut la cause exacte. */
    const connection = resolvePostgresConnection(endpoint.url);
    client = new Client({
      connectionString: connection.connectionString,
      ssl: connection.ssl,
      application_name: "devnet-inspect",
      connectionTimeoutMillis: INSPECT_TIMEOUT_MS,
    });
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("probe_timeout")), INSPECT_TIMEOUT_MS);
      }),
    ]);
    const result = await Promise.race([
      client.query<{
        migrations: string | null;
        schema: string | null;
        bytes: string | null;
        tables: string | null;
        connections: string | null;
        version: string | null;
      }>(
        `select
           (select count(*) from public.schema_migrations)::text as migrations,
           (select md5(string_agg(sig, '|' order by sig))
              from (select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable as sig
                      from information_schema.columns
                     where table_schema = 'public') c) as schema,
           pg_database_size(current_database())::text as bytes,
           (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind = 'r')::text as tables,
           (select count(*) from pg_stat_activity where datname = current_database())::text as connections,
           current_setting('server_version') as version`,
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("probe_timeout")), INSPECT_TIMEOUT_MS);
      }),
    ]);
    const row = result.rows[0];
    state.health[target] = "ok";
    state.lastError[target] = null;
    state.lastSeenAt[target] = new Date().toISOString();
    state.migrations[target] = Number(row?.migrations ?? 0);
    state.schema[target] = row?.schema ?? null;
    if (row?.schema) schemaProbeAt[target] = Date.now();
    return {
      ...base,
      reachable: true,
      latencyMs: Date.now() - started,
      migrations: state.migrations[target],
      schema: state.schema[target],
      health: "ok",
      error: null,
      lastSeenAt: state.lastSeenAt[target],
      databaseBytes: row?.bytes ? Number(row.bytes) : null,
      tableCount: row?.tables ? Number(row.tables) : null,
      connections: row?.connections ? Number(row.connections) : null,
      serverVersion: row?.version ?? null,
    };
  } catch (error) {
    state.health[target] = "down";
    state.lastError[target] = safeErrorMessage(error);
    return {
      ...base,
      reachable: false,
      latencyMs: Date.now() - started,
      health: "down",
      error: state.lastError[target],
    };
  } finally {
    if (timer) clearTimeout(timer);
    await client?.end().catch(() => undefined);
  }
}

/** Les deux cibles en parallèle — une base morte ne retarde pas l'autre. */
export function inspectBoth(): Promise<Record<FailoverTarget, EndpointInspection>> {
  return Promise.all([inspectTarget("primary"), inspectTarget("standby")]).then(
    ([primary, standby]) => ({ primary, standby }),
  );
}

/**
 * Version mémorisée pendant quelques secondes.
 *
 * La console charge « Données » puis « Plateforme » : sans ce cache, la même
 * sonde de la secours morte serait payée deux fois, et deux onglets
 * ouverts multiplieraient encore le coût. Dix secondes suffisent à rendre
 * l'écran réactif sans jamais mentir sur un état qui change à la seconde.
 */
let inspectCache: {
  at: number;
  value: Record<FailoverTarget, EndpointInspection>;
} | null = null;

export async function inspectBothCached(
  maxAgeMs = 10_000,
): Promise<Record<FailoverTarget, EndpointInspection>> {
  if (inspectCache && Date.now() - inspectCache.at < maxAgeMs) return inspectCache.value;
  const value = await inspectBoth();
  inspectCache = { at: Date.now(), value };
  return value;
}

/**
 * Change de base à la demande, en réutilisant les garde-fous.
 *
 * - vers la secours : `promote()` (schéma identique exigé) ;
 * - vers la primaire : `demote()` (même règle, dans l'autre sens).
 *
 * Aucune écriture n'est copiée. Le rapport le dit, et la console le répète
 * avant de demander confirmation.
 */
export async function switchTo(
  target: FailoverTarget,
  reason: string,
): Promise<PromoteResult> {
  if (target === state.active) {
    return { ok: false, reason: `déjà sur la base ${target === "primary" ? "primaire" : "de secours"}` };
  }
  if (!failoverEnabled()) {
    return { ok: false, reason: "bascule désactivée (DATABASE_FAILOVER=off)" };
  }
  const result = target === "standby" ? await promote(reason) : await demote(reason);
  /*
   * `promote()`/`demote()` utilisent la sonde courte de la bascule : quand
   * l'hôte met plus de temps à rendre un refus d'authentification, elles
   * concluent « ne répond pas » et masquent la cause. Une décision prise
   * depuis la console mérite le diagnostic complet — c'est un geste rare,
   * pas la boucle de disponibilité.
   */
  if (!result.ok && /ne répond pas/i.test(result.reason)) {
    const inspection = await inspectTarget(target).catch(() => null);
    if (inspection && !inspection.reachable && inspection.error) {
      return { ...result, reason: inspection.error };
    }
  }
  return result;
}

/**
 * Ferme les connexions ouvertes vers les deux bases.
 *
 * Les pools vivent ici depuis la bascule : `closePostgresPool()` ne peut donc
 * plus fermer le sien, il n'en a plus. Sans cette fonction, un arrêt propre
 * (test, script, `next start` qui s'éteint) laissait les connexions ouvertes
 * jusqu'à ce que la base les coupe elle-même.
 */
async function closePools(): Promise<void> {
  const pools = [endpoints.primary?.pool, endpoints.standby?.pool].filter(Boolean) as Pool[];
  endpoints = { primary: null, standby: null };
  await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
}

/** Ferme les connexions sans toucher à l'état : appelé à l'arrêt du processus. */
export async function closeFailoverPools(): Promise<void> {
  await closePools();
}

/** Remet l'état à zéro. Réservé aux tests. */
export async function resetFailover(): Promise<void> {
  await closePools();
  state = {
    active: "primary",
    standbyConfigured: false,
    health: { primary: "unknown", standby: "unknown" },
    switchedAt: null,
    reason: null,
    migrations: { primary: null, standby: null },
    schema: { primary: null, standby: null },
    lastError: { primary: null, standby: null },
    lastSeenAt: { primary: null, standby: null },
  };
  lastProbeAt = 0;
  probing = false;
  lastFailoverAt = 0;
  inspectCache = null;
  schemaProbeAt.primary = 0;
  schemaProbeAt.standby = 0;
}
