/**
 * Dossiers de modération.
 *
 * Un dossier est l'unité de travail humaine : il rassemble les constats
 * d'une même cible, il porte son statut, son priorité et sa décision. Les
 * constats sont des observations ; les preuves sont des copies conservées
 * avant suppression. Aucun écran ne montre le contenu complet d'un
 * dossier : il montre la catégorie, le moteur et la décision.
 *
 * Toutes les écritures passent par le pool propriétaire **après** une
 * vérification de rôle faite en base. Un modérateur nommé n'est pas un
 * administrateur : il ne peut pas lire les secrets d'administration ni
 * modifier les rôles.
 */
import { createHash } from "node:crypto";
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";
import { withUser } from "@/platform/infrastructure/postgres/with-user";
import { writeAudit } from "@/lib/admin-audit";
import type { PolicyResult, TrustFinding } from "./policy";

export type CaseStatus =
  | "open"
  | "triaged"
  | "investigating"
  | "actioned"
  | "no_violation"
  | "closed";

export type CasePriority = "low" | "normal" | "high" | "urgent";

export type ModerationCase = {
  id: string;
  target_type: string;
  target_id: string;
  content_author_id: string | null;
  author_pseudo: string | null;
  status: CaseStatus;
  priority: CasePriority;
  policy_version: string;
  assigned_to: string | null;
  assigned_pseudo: string | null;
  summary: string;
  internal_note: string;
  last_decision: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  findings: number;
  reports: number;
};

export type CaseFinding = {
  id: string;
  engine: TrustFinding["engine"];
  provider: string;
  category: string;
  score: number;
  severity: string;
  explanation_code: string;
  evidence: Record<string, unknown>;
  latency_ms: number | null;
  created_at: string;
};

export type CaseEvent = {
  id: string;
  actor_id: string | null;
  actor_pseudo: string | null;
  event: string;
  from_status: string | null;
  to_status: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export type CaseDetail = ModerationCase & {
  findings_list: CaseFinding[];
  events: CaseEvent[];
  evidence: {
    id: string;
    content_table: string;
    content_id: string;
    content_sha256: string;
    media_path: string;
    created_at: string;
    expires_at: string;
  }[];
};

export type TrustOverview = {
  policy: {
    version: string;
    active: boolean;
    activated_at: string | null;
    categories: Record<string, unknown>;
    thresholds: Record<string, unknown>;
  };
  counts: {
    open: number;
    urgent: number;
    unassigned: number;
    actioned: number;
    no_violation: number;
    appeals_pending: number;
    sanctions_active: number;
  };
  triageMinutes: number | null;
  appealRate: number | null;
  reversalRate: number | null;
  engines: {
    engine: string;
    runs: number;
    holds: number;
    failures: number;
    avg_latency_ms: number | null;
  }[];
  recent: ModerationCase[];
};

export class TrustSafetyConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrustSafetyConflict";
  }
}

