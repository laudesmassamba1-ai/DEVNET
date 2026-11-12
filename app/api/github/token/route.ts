/**
 * Connexion GitHub par jeton personnel.
 *
 * Pourquoi cette route : un OAuth App exige un `client_id` et un
 * `client_secret` créés dans un compte GitHub. Tant que ces valeurs ne sont
 * pas configurées, un utilisateur peut néanmoins relier ses dépôts avec un
 * jeton personnel (classique ou fine-grained). Le jeton est vérifié auprès
 * de GitHub, puis rangé **chiffré** dans le même cookie `httpOnly` que le
 * flux OAuth : il ne passe jamais par le JavaScript de la page, n'est pas
 * en base, et disparaît à la déconnexion.
 *
 * Le formulaire demande les portées `repo` et `read:user` (ou, pour un jeton
 * fine-grained, l'accès en lecture aux contenus des dépôts choisis).
 */
import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import { encryptValue, hasVaultKey } from "@/lib/github/crypto";
import {
  publicOrigin,
  TOKEN_COOKIE,
  TOKEN_MAX_AGE,
} from "@/lib/github/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Jetons classiques (`ghp_`, `gho_`, …) et fine-grained (`github_pat_`). */
const TOKEN_PATTERN =
  /^(gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})$/;
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

function refuse(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let userId: string | null;
  try {
    userId = await currentUserId();
  } catch (error) {
    console.error("[github] session lookup failed", error);
    return refuse("Authentification indisponible.", 503);
  }
  if (!userId) return refuse("Session requise.", 401);

  if (!hasVaultKey()) {
    return refuse(
      "Le coffre GitHub n'est pas configuré sur ce déploiement.",
      503,
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { token?: unknown }
    | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!TOKEN_PATTERN.test(token)) {
    return refuse("Jeton GitHub invalide.", 400);
  }

  let login = "";
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "devnet",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return refuse(
        response.status === 403
          ? "GitHub limite les requêtes ; réessaie dans un instant."
          : "GitHub refuse ce jeton.",
        response.status === 403 ? 429 : 401,
      );
    }
    const data = (await response.json().catch(() => null)) as {
      login?: unknown;
    } | null;
    login = typeof data?.login === "string" ? data.login : "";
  } catch {
    return refuse("GitHub ne répond pas.", 502);
  }

  if (!LOGIN_PATTERN.test(login)) {
    return refuse("Identité GitHub illisible.", 502);
  }

  const sealed = await encryptValue(
    process.env.GITHUB_CRYPT_KEY ?? "",
    token,
  );
  const response = NextResponse.json(
    { login },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(TOKEN_COOKIE, sealed, {
    httpOnly: true,
    secure: publicOrigin(request).startsWith("https:"),
    sameSite: "lax",
    path: "/api/github",
    maxAge: TOKEN_MAX_AGE,
  });
  return response;
}
