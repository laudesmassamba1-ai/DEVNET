import { NextResponse } from "next/server";
import { AuthRepositoryError } from "@/modules/auth/ports/auth-repository";
import {
  rateLimit,
  rateLimitHeaders,
  resetRateLimit,
} from "@/lib/security/rate-limit";
import {
  hashIdentifier,
  recordSecurityEvent,
  requestIp,
} from "@/lib/security/events";
import { readObjectBody, stringField } from "@/modules/auth/http/request";
import { setSessionCookie } from "@/modules/auth/http/session-cookie";
import { getServerAuthService } from "@/platform/auth-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await readObjectBody(request);
  const email = body ? stringField(body, "email") : null;
  const password = body ? stringField(body, "password") : null;

  if (!body || !email?.trim() || !password) {
    return NextResponse.json(
      { error: "Email et mot de passe requis." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  /*
   * Deux limites, et elles ne protègent pas la même chose.
   *
   *  - Par adresse IP : une boucle depuis un même client s'arrête vite.
   *    C'est ce qui bloque un script naïf et un formulaire qui rejoue.
   *  - Par empreinte d'email : un attaquant réparti sur plusieurs IP ne doit
   *    pas pouvoir essayer mille mots de passe sur **le même compte**. C'est
   *    la limite qui compte réellement contre le bourrage d'identifiants.
   *
   * Les deux sont en mémoire du processus : imparfait sur plusieurs instances,
   * mais doublé d'un signal persistant (`auth.bruteforce`) qui ouvre un
   * incident et reste visible dans la console.
   */
  const ip = requestIp(request);
  const ipLimit = rateLimit(`auth:ip:${ip ?? "unknown"}`, {
    limit: 15,
    windowMs: 5 * 60_000,
    blockMs: 10 * 60_000,
  });
  const emailHash = hashIdentifier(email);
  const emailLimit = rateLimit(`auth:email:${emailHash}`, {
    limit: 8,
    windowMs: 10 * 60_000,
    blockMs: 15 * 60_000,
  });

  if (!ipLimit.allowed || !emailLimit.allowed) {
    await recordSecurityEvent({
      kind: "auth.ratelimited",
      severity: "warning",
      subject: emailHash,
      ip,
      userAgent: request.headers.get("user-agent"),
      details: { ipBlocked: !ipLimit.allowed, emailBlocked: !emailLimit.allowed },
    });
    return NextResponse.json(
      { error: "Trop de tentatives. Réessaie dans quelques minutes." },
      { status: 429, headers: rateLimitHeaders(ipLimit.allowed ? emailLimit : ipLimit) },
    );
  }

  try {
    const result = await getServerAuthService().signIn({
      email,
      password,
      userAgent: request.headers.get("user-agent"),
    });

    if (!result.ok) {
      const nearlyBlocked = emailLimit.remaining <= 2;
      await recordSecurityEvent({
        kind: nearlyBlocked ? "auth.bruteforce" : "auth.failed",
        severity: nearlyBlocked ? "critical" : "warning",
        subject: emailHash,
        ip,
        userAgent: request.headers.get("user-agent"),
        details: { remainingBeforeBlock: emailLimit.remaining },
      });
      return NextResponse.json(
        { error: "Identifiants invalides." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Une connexion réussie efface le compteur par email : un utilisateur
    // qui retrouve son mot de passe ne doit pas rester bloqué.
    resetRateLimit(`auth:email:${emailHash}`);

    await setSessionCookie(result.token, result.expiresAt);
    return NextResponse.json(
      {
        user: { id: result.userId, email: result.email },
        expiresAt: result.expiresAt.toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthRepositoryError) {
      return NextResponse.json(
        { error: "Connexion indisponible. Réessaie dans un instant." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("[auth] connexion impossible", error);
    return NextResponse.json(
      { error: "Connexion impossible." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
