import { NextRequest, NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
import { writeAudit } from "@/lib/admin-audit";
import { recordSecurityEvent } from "@/lib/security/events";
import {
  failoverConfig,
  inspectBoth,
  switchTo,
  type FailoverTarget,
} from "@/platform/infrastructure/postgres/failover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pilotage de la bascule depuis la console.
 *
 * Cette route ne fait qu'une chose que le mode automatique ne peut pas faire :
 * **décider**. Le retour sur la primaire est un choix d'exploitation, pas une
 * déduction — une empreinte de schéma identique ne dit rien des lignes
 * écrites sur la secours pendant l'incident. Le bouton existe donc, mais il
 * passe par `switchTo()`, qui applique exactement les garde-fous de la bascule
 * automatique (cible joignable, schéma identique). Un bouton d'administration
 * ne doit jamais être un chemin plus court.
 *
 * Chaque action est journalisée. Un changement de base non tracé serait le
 * pire des deux mondes : une décision lourde et aucune preuve de qui l'a
 * prise.
 */

function isTarget(value: unknown): value is FailoverTarget {
  return value === "primary" || value === "standby";
}

export async function GET(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }
  return NextResponse.json(
    { config: failoverConfig(), databases: await inspectBoth() },
    { headers: ADMIN_NO_STORE },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  let body: { action?: unknown; target?: unknown; confirmation?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "corps illisible" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  if (body.action !== "probe" && body.action !== "switch") {
    return NextResponse.json(
      { error: "action inconnue (probe ou switch)" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  if (body.action === "probe") {
    const databases = await inspectBoth();
    return NextResponse.json(
      { ok: true, action: "probe", config: failoverConfig(), databases },
      { headers: ADMIN_NO_STORE },
    );
  }

  if (!isTarget(body.target)) {
    return NextResponse.json(
      { error: "cible inconnue (primary ou standby)" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }
  if (body.confirmation !== "basculer") {
    return NextResponse.json(
      {
        error:
          "confirmation manquante : cette action change la base servie. "
          + "Renvoyer confirmation=\"basculer\" après avoir lu la conséquence.",
      },
      { status: 428, headers: ADMIN_NO_STORE },
    );
  }

  const target = body.target;
  const label = target === "primary" ? "primaire" : "secours";
  const result = await switchTo(target, `bascule manuelle depuis la console vers la ${label}`);

  const databases = await inspectBoth();
  const audit = await writeAudit({
    actorId: admin.userId,
    action: "platform.failover",
    targetType: "database",
    targetId: target,
    details: {
      ok: result.ok,
      reason: result.ok ? null : result.reason,
      from: result.ok ? result.from : null,
      to: result.ok ? result.to : null,
    },
  });

  await recordSecurityEvent({
    kind: result.ok ? "admin.failover.switched" : "admin.failover.refused",
    severity: result.ok ? "critical" : "warning",
    actorId: admin.userId,
    subject: `bascule manuelle vers ${label}`,
    details: { reason: result.ok ? null : result.reason },
  });

  return NextResponse.json(
    {
      ok: result.ok,
      action: "switch",
      reason: result.ok ? null : result.reason,
      audit,
      config: failoverConfig(),
      databases,
    },
    { headers: ADMIN_NO_STORE },
  );
}
