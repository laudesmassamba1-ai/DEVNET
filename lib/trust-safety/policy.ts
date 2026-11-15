/**
 * Policy Engine.
 *
 * Une politique est une **donnée versionnée**, pas une suite de `if`
 * dispersés dans les routes. Le moteur prend des constats et rend une
 * décision unique, avec la version qui l'a produite. C'est ce qui permet
 * de rejouer une décision passée et de dire pourquoi elle a été prise.
 *
 * Ce que le moteur ne fait jamais :
 *   - supprimer du contenu ;
 *   - bannir un compte ;
 *   - publier une accusation.
 *
 * Une décision `hold` empêche la publication et ouvre un dossier. Une
 * décision `review` laisse publier et ouvre un dossier. Un humain décide
 * ensuite. Une machine qui condamne sans preuve n'est pas de la
 * modération, c'est une panne.
 */

export type TrustEngine = "text" | "vision" | "video" | "link" | "behavior" | "secret";

export type TrustSeverity = "info" | "warning" | "critical";

export type TrustCategory =
  | "insult"
  | "hate"
  | "sexual"
  | "violence"
  | "threat"
  | "self_harm"
  | "scam"
  | "spam"
  | "minor_safety"
  | "secret"
  | "malware"
  | "doxxing"
  | "impersonation"
  | "other";

export type TrustFinding = {
  engine: TrustEngine;
  category: TrustCategory;
  severity: TrustSeverity;
  /** 0..1. Un constat sans score vaut 1 : la règle est certaine. */
  score?: number;
  explanationCode: string;
  /** Références, jamais le contenu sensible lui-même. */
  evidence?: Record<string, unknown>;
  provider?: string;
  providerVersion?: string;
  latencyMs?: number;
};

export type PolicyDecision = "allow" | "review" | "hold";

export type PolicyCategoryRule = {
  severity: TrustSeverity;
  /** `block`, `hold`, `review` ou `allow`. */
  auto: "block" | "hold" | "review" | "allow";
};

export type Policy = {
  version: string;
  categories: Record<string, PolicyCategoryRule>;
  thresholds: {
    holdAt: number;
    reviewAt: number;
    escalateReports: number;
    autoRemove: false;
    autoBan: false;
  };
};

export type PolicyContext = {
  /** Nombre de signalements distincts déjà reçus sur cette cible. */
  reportCount?: number;
  /** Âge du compte en heures, quand il est connu. */
  accountAgeHours?: number | null;
  /** Un contenu neuf d'un compte neuf est plus souvent du spam. */
  targetType?: string;
};

export type PolicyResult = {
  decision: PolicyDecision;
  severity: TrustSeverity;
  score: number;
  priority: "low" | "normal" | "high" | "urgent";
  policyVersion: string;
  reasons: TrustCategory[];
  explanationCodes: string[];
  findings: TrustFinding[];
  /** Une recommandation, jamais une sanction appliquée automatiquement. */
  recommendedSanction: null | {
    kind: "warning" | "restrict" | "suspend";
    days: number | null;
    reasonCode: string;
  };
  notifyModeration: boolean;
};

/**
 * Repli local de la politique active.
 *
 * Il est identique à la ligne `2026.11.1` de la migration 076. Le serveur
 * ne doit pas rester sans politique si la base est indisponible ; la
 * version rendue reste celle du repli, et l'écran peut le dire.
 */
export const DEFAULT_POLICY: Policy = {
  version: "2026.11.1",
  categories: {
    insult: { severity: "warning", auto: "block" },
    hate: { severity: "critical", auto: "block" },
    sexual: { severity: "critical", auto: "block" },
    violence: { severity: "critical", auto: "hold" },
    threat: { severity: "critical", auto: "hold" },
    self_harm: { severity: "critical", auto: "review" },
    scam: { severity: "warning", auto: "review" },
    spam: { severity: "warning", auto: "review" },
    minor_safety: { severity: "critical", auto: "hold" },
    secret: { severity: "critical", auto: "hold" },
    malware: { severity: "critical", auto: "hold" },
    doxxing: { severity: "critical", auto: "review" },
    other: { severity: "info", auto: "review" },
  },
  thresholds: {
    holdAt: 0.85,
    reviewAt: 0.45,
    escalateReports: 3,
    autoRemove: false,
    autoBan: false,
  },
};

const CATEGORIES = new Set<string>(Object.keys(DEFAULT_POLICY.categories));

function severityRank(value: TrustSeverity): number {
  return value === "critical" ? 2 : value === "warning" ? 1 : 0;
}

function maxSeverity(left: TrustSeverity, right: TrustSeverity): TrustSeverity {
  return severityRank(right) > severityRank(left) ? right : left;
}

