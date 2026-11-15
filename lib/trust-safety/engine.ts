/**
 * Orchestrateur des moteurs.
 *
 * Chaque moteur rend des constats ; l'orchestrateur les rassemble, lit la
 * politique active et rend une décision. Les constats sont écrits dans le
 * dossier, avec le moteur, la version du fournisseur et la latence. C'est
 * ce qui permet de répondre plus tard à « pourquoi ce contenu a-t-il été
 * retenu » sans relire le contenu lui-même.
 */
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";
import { evaluateText } from "@/lib/moderation/service";
import { inspectLinks } from "./engines/link";
import { inspectSecrets } from "./engines/secrets";
import {
  decide,
  normalizePolicy,
  type Policy,
  type TrustCategory,
  type TrustFinding,
  type TrustSeverity,
} from "./policy";
import { attachDecision } from "./cases";

let policyCache: { at: number; policy: Policy } | null = null;
const POLICY_TTL_MS = 60_000;

export async function activePolicy(): Promise<Policy> {
  if (policyCache && Date.now() - policyCache.at < POLICY_TTL_MS) return policyCache.policy;
  try {
    const result = await getPostgresPool().query<{
      version: string;
      categories: unknown;
      thresholds: unknown;
    }>(
      `select version, categories, thresholds
         from public.moderation_policy_versions
        where active limit 1`,
    );
    const row = result.rows[0];
    const policy = normalizePolicy(row ?? undefined);
    policyCache = { at: Date.now(), policy };
    return policy;
  } catch {
    const policy = normalizePolicy(undefined);
    policyCache = { at: Date.now(), policy };
    return policy;
  }
}

export function invalidatePolicyCache(): void {
  policyCache = null;
}

function mapCategory(category: string): TrustCategory {
  switch (category) {
    case "selfharm":
      return "self_harm";
    case "drugs":
      return "other";
    case "custom":
      return "other";
    default:
      return category as TrustCategory;
  }
}

function severityScore(severity: TrustSeverity): number {
  return severity === "critical" ? 0.95 : severity === "warning" ? 0.65 : 0.3;
}

/**
 * Analyse pure d'un texte : liste de termes, liens, secrets.
 *
 * Elle ne touche pas la base. C'est ce qui permet à la passerelle REST de
 * refuser avant l'insertion, et aux tests de tourner sans PostgreSQL.
 */
export async function inspectText(
  text: string,
  blockedDomains: readonly string[] = [],
): Promise<TrustFinding[]> {
  const findings: TrustFinding[] = [];
  const started = Date.now();
  try {
    const result = await evaluateText(text);
    for (const match of result.matches) {
      const category = mapCategory(match.category);
      findings.push({
        engine: "text",
        category,
        severity: match.severity,
        score: severityScore(match.severity),
        explanationCode: `text.${match.category}`,
        evidence: { rule: match.category, matches: result.matches.length },
        provider: "local-rules",
        providerVersion: "2026.11",
        latencyMs: Date.now() - started,
      });
    }
  } catch {
    // Un moteur en panne ne doit pas bloquer une publication : il ne
    // produit simplement aucun constat, et l'absence est visible dans les
    // exécutions (aucune ligne pour ce moteur).
  }

  findings.push(...inspectLinks(text, blockedDomains).findings);
  findings.push(...inspectSecrets(text));
  return findings;
}

export type TextAnalysis = {
  findings: TrustFinding[];
  decision: ReturnType<typeof decide>;
};

/** Analyse complète d'un texte, politique comprise. */
export async function analyzeText(
  text: string,
  context: { reportCount?: number; accountAgeHours?: number | null; targetType?: string } = {},
  blockedDomains: readonly string[] = [],
): Promise<TextAnalysis> {
  const policy = await activePolicy();
  const findings = await inspectText(text, blockedDomains);
  return { findings, decision: decide(findings, context, policy) };
}

/** Après une écriture : rattache les constats au dossier de la cible. */
export async function analyzeWrittenText(input: {
  targetType: string;
  targetId: string;
  text: string;
  authorId: string;
}): Promise<{ decision: string; caseId: string | null }> {
  try {
    const [analysis, behavior] = await Promise.all([
      analyzeText(input.text, { targetType: input.targetType }),
      inspectBehavior(input.authorId),
    ]);
    const policy = await activePolicy();
    const all = [...analysis.findings, ...behavior];
    const decision = decide(all, { targetType: input.targetType }, policy);
    const caseId = await attachDecision({
      targetType: input.targetType,
      targetId: input.targetId,
      result: decision,
      authorId: input.authorId,
    });
    return { decision: decision.decision, caseId };
  } catch (error) {
    console.error(
      "[trust] analyse post-écriture impossible",
      error instanceof Error ? error.message : String(error),
    );
    return { decision: "unknown", caseId: null };
  }
}

