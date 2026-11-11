import { NextRequest, NextResponse } from "next/server";
import { AuthRepositoryError } from "@/modules/auth";
import { getServerAuthService } from "@/platform/server-container";
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  try {
    const session = await getServerAuthService().resolveSession(token);
    if (!session) {
      return NextResponse.json({ error: "non connecté" }, { status: 401, headers: NO_STORE });
    }

    const { rows } = await getPostgresPool().query(
      `select id::text as id, prenom, pseudo, email, avatar_color, is_admin
         from public.users
        where id = $1::uuid`,
      [session.userId],
    );
    if (!rows[0]) {
      return NextResponse.json({ error: "non connecté" }, { status: 401, headers: NO_STORE });
    }

    return NextResponse.json({ user: rows[0] }, { status: 200, headers: NO_STORE });
  } catch (error) {
    if (error instanceof AuthRepositoryError) {
      console.error("[auth] lecture de session impossible", error.operation, error.code);
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