/** Lit une politique venue de la base, sans faire confiance à sa forme. */
export function normalizePolicy(input: unknown): Policy {
  if (!input || typeof input !== "object") return DEFAULT_POLICY;
  const row = input as {
    version?: unknown;
    categories?: unknown;
    thresholds?: unknown;
  };
  const version =
    typeof row.version === "string" && row.version.trim().length > 0
      ? row.version.trim().slice(0, 40)
      : DEFAULT_POLICY.version;

  const categories: Record<string, PolicyCategoryRule> = {};
  if (row.categories && typeof row.categories === "object") {
    for (const [key, raw] of Object.entries(row.categories as Record<string, unknown>)) {
      if (!CATEGORIES.has(key) || !raw || typeof raw !== "object") continue;
      const rule = raw as { severity?: unknown; auto?: unknown };
      const severity: TrustSeverity =
        rule.severity === "critical" || rule.severity === "warning" || rule.severity === "info"
          ? rule.severity
          : DEFAULT_POLICY.categories[key]?.severity ?? "warning";
      const auto =
        rule.auto === "block" || rule.auto === "hold" || rule.auto === "review" || rule.auto === "allow"
          ? rule.auto
          : DEFAULT_POLICY.categories[key]?.auto ?? "review";
      categories[key] = { severity, auto };
    }
  }

  const thresholds = row.thresholds && typeof row.thresholds === "object"
    ? (row.thresholds as Record<string, unknown>)
    : {};
  const number = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : fallback;

  return {
    version,
    categories: { ...DEFAULT_POLICY.categories, ...categories },
    thresholds: {
      holdAt: number(thresholds.hold_at, DEFAULT_POLICY.thresholds.holdAt),
      reviewAt: number(thresholds.review_at, DEFAULT_POLICY.thresholds.reviewAt),
      escalateReports:
        typeof thresholds.escalate_reports === "number" && thresholds.escalate_reports >= 1
          ? Math.min(100, Math.round(thresholds.escalate_reports))
          : DEFAULT_POLICY.thresholds.escalateReports,
      autoRemove: false,
      autoBan: false,
    },
  };
}

/**
 * Décide à partir d'un ensemble de constats.
 *
 * L'ordre des règles est volontaire :
 *  1. une catégorie critique impose `hold`, même seule ;
 *  2. un score au-dessus de `holdAt` impose `hold` ;
 *  3. la répétition de signalements transforme un `review` en `hold` ;
 *  4. tout le reste qui dépasse `reviewAt` reste `review`.
 *
 * `accountAgeHours` ne durcit jamais à lui seul : un compte neuf n'est
 * pas coupable. Il ne sert qu'à prioriser un dossier déjà fondé.
 */
export function decide(findings: TrustFinding[], context: PolicyContext = {}, policy: Policy = DEFAULT_POLICY): PolicyResult {
  const relevant = findings.filter((finding) => {
    const score = finding.score ?? 1;
    return score >= policy.thresholds.reviewAt;
  });

  if (relevant.length === 0) {
    return {
      decision: "allow",
      severity: "info",
      score: 0,
      priority: "low",
      policyVersion: policy.version,
      reasons: [],
      explanationCodes: [],
      findings,
      recommendedSanction: null,
      notifyModeration: false,
    };
  }

  let severity: TrustSeverity = "info";
  let score = 0;
  let decision: PolicyDecision = "allow";
  const reasons = new Set<TrustCategory>();
  const codes = new Set<string>();

  for (const finding of relevant) {
    severity = maxSeverity(severity, finding.severity);
    score = Math.max(score, finding.score ?? 1);
    reasons.add(finding.category);
    codes.add(finding.explanationCode);

    const rule = policy.categories[finding.category] ?? { severity: finding.severity, auto: "review" };
    const effectiveScore = finding.score ?? 1;

    if (rule.auto === "block" || rule.auto === "hold") {
      decision = "hold";
    } else if (rule.auto === "review" && decision === "allow") {
      decision = "review";
    }

    if (finding.severity === "critical" && effectiveScore >= policy.thresholds.holdAt) {
      decision = "hold";
    }

    // La sécurité des mineurs, un secret exposé et un malware sont les
    // trois cas où attendre la revue laisserait le mal se propager.
    if (
      finding.category === "minor_safety"
      || finding.category === "secret"
      || finding.category === "malware"
    ) {
      decision = "hold";
      severity = "critical";
    }
  }

  const reports = context.reportCount ?? 0;
  if (reports >= policy.thresholds.escalateReports && decision !== "allow") {
    decision = "hold";
  }

  let priority: PolicyResult["priority"] = "normal";
  if (severity === "critical") priority = "high";
  if (reasons.has("minor_safety") || reasons.has("secret") || reasons.has("malware")) {
    priority = "urgent";
  }
  if (decision === "review") priority = priority === "urgent" ? priority : "normal";
  if (decision === "allow") priority = "low";

  let recommendedSanction: PolicyResult["recommendedSanction"] = null;
  if (reasons.has("minor_safety") || reasons.has("secret") || reasons.has("malware")) {
    recommendedSanction = { kind: "suspend", days: 7, reasonCode: "minor_safety" };
  } else if (severity === "critical") {
    recommendedSanction = { kind: "restrict", days: 3, reasonCode: [...reasons][0] ?? "other" };
  } else if (reports >= policy.thresholds.escalateReports) {
    recommendedSanction = { kind: "warning", days: null, reasonCode: [...reasons][0] ?? "other" };
  }

  return {
    decision,
    severity,
    score,
    priority,
    policyVersion: policy.version,
    reasons: [...reasons],
    explanationCodes: [...codes],
    findings,
    recommendedSanction,
    notifyModeration: true,
  };
}
