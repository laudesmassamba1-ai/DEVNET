import { NextResponse } from "next/server";
import { AuthRepositoryError } from "@/modules/auth/ports/auth-repository";
import { readObjectBody, stringField } from "@/modules/auth/http/request";
import { setSessionCookie } from "@/modules/auth/http/session-cookie";
import { getServerAuthService } from "@/platform/auth-container";
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";
import { readPlatformSettings } from "@/lib/platform-settings";
import { rateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";
import {
  hashIdentifier,
  recordSecurityEvent,
  requestIp,
} from "@/lib/security/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function metadataField(body: Record<string, unknown>): Record<string, unknown> {
  const value = body.metadata;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(request: Request): Promise<NextResponse> {
  const headers = { "Cache-Control": "no-store" };
  const body = await readObjectBody(request);
  const email = body ? stringField(body, "email") : null;
  const password = body ? stringField(body, "password") : null;

  if (!body || !email?.trim() || !password) {
    return NextResponse.json(
      { error: "Email et mot de passe requis." },
      { status: 400, headers },
    );
  }

  /*
   * Une création de compte par minute et par IP, et cinq par heure. Sans
   * cela, un script crée mille comptes en quelques secondes : c'est du
   * bourrage de base, du spam à venir, et un coût de stockage.
   */
  const ip = requestIp(request);
  const burst = rateLimit(`signup:burst:${ip ?? "unknown"}`, {
    limit: 1,
    windowMs: 60_000,
    blockMs: 60_000,
  });
  const hourly = rateLimit(`signup:hour:${ip ?? "unknown"}`, {
    limit: 5,
    windowMs: 60 * 60_000,
    blockMs: 60 * 60_000,
  });
  if (!burst.allowed || !hourly.allowed) {
    await recordSecurityEvent({
      kind: "auth.signup.ratelimited",
      severity: "warning",
      ip,
      userAgent: request.headers.get("user-agent"),
      details: { hourly: !hourly.allowed },
    });
    return NextResponse.json(
      { error: "Trop de créations de compte. Réessaie plus tard." },
      { status: 429, headers: rateLimitHeaders(hourly.allowed ? burst : hourly) },
    );
  }

  /* Les inscriptions peuvent être fermées depuis la console
     d'administration. La lecture passe par le pool direct : à ce stade
     il n'y a pas encore de session, donc pas d'identité à poser. Un échec
     de lecture laisse les inscriptions ouvertes (voir
     `readPlatformSettings`) : une base momentanément muette ne doit pas
     fermer la porte d'entrée. */
  try {
    const pool = getPostgresPool();
    const settings = await readPlatformSettings((sql, values) =>
      pool.query(sql, values).then((result) => result.rows),
    );
    if (!settings.signups_enabled) {
      return NextResponse.json(
        { error: "Les inscriptions sont fermées pour le moment." },
        { status: 403, headers },
      );
    }
  } catch {
    /* pool indisponible : le service d'authentification dira son mot */
  }

  try {
    const result = await getServerAuthService().signUp({
      email,
      password,
      metadata: metadataField(body),
      userAgent: request.headers.get("user-agent"),
    });

    if (!result.ok) {
      if (result.reason === "email-taken") {
        await recordSecurityEvent({
          kind: "auth.signup.duplicate",
          severity: "info",
          subject: hashIdentifier(email),
          ip,
          userAgent: request.headers.get("user-agent"),
        });
        return NextResponse.json(
          { error: "Un compte existe déjà avec cette adresse." },
          { status: 409, headers },
        );
      }
      return NextResponse.json(
        { error: "Mot de passe : 6 caractères minimum." },
        { status: 400, headers },
      );
    }

    await setSessionCookie(result.token, result.expiresAt);
    return NextResponse.json(
      {
        user: {
          id: result.userId,
          email: result.email,
          user_metadata: metadataField(body),
        },
        expiresAt: result.expiresAt.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof AuthRepositoryError) {
      return NextResponse.json(
        { error: "Inscription indisponible. Réessaie dans un instant." },
        { status: 503, headers },
      );
    }
    console.error("[auth] inscription impossible", error);
    return NextResponse.json(
      { error: "Inscription impossible." },
      { status: 500, headers },
    );
  }
}
