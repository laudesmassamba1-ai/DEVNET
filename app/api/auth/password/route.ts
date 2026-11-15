import { NextResponse } from "next/server";
import { AuthRepositoryError } from "@/modules/auth/ports/auth-repository";
import { readObjectBody, stringField } from "@/modules/auth/http/request";
import { readSessionToken } from "@/modules/auth/http/session-cookie";
import { MIN_PASSWORD_LENGTH } from "@/modules/auth";
import { getServerAuthService } from "@/platform/auth-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request): Promise<NextResponse> {
  const headers = { "Cache-Control": "no-store" };
  const body = await readObjectBody(request);
  const newPassword = body ? stringField(body, "newPassword") : null;

  if (!body || !newPassword) {
    return NextResponse.json(
      { error: "Nouveau mot de passe requis." },
      { status: 400, headers },
    );
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Mot de passe : ${MIN_PASSWORD_LENGTH} caractères minimum.` },
      { status: 400, headers },
    );
  }

  try {
    const result = await getServerAuthService().changePassword({
      token: await readSessionToken(),
      currentPassword: stringField(body, "currentPassword"),
      newPassword,
    });

    if (result.ok) return new NextResponse(null, { status: 204, headers });

    if (result.reason === "invalid-session") {
      return NextResponse.json(
        { error: "Session requise." },
        { status: 401, headers },
      );
    }
    if (result.reason === "invalid-credentials") {
      return NextResponse.json(
        { error: "Mot de passe actuel incorrect." },
        { status: 401, headers },
      );
    }
    return NextResponse.json(
      { error: `Mot de passe : ${MIN_PASSWORD_LENGTH} caractères minimum.` },
      { status: 400, headers },
    );
  } catch (error) {
    if (error instanceof AuthRepositoryError) {
      return NextResponse.json(
        { error: "Changement indisponible. Réessaie dans un instant." },
        { status: 503, headers },
      );
    }
    console.error("[auth] changement de mot de passe impossible", error);
    return NextResponse.json(
      { error: "Changement impossible." },
      { status: 500, headers },
    );
  }
}
