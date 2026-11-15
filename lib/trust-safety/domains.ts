/**
 * Liste de domaines bloqués, tenue par des humains.
 *
 * Un domaine n'est jamais bloqué automatiquement : le moteur de liens
 * produit un constat, la modération décide. La liste est donc une preuve
 * de décisions passées, pas une liste de suspicion.
 */
import { domainToASCII } from "node:url";
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";
import { writeAudit } from "@/lib/admin-audit";

export type BlockedDomain = {
  domain: string;
  category: "phishing" | "malware" | "scam" | "other";
  reason: string;
  created_at: string;
};

const CATEGORIES = new Set(["phishing", "malware", "scam", "other"]);

export async function listBlockedDomains(): Promise<BlockedDomain[]> {
  const result = await getPostgresPool().query<BlockedDomain>(
    `select domain, category, reason, created_at
       from public.moderation_blocked_domains
      order by created_at desc
      limit 500`,
  );
  return result.rows;
}

function normalizeDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.length > 253) return null;
  let candidate = trimmed;
  try {
    candidate = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }
  const ascii = domainToASCII(candidate).toLowerCase();
  if (!ascii || ascii.length < 3 || !ascii.includes(".")) return null;
  if (!/^[a-z0-9.-]+$/.test(ascii)) return null;
  return ascii;
}

export async function addBlockedDomain(input: {
  domain: string;
  category: string;
  reason: string;
  actorId: string;
}): Promise<string> {
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new Error("domaine invalide");
  const category = CATEGORIES.has(input.category) ? input.category : "other";

  await getPostgresPool().query(
    `insert into public.moderation_blocked_domains (domain, category, reason, added_by)
     values ($1, $2, $3, $4)
     on conflict (domain) do update
       set category = excluded.category, reason = excluded.reason`,
    [domain, category, input.reason.trim().slice(0, 500), input.actorId],
  );
  await writeAudit({
    actorId: input.actorId,
    action: "moderation.domain.block",
    targetType: "domain",
    targetId: domain,
    details: { category },
  });
  return domain;
}

export async function removeBlockedDomain(actorId: string, domain: string): Promise<void> {
  const normalized = normalizeDomain(domain);
  if (!normalized) throw new Error("domaine invalide");
  await getPostgresPool().query(
    "delete from public.moderation_blocked_domains where domain = $1",
    [normalized],
  );
  await writeAudit({
    actorId,
    action: "moderation.domain.unblock",
    targetType: "domain",
    targetId: normalized,
  });
}
