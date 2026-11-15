/**
 * Moteur de liens.
 *
 * Il ne visite **aucune URL**. Une requête sortante depuis le serveur
 * pour « vérifier » un lien est une SSRF : elle permet de faire parler
 * le serveur à un service interne, et elle rend la modération dépendante
 * d'un tiers. On juge donc la forme du lien, et on consulte une liste de
 * domaines bloqués tenue par des humains.
 *
 * Ce que le moteur attrape :
 *   - un identifiant en clair dans l'URL (`user:password@`) ;
 *   - une adresse IP littérale, qui contourne les listes de domaines ;
 *   - un raccourcisseur, qui cache la destination ;
 *   - un domaine `xn--` (homographe possible) ;
 *   - une marque connue placée en sous-domaine d'un domaine étranger ;
 *   - un domaine présent dans la liste de blocage.
 *
 * Un constat `review` n'empêche pas la publication. Un domaine bloqué,
 * lui, vaut `hold` : c'est une décision humaine antérieure.
 */

import { domainToASCII, domainToUnicode } from "node:url";
import type { TrustFinding } from "../policy";

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const SHORTENERS = new Set([
  "bit.ly", "t.co", "tinyurl.com", "goo.gl", "ow.ly", "is.gd", "buff.ly",
  "rebrand.ly", "cutt.ly", "shorturl.at", "t.ly", "s.id", "lnkd.in",
]);
const SUSPICIOUS_TLDS = new Set([
  "zip", "mov", "top", "xin", "gq", "tk", "ml", "cf", "work", "click",
  "country", "stream", "download", "review", "science", "party", "gdn",
]);
const BRANDS = [
  "paypal", "apple", "microsoft", "google", "amazon", "netflix", "instagram",
  "facebook", "whatsapp", "telegram", "binance", "coinbase", "metamask",
  "devnet",
];

export type LinkInspection = {
  findings: TrustFinding[];
  domains: string[];
};

function normalizeHost(host: string): string {
  const ascii = domainToASCII(host.toLowerCase());
  return ascii || host.toLowerCase();
}

function isIpLiteral(host: string): boolean {
  const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
  const ipv6 = /^\[[0-9a-f:]+\]$/i;
  return ipv4.test(host) || ipv6.test(host);
}

function brandInSubdomain(host: string): string | null {
  const labels = host.split(".");
  if (labels.length < 3) return null;
  const base = labels.slice(-2).join(".");
  const withoutTld = labels.slice(0, -2).join(".");
  for (const brand of BRANDS) {
    if (withoutTld.includes(brand) && !base.startsWith(`${brand}.`)) return brand;
  }
  return null;
}

/**
 * Extrait les URL d'un texte, avec la ponctuation finale retirée.
 *
 * Un point final ou une parenthèse fermante appartient rarement à
 * l'URL, et la garder ferait échouer la reconnaissance du domaine.
 */
export function extractLinks(text: string): string[] {
  const found = text.match(URL_PATTERN) ?? [];
  const cleaned = found.map((raw) =>
    raw.replace(/[),.;:!?]+$/g, "").replace(/^www\./i, "https://www."),
  );
  return [...new Set(cleaned)].slice(0, 20);
}

export function inspectLinks(
  text: string,
  blockedDomains: readonly string[] = [],
): LinkInspection {
  const findings: TrustFinding[] = [];
  const domains: string[] = [];
  const blocked = new Set(blockedDomains.map((domain) => normalizeHost(domain)));

  for (const raw of extractLinks(text)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      findings.push({
        engine: "link",
        category: "other",
        severity: "info",
        score: 0.3,
        explanationCode: "link.malformed",
        evidence: { length: raw.length },
      });
      continue;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") continue;

    const host = normalizeHost(url.hostname);
    domains.push(host);

    if (blocked.has(host) || [...blocked].some((domain) => host.endsWith(`.${domain}`))) {
      findings.push({
        engine: "link",
        category: url.protocol === "http:" ? "malware" : "scam",
        severity: "critical",
        score: 1,
        explanationCode: "link.blocked_domain",
        evidence: { domain: host },
      });
      continue;
    }

    if (url.username || url.password) {
      findings.push({
        engine: "link",
        category: "secret",
        severity: "critical",
        score: 0.95,
        explanationCode: "link.credentials_in_url",
        evidence: { domain: host },
      });
    }

    if (isIpLiteral(url.hostname)) {
      findings.push({
        engine: "link",
        category: "scam",
        severity: "warning",
        score: 0.7,
        explanationCode: "link.ip_literal",
        evidence: { domain: host },
      });
    }

    if (SHORTENERS.has(host)) {
      findings.push({
        engine: "link",
        category: "scam",
        severity: "warning",
        score: 0.6,
        explanationCode: "link.shortener",
        evidence: { domain: host },
      });
    }

    if (host.startsWith("xn--") || /[^\x00-\x7f]/.test(url.hostname)) {
      findings.push({
        engine: "link",
        category: "impersonation",
        severity: "warning",
        score: 0.55,
        explanationCode: "link.punycode",
        evidence: {
          domain: host,
          unicode: (() => {
            try {
              return domainToUnicode(host);
            } catch {
              return host;
            }
          })(),
        },
      });
    }

    const brand = brandInSubdomain(host);
    if (brand) {
      findings.push({
        engine: "link",
        category: "impersonation",
        severity: "critical",
        score: 0.9,
        explanationCode: "link.brand_subdomain",
        evidence: { domain: host, brand },
      });
    }

    const tld = host.split(".").pop() ?? "";
    if (SUSPICIOUS_TLDS.has(tld) && url.protocol === "http:") {
      findings.push({
        engine: "link",
        category: "scam",
        severity: "warning",
        score: 0.5,
        explanationCode: "link.suspicious_tld_http",
        evidence: { domain: host, tld },
      });
    }

    if (url.protocol === "http:") {
      findings.push({
        engine: "link",
        category: "other",
        severity: "info",
        score: 0.35,
        explanationCode: "link.no_tls",
        evidence: { domain: host },
      });
    }
  }

  return { findings, domains: [...new Set(domains)] };
}