/** Analyse d'un média après stockage, à partir des résultats déjà calculés. */
export async function analyzeMedia(input: {
  targetId: string;
  authorId: string;
  kind: "image" | "video";
  phash: string | null;
  skinRatio?: number | null;
  review?: { severity: "warning" | "critical"; reason: string } | null;
  blocked?: boolean;
  transcoded?: boolean;
  originMime?: string;
}): Promise<{ decision: string; caseId: string | null }> {
  const findings: TrustFinding[] = [];
  const engine = input.kind === "video" ? "video" : "vision";

  if (input.blocked) {
    findings.push({
      engine,
      category: "sexual",
      severity: "critical",
      score: 1,
      explanationCode: `${engine}.blocked_hash`,
      evidence: { phash: input.phash ? "present" : "absent" },
    });
  } else if (input.review) {
    findings.push({
      engine,
      category: "sexual",
      severity: input.review.severity,
      score: input.review.severity === "critical" ? 0.9 : 0.6,
      explanationCode: `${engine}.skin_ratio`,
      evidence: {
        skin_ratio:
          typeof input.skinRatio === "number" ? Math.round(input.skinRatio * 100) / 100 : null,
      },
    });
  }

  if (input.kind === "video" && input.transcoded === false && /hevc|h265|av1/i.test(input.originMime ?? "")) {
    findings.push({
      engine: "video",
      category: "other",
      severity: "info",
      score: 0.4,
      explanationCode: "video.not_transcoded",
      evidence: { origin_mime: input.originMime },
    });
  }

  const policy = await activePolicy();
  const decision = decide(findings, { targetType: "media" }, policy);
  const caseId = await attachDecision({
    targetType: "media",
    targetId: input.targetId,
    result: decision,
    authorId: input.authorId,
  });
  return { decision: decision.decision, caseId };
}

/**
 * Comportement : volume, ancienneté, signalements reçus.
 *
 * Ce moteur ne juge pas un compte, il signale une **forme** : une rafale
 * de messages identiques vers des inconnus, un compte de dix minutes qui
 * publie trente fois, trois personnes différentes qui signalent la même
 * cible. Une forme n'est pas une preuve, et elle ne déclenche jamais de
 * sanction seule.
 */
export async function inspectBehavior(userId: string): Promise<TrustFinding[]> {
  try {
    const result = await getPostgresPool().query<{
      age_hours: string | null;
      posts_recent: string;
      comments_recent: string;
      messages_recent: string;
      distinct_recipients: string;
      reports_recent: string;
      distinct_reporters: string;
    }>(
      `select
         extract(epoch from (now() - coalesce(u.created_at, now()))) / 3600 as age_hours,
         (select count(*) from public.posts p
           where p.author_id = u.id and p.created_at > now() - interval '1 hour')::text as posts_recent,
         (select count(*) from public.comments c
           where c.author_id = u.id and c.created_at > now() - interval '1 hour')::text as comments_recent,
         (select count(*) from public.direct_messages m
           where m.author_id = u.id and m.created_at > now() - interval '1 hour')::text as messages_recent,
         (select count(distinct cm.user_id) from public.direct_messages m
            join public.conversation_members cm on cm.conversation_id = m.conversation_id
           where m.author_id = u.id and m.created_at > now() - interval '1 hour')::text as distinct_recipients,
         (select count(*) from public.reports r
           where r.created_at > now() - interval '24 hours'
             and (
               exists (select 1 from public.posts p where p.id = r.post_id and p.author_id = u.id)
               or exists (select 1 from public.comments c where c.id = r.comment_id and c.author_id = u.id)
               or exists (select 1 from public.group_messages g where g.id = r.message_id and g.author_id = u.id)
               or exists (select 1 from public.stories s where s.id = r.story_id and s.author_id = u.id)
               or exists (select 1 from public.direct_messages d where d.id = r.direct_message_id and d.author_id = u.id)
             )
         )::text as reports_recent,
         (select count(distinct r.reporter_id) from public.reports r
           where r.created_at > now() - interval '24 hours'
             and (
               exists (select 1 from public.posts p where p.id = r.post_id and p.author_id = u.id)
               or exists (select 1 from public.comments c where c.id = r.comment_id and c.author_id = u.id)
               or exists (select 1 from public.group_messages g where g.id = r.message_id and g.author_id = u.id)
               or exists (select 1 from public.stories s where s.id = r.story_id and s.author_id = u.id)
               or exists (select 1 from public.direct_messages d where d.id = r.direct_message_id and d.author_id = u.id)
             )
         )::text as distinct_reporters
       from public.users u
      where u.id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return [];

    const age = row.age_hours === null ? null : Number(row.age_hours);
    const posts = Number(row.posts_recent);
    const comments = Number(row.comments_recent);
    const messages = Number(row.messages_recent);
    const recipients = Number(row.distinct_recipients);
    const reports = Number(row.reports_recent);
    const reporters = Number(row.distinct_reporters);
    const findings: TrustFinding[] = [];

    if (posts + comments > 40) {
      findings.push({
        engine: "behavior",
        category: "spam",
        severity: "warning",
        score: 0.7,
        explanationCode: "behavior.publish_burst",
        evidence: { posts, comments },
      });
    }
    if (age !== null && age < 24 && posts + comments > 12) {
      findings.push({
        engine: "behavior",
        category: "spam",
        severity: "warning",
        score: 0.65,
        explanationCode: "behavior.new_account_burst",
        evidence: { age_hours: Math.round(age), posts, comments },
      });
    }
    if (messages > 60 && recipients > 15) {
      findings.push({
        engine: "behavior",
        category: "spam",
        severity: "warning",
        score: 0.8,
        explanationCode: "behavior.message_burst",
        evidence: { messages, recipients },
      });
    }
    if (reporters >= 3) {
      findings.push({
        engine: "behavior",
        category: "other",
        severity: "warning",
        score: 0.75,
        explanationCode: "behavior.report_velocity",
        evidence: { reports, reporters },
      });
    }

    return findings;
  } catch {
    return [];
  }
}

/** Domaines bloqués, lus par le moteur de liens. */
export async function blockedDomains(): Promise<string[]> {
  try {
    const result = await getPostgresPool().query<{ domain: string }>(
      "select domain from public.moderation_blocked_domains order by created_at desc limit 5000",
    );
    return result.rows.map((row) => row.domain);
  } catch {
    return [];
  }
}
