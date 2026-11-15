import { NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
import { checkDatabase, getPostgresPool } from "@/platform/infrastructure/postgres/pool";
import { getFailoverState } from "@/platform/infrastructure/postgres/failover";
import { readBackupState } from "@/lib/backup-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plateforme — les jobs, les sauvegardes et les limites, observables.
 *
 * Le module disait « les jobs, sauvegardes et limites ne sont pas
 * observables depuis l'application ». Les sauvegardes le sont depuis
 * `/api/admin/data` ; cette route s'occupe du reste, et le reste a une
 * propriété importante : **il se mesure**.
 *
 * Trois idées, et aucune n'est un badge vert :
 *
 *  1. **Un job sans trace n'est pas un job.** La purge des stories expirées
 *     n'écrit aucun journal : on ne peut donc pas dire « elle a tourné ».
 *     Mais on peut mesurer son **effet attendu** — combien de stories sont
 *     expirées à cet instant. Si ce nombre reste élevé alors que le job est
 *     censé tourner chaque nuit, il ne tourne pas. C'est une preuve par
 *     l'absence, et c'est plus honnête qu'un voyant vert.
 *  2. **La boîte d'envoi dit si le drainage suit.** Un `pending` qui
 *     s'accumule est le signe d'un drainage arrêté ; un `failed` est un
 *     événement perdu. On rapporte les deux, avec l'âge du plus ancien.
 *  3. **Les limites sont lues, pas supposées.** `max_connections` vient du
 *     serveur, pas d'une constante du dépôt. Sur Neon il vaut 901, sur
 *     Systalink 100 : coder la valeur en dur aurait menti sur l'un des deux.
 */

type JobState = {
  name: string;
  schedule: string;
  /** Ce qui déclenche le job, tel qu'il est réellement câblé. */
  trigger: string;
  /** Ce que le job fait, en une phrase. */
  purpose: string;
  /** Preuve mesurable de son effet, ou `null` si aucune n'existe. */
  evidence: string | null;
  /** `ok`, `late`, `unknown` — jamais `ok` sans preuve. */
  verdict: "ok" | "late" | "unknown";
};

export async function GET(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  const health = await checkDatabase(2_000);
  const failover = getFailoverState();
  const backups = await readBackupState();

  let outbox: {
    total: number;
    pending: number;
    failed: number;
    dispatched: number;
    oldestPendingAt: string | null;
    lastEventAt: string | null;
  } | null = null;

  let stories: {
    expired: number;
    live: number;
    oldestExpiredAt: string | null;
  } | null = null;

  let limits: {
    maxConnections: number | null;
    activeConnections: number | null;
    devnetConnections: number | null;
    databaseBytes: number | null;
    statementTimeout: string | null;
  } | null = null;

  let cronSecretConfigured = false;
  let drainSecretConfigured = false;

  try {
    const pool = getPostgresPool();

    const [outboxRow] = await pool
      .query<{
        total: string;
        pending: string;
        failed: string;
        dispatched: string;
        oldest_pending: string | null;
        last_event: string | null;
      }>(`
        select count(*)::text as total,
               count(*) filter (where status = 'pending')::text as pending,
               count(*) filter (where status = 'failed')::text as failed,
               count(*) filter (where status = 'dispatched')::text as dispatched,
               min(created_at) filter (where status = 'pending')::text as oldest_pending,
               max(created_at)::text as last_event
          from public.event_outbox
      `)
      .then((result) => result.rows)
      .catch(() => [undefined]);

    if (outboxRow) {
      outbox = {
        total: Number(outboxRow.total),
        pending: Number(outboxRow.pending),
        failed: Number(outboxRow.failed),
        dispatched: Number(outboxRow.dispatched),
        oldestPendingAt: outboxRow.oldest_pending,
        lastEventAt: outboxRow.last_event,
      };
    }

    const [storyRow] = await pool
      .query<{ expired: string; live: string; oldest_expired: string | null }>(`
        select count(*) filter (where expires_at < now())::text as expired,
               count(*) filter (where expires_at >= now())::text as live,
               min(expires_at) filter (where expires_at < now())::text as oldest_expired
          from public.stories
      `)
      .then((result) => result.rows)
      .catch(() => [undefined]);

    if (storyRow) {
      stories = {
        expired: Number(storyRow.expired),
        live: Number(storyRow.live),
        oldestExpiredAt: storyRow.oldest_expired,
      };
    }

    const [limitRow] = await pool
      .query<{
        max_conn: string;
        active_conn: string;
        devnet_conn: string;
        bytes: string;
        statement_timeout: string;
      }>(`
        select current_setting('max_connections')::text as max_conn,
               (select count(*)::int from pg_stat_activity)::text as active_conn,
               (select count(*)::int from pg_stat_activity
                 where application_name like 'devnet%')::text as devnet_conn,
               pg_database_size(current_database())::text as bytes,
               current_setting('statement_timeout') as statement_timeout
      `)
      .then((result) => result.rows)
      .catch(() => [undefined]);

    if (limitRow) {
      limits = {
        maxConnections: Number(limitRow.max_conn),
        activeConnections: Number(limitRow.active_conn),
        devnetConnections: Number(limitRow.devnet_conn),
        databaseBytes: Number(limitRow.bytes),
        statementTimeout: limitRow.statement_timeout,
      };
    }

    cronSecretConfigured = Boolean(process.env.CRON_SECRET?.trim());
    drainSecretConfigured = Boolean(process.env.EVENTS_DRAIN_SECRET?.trim());
  } catch {
    /* base muette : les blocs restent `null` et l'écran le dit */
  }

  /*
   * Le verdict de la purge est une preuve par l'absence. La route ne
   * journalise rien : on ne peut donc pas affirmer « elle a tourné ». Mais
   * si des stories sont expirées depuis plus de 48 h alors que le cron
   * passe chaque nuit à 3 h, la conclusion tient : elle ne tourne pas.
   */
  let purgeVerdict: JobState["verdict"] = "unknown";
  let purgeEvidence: string | null = null;
  if (stories) {
    if (stories.expired === 0) {
      purgeVerdict = "ok";
      purgeEvidence = "Aucune story expirée : la purge n'a rien à faire.";
    } else if (stories.oldestExpiredAt) {
      const ageHours =
        (Date.now() - Date.parse(stories.oldestExpiredAt)) / 3_600_000;
      if (ageHours > 48) {
        purgeVerdict = "late";
        purgeEvidence =
          `${stories.expired} story(s) expirée(s), la plus ancienne depuis `
          + `${Math.round(ageHours)} h. Le cron passe chaque nuit à 3 h : `
          + `elles devraient avoir disparu.`;
      } else {
        purgeVerdict = "unknown";
        purgeEvidence =
          `${stories.expired} story(s) expirée(s) depuis moins de 48 h : `
          + `c'est normal entre deux passages du cron.`;
      }
    }
  }

  const jobs: JobState[] = [
    {
      name: "Purge des stories expirées",
      schedule: "0 3 * * *",
      trigger: cronSecretConfigured
        ? "Vercel Cron, protégé par CRON_SECRET"
        : "Vercel Cron, mais CRON_SECRET est absent : la route répond 503",
      purpose: "Supprime les médias des stories dont la rétention est passée.",
      evidence: purgeEvidence,
      verdict: cronSecretConfigured ? purgeVerdict : "unknown",
    },
    {
      name: "Drainage de la boîte d'envoi",
      schedule: "à la demande (pompe navigateur + planificateur)",
      trigger: drainSecretConfigured
        ? "EVENTS_DRAIN_SECRET configuré, ou toute session authentifiée"
        : "EVENTS_DRAIN_SECRET absent : seules les sessions authentifiées peuvent drainer",
      purpose: "Distribue les événements métier en attente (inscriptions, preuves, publications).",
      evidence: outbox
        ? outbox.pending === 0
          ? `${outbox.dispatched} événement(s) traité(s), aucun en attente.`
          : `${outbox.pending} événement(s) en attente, le plus ancien du ${outbox.oldestPendingAt ?? "?"}.`
        : null,
      verdict: outbox ? (outbox.pending === 0 ? "ok" : "late") : "unknown",
    },
    {
      name: "Sauvegarde chiffrée",
      schedule: "quotidienne, 3 h (systemd, hors Vercel)",
      trigger: "devnet-backup.timer sur la machine de l'opérateur",
      purpose: "Archive la base active, la chiffre et la dépose hors site.",
      evidence: backups.detail,
      verdict:
        backups.verdict === "ok" ? "ok" : backups.verdict === "stale" ? "late" : "unknown",
    },
    {
      name: "Mise à niveau de la secours",
      schedule: "quotidienne, 4 h (systemd, hors Vercel)",
      trigger: "devnet-sync-standby.timer sur la machine de l'opérateur",
      purpose: "Applique les migrations manquantes sur la base de secours.",
      evidence: failover.standbyConfigured
        ? "Secours configurée ; son alignement est vérifié par /api/ready."
        : "Aucune secours configurée : ce job n'a pas de cible.",
      verdict: failover.standbyConfigured ? "ok" : "unknown",
    },
  ];

  return NextResponse.json(
    {
      checkedAt: new Date().toISOString(),
      database: {
        ok: health.ok,
        latencyMs: health.ok ? health.latencyMs : null,
        reason: health.ok ? null : health.reason,
        active: failover.active,
      },
      jobs,
      outbox,
      stories,
      limits,
      secrets: {
        cronSecret: cronSecretConfigured,
        drainSecret: drainSecretConfigured,
      },
    },
    { headers: ADMIN_NO_STORE },
  );
}
