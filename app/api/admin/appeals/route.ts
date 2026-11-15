import { NextRequest, NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireModerator } from "@/lib/admin-server";
import { listAppeals, reviewAppeal, TrustSafetyError } from "@/lib/trust-safety/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const moderator = await requireModerator("view");
  if (!moderator.ok) {
    return NextResponse.json(
      { error: moderator.error },
      { status: moderator.status, headers: ADMIN_NO_STORE },
    );
  }

  const requested = request.nextUrl.searchParams.get("status") ?? "pending";
  const status =
    requested === "upheld" || requested === "overturned" || requested === "all"
      ? requested
      : "pending";

  try {
    return NextResponse.json(
      { appeals: await listAppeals(moderator.userId, status) },
      { headers: ADMIN_NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { error: "liste des recours indisponible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const moderator = await requireModerator("sanction");
  if (!moderator.ok) {
    return NextResponse.json(
      { error: moderator.error },
      { status: moderator.status, headers: ADMIN_NO_STORE },
    );
  }

  let body: { id?: unknown; decision?: unknown; note?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "corps illisible" }, { status: 400, headers: ADMIN_NO_STORE });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const decision =
    body.decision === "upheld" || body.decision === "overturned" ? body.decision : null;
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : "";

  if (!UUID.test(id) || !decision) {
    return NextResponse.json(
      { error: "recours ou décision invalide" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  try {
    await reviewAppeal(moderator.userId, id, decision, note);
    return NextResponse.json({ ok: true }, { headers: ADMIN_NO_STORE });
  } catch (error) {
    const status = error instanceof TrustSafetyError ? error.status : 503;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "décision impossible" },
      { status, headers: ADMIN_NO_STORE },
    );
  }
}
