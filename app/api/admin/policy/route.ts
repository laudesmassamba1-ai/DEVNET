/**
 * Éditeur de politique Trust & Safety.
 *
 * La politique est une donnée versionnée, jamais un `if` modifié à chaud.
 * Publier crée une **nouvelle** ligne et désactive l'ancienne dans la même
 * transaction : une décision passée garde la version qui l'a produite.
 *
 * Deux garde-fous restent hors de portée de l'éditeur :
 * `autoRemove` et `autoBan` sont forcés à `false`. Une machine ne supprime
 * pas un contenu et ne bannit pas un compte, même si quelqu'un coche une
 * case dans cette console.
 */
import { NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireModerator } from "@/lib/admin-server";
import { writeAudit } from "@/lib/admin-audit";
import { invalidatePolicyCache } from "@/lib/trust-safety/engine";
import { normalizePolicy, type Policy } from "@/lib/trust-safety/policy";
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = /^\d{4}\.\d{1,2}\.\d{1,2}$/;

type VersionRow = {
  version: string;
  active: boolean;
  categories: unknown;
  thresholds: unknown;
  notes: string;
  created_at: string;
  activated_at: string | null;
};

async function listVersions(userId: string): Promise<VersionRow[]> {
  return withUser(userId, (query) =>
    query<VersionRow>(
      `select version, active, categories, thresholds, notes,
              created_at::text as created_at,
              activated_at::text as activated_at
         from public.moderation_policy_versions
        order by created_at desc
        limit 50`,
    ),
  );
}

export async function GET(): Promise<NextResponse> {
  const access = await requireModerator("view");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: ADMIN_NO_STORE });
  }
  try {
    const versions = await listVersions(access.userId);
    const active = versions.find((row) => row.active);
    return NextResponse.json(
      {
        active: active ? normalizePolicy(active) : null,
        versions,
      },
      { headers: ADMIN_NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { error: "politiques illisibles" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireModerator("manage");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: ADMIN_NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "corps illisible" }, { status: 400, headers: ADMIN_NO_STORE });
  }

  const version = typeof body.version === "string" ? body.version.trim() : "";
  if (!VERSION.test(version)) {
    return NextResponse.json(
      { error: "version attendue au format AAAA.MM.N" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > 4_000) {
    return NextResponse.json({ error: "note trop longue" }, { status: 400, headers: ADMIN_NO_STORE });
  }

  const policy: Policy = normalizePolicy({
    version,
    categories: body.categories,
    thresholds: body.thresholds,
  });
  if (policy.thresholds.reviewAt >= policy.thresholds.holdAt) {
    return NextResponse.json(
      { error: "reviewAt doit rester inférieur à holdAt" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  const client = await getPostgresPool().connect();
  try {
    await client.query("begin");
    const previous = await client.query<{ version: string }>(
      "select version from public.moderation_policy_versions where active limit 1",
    );
    await client.query("update public.moderation_policy_versions set active = false where active");
    await client.query(
      `insert into public.moderation_policy_versions
         (version, active, categories, thresholds, notes, created_by, activated_at)
       values ($1, true, $2::jsonb, $3::jsonb, $4, $5, now())`,
      [
        policy.version,
        JSON.stringify(policy.categories),
        JSON.stringify({
          hold_at: policy.thresholds.holdAt,
          review_at: policy.thresholds.reviewAt,
          escalate_reports: policy.thresholds.escalateReports,
          auto_remove: false,
          auto_ban: false,
        }),
        notes,
        access.userId,
      ],
    );
    await client.query("commit");
    invalidatePolicyCache();

    const audit = await writeAudit({
      actorId: access.userId,
      action: "moderation.policy.publish",
      targetType: "moderation_policy",
      targetId: policy.version,
      details: {
        previous: previous.rows[0]?.version ?? null,
        notes,
        autoRemove: false,
        autoBan: false,
      },
    });

    return NextResponse.json(
      { ok: true, policy, audit },
      { headers: ADMIN_NO_STORE },
    );
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    const code = (error as { code?: string }).code;
    return NextResponse.json(
      {
        error: code === "23505"
          ? "cette version existe déjà"
          : "publication impossible",
      },
      { status: code === "23505" ? 409 : 503, headers: ADMIN_NO_STORE },
    );
  } finally {
    client.release();
  }
}
