/**
 * Sentinelles — les vérifications autonomes de la plateforme.
 *
 * ## Ce que « IA qui surveille » veut dire ici, honnêtement
 *
 * Il n'y a pas de modèle de langage qui lit chaque message : ce serait cher,
 * lent, et impossible à expliquer en cas de sanction. Ce sont des **règles
 * mesurables**, exécutées régulièrement, qui répondent à des questions
 * concrètes :
 *
 *  - la base active répond-elle, et la secours est-elle prête ?
 *  - les tentatives de connexion sont-elles anormales ?
 *  - un texte publié récemment contient-il un terme interdit ?
 *  - le même message est-il copié-collé par plusieurs comptes (raid) ?
 *  - la file de signalements et celle de modération débordent-elles ?
 *  - la sauvegarde est-elle à jour, la boîte d'envoi se vide-t-elle ?
 *
 * Chaque constat porte sa **preuve** (un compte, une fenêtre, un identifiant).
 * Un constat sans preuve serait une alerte qu'on apprend à ignorer.
 *
 * ## Ce que le module ne fait pas
 *
 * Il ne supprime rien, ne bannit personne et ne « score » pas les gens. Il
 * ouvre des incidents pour le critique et met le reste en file de relecture.
 * La décision reste humaine, et c'est délibéré : une machine qui sanctionne
 * sans recours n'est pas de la modération, c'est une panne.
 */
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";
import { inspectBoth, failoverConfig } from "@/platform/infrastructure/postgres/failover";
import { readBackupState } from "@/lib/backup-status";
import { inspectStorage } from "@/lib/storage-inventory";
import { evaluateText, recordModerationFlag } from "@/lib/moderation/service";
import { recordSecurityEvent, countRecentSecurityEvents } from "@/lib/security/events";

export type SentinelSeverity = "info" | "warning" | "critical";

export type SentinelFinding = {
  check: string;
  severity: SentinelSeverity;
  title: string;
  detail: string;
  count?: number;
};

export type SentinelReport = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  findings: SentinelFinding[];
  scanned: { texts: number; flags: number; blocked: number };
};

type CandidateText = {
  id: string;
  target: "post" | "comment" | "message" | "story";
  text: string;
};

const MAX_TEXT_SCAN = 300;

async function checkDatabase(): Promise<SentinelFinding[]> {
  const findings: SentinelFinding[] = [];
  const [databases, config] = await Promise.all([
    inspectBoth().catch(() => null),
    Promise.resolve(failoverConfig()),
  ]);
  if (!databases) {
    findings.push({
      check: "database",
      severity: "critical",
      title: "Sonde des bases impossible",
      detail: "Les deux cibles ont échoué sans verdict exploitable.",
    });
    return findings;
  }

  const active = databases[config.active];
  if (!active.reachable) {
    findings.push({
      check: "database",
      severity: "critical",
      title: "La base active ne répond pas",
      detail:
        `Cible ${config.active} injoignable`
        + (active.error ? ` (${active.error})` : "")
        + ". Aucune écriture ne peut aboutir.",
    });
  }

  const other = config.active === "primary" ? databases.standby : databases.primary;
  if (!other.configured) {
    findings.push({
      check: "database",
      severity: "warning",
      title: "Aucune base de secours",
      detail: "Une panne de la base active arrêterait la plateforme sans relais.",
    });
  } else if (!other.reachable) {
    findings.push({
      check: "database",
      severity: "warning",
      title: "La base de secours ne répond pas",
      detail:
        `Cible ${other.target} injoignable`
        + (other.error ? ` (${other.error})` : "")
        + ". La bascule ne pourrait pas aboutir.",
    });
  } else if (
    databases.primary.schema
    && databases.standby.schema
    && databases.primary.schema !== databases.standby.schema
  ) {
    findings.push({
      check: "database",
      severity: "warning",
      title: "Les schémas des deux bases diffèrent",
      detail:
        "Une bascule serait refusée (à raison) tant que la secours n'est pas "
        + "alignée. Lancer scripts/db/sync-standby.ts.",
    });
  }

  if (config.active === "standby" && !config.autoReturn) {
    findings.push({
      check: "database",
      severity: "info",
      title: "On tourne sur la secours",
      detail:
        "Le retour sur la primaire attend une décision depuis la console "
        + "(FAILOVER_AUTO_RETURN=manual). C'est voulu : revenir abandonne les "
        + "écritures faites sur la secours.",
    });
  }
  return findings;
}

