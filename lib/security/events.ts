/**
 * Signaux de sécurité : ce que l'application remarque, et comment elle le dit.
 *
 * Trois principes, parce qu'un système d'alerte mal fait crée plus de bruit
 * que de sécurité :
 *
 *  1. **Aucune donnée personnelle brute.** Une adresse IP n'est jamais
 *     stockée : on garde un HMAC tronqué, calculé avec un secret serveur. Il
 *     permet de corréler deux tentatives sans conserver l'adresse.
 *  2. **Une écriture ne casse jamais la requête.** Un échec du journal de
 *     sécurité est signalé dans les journaux serveur, pas dans la réponse à
 *     l'utilisateur : refuser une connexion valide parce que la table
 *     d'alertes est pleine serait une panne causée par l'observabilité.
 *  3. **Les incidents critiques sont ouverts une fois.** Trois cents
 *     tentatives de connexion échouées ne doivent pas créer trois cents
 *     incidents : on regroupe par `kind` et par fenêtre.
 */
import { createHmac } from "node:crypto";
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";

export type SecuritySeverity = "info" | "warning" | "critical";

export type SecurityEventInput = {
  kind: string;
  severity?: SecuritySeverity;
  actorId?: string | null;
  subject?: string;
  ip?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown>;
};

/**
 * Empreinte d'adresse IP.
 *
 * Le secret vient de `SECURITY_HASH_SECRET`, puis de `AUTH_OAUTH_SECRET`, puis
 * d'une constante de développement. Sans secret configuré en production, on
 * préfère une empreinte non corrélable entre processus à une IP en clair :
 * `AUTH_OAUTH_SECRET` est déjà exigé par le démarrage de l'authentification,
 * donc le cas « aucun secret » ne devrait pas exister en production.
 */
function securitySecret(): string {
  return (
    process.env.SECURITY_HASH_SECRET?.trim()
    || process.env.AUTH_OAUTH_SECRET?.trim()
    || "devnet-security-dev-only"
  );
}

function hashIp(ip: string | null | undefined): string {
  if (!ip) return "";
  return createHmac("sha256", securitySecret()).update(ip).digest("hex").slice(0, 32);
}

/**
 * Empreinte d'un identifiant (adresse email, pseudo) pour corréler des
 * tentatives sans stocker l'identifiant en clair. Le sel est le secret
 * serveur : deux installations ne produisent pas les mêmes empreintes.
 */
export function hashIdentifier(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  return createHmac("sha256", securitySecret()).update(normalized).digest("hex").slice(0, 32);
}

/** Extrait l'adresse d'une requête derrière un proxy, sans faire confiance à `x-forwarded-for` en bloc. */
export function requestIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || null;
}

/**
 * Ouvre un incident d'exploitation pour un signal critique, au plus une fois
 * par quart d'heure et par nature.
 *
 * L'insertion passe par le pool propriétaire : `open_incident()` est une
 * fonction d'administration qui exige `is_admin()`, et une sentinelle n'a pas
 * de session. Le contrôle d'accès est ici « le serveur est le seul à écrire »,
 * pas « un administrateur clique ».
 */
async function openIncidentFor(event: SecurityEventInput): Promise<void> {
  const pool = getPostgresPool();
  const title = `Sécurité · ${event.kind}`.slice(0, 140);
  const recent = await pool.query<{ id: string }>(
    `select id from public.platform_incidents
      where status <> 'resolved' and title = $1 and created_at > now() - interval '15 minutes'
      limit 1`,
    [title],
  );
  if (recent.rows.length > 0) return;

  const body = [
    event.subject ? `Sujet : ${event.subject}` : null,
    event.ip ? "Adresse : empreinte seulement" : null,
    event.details ? `Détails : ${JSON.stringify(event.details).slice(0, 800)}` : null,
  ].filter(Boolean).join("\n");

  await pool.query(
    `insert into public.platform_incidents (title, body, severity, status)
     values ($1, $2, 'critical', 'open')`,
    [title, body || "Signal critique détecté par l'application."],
  );
}

/** Écrit un signal. Ne lève jamais. */
export async function recordSecurityEvent(event: SecurityEventInput): Promise<void> {
  const severity = event.severity ?? "info";
  try {
    const pool = getPostgresPool();
    await pool.query(
      `insert into public.security_events
         (kind, severity, actor_id, subject, ip_hash, user_agent, details)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        event.kind.slice(0, 80),
        severity,
        event.actorId ?? null,
        (event.subject ?? "").slice(0, 240),
        hashIp(event.ip),
        (event.userAgent ?? "").slice(0, 300),
        JSON.stringify(event.details ?? {}),
      ],
    );
    if (severity === "critical") {
      await openIncidentFor(event).catch(() => undefined);
    }
  } catch (error) {
    console.error(
      "[security] signal non enregistré",
      event.kind,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Compte les signaux d'une nature sur une fenêtre — pour les seuils. */
export async function countRecentSecurityEvents(
  kind: string,
  windowMinutes = 15,
): Promise<number> {
  try {
    const result = await getPostgresPool().query<{ n: string }>(
      `select count(*)::text as n from public.security_events
        where kind = $1 and created_at > now() - ($2 || ' minutes')::interval`,
      [kind, String(Math.max(1, Math.min(1440, windowMinutes)))],
    );
    return Number(result.rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}