const CONTENT_TABLES: Record<string, { table: string; idColumn: string }> = {
  post: { table: "posts", idColumn: "id" },
  comment: { table: "comments", idColumn: "id" },
  group_message: { table: "group_messages", idColumn: "id" },
  message: { table: "group_messages", idColumn: "id" },
  direct_message: { table: "direct_messages", idColumn: "id" },
  story: { table: "stories", idColumn: "id" },
  media: { table: "media_files", idColumn: "path" },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function canView(actorId: string): Promise<boolean> {
  try {
    const rows = await withUser(actorId, (query) =>
      query<{ ok: boolean }>("select public.can_view_trust_safety() as ok"),
    );
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}

async function canModerate(actorId: string): Promise<boolean> {
  try {
    const rows = await withUser(actorId, (query) =>
      query<{ ok: boolean }>("select public.can_moderate() as ok"),
    );
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}

async function canSanction(actorId: string): Promise<boolean> {
  try {
    const rows = await withUser(actorId, (query) =>
      query<{ ok: boolean }>("select public.can_sanction() as ok"),
    );
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}

async function effectiveRole(actorId: string): Promise<string | null> {
  const rows = await withUser(actorId, (query) =>
    query<{ role: string | null }>("select public.trust_safety_role() as role"),
  );
  return rows[0]?.role ?? null;
}

export async function openCase(input: {
  targetType: string;
  targetId: string;
  priority?: CasePriority;
  summary?: string;
  actorId?: string | null;
}): Promise<string> {
  const pool = getPostgresPool();
  const rows = await pool.query<{ id: string }>(
    "select public.open_moderation_case($1, $2, $3, $4) as id",
    [
      input.targetType,
      input.targetId,
      input.priority ?? "normal",
      (input.summary ?? "").slice(0, 1000),
    ],
  );
  const id = rows.rows[0]?.id;
  if (!id) throw new Error("dossier non créé");
  return id;
}

/** Enregistre un constat sans doublon pour le même moteur et la même règle. */
export async function addFinding(caseId: string, finding: TrustFinding): Promise<void> {
  await getPostgresPool().query(
    `insert into public.moderation_findings
       (case_id, engine, provider, provider_version, category, score, severity,
        explanation_code, evidence, latency_ms)
     select $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10
      where not exists (
        select 1 from public.moderation_findings
         where case_id = $1 and engine = $2 and category = $5
           and explanation_code = $8
      )`,
    [
      caseId,
      finding.engine,
      (finding.provider ?? "local").slice(0, 80),
      (finding.providerVersion ?? "").slice(0, 80),
      finding.category,
      finding.score ?? 1,
      finding.severity,
      finding.explanationCode.slice(0, 120),
      JSON.stringify(finding.evidence ?? {}),
      finding.latencyMs ?? null,
    ],
  );
}

export async function recordEngineRun(input: {
  targetType: string;
  targetId: string;
  caseId: string | null;
  engine: TrustFinding["engine"];
  policyVersion: string;
  decision: PolicyResult["decision"];
  score: number;
  latencyMs?: number;
  status?: "ok" | "partial" | "failed" | "skipped";
  detail?: Record<string, unknown>;
}): Promise<void> {
  await getPostgresPool().query(
    `insert into public.moderation_engine_runs
       (target_type, target_id, case_id, engine, policy_version, decision,
        score, latency_ms, status, detail)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      input.targetType.slice(0, 40),
      input.targetId.slice(0, 240),
      input.caseId,
      input.engine,
      input.policyVersion.slice(0, 40),
      input.decision,
      Math.min(1, Math.max(0, input.score)),
      input.latencyMs ?? null,
      input.status ?? "ok",
      JSON.stringify(input.detail ?? {}),
    ],
  ).catch(() => undefined);
}

export async function attachDecision(input: {
  targetType: string;
  targetId: string;
  result: PolicyResult;
  authorId?: string | null;
}): Promise<string | null> {
  if (!input.result.notifyModeration) return null;
  const caseId = await openCase({
    targetType: input.targetType,
    targetId: input.targetId,
    priority: input.result.priority,
    summary: input.result.reasons.join(", "),
  });

  await Promise.all(
    input.result.findings.map((finding) => addFinding(caseId, finding)),
  );
  await recordEngineRun({
    targetType: input.targetType,
    targetId: input.targetId,
    caseId,
    engine: input.result.findings[0]?.engine ?? "text",
    policyVersion: input.result.policyVersion,
    decision: input.result.decision,
    score: input.result.score,
  });

  return caseId;
}

const CASE_SELECT = `
  select c.id, c.target_type, c.target_id, c.content_author_id,
         u.pseudo as author_pseudo, c.status, c.priority, c.policy_version,
         c.assigned_to, a.pseudo as assigned_pseudo, c.summary, c.internal_note,
         c.last_decision, c.created_at, c.updated_at, c.resolved_at,
         (select count(*)::int from public.moderation_findings f where f.case_id = c.id) as findings,
         (select count(*)::int from public.reports r where r.case_id = c.id) as reports
    from public.moderation_cases c
    left join public.users u on u.id = c.content_author_id
    left join public.users a on a.id = c.assigned_to
`;

export async function listCases(
  actorId: string,
  filters: { status?: CaseStatus | "all"; priority?: CasePriority; assigned?: "me" | "all" } = {},
): Promise<ModerationCase[]> {
  if (!(await canView(actorId))) throw new Error("réservé à la modération");
  const status = filters.status ?? "open";
  const values: unknown[] = [];
  const clauses: string[] = [];

  if (status !== "all") {
    values.push(status);
    clauses.push(`c.status = $${values.length}`);
  }
  if (filters.priority) {
    values.push(filters.priority);
    clauses.push(`c.priority = $${values.length}`);
  }
  if (filters.assigned === "me") {
    values.push(actorId);
    clauses.push(`c.assigned_to = $${values.length}`);
  }

  const result = await getPostgresPool().query<ModerationCase>(
    `${CASE_SELECT}
     ${clauses.length ? `where ${clauses.join(" and ")}` : ""}
     order by
       case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
       c.created_at asc
     limit 200`,
    values,
  );
  return result.rows;
}

export async function getCase(actorId: string, caseId: string): Promise<CaseDetail | null> {
  if (!(await canView(actorId))) throw new Error("réservé à la modération");
  if (!UUID.test(caseId)) return null;
  const pool = getPostgresPool();
  const [main, findings, events, evidence] = await Promise.all([
    pool.query<ModerationCase>(`${CASE_SELECT} where c.id = $1`, [caseId]),
    pool.query<CaseFinding>(
      `select id, engine, provider, category, score, severity, explanation_code,
              evidence, latency_ms, created_at
         from public.moderation_findings
        where case_id = $1
        order by created_at desc
        limit 100`,
      [caseId],
    ),
    pool.query<CaseEvent>(
      `select e.id::text, e.actor_id, u.pseudo as actor_pseudo, e.event,
              e.from_status, e.to_status, e.details, e.created_at
         from public.moderation_case_events e
         left join public.users u on u.id = e.actor_id
        where e.case_id = $1
        order by e.created_at asc
        limit 200`,
      [caseId],
    ),
    pool.query<CaseDetail["evidence"][number]>(
      `select id, content_table, content_id, content_sha256, media_path, created_at, expires_at
         from public.moderation_evidence
        where case_id = $1
        order by created_at desc
        limit 50`,
      [caseId],
    ),
  ]);
  const row = main.rows[0];
  if (!row) return null;
  return {
    ...row,
    findings_list: findings.rows,
    events: events.rows,
    evidence: evidence.rows,
  };
}

export async function assignCase(actorId: string, caseId: string, assigneeId: string | null): Promise<void> {
  if (!(await canModerate(actorId))) throw new Error("réservé à la modération");
  if (!UUID.test(caseId)) throw new Error("dossier invalide");
  if (assigneeId && !UUID.test(assigneeId)) throw new Error("compte invalide");

  await getPostgresPool().query(
    `update public.moderation_cases
        set assigned_to = $2, status = case when status = 'open' then 'triaged' else status end,
            updated_at = now()
      where id = $1 and status not in ('actioned', 'no_violation', 'closed')`,
    [caseId, assigneeId],
  );
  await addEvent(caseId, actorId, "case.assigned", { assignee: assigneeId });
  await writeAudit({
    actorId,
    action: "moderation.case.assign",
    targetType: "case",
    targetId: caseId,
    details: { assignee: assigneeId },
  });
}

async function addEvent(
  caseId: string,
  actorId: string | null,
  event: string,
  details: Record<string, unknown> = {},
  fromStatus?: string | null,
  toStatus?: string | null,
): Promise<void> {
  await getPostgresPool().query(
    `insert into public.moderation_case_events
       (case_id, actor_id, event, from_status, to_status, details)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [caseId, actorId, event.slice(0, 80), fromStatus ?? null, toStatus ?? null, JSON.stringify(details)],
  );
}

/**
 * Copie le contenu avant de le supprimer.
 *
 * La preuve reste chez la modération, jamais dans une réponse publique.
 * Elle expire à 180 jours : une suppression définitive sans copie rendrait
 * tout recours impossible, une copie éternelle serait une archive de
 * contenu nuisible.
 */
async function snapshotAndRemove(
  caseId: string,
  targetType: string,
  targetId: string,
  actorId: string,
): Promise<{ removed: boolean; reason?: string }> {
  const mapping = CONTENT_TABLES[targetType];
  if (!mapping) return { removed: false, reason: "cible non supprimable" };
  const pool = getPostgresPool();

  const query =
    mapping.idColumn === "path"
      ? `select to_jsonb(t) as snapshot from public.${mapping.table} t where t.path = $1 limit 1`
      : `select to_jsonb(t) as snapshot from public.${mapping.table} t where t.id = $1::uuid limit 1`;

  const found = await pool.query<{ snapshot: Record<string, unknown> }>(query, [targetId]);
  const snapshot = found.rows[0]?.snapshot;
  if (!snapshot) return { removed: false, reason: "contenu introuvable" };

  const serialized = JSON.stringify(snapshot);
  const sha256 = createHash("sha256").update(serialized).digest("hex");
  const mediaPath =
    typeof snapshot.media_url === "string"
      ? snapshot.media_url
      : typeof snapshot.path === "string"
        ? snapshot.path
        : "";

  await pool.query(
    `insert into public.moderation_evidence
       (case_id, content_table, content_id, content_snapshot, content_sha256, media_path)
     values ($1, $2, $3, $4::jsonb, $5, $6)`,
    [caseId, mapping.table, targetId, serialized, sha256, mediaPath.slice(0, 500)],
  );

  const deleted = await pool.query(
    mapping.idColumn === "path"
      ? `delete from public.${mapping.table} where path = $1`
      : `delete from public.${mapping.table} where id = $1::uuid`,
    [targetId],
  );

  await writeAudit({
    actorId,
    action: "moderation.content.remove",
    targetType,
    targetId,
    details: { case_id: caseId, sha256, rows: deleted.rowCount ?? 0 },
  });

  return { removed: (deleted.rowCount ?? 0) > 0 };
}

export async function decideCase(
  actorId: string,
  caseId: string,
  input: {
    action: "no_violation" | "warning" | "restrict" | "suspend" | "ban";
    reasonCode: string;
    note?: string;
    days?: number | null;
    capabilities?: string[];
    removeContent?: boolean;
  },
): Promise<{ ok: true; removed: boolean; sanctionId: string | null }> {
  if (!(await canModerate(actorId))) throw new Error("réservé à la modération");
  if (!UUID.test(caseId)) throw new Error("dossier invalide");

  const pool = getPostgresPool();
  const found = await pool.query<{
    status: CaseStatus;
    target_type: string;
    target_id: string;
    content_author_id: string | null;
    priority: CasePriority;
  }>(
    `select status, target_type, target_id, content_author_id, priority
       from public.moderation_cases where id = $1`,
    [caseId],
  );
  const current = found.rows[0];
  if (!current) throw new Error("dossier introuvable");
  if (["actioned", "no_violation", "closed"].includes(current.status)) {
    throw new TrustSafetyConflict("ce dossier est déjà clos");
  }

  const needsSanction = input.action !== "no_violation";
  if (needsSanction && !current.content_author_id) {
    throw new Error("ce dossier n'a pas d'auteur à sanctionner");
  }
  if (needsSanction && !(await canSanction(actorId))) {
    throw new Error("sanction réservée à la modération habilitée");
  }
  if (input.action === "ban" && (await effectiveRole(actorId)) === "lead_moderator") {
    throw new Error("un bannissement définitif demande un administrateur");
  }

  let sanctionId: string | null = null;
  if (needsSanction && current.content_author_id) {
    const kind = input.action;
    const capabilities =
      kind === "restrict" && Array.isArray(input.capabilities)
        ? input.capabilities.filter((value) =>
            ["post", "comment", "message", "story", "live"].includes(value),
          )
        : [];
    const rows = await withUser(actorId, (query) =>
      query<{ id: string }>(
        `select public.issue_sanction($1::uuid, $2, $3, $4, $5, null, $6::text[]) as id`,
        [
          current.content_author_id,
          kind,
          input.reasonCode,
          (input.note ?? "").slice(0, 2000),
          input.days ?? null,
          capabilities,
        ],
      ),
    );
    sanctionId = rows[0]?.id ?? null;
  }

  let removed = false;
  if (input.removeContent) {
    const outcome = await snapshotAndRemove(caseId, current.target_type, current.target_id, actorId);
    removed = outcome.removed;
  }

  const nextStatus: CaseStatus = input.action === "no_violation" ? "no_violation" : "actioned";
  await pool.query(
    `update public.moderation_cases
        set status = $2, last_decision = $3, resolved_at = now(), updated_at = now()
      where id = $1`,
    [caseId, nextStatus, input.action],
  );
  await pool.query(
    `update public.reports
        set status = case when $2 = 'no_violation' then 'dismissed' else 'resolved' end
      where case_id = $1 and status = 'open'`,
    [caseId, input.action],
  );
  await addEvent(
    caseId,
    actorId,
    "case.decision",
    {
      action: input.action,
      reason: input.reasonCode,
      days: input.days ?? null,
      capabilities: input.capabilities ?? [],
      remove_content: removed,
      sanction_id: sanctionId,
    },
    current.status,
    nextStatus,
  );
  await writeAudit({
    actorId,
    action: "moderation.case.decide",
    targetType: "case",
    targetId: caseId,
    details: {
      decision: input.action,
      reason: input.reasonCode,
      sanction_id: sanctionId,
      removed,
    },
  });

  return { ok: true, removed, sanctionId };
}

export async function noteCase(actorId: string, caseId: string, note: string): Promise<void> {
  if (!(await canModerate(actorId))) throw new Error("réservé à la modération");
  if (!UUID.test(caseId)) throw new Error("dossier invalide");
  const text = note.trim().slice(0, 4000);
  if (text.length < 3) throw new Error("note trop courte");

  await getPostgresPool().query(
    `update public.moderation_cases
        set internal_note = left(internal_note || case when internal_note = '' then '' else E'\n' end || $2, 8000),
            updated_at = now()
      where id = $1`,
    [caseId, text],
  );
  await addEvent(caseId, actorId, "case.note", { length: text.length });
  await writeAudit({
    actorId,
    action: "moderation.case.note",
    targetType: "case",
    targetId: caseId,
    details: { length: text.length },
  });
}

export async function readOverview(actorId: string): Promise<TrustOverview> {
  if (!(await canView(actorId))) throw new Error("réservé à la modération");
  const pool = getPostgresPool();
  const [policy, counts, metrics, engines, recent] = await Promise.all([
    pool.query<{
      version: string;
      active: boolean;
      activated_at: string | null;
      categories: Record<string, unknown>;
      thresholds: Record<string, unknown>;
    }>(
      `select version, active, activated_at, categories, thresholds
         from public.moderation_policy_versions
        where active limit 1`,
    ),
    pool.query<{
      open: string;
      urgent: string;
      unassigned: string;
      actioned: string;
      no_violation: string;
      appeals_pending: string;
      sanctions_active: string;
    }>(
      `select
         (select count(*) from public.moderation_cases where status in ('open','triaged','investigating'))::text as open,
         (select count(*) from public.moderation_cases where priority = 'urgent' and status in ('open','triaged','investigating'))::text as urgent,
         (select count(*) from public.moderation_cases where assigned_to is null and status in ('open','triaged','investigating'))::text as unassigned,
         (select count(*) from public.moderation_cases where status = 'actioned')::text as actioned,
         (select count(*) from public.moderation_cases where status = 'no_violation')::text as no_violation,
         (select count(*) from public.sanction_appeals where status = 'pending')::text as appeals_pending,
         (select count(*) from public.user_sanctions where status = 'active')::text as sanctions_active`,
    ),
    pool.query<{ triage: string | null; appeals: string; overturns: string; sanctions: string }>(
      `select
         (select avg(extract(epoch from (resolved_at - created_at)) / 60)
            from public.moderation_cases where resolved_at is not null)::text as triage,
         (select count(*) from public.sanction_appeals)::text as appeals,
         (select count(*) from public.sanction_appeals where status = 'overturned')::text as overturns,
         (select count(*) from public.user_sanctions)::text as sanctions`,
    ),
    pool.query<{
      engine: string;
      runs: string;
      holds: string;
      failures: string;
      avg_latency_ms: string | null;
    }>(
      `select engine,
              count(*)::text as runs,
              count(*) filter (where decision = 'hold')::text as holds,
              count(*) filter (where status in ('failed','partial'))::text as failures,
              avg(latency_ms)::text as avg_latency_ms
         from public.moderation_engine_runs
        group by engine
        order by count(*) desc
        limit 12`,
    ),
    pool.query<ModerationCase>(
      `${CASE_SELECT}
       where c.status in ('open','triaged','investigating')
       order by
         case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
         c.created_at asc
       limit 25`,
    ),
  ]);

  const row = counts.rows[0];
  const metric = metrics.rows[0];
  const appeals = Number(metric?.appeals ?? 0);
  const sanctions = Number(metric?.sanctions ?? 0);
  return {
    policy:
      policy.rows[0] ?? {
        version: "2026.11.1",
        active: true,
        activated_at: null,
        categories: {},
        thresholds: {},
      },
    counts: {
      open: Number(row?.open ?? 0),
      urgent: Number(row?.urgent ?? 0),
      unassigned: Number(row?.unassigned ?? 0),
      actioned: Number(row?.actioned ?? 0),
      no_violation: Number(row?.no_violation ?? 0),
      appeals_pending: Number(row?.appeals_pending ?? 0),
      sanctions_active: Number(row?.sanctions_active ?? 0),
    },
    triageMinutes: metric?.triage ? Math.round(Number(metric.triage)) : null,
    appealRate: sanctions > 0 ? Math.round((appeals / sanctions) * 100) / 100 : null,
    reversalRate: appeals > 0 ? Math.round((Number(metric?.overturns ?? 0) / appeals) * 100) / 100 : null,
    engines: engines.rows.map((engine) => ({
      engine: engine.engine,
      runs: Number(engine.runs),
      holds: Number(engine.holds),
      failures: Number(engine.failures),
      avg_latency_ms: engine.avg_latency_ms ? Math.round(Number(engine.avg_latency_ms)) : null,
    })),
    recent: recent.rows,
  };
}
