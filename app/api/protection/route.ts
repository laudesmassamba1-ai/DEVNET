import { NextRequest, NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import {
  blockUser,
  muteUser,
  myProtection,
  TrustSafetyError,
  unblockUser,
  unmuteUser,
} from "@/lib/trust-safety/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Protection du compte courant : ce que je bloque, ce que je mets en sourdine. */
export async function GET(): Promise<NextResponse> {
  let userId: string | null;
  try {
    userId = await currentUserId();
  } catch {
    return NextResponse.json({ error: "session indisponible" }, { status: 503, headers: NO_STORE });
  }
  if (!userId) {
    return NextResponse.json({ error: "session requise" }, { status: 401, headers: NO_STORE });
  }

  try {
    return NextResponse.json(await myProtection(userId), { headers: NO_STORE });
  } catch (error) {
    const status = error instanceof TrustSafetyError ? error.status : 503;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "lecture impossible" },
      { status, headers: NO_STORE },
    );
  }
}

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

  let body: { action?: unknown; userId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "corps illisible" }, { status: 400, headers: NO_STORE });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const target = typeof body.userId === "string" ? body.userId : "";
  if (!UUID.test(target)) {
    return NextResponse.json({ error: "identifiant invalide" }, { status: 400, headers: NO_STORE });
  }
  if (target === userId) {
    return NextResponse.json(
      { error: "on ne se bloque pas soi-même" },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    if (action === "block") await blockUser(userId, target);
    else if (action === "unblock") await unblockUser(userId, target);
    else if (action === "mute") await muteUser(userId, target);
    else if (action === "unmute") await unmuteUser(userId, target);
    else {
      return NextResponse.json(
        { error: "action inconnue (block, unblock, mute, unmute)" },
        { status: 400, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      { ok: true, protection: await myProtection(userId) },
      { headers: NO_STORE },
    );
  } catch (error) {
    const status = error instanceof TrustSafetyError ? error.status : 503;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "action impossible" },
      { status, headers: NO_STORE },
    );
  }
}
