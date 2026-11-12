import { NextResponse } from "next/server";
import { AuthRepositoryError } from "@/modules/auth/ports/auth-repository";
import { readObjectBody, stringField } from "@/modules/auth/http/request";
import { setSessionCookie } from "@/modules/auth/http/session-cookie";
import { getServerAuthService } from "@/platform/auth-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function metadataField(body: Record<string, unknown>): Record<string, unknown> {
  const value = body.metadata;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(request: Request): Promise<NextResponse> {
  const headers = { "Cache-Control": "no-store" };
  const body = await readObjectBody(request);
  const email = body ? stringField(body, "email") : null;
  const password = body ? stringField(body, "password") : null;

  if (!body || !email?.trim() || !password) {
    return NextResponse.json(
      { error: "Email et mot de passe requis." },
      { status: 400, headers },
    );
  }

  try {
    const result = await getServerAuthService().signUp({
      email,
      password,
      metadata: metadataField(body),
      userAgent: request.headers.get("user-agent"),
    });

    if (!result.ok) {
      if (result.reason === "email-taken") {
        return NextResponse.json(
          { error: "Un compte existe déjà avec cette adresse." },
          { status: 409, headers },
        );
      }
      return NextResponse.json(
        { error: "Mot de passe : 6 caractères minimum." },
        { status: 400, headers },
      );
    }

    await setSessionCookie(result.token, result.expiresAt);
    return NextResponse.json(
      {
        user: {
          id: result.userId,
          email: result.email,
          user_metadata: metadataField(body),
        },
        expiresAt: result.expiresAt.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof AuthRepositoryError) {
      return NextResponse.json(
        { error: "Inscription indisponible. Réessaie dans un instant." },
        { status: 503, headers },
      );
    }
    console.error("[auth] inscription impossible", error);
    return NextResponse.json(
      { error: "Inscription impossible." },
      { status: 500, headers },
    );
  }
}
