import { NextRequest, NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import { submitAppeal, TrustSafetyError } from "@/lib/trust-safety/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Contester une sanction : un seul recours en attente par sanction. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let userId: string | null;
  try {
    userId = await currentUserId();
  } catch {
    return NextResponse.json({ error: "session indisponible" }, { status: 503, headers: NO_STORE });
  }
  if (!userId) {
    return NextResponse.json({ error: "session requise" }, { status: 401, headers: NO_STORE });
  }

  let body: { sanctionId?: unknown; message?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "corps illisible" }, { status: 400, headers: NO_STORE });
  }

  const sanctionId = typeof body.sanctionId === "string" ? body.sanctionId : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!UUID.test(sanctionId)) {
    return NextResponse.json({ error: "sanction invalide" }, { status: 400, headers: NO_STORE });
  }
  if (message.length < 10 || message.length > 2000) {
    return NextResponse.json(
      { error: "explique le recours en 10 à 2000 caractères" },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const id = await submitAppeal(userId, sanctionId, message);
    return NextResponse.json({ ok: true, appealId: id }, { headers: NO_STORE });
  } catch (error) {
    const status = error instanceof TrustSafetyError ? error.status : 503;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "recours impossible" },
      { status, headers: NO_STORE },
    );
  }
}