async function checkAuthSignals(): Promise<SentinelFinding[]> {
  const [recent, brute] = await Promise.all([
    countRecentSecurityEvents("auth.failed", 15),
    countRecentSecurityEvents("auth.bruteforce", 60),
  ]);
  const findings: SentinelFinding[] = [];
  if (brute > 0) {
    findings.push({
      check: "auth",
      severity: "critical",
      title: "Force brute détectée",
      detail:
        `${brute} signalement(s) de force brute sur la dernière heure. `
        + "Les connexions sont limitées ; vérifier l'origine dans l'onglet Sécurité.",
      count: brute,
    });
  }
  if (recent >= 40) {
    findings.push({
      check: "auth",
      severity: "critical",
      title: "Rafale de connexions échouées",
      detail: `${recent} échecs de connexion en 15 minutes.`,
      count: recent,
    });
  } else if (recent >= 12) {
    findings.push({
      check: "auth",
      severity: "warning",
      title: "Connexions échouées inhabituelles",
      detail: `${recent} échecs de connexion en 15 minutes.`,
      count: recent,
    });
  }
  return findings;
}

async function recentTexts(): Promise<CandidateText[]> {
  const pool = getPostgresPool();
  const [posts, comments, messages, stories] = await Promise.all([
    pool
      .query<{ id: string; text: string }>(
        `select id, text from public.posts
          where created_at > now() - interval '24 hours'
          order by created_at desc limit $1`,
        [MAX_TEXT_SCAN],
      )
      .catch(() => ({ rows: [] })),
    pool
      .query<{ id: string; text: string }>(
        `select id, text from public.comments
          where created_at > now() - interval '24 hours'
          order by created_at desc limit $1`,
        [MAX_TEXT_SCAN],
      )
      .catch(() => ({ rows: [] })),
    pool
      .query<{ id: string; text: string }>(
        `select id, text from public.direct_messages
          where created_at > now() - interval '24 hours'
          order by created_at desc limit $1`,
        [MAX_TEXT_SCAN],
      )
      .catch(() => ({ rows: [] })),
    pool
      .query<{ id: string; text: string }>(
        `select id, caption as text from public.stories
          where created_at > now() - interval '24 hours'
          order by created_at desc limit $1`,
        [MAX_TEXT_SCAN],
      )
      .catch(() => ({ rows: [] })),
  ]);

  return [
    ...posts.rows.map((row) => ({ ...row, target: "post" as const })),
    ...comments.rows.map((row) => ({ ...row, target: "comment" as const })),
    ...messages.rows.map((row) => ({ ...row, target: "message" as const })),
    ...stories.rows
      .filter((row) => typeof row.text === "string" && row.text.trim().length > 0)
      .map((row) => ({ ...row, target: "story" as const })),
  ];
}

async function checkRecentTexts(): Promise<{
  findings: SentinelFinding[];
  scanned: number;
  flags: number;
  blocked: number;
}> {
  const texts = await recentTexts();
  let flags = 0;
  let blocked = 0;
  const byCategory = new Map<string, number>();

  for (const row of texts) {
    if (!row.text || row.text.length > 4_000) continue;
    const result = await evaluateText(row.text);
    if (result.verdict === "allow") continue;
    if (result.verdict === "block") blocked += 1;
    else flags += 1;
    for (const match of result.matches) {
      byCategory.set(match.category, (byCategory.get(match.category) ?? 0) + 1);
    }
    await recordModerationFlag({
      targetType: row.target,
      targetId: row.id,
      source: "sentinel",
      severity: result.severity,
      reason: result.reason ?? "terme à surveiller",
      details: {
        terms: result.matches.map((match) => match.term),
        categories: [...new Set(result.matches.map((match) => match.category))],
      },
    });
  }

  const findings: SentinelFinding[] = [];
  if (blocked > 0) {
    findings.push({
      check: "moderation",
      severity: "critical",
      title: "Contenu interdit publié malgré le filtre",
      detail:
        `${blocked} texte(s) contiendraient un terme bloquant. Ils ont été `
        + "signalés ; la suppression reste une décision humaine.",
      count: blocked,
    });
  }
  if (flags > 0) {
    findings.push({
      check: "moderation",
      severity: "warning",
      title: "Termes à surveiller dans le contenu récent",
      detail:
        `${flags} texte(s) signalé(s) sur ${texts.length} analysés `
        + `(${[...byCategory.entries()].map(([key, value]) => `${key}: ${value}`).join(", ")}).`,
      count: flags,
    });
  }
  return { findings, scanned: texts.length, flags, blocked };
}

async function checkSpam(): Promise<SentinelFinding[]> {
  try {
    const result = await getPostgresPool().query<{
      text: string;
      n: string;
      authors: string;
    }>(
      `select text, count(*)::text as n, count(distinct author_id)::text as authors
         from public.posts
        where created_at > now() - interval '24 hours'
          and char_length(text) > 24
        group by text
       having count(*) >= 4
        order by count(*) desc
        limit 5`,
    );
    const raids = result.rows.filter((row) => Number(row.authors) >= 3);
    if (raids.length === 0) return [];
    return [
      {
        check: "spam",
        severity: "warning",
        title: "Message répété par plusieurs comptes",
        detail:
          `${raids.length} texte(s) identiques publiés par au moins 3 comptes en 24 h. `
          + "C'est la signature d'un raid coordonné, pas d'une coïncidence.",
        count: raids.length,
      },
    ];
  } catch {
    return [];
  }
}

