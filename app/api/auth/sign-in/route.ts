import { NextResponse } from "next/server";
import { AuthRepositoryError } from "@/modules/auth/ports/auth-repository";
import { readObjectBody, stringField } from "@/modules/auth/http/request";
import { setSessionCookie } from "@/modules/auth/http/session-cookie";
import { getServerAuthService } from "@/platform/auth-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await readObjectBody(request);
  const email = body ? stringField(body, "email") : null;
  const password = body ? stringField(body, "password") : null;

  if (!body || !email?.trim() || !password) {
    return NextResponse.json(
      { error: "Email et mot de passe requis." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await getServerAuthService().signIn({
      email,
      password,
      userAgent: request.headers.get("user-agent"),
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: "Identifiants invalides." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    await setSessionCookie(result.token, result.expiresAt);
    return NextResponse.json(
      {
        user: { id: result.userId, email: result.email },
        expiresAt: result.expiresAt.toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthRepositoryError) {
      return NextResponse.json(
        { error: "Connexion indisponible. Réessaie dans un instant." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("[auth] connexion impossible", error);
    return NextResponse.json(
      { error: "Connexion impossible." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
