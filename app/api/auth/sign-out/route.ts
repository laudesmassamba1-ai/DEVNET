import { NextResponse } from "next/server";
import {
  clearSessionCookie,
  readSessionToken,
} from "@/modules/auth/http/session-cookie";
import { getServerAuthService } from "@/platform/auth-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    await getServerAuthService().signOut(await readSessionToken());
  } catch (error) {
    console.error("[auth] déconnexion partielle", error);
  } finally {
    await clearSessionCookie();
  }

  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
