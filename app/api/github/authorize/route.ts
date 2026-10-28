/**
 * Point de départ du flux OAuth GitHub.
 *
 * ## L'exception à la règle « pas de route handler »
 *
 * DevNet interroge Supabase directement et laisse la RLS
 * décider (MEMO §9) — parce qu'un route handler serait une
 * **seconde** couche d'autorisation, donc un second endroit
 * où une erreur donne un accès. Ce route est l'exception
 * bornée à laquelle §9 n'avait pas de réponse : un échange
 * OAuth exige `client_secret`, qui **ne peut pas** vivre
 * dans le navigateur. La borne est explicite :
 *
 *   · ce route ne lit **aucune** donnée applicative ;
 *   · il ne connaît l'utilisateur que par `?u=`, que le
 *     callback recoupe avec l'identité GitHub réelle ;
 *   · il n'écrit qu'un cookie.
 *
 * Il n'y a donc rien à autoriser ici. La seule décision
 * qu'il prend est de refuser une configuration absente
 * plutôt que de rediriger vers une impasse.
 */

import { NextResponse } from "next/server";
import { hasVaultKey } from "@/lib/github/crypto";
import {
  authorizeUrl,
  isRelativePath,
  publicOrigin,
  sealState,
  STATE_COOKIE,
  STATE_TTL_MS,
  validUserId,
} from "@/lib/github/oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const user = url.searchParams.get("u") ?? "";
  const next = url.searchParams.get("next") ?? "/";

  if (!validUserId(user)) {
    return NextResponse.json(
      { error: "Identifiant DevNet absent ou invalide." },
      { status: 400 },
    );
  }
  if (!isRelativePath(next)) {
    // Pas de message détaillé : expliquer pourquoi une
    // redirection est refusée apprend comment la forger.
    return NextResponse.json({ error: "Redirection refusée." }, { status: 400 });
  }

  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID ?? "";
  const secret = process.env.GITHUB_CRYPT_KEY ?? "";
  if (!clientId || !hasVaultKey()) {
    const destination = new URL(next, publicOrigin(request));
    destination.searchParams.set("gh", "unconfigured");
    return NextResponse.redirect(destination);
  }

  const origin = publicOrigin(request);
  const secure = origin.startsWith("https:");
  const state = await sealState(secret, { u: user, next, t: Date.now() });

  const response = NextResponse.redirect(
    authorizeUrl({
      clientId,
      redirectUri: `${origin}/api/github/callback`,
      state,
    }),
  );

  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/api/github/callback",
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  });

  return response;
}
