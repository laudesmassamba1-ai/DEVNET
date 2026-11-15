import { NextResponse } from "next/server";
import {
  isOAuthProvider,
  OAUTH_STATE_COOKIE,
  openOAuthState,
  oauthRedirectUri,
} from "@/modules/auth";
import { setSessionCookie } from "@/modules/auth/http/session-cookie";
import { getServerAuthService, serverOAuthClient } from "@/platform/auth-container";
import { publicOrigin, readCookie } from "@/lib/github/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Failure =
  | "state"
  | "denied"
  | "failed"
  | "unconfigured"
  | "email";

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
  const code = url.searchParams.get("code") ?? "";
  const errorParam = url.searchParams.get("error") ?? "";
  const stateParam = url.searchParams.get("state") ?? "";
  const sealed = readCookie(
    request.headers.get("cookie"),
    OAUTH_STATE_COOKIE,
  );

  const origin = publicOrigin(request);
  const secure = origin.startsWith("https:");
  const secret = serverOAuthClient.stateSecret();
  const config = serverOAuthClient.config(provider);
  const state = secret
    ? openOAuthState(secret, sealed, provider)
    : null;

  const fail = (kind: Failure, next = state?.next ?? "/feed") => {
    const destination = new URL("/login", origin);
    destination.searchParams.set("oauth", kind);
    destination.searchParams.set("next", next);
    const response = NextResponse.redirect(destination);
    response.headers.set("Cache-Control", "no-store");
    clearState(response, secure);
    return response;
  };

  if (!config || !secret) return fail("unconfigured");
  if (!state || !sealed || stateParam !== sealed) return fail("state");
  if (errorParam) return fail("denied");
  if (!code) return fail("failed");

  try {
    const accessToken = await serverOAuthClient.exchangeCode({
      provider,
      config,
      code,
      redirectUri: oauthRedirectUri(origin, provider),
    });
    if (!accessToken) return fail("failed");

    const profileResult = await serverOAuthClient.fetchProfile(
      provider,
      accessToken,
    );
    if (!profileResult.ok) {
      return fail(
        profileResult.reason === "email-unavailable" ? "email" : "failed",
      );
    }

    const { profile } = profileResult;
    const result = await getServerAuthService().signInWithExternalIdentity({
      provider,
      subject: profile.subject,
      email: profile.email,
      emailVerified: profile.emailVerified,
      metadata: profile.metadata,
      userAgent: request.headers.get("user-agent"),
    });

    if (!result.ok) {
      return fail(result.reason === "email-unverified" ? "email" : "failed");
    }

    await setSessionCookie(result.token, result.expiresAt);
    const destination = new URL(state.next, origin);
    const response = NextResponse.redirect(destination);
    response.headers.set("Cache-Control", "no-store");
    clearState(response, secure);
    return response;
  } catch (error) {
    console.error(`[auth] connexion ${provider} impossible`, error);
    return fail("failed");
  }
}

function clearState(response: NextResponse, secure: boolean): void {
  response.cookies.set(OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/api/auth/oauth",
    maxAge: 0,
  });
}
