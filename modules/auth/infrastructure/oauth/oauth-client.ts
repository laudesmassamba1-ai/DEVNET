/**
 * Échanges réseau OAuth et lecture de configuration.
 *
 * Le client secret ne quitte jamais le serveur. Aucun jeton, code ou
 * réponse brute n'est journalisé : les routes ne reçoivent qu'un profil
 * normalisé ou un refus générique.
 */
import type {
  OAuthProfile,
  OAuthProvider,
} from "../../application/oauth";
import {
  parseGitHubProfile,
  parseGoogleProfile,
} from "../../application/oauth";

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export type OAuthProfileResult =
  | { ok: true; profile: OAuthProfile }
  | { ok: false; reason: "email-unavailable" | "provider-error" };

export function readOAuthConfig(provider: OAuthProvider): OAuthClientConfig | null {
  const clientId =
    provider === "google"
      ? process.env.GOOGLE_CLIENT_ID?.trim()
      : process.env.GITHUB_LOGIN_CLIENT_ID?.trim();
  const clientSecret =
    provider === "google"
      ? process.env.GOOGLE_CLIENT_SECRET?.trim()
      : process.env.GITHUB_LOGIN_CLIENT_SECRET?.trim();

  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function readOAuthStateSecret(): string | null {
  const secret = process.env.AUTH_OAUTH_SECRET?.trim() ?? "";
  return secret.length >= 32 ? secret : null;
}

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function exchangeOAuthCode(input: {
  provider: OAuthProvider;
  config: OAuthClientConfig;
  code: string;
  redirectUri: string;
}): Promise<string | null> {
  const endpoint =
    input.provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : "https://github.com/login/oauth/access_token";

  const body = new URLSearchParams({
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  if (input.provider === "google") {
    body.set("grant_type", "authorization_code");
  }

  const data = (await fetchJson(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "devnet-auth",
    },
    body: body.toString(),
  })) as { access_token?: unknown } | null;

  return typeof data?.access_token === "string" && data.access_token
    ? data.access_token
    : null;
}

export async function fetchOAuthProfile(
  provider: OAuthProvider,
  accessToken: string,
): Promise<OAuthProfileResult> {
  if (provider === "google") {
    const data = await fetchJson("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "user-agent": "devnet-auth",
      },
    });
    if (data === null) return { ok: false, reason: "provider-error" };

    const profile = parseGoogleProfile(data);
    return profile
      ? { ok: true, profile }
      : { ok: false, reason: "email-unavailable" };
  }

  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${accessToken}`,
    "user-agent": "devnet-auth",
  };
  const [user, emails] = await Promise.all([
    fetchJson("https://api.github.com/user", { headers }),
    fetchJson("https://api.github.com/user/emails", { headers }),
  ]);

  if (user === null) return { ok: false, reason: "provider-error" };
  if (emails === null) return { ok: false, reason: "email-unavailable" };

  const profile = parseGitHubProfile(user, emails);
  return profile
    ? { ok: true, profile }
    : { ok: false, reason: "email-unavailable" };
}
