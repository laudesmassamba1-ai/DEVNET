import { NextRequest, NextResponse } from "next/server";
import { AuthRepositoryError } from "@/modules/auth";
import { getServerAuthService } from "@/platform/server-container";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "requête invalide" }, { status: 400, headers: NO_STORE });
  }

  const { email, password } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length === 0 ||
    email.length > 254 ||
    password.length === 0 ||
    password.length > 128
  ) {
    return NextResponse.json({ error: "requête invalide" }, { status: 400, headers: NO_STORE });
  }

  try {
    const session = await getServerAuthService().signIn({
      email,
      password,
      userAgent: request.headers.get("user-agent"),
    });
    if (!session.ok) {
      return NextResponse.json({ error: "identifiants incorrects" }, { status: 401, headers: NO_STORE });
    }

    const response = NextResponse.json(
      { userId: session.userId },
      { status: 200, headers: NO_STORE },
    );
    response.cookies.set(SESSION_COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    if (error instanceof AuthRepositoryError) {
      console.error("[auth] connexion impossible", error.operation, error.code);
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
}