/**
 * Moteurs et Policy Engine, sans base de données.
 *
 * Ces vérifications prouvent trois choses : une catégorie critique ne peut
 * pas être publiée sans revue, un contenu propre n'ouvre aucun dossier, et
 * aucune politique ne peut activer une suppression ou un bannissement
 * automatique. Elles ne remplacent pas le test PostgreSQL : elles isolent
 * la décision de la persistance.
 */
import assert from "node:assert/strict";
import {
  DEFAULT_POLICY,
  decide,
  normalizePolicy,
  type TrustFinding,
} from "../lib/trust-safety/policy";
import { inspectLinks } from "../lib/trust-safety/engines/link";
import { inspectSecrets } from "../lib/trust-safety/engines/secrets";

let checks = 0;
function ok(label: string, condition: boolean): void {
  assert.ok(condition, label);
  checks += 1;
  console.log(`✓ ${label}`);
}

const finding = (over: Partial<TrustFinding> = {}): TrustFinding => ({
  engine: "text",
  category: "insult",
  severity: "warning",
  score: 0.9,
  explanationCode: "text.insult",
  ...over,
});

const clean = decide([], {}, DEFAULT_POLICY);
ok("0. un texte sans constat est autorisé", clean.decision === "allow" && clean.score === 0);

const insult = decide([finding()], {}, DEFAULT_POLICY);
ok("1. une insulte certaine est retenue avant publication", insult.decision === "hold");

const spam = decide(
  [finding({ category: "spam", severity: "warning", score: 0.6 })],
  {},
  DEFAULT_POLICY,
);
ok("2. un spam douteux part en revue sans bloquer", spam.decision === "review");

const minor = decide(
  [finding({ category: "minor_safety", severity: "critical", score: 0.99 })],
  {},
  DEFAULT_POLICY,
);
ok(
  "3. la sécurité des mineurs est urgente et retenue",
  minor.decision === "hold" && minor.priority === "urgent" && minor.severity === "critical",
);

const escalated = decide(
  [finding({ category: "spam", severity: "warning", score: 0.5 })],
  { reportCount: DEFAULT_POLICY.thresholds.escalateReports },
  DEFAULT_POLICY,
);
ok("4. la répétition de signalements transforme la revue en retenue", escalated.decision === "hold");

const cleanAccount = decide([], { accountAgeHours: 0.2 }, DEFAULT_POLICY);
ok("5. un compte neuf n'est jamais coupable à lui seul", cleanAccount.decision === "allow");

const malicious = normalizePolicy({
  version: "test",
  thresholds: { hold_at: 2, review_at: -1, escalate_reports: 1, auto_remove: true, auto_ban: true },
  categories: { insult: { severity: "critical", auto: "block" } },
});
ok(
  "6. une politique ne peut pas activer la suppression ni le bannissement automatique",
  malicious.thresholds.autoRemove === false
    && malicious.thresholds.autoBan === false
    && malicious.thresholds.holdAt === 1
    && malicious.thresholds.reviewAt === 0,
);

const credentials = inspectLinks("voir https://user:secret@example.com/page");
ok(
  "7. un identifiant dans une URL est un secret critique",
  credentials.findings.some(
    (item) => item.category === "secret" && item.severity === "critical",
  ),
);

const brand = inspectLinks("https://paypal.com.security-check.example/login");
ok(
  "8. une marque en sous-domaine étranger est une usurpation",
  brand.findings.some((item) => item.explanationCode === "link.brand_subdomain"),
);

const blocked = inspectLinks("https://mal.example/x", ["mal.example"]);
ok(
  "9. un domaine bloqué par un humain impose la retenue",
  decide(blocked.findings, {}, DEFAULT_POLICY).decision === "hold",
);

const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
const secrets = inspectSecrets(`mon jeton ${token}`);
const serialized = JSON.stringify(secrets);
ok(
  "10. un jeton est détecté sans être recopié dans la preuve",
  secrets.some((item) => item.explanationCode === "secret.github_token")
    && !serialized.includes(token),
);

const ip = inspectLinks("http://192.168.1.10/admin");
ok(
  "11. une IP littérale en HTTP est signalée",
  ip.findings.some((item) => item.explanationCode === "link.ip_literal"),
);

const malformed = inspectLinks("https://exa mple .com");
ok(
  "12. un lien mal formé ne fait pas planter le moteur",
  Array.isArray(malformed.findings) && malformed.findings.length === 0,
);

console.log(`\n✓ Trust & Safety : ${checks} vérifications moteurs et politique.`);
