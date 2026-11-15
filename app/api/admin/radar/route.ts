import { NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
import { writeAudit } from "@/lib/admin-audit";
import { runSentinels } from "@/lib/ai/sentinels";
import { checkDatabase } from "@/platform/infrastructure/postgres/pool";
import {
  failoverConfig,
  getFailoverState,
  inspectBothCached,
} from "@/platform/infrastructure/postgres/failover";
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Radar — l'état vivant de la plateforme, et le bouton des sentinelles.
 *
 * Le module ne faisait qu'une chose : appeler `/api/backend-check`. Il ne
 * disait ni sur quelle base on tournait, ni si les deux répondaient, ni ce
 * que les sentinelles avaient vu. C'est corrigé ici, sans inventer de
 * métriques : tout ce qui est affiché est mesuré à la requête.
 */
export async function GET(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  const [health, databases, alerts, incidents, lastRun] = await Promise.all([
    checkDatabase(2_000),
    inspectBothCached().catch(() => null),
    getPostgresPool()
      .query(
        `select id, kind, severity, subject, details, created_at
           from public.security_events
          order by created_at desc
          limit 25`,
      )
      .then((result) => result.rows)
      .catch(() => []),
    getPostgresPool()
      .query<{ open: string; critical: string }>(
        `select count(*) filter (where status <> 'resolved')::text as open,
                count(*) filter (where status <> 'resolved' and severity = 'critical')::text as critical
           from public.platform_incidents`,
      )
      .then((result) => result.rows[0] ?? { open: "0", critical: "0" })
      .catch(() => ({ open: "0", critical: "0" })),
    getPostgresPool()
      .query<{ created_at: string; details: Record<string, unknown>; severity: string }>(
        `select created_at, details, severity
           from public.security_events
          where kind = 'sentinel.run'
          order by created_at desc
          limit 1`,
      )
      .then((result) => result.rows[0] ?? null)
      .catch(() => null),
  ]);

  return NextResponse.json(
    {
      checkedAt: new Date().toISOString(),
      database: health,
      config: failoverConfig(),
      failover: getFailoverState(),
      databases,
      alerts,
      incidents: {
        open: Number(incidents.open ?? 0),
        critical: Number(incidents.critical ?? 0),
      },
      lastSentinelRun: lastRun,
    },
    { headers: ADMIN_NO_STORE },
  );
}

export async function POST(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  const report = await runSentinels();
  const audit = await writeAudit({
    actorId: admin.userId,
    action: "platform.sentinels.run",
    targetType: "platform",
    targetId: "sentinels",
    details: {
      findings: report.findings.length,
      critical: report.findings.filter((finding) => finding.severity === "critical").length,
      scanned: report.scanned,
    },
  });

  return NextResponse.json({ report, audit }, { headers: ADMIN_NO_STORE });
}
