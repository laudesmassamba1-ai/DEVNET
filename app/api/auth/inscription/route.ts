import { NextRequest, NextResponse } from "next/server";
import { AuthRepositoryError } from "@/modules/auth";
import { getServerAuthService } from "@/platform/server-container";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Lire le corps JSON
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "requête invalide" }, { status: 400, headers: NO_STORE });
  }

  // 2. Valider
  const { email, password, pseudo } = (body ?? {}) as Record<string, unknown>;

  if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "adresse e-mail invalide" }, { status: 400, headers: NO_STORE });
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return NextResponse.json(
      { error: "mot de passe : 8 à 128 caractères" },
      { status: 400, headers: NO_STORE },
    );
  }
  if (pseudo !== undefined && (typeof pseudo !== "string" || !/^[a-z0-9_]{3,30}$/.test(pseudo))) {
    return NextResponse.json({ error: "pseudo invalide" }, { status: 400, headers: NO_STORE });
  }

  try {
    const auth = getServerAuthService();

    // 3. Créer le compte
    const created = await auth.signUp({ email, password, pseudo });
    if (!created.ok) {
      return NextResponse.json({ error: "adresse déjà utilisée" }, { status: 409, headers: NO_STORE });
    }

    // 4. Ouvrir la session
    const session = await auth.signIn({
      email,
      password,
      userAgent: request.headers.get("user-agent"),
    });
    if (!session.ok) {
      return NextResponse.json(
        { error: "compte créé, connexion impossible" },
        { status: 500, headers: NO_STORE },
      );
    }

    // 5. Poser le cookie et répondre
    const response = NextResponse.json(
      { userId: created.userId },
      { status: 201, headers: NO_STORE },
    );
    response.cookies.set(SESSION_COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    if (error instanceof AuthRepositoryError) {
      console.error("[auth] inscription impossible", error.operation, error.code);
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