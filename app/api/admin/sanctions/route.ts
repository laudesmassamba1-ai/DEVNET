import { NextRequest, NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireModerator } from "@/lib/admin-server";
import {
  issueSanction,
  liftSanction,
  listSanctions,
  TrustSafetyError,
  type SanctionKind,
} from "@/lib/trust-safety/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: ReadonlySet<SanctionKind> = new Set(["warning", "restrict", "suspend", "ban"]);
const REASONS = new Set([
  "harassment", "hate", "threats", "sexual", "minor_safety", "self_harm",
  "spam", "scam", "doxxing", "malware_secret", "impersonation", "other",
]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const moderator = await requireModerator("view");
  if (!moderator.ok) {
    return NextResponse.json(
      { error: moderator.error },
      { status: moderator.status, headers: ADMIN_NO_STORE },
    );
  }

  const requested = request.nextUrl.searchParams.get("status") ?? "active";
  const status = requested === "lifted" || requested === "all" ? requested : "active";

  try {
    return NextResponse.json(
      { sanctions: await listSanctions(moderator.userId, status) },
      { headers: ADMIN_NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { error: "liste des sanctions indisponible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const moderator = await requireModerator("sanction");
  if (!moderator.ok) {
    return NextResponse.json(
      { error: moderator.error },
      { status: moderator.status, headers: ADMIN_NO_STORE },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "corps illisible" }, { status: 400, headers: ADMIN_NO_STORE });
  }

  try {
    if (body.action === "issue") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      const kind = typeof body.kind === "string" ? (body.kind as SanctionKind) : null;
      const reasonCode = typeof body.reasonCode === "string" ? body.reasonCode : "";
      const note = typeof body.note === "string" ? body.note.slice(0, 2000) : "";
      const days = Number.isInteger(body.days) ? Number(body.days) : null;

      if (!UUID.test(userId) || !kind || !KINDS.has(kind) || !REASONS.has(reasonCode)) {
        return NextResponse.json(
          { error: "compte, type ou motif invalide" },
          { status: 400, headers: ADMIN_NO_STORE },
        );
      }

      const id = await issueSanction({
        actorId: moderator.userId,
        userId,
        kind,
        reasonCode,
        note,
        days,
      });
      return NextResponse.json({ ok: true, id }, { headers: ADMIN_NO_STORE });
    }

    if (body.action === "lift") {
      const id = typeof body.id === "string" ? body.id : "";
      const note = typeof body.note === "string" ? body.note.slice(0, 500) : "";
      if (!UUID.test(id)) {
        return NextResponse.json({ error: "sanction invalide" }, { status: 400, headers: ADMIN_NO_STORE });
      }
      await liftSanction(moderator.userId, id, note);
      return NextResponse.json({ ok: true }, { headers: ADMIN_NO_STORE });
    }

    return NextResponse.json(
      { error: "action inconnue (issue, lift)" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  } catch (error) {
    const status = error instanceof TrustSafetyError ? error.status : 503;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "action impossible" },
      { status, headers: ADMIN_NO_STORE },
    );
  }
}
