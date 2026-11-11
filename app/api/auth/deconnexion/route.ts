import { NextRequest, NextResponse } from "next/server";
import { AuthRepositoryError } from "@/modules/auth";
import { getServerAuthService } from "@/platform/server-container";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  try {
    await getServerAuthService().signOut(token);
  } catch (error) {
    if (error instanceof AuthRepositoryError) {
      console.error("[auth] déconnexion impossible", error.operation, error.code);
      return NextResponse.json(
        { error: "authentification indisponible" },
        { status: 503, headers: NO_STORE },
      );
    }
    console.error(
      "[auth] erreur inattendue",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ error: "erreur serveur" }, { status: 500, headers: NO_STORE });
  }

  // Cookie effacé : date d'expiration dans le passé.
  const response = NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
  response.cookies.set(SESSION_COOKIE_NAME, "", sessionCookieOptions(new Date(0)));
  return response;
}