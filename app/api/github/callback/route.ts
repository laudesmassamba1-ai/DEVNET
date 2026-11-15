/**
 * Callback OAuth GitHub.
 *
 * Trois vérifications, dans cet ordre, et chacune est un
 * refus distinct :
 *
 *   1. **l'état.** Absent, illisible ou vieux de plus de
 *      dix minutes → on ne sait plus qui a demandé la
 *      connexion, donc on ne sait plus à qui la donner.
 *      Un `state` qui ne rouvre pas est une attaque ou un
 *      onglet resté ouvert deux semaines — même réponse.
 *   2. **le code.** GitHub le donne une seule fois ; l'échec
 *      d'échange n'est pas retryable ici.
 *   3. **l'identité.** `GET /user` avec le jeton : le login
 *      que l'on enregistre vient de GitHub, pas du client.
 *
 * Le jeton est alors chiffré dans le cookie `httpOnly`.
 * La ligne `github_connections` — celle que la RLS
 * protège — est écrite par le **client** au retour, avec
 * le login : c'est la seule écriture applicative du flux,
 * et elle passe par les règles de tout le reste de l'app.
 *
 * ## Les échecs
 *
 * Un échec ne dit jamais lequel des trois a échoué dans
 * l'URL publique : `?gh=state|denied|failed` suffisent à
 * l'écran pour expliquer, et ne renseignent pas un
 * adversaire sur la forme du problème.
 */

import { NextResponse } from "next/server";
import { encryptValue } from "@/lib/github/crypto";
import {
  isRelativePath,
  openState,
  publicOrigin,
  readCookie,
  STATE_COOKIE,
  stateExpired,
  TOKEN_COOKIE,
  TOKEN_MAX_AGE,
} from "@/lib/github/oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const errorParam = url.searchParams.get("error") ?? "";
  const stateParam = url.searchParams.get("state") ?? "";

  const secret = process.env.GITHUB_CRYPT_KEY ?? "";
  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID ?? "";
  const clientSecret = process.env.GITHUB_CLIENT_SECRET ?? "";

  const root = publicOrigin(request);
  const secure = root.startsWith("https:");
  const fail = (kind: "state" | "denied" | "failed" | "unconfigured", next = "/") => {
    const destination = new URL(next, root);
    destination.searchParams.set("gh", kind);
    return NextResponse.redirect(destination);
  };

  const sealed = readCookie(
    request.headers.get("cookie"),
    STATE_COOKIE,
  );
  const state = secret ? await openState(secret, sealed) : null;

  if (!state || stateExpired(state) || !sealed || stateParam !== sealed) {
    return fail("state");
  }
  if (!isRelativePath(state.next)) return fail("state");
  if (errorParam) return fail("denied", state.next);
  if (!code) return fail("failed", state.next);
  if (!clientId || !clientSecret) return fail("unconfigured", state.next);

  const token = await exchangeCode({
    clientId,
    clientSecret,
    code,
    redirectUri: `${root}/api/github/callback`,
  });
  if (!token) return fail("failed", state.next);

  const identity = await fetchGithubUser(token);
  if (!identity) return fail("failed", state.next);

  const sealedToken = await encryptValue(secret, token);
  const next = isRelativePath(state.next) ? state.next : "/";

  const destination = new URL(next, root);
  destination.searchParams.set("gh", "ok");
  destination.searchParams.set("u", state.u);
  const response = NextResponse.redirect(destination);

  response.cookies.set(TOKEN_COOKIE, sealedToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    // Le cookie ne vaut que pour les routes GitHub : un
    // autre route de l'application ne le verra jamais.
    path: "/api/github",
    maxAge: TOKEN_MAX_AGE,
  });
  // L'état est à usage unique : on le consume plutôt que
  // d'attendre qu'il meure de vieillesse.
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    secure,
    path: "/api/github/callback",
    maxAge: 0,
  });

  return response;
}

/* ── Appels GitHub ─────────────────────────────────────── */

/**
 * Échange le code contre un jeton.
 *
 * Le formulaire, pas le JSON : c'est la forme que le
 * endpoint d'accepte, et la seule raison pour laquelle un
 * `content-type` correct ici vaut mieux qu'un joli objet.
 */
async function exchangeCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  });

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) return null;

  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
  } | null;

  return data?.access_token ?? null;
}

/** L'identité du porteur du jeton — le login, rien d'autre. */
async function fetchGithubUser(
  token: string,
): Promise<{ login: string } | null> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) return null;

  const data = (await res.json().catch(() => null)) as {
    login?: string;
  } | null;

  return data?.login ? { login: data.login } : null;
}
