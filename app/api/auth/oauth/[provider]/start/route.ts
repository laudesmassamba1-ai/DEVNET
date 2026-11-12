import { NextResponse } from "next/server";
import {
  createOAuthState,
  isOAuthProvider,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
  oauthAuthorizeUrl,
  oauthRedirectUri,
  safeNextPath,
  sealOAuthState,
} from "@/modules/auth";
import { serverOAuthClient } from "@/platform/auth-container";
import { publicOrigin } from "@/lib/github/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await context.params;
  if (!isOAuthProvider(provider)) {
    return NextResponse.json(
      { error: "Fournisseur de connexion inconnu." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const origin = publicOrigin(request);
  const config = serverOAuthClient.config(provider);
  const secret = serverOAuthClient.stateSecret();

  if (!config || !secret) {
    const destination = new URL("/login", origin);
    destination.searchParams.set("oauth", "unconfigured");
    destination.searchParams.set("next", next);
    return NextResponse.redirect(destination);
  }

  const state = createOAuthState(provider, next);
  const sealed = sealOAuthState(secret, state);

  const response = NextResponse.redirect(
    oauthAuthorizeUrl({
      provider,
      clientId: config.clientId,
      redirectUri: oauthRedirectUri(origin, provider),
      state: sealed,
    }),
  );
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(OAUTH_STATE_COOKIE, sealed, {
    httpOnly: true,
    secure: origin.startsWith("https:"),
    sameSite: "lax",
    path: "/api/auth/oauth",
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
  });

  return response;
}
