import { NextRequest, NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireModerator } from "@/lib/admin-server";
import { writeAudit } from "@/lib/admin-audit";
import {
  addModerationTerm,
  listModerationFlags,
  removeModerationTerm,
  resolveModerationFlag,
} from "@/lib/moderation/service";
import {
  blockImageHash,
  listBlockedImages,
  unblockImageHash,
} from "@/lib/moderation/image";
import type { ModerationCategory, ModerationSeverity } from "@/lib/moderation/text";
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";
import {
  addBlockedDomain,
  listBlockedDomains,
  removeBlockedDomain,
} from "@/lib/trust-safety/domains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Modération — la console qui manquait.
 *
 * Le moteur existait (`lib/moderation/*`), la base aussi (migration 073),
 * mais rien ne permettait de **relire** ce qu'il avait signalé ni de
 * décider. Une file de modération sans écran est une file qui grossit :
 * au bout de quelques jours, elle ne dit plus rien à personne.
 *
 * Cette route fait trois choses, et refuse tout le reste :
 *
 *  - lire la file, les termes administrables et les empreintes bannies ;
 *  - clore un signal (confirmé / écarté), avec journal et signal de sécurité ;
 *  - ajouter ou retirer un terme, bannir ou débannir une empreinte.
 *
 * Aucune suppression de contenu ici : `admin_delete_content` (module
 * Contenu) reste le seul chemin, avec son motif et son journal. Une console
 * de modération qui pourrait effacer contournerait la trace.
 */

const CATEGORIES: ReadonlySet<ModerationCategory> = new Set([
  "insult",
  "hate",
  "sexual",
  "violence",
  "scam",
  "drugs",
  "selfharm",
  "custom",
]);