async function checkQueues(): Promise<SentinelFinding[]> {
  const findings: SentinelFinding[] = [];
  try {
    const pool = getPostgresPool();
    const [reports, flags, outbox] = await Promise.all([
      pool.query<{ n: string }>(
        "select count(*)::text as n from public.reports where status = 'open'",
      ),
      pool.query<{ n: string; critical: string }>(
        `select count(*)::text as n,
                count(*) filter (where severity = 'critical')::text as critical
           from public.moderation_flags where status = 'open'`,
      ),
      pool
        .query<{ n: string }>(
          "select count(*)::text as n from public.event_outbox where status = 'pending'",
        )
        .catch(() => ({ rows: [{ n: "0" }] })),
    ]);

    const openReports = Number(reports.rows[0]?.n ?? 0);
    if (openReports >= 100) {
      findings.push({
        check: "reports",
        severity: "critical",
        title: "File de signalements saturée",
        detail: `${openReports} signalements ouverts. La modération ne suit plus.`,
        count: openReports,
      });
    } else if (openReports >= 20) {
      findings.push({
        check: "reports",
        severity: "warning",
        title: "Signalements en attente",
        detail: `${openReports} signalements ouverts.`,
        count: openReports,
      });
    }

    const openFlags = Number(flags.rows[0]?.n ?? 0);
    const criticalFlags = Number(flags.rows[0]?.critical ?? 0);
    if (criticalFlags > 0) {
      findings.push({
        check: "moderation",
        severity: "warning",
        title: "Signaux critiques non relus",
        detail: `${criticalFlags} signalement(s) critique(s) attendent une décision humaine.`,
        count: criticalFlags,
      });
    } else if (openFlags >= 30) {
      findings.push({
        check: "moderation",
        severity: "warning",
        title: "File de modération qui grossit",
        detail: `${openFlags} signalements ouverts dans la file.`,
        count: openFlags,
      });
    }

    const pending = Number(outbox.rows[0]?.n ?? 0);
    if (pending >= 100) {
      findings.push({
        check: "outbox",
        severity: "warning",
        title: "Boîte d'envoi qui ne se vide pas",
        detail: `${pending} événements en attente : le drainage est probablement arrêté.`,
        count: pending,
      });
    }
  } catch {
    /* base muette : le constat « base » le dira déjà */
  }
  return findings;
}

async function checkBackups(): Promise<SentinelFinding[]> {
  const [backup, storage] = await Promise.all([
    readBackupState().catch(() => null),
    inspectStorage().catch(() => null),
  ]);
  const findings: SentinelFinding[] = [];
  if (backup && ["stale", "missing", "error"].includes(backup.verdict)) {
    findings.push({
      check: "backup",
      severity: backup.verdict === "missing" ? "critical" : "warning",
      title:
        backup.verdict === "missing"
          ? "Aucune sauvegarde hors site"
          : "Sauvegarde hors site à vérifier",
      detail: backup.detail,
    });
  }
  if (storage?.orphaned && storage.orphaned > 100) {
    findings.push({
      check: "storage",
      severity: "info",
      title: "Fichiers non référencés",
      detail:
        `${storage.orphaned} fichiers de media_files ne sont référencés par aucun contenu. `
        + "Candidats à une purge, pas une panne.",
      count: storage.orphaned,
    });
  }
  return findings;
}

/** Exécute toutes les sentinelles. Ne lève jamais : rend un rapport. */
export async function runSentinels(): Promise<SentinelReport> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();

  const [database, auth, spam, queues, backups, texts] = await Promise.all([
    checkDatabase().catch(() => []),
    checkAuthSignals().catch(() => []),
    checkSpam().catch(() => []),
    checkQueues().catch(() => []),
    checkBackups().catch(() => []),
    checkRecentTexts().catch(() => ({ findings: [], scanned: 0, flags: 0, blocked: 0 })),
  ]);

  const findings = [...database, ...auth, ...texts.findings, ...spam, ...queues, ...backups];
  const critical = findings.filter((finding) => finding.severity === "critical");
  const warning = findings.filter((finding) => finding.severity === "warning");

  const severity: SentinelSeverity =
    critical.length > 0 ? "critical" : warning.length > 0 ? "warning" : "info";

  await recordSecurityEvent({
    kind: "sentinel.run",
    severity,
    subject: `${findings.length} constat(s)`,
    details: {
      critical: critical.length,
      warning: warning.length,
      checks: findings.map((finding) => `${finding.check}:${finding.severity}`),
    },
  }).catch(() => undefined);

  // Un incident par famille critique, pas un par constat : trois cents
  // messages toxiques ne doivent pas créer trois cents incidents.
  for (const finding of critical) {
    await recordSecurityEvent({
      kind: `sentinel.${finding.check}`,
      severity: "critical",
      subject: finding.title,
      details: { detail: finding.detail, count: finding.count ?? null },
    }).catch(() => undefined);
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    findings,
    scanned: { texts: texts.scanned, flags: texts.flags, blocked: texts.blocked },
  };
}
