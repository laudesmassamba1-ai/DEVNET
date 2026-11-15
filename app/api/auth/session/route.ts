import { NextResponse } from "next/server";
import { AuthRepositoryError } from "@/modules/auth/ports/auth-repository";
import { readSessionToken } from "@/modules/auth/http/session-cookie";
import { getServerAuthService } from "@/platform/auth-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const headers = { "Cache-Control": "no-store" };

  try {
    const session = await getServerAuthService().resolveSession(
      await readSessionToken(),
    );

    if (!session) return NextResponse.json({ user: null }, { headers });

    return NextResponse.json(
      {
        user: {
          id: session.userId,
          email: session.email,
          user_metadata: session.metadata,
        },
        expiresAt: session.expiresAt.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof AuthRepositoryError) {
      return NextResponse.json(
        { error: "Session indisponible. Réessaie dans un instant." },
        { status: 503, headers },
      );
    }
    console.error("[auth] session impossible", error);
    return NextResponse.json(
      { error: "Session impossible." },
      { status: 500, headers },
    );
  }
}