const SEVERITIES: ReadonlySet<ModerationSeverity> = new Set([
  "info",
  "warning",
  "critical",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHASH = /^[0-9a-f]{16}$/i;

type Body = {
  action?: unknown;
  id?: unknown;
  decision?: unknown;
  term?: unknown;
  category?: unknown;
  severity?: unknown;
  phash?: unknown;
  reason?: unknown;
  domain?: unknown;
};

async function readModeration(status: "open" | "confirmed" | "dismissed" | "all") {
  const [flags, blocked, counts] = await Promise.all([
    listModerationFlags(status, 120).catch(() => []),
    listBlockedImages().catch(() => []),
    getPostgresPool()
      .query<{
        open: string;
        critical: string;
        confirmed: string;
        dismissed: string;
        terms: string;
      }>(
        `select
           (select count(*) from public.moderation_flags where status = 'open')::text as open,
           (select count(*) from public.moderation_flags
             where status = 'open' and severity = 'critical')::text as critical,
           (select count(*) from public.moderation_flags where status = 'confirmed')::text as confirmed,
           (select count(*) from public.moderation_flags where status = 'dismissed')::text as dismissed,
           (select count(*) from public.moderation_terms where active)::text as terms`,
      )
      .then((result) => result.rows[0] ?? null)
      .catch(() => null),
  ]);

  const terms = await getPostgresPool()
    .query<{
      id: string;
      term: string;
      category: ModerationCategory;
      severity: ModerationSeverity;
      created_at: string;
    }>(
      `select id, term, category, severity, created_at
         from public.moderation_terms
        where active
        order by created_at desc
        limit 200`,
    )
    .then((result) => result.rows)
    .catch(() => []);

  return {
    checkedAt: new Date().toISOString(),
    counts: {
      open: Number(counts?.open ?? 0),
      critical: Number(counts?.critical ?? 0),
      confirmed: Number(counts?.confirmed ?? 0),
      dismissed: Number(counts?.dismissed ?? 0),
      terms: Number(counts?.terms ?? terms.length),
      blocked: blocked.length,
    },
    flags,
    terms,
    blocked,
    domains: await listBlockedDomains().catch(() => []),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const admin = await requireModerator("view");
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  const requested = request.nextUrl.searchParams.get("status") ?? "open";
  const status =
    requested === "all" || requested === "confirmed" || requested === "dismissed"
      ? requested
      : "open";

  try {
    return NextResponse.json(await readModeration(status), { headers: ADMIN_NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "file de modération indisponible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const admin = await requireModerator("moderate");
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "corps illisible" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  const audit = await (async () => {
    switch (body.action) {
      case "resolve-flag": {
        const id = typeof body.id === "string" ? body.id : "";
        const decision = body.decision === "confirmed" ? "confirmed" : body.decision === "dismissed" ? "dismissed" : null;
        if (!UUID.test(id) || !decision) {
          return { status: 400, error: "identifiant ou décision invalide" } as const;
        }
        try {
          await resolveModerationFlag(id, decision, admin.userId);
        } catch {
          return { status: 404, error: "signal introuvable ou déjà clos" } as const;
        }
        // `resolveModerationFlag` journalise déjà ; on ajoute le résultat au
        // rapport pour que l'écran sache si la trace a été écrite.
        return {
          status: 200,
          report: await writeAudit({
            actorId: admin.userId,
            action: `moderation.${decision}`,
            targetType: "flag",
            targetId: id,
          }),
        } as const;
      }

      case "add-term": {
        const term = typeof body.term === "string" ? body.term.trim() : "";
        const category = body.category;
        const severity = body.severity;
        if (
          term.length < 2
          || term.length > 80
          || typeof category !== "string"
          || !CATEGORIES.has(category as ModerationCategory)
          || typeof severity !== "string"
          || !SEVERITIES.has(severity as ModerationSeverity)
        ) {
          return { status: 400, error: "terme, catégorie ou gravité invalide" } as const;
        }
        try {
          await addModerationTerm({
            term,
            category: category as ModerationCategory,
            severity: severity as ModerationSeverity,
            actorId: admin.userId,
          });
        } catch {
          return { status: 503, error: "ajout du terme impossible" } as const;
        }
        return {
          status: 200,
          report: await writeAudit({
            actorId: admin.userId,
            action: "moderation.term.add",
            targetType: "term",
            targetId: term,
            details: { category, severity },
          }),
        } as const;
      }

      case "remove-term": {
        const term = typeof body.term === "string" ? body.term.trim() : "";
        if (term.length < 2 || term.length > 80) {
          return { status: 400, error: "terme invalide" } as const;
        }
        await removeModerationTerm(term).catch(() => undefined);
        return {
          status: 200,
          report: await writeAudit({
            actorId: admin.userId,
            action: "moderation.term.remove",
            targetType: "term",
            targetId: term,
          }),
        } as const;
      }

      case "block-media": {
        const phash = typeof body.phash === "string" ? body.phash.trim() : "";
        const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
        if (!PHASH.test(phash)) {
          return { status: 400, error: "empreinte invalide (16 caractères hexadécimaux)" } as const;
        }
        try {
          await blockImageHash(phash, reason || "décision de modération", admin.userId);
        } catch {
          return { status: 503, error: "bannissement de l'empreinte impossible" } as const;
        }
        return {
          status: 200,
          report: await writeAudit({
            actorId: admin.userId,
            action: "moderation.media.block",
            targetType: "media",
            targetId: phash,
            details: { reason },
          }),
        } as const;
      }

      case "unblock-media": {
        const phash = typeof body.phash === "string" ? body.phash.trim() : "";
        if (!PHASH.test(phash)) {
          return { status: 400, error: "empreinte invalide" } as const;
        }
        await unblockImageHash(phash).catch(() => undefined);
        return {
          status: 200,
          report: await writeAudit({
            actorId: admin.userId,
            action: "moderation.media.unblock",
            targetType: "media",
            targetId: phash,
          }),
        } as const;
      }

      case "block-domain": {
        const domain = typeof body.domain === "string" ? body.domain : "";
        const category =
          body.category === "malware" || body.category === "scam" || body.category === "other"
            ? body.category
            : "phishing";
        const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : "";
        try {
          const normalized = await addBlockedDomain({
            domain,
            category,
            reason,
            actorId: admin.userId,
          });
          return { status: 200, report: { ok: true, domain: normalized } } as const;
        } catch (error) {
          return {
            status: 400,
            error: error instanceof Error ? error.message : "domaine invalide",
          } as const;
        }
      }

      case "unblock-domain": {
        const domain = typeof body.domain === "string" ? body.domain : "";
        try {
          await removeBlockedDomain(admin.userId, domain);
          return { status: 200, report: { ok: true } } as const;
        } catch (error) {
          return {
            status: 400,
            error: error instanceof Error ? error.message : "domaine invalide",
          } as const;
        }
      }

      default:
        return {
          status: 400,
          error:
            "action inconnue (resolve-flag, add-term, remove-term, block-media, unblock-media, block-domain, unblock-domain)",
        } as const;
    }
  })();

  if ("error" in audit) {
    return NextResponse.json(
      { error: audit.error },
      { status: audit.status, headers: ADMIN_NO_STORE },
    );
  }

  const [state] = await Promise.all([
    readModeration("open").catch(() => null),
  ]);

  return NextResponse.json(
    { ok: true, audit: audit.report, moderation: state },
    { headers: ADMIN_NO_STORE },
  );
}

