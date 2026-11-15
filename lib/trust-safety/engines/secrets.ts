/**
 * Moteur de secrets exposés.
 *
 * Un jeton collé dans une publication est une fuite : il peut être lu
 * par n'importe qui, indexé, et il reste valable jusqu'à sa révocation.
 * Le moteur **ne conserve jamais le secret** : il ne rend que sa famille
 * et sa longueur. Le contenu d'origine n'est pas recopié dans un constat
 * ni dans une preuve.
 *
 * Les motifs sont volontairement stricts. Un faux positif sur un
 * extrait de code pédagogique coûte cher ; un motif large transformerait
 * chaque tutoriel d'API en dossier de modération.
 */

import type { TrustFinding } from "../policy";

type SecretPattern = {
  name: string;
  pattern: RegExp;
  /** Un extrait de code peut contenir un faux exemple : score plus bas. */
  confidence: number;
};

const PATTERNS: SecretPattern[] = [
  {
    name: "private_key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    confidence: 0.99,
  },
  {
    name: "aws_access_key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    confidence: 0.98,
  },
  {
    name: "github_token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/,
    confidence: 0.97,
  },
  {
    name: "stripe_secret",
    pattern: /\bsk_live_[0-9A-Za-z]{20,}\b/,
    confidence: 0.98,
  },
  {
    name: "openai_key",
    pattern: /\bsk-[A-Za-z0-9_-]{40,}\b/,
    confidence: 0.9,
  },
  {
    name: "slack_token",
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/,
    confidence: 0.96,
  },
  {
    name: "google_api_key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
    confidence: 0.95,
  },
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    confidence: 0.75,
  },
  {
    name: "database_url",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/i,
    confidence: 0.93,
  },
];

export function inspectSecrets(text: string): TrustFinding[] {
  const findings: TrustFinding[] = [];
  for (const pattern of PATTERNS) {
    if (!pattern.pattern.test(text)) continue;
    findings.push({
      engine: "secret",
      category: "secret",
      severity: "critical",
      score: pattern.confidence,
      explanationCode: `secret.${pattern.name}`,
      // On ne rend ni la valeur, ni un extrait, ni un préfixe : un préfixe
      // de clé suffit parfois à réduire l'espace de recherche.
      evidence: { family: pattern.name },
    });
  }
  return findings;
}
