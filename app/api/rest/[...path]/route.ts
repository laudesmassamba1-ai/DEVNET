import { NextRequest, NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import {
  executeRest,
  executeRpc,
  RestError,
  type RestOutput,
  type RestQuery,
} from "@/lib/rest/query";
import { withAnon, withUser } from "@/platform/infrastructure/postgres/with-user";
import { dispatchDirectMessagePush } from "@/lib/push/notify-message";
import { dispatchActivityPush } from "@/lib/push/notify-activity";
import { rateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent, requestIp } from "@/lib/security/events";
import { checkComment, checkDirectMessage, checkMentions } from "@/lib/trust-safety/incoming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(error: RestError): NextResponse {
  return NextResponse.json(
    {
      code: error.code,
      details: error.details,
      hint: null,
      message: error.message,
    },
    { status: error.status, headers: NO_STORE },
  );
}

function successResponse(
  output: RestOutput,
  method: string,
): NextResponse {
  const single = output.single;
  let body: unknown = output.rows;
  if (single && output.rows) {
    if (output.rows.length !== 1) {
      return errorResponse(
        new RestError(
          406,
          "PGRST116",
          "JSON object requested, multiple (or no) rows returned",
        ),
      );
    }
    body = output.rows[0];
  }

  const headers: Record<string, string> = { ...NO_STORE };
  if (output.count !== null) {
    const length = output.rows?.length ?? 0;
    headers["Content-Range"] =
      length > 0 ? `0-${length - 1}/${output.count}` : `*/${output.count}`;
  }

  if (method === "HEAD") {
    return new NextResponse(null, { status: 200, headers });
  }

  if (output.rows === null && method !== "GET") {
    return new NextResponse(null, { status: 204, headers });
  }

  headers["Content-Type"] = "application/json; charset=utf-8";
  return NextResponse.json(body, {
    status: method === "POST" && output.rows !== null ? 201 : 200,
    headers,
  });
}

async function handle(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  if (!path || path.length === 0) {
    return errorResponse(new RestError(404, "PGRST205", "relation introuvable"));
  }

  const method = request.method.toUpperCase();
  const hasBody = method === "POST" || method === "PATCH" || method === "PUT";
  let body: unknown = undefined;
  if (hasBody) {
    try {
      body = await request.json();
    } catch {
      return errorResponse(new RestError(400, "PGRST102", "corps JSON illisible"));
    }
  }

  const prefer = request.headers.get("prefer") ?? "";
  const accept = request.headers.get("accept") ?? "";

  try {
    const callerId = await currentUserId();

    /*
     * Garde de débit sur les écritures.
     *
     * Les lectures peuvent être fréquentes (pagination, hydratation) ; les
     * écritures non. Une limite par identité — et par IP pour un visiteur
     * anonyme — arrête une boucle qui publie ou supprime en rafale, sans
     * gêner un usage normal (120 écritures par minute est déjà énorme).
     */
    if (method !== "GET" && method !== "HEAD") {
      const key = callerId ? `rest:user:${callerId}` : `rest:ip:${requestIp(request) ?? "unknown"}`;
      const limit = rateLimit(key, {
        limit: callerId ? 120 : 20,
        windowMs: 60_000,
        blockMs: 60_000,
      });
      if (!limit.allowed) {
        await recordSecurityEvent({
          kind: "rest.rate_limited",
          severity: "warning",
          actorId: callerId,
          ip: requestIp(request),
          userAgent: request.headers.get("user-agent"),
          details: { table: path[0] ?? "", method },
        });
        return NextResponse.json(
          { code: "PGRST429", message: "trop d'écritures en peu de temps", details: null, hint: null },
          {
            status: 429,
            headers: { ...NO_STORE, "Retry-After": "60" },
          },
        );
      }
    }

    /*
     * Les préférences du destinataire sont vérifiées avant l'écriture.
     *
     * Le contrôle est ici et non dans l'écran : un client tiers qui écrit
     * par la même route doit rencontrer la même règle. Le refus est
     * volontairement générique, pour ne pas révéler la préférence exacte
     * d'un compte à quelqu'un qu'il ne connaît pas.
     */
    if (callerId && method === "POST" && body && typeof body === "object") {
      const row = (Array.isArray(body) ? body[0] : body) as Record<string, unknown>;
      const text = typeof row.text === "string" ? row.text : "";
      if (path[0] === "direct_messages" && typeof row.conversation_id === "string" && text) {
        const decision = await checkDirectMessage({
          senderId: callerId,
          conversationId: row.conversation_id,
          text,
        });
        if (!decision.allowed) {
          await recordSecurityEvent({
            kind: "trust.incoming_refused",
            severity: "info",
            actorId: callerId,
            details: { table: "direct_messages", reason: decision.reason },
          });
          return NextResponse.json(
            { code: "TRUST_REFUSED", message: decision.reason, details: null, hint: null },
            { status: 403, headers: NO_STORE },
          );
        }
      }
      if ((path[0] === "posts" || path[0] === "comments" || path[0] === "stories") && text) {
        const decision = await checkMentions({ senderId: callerId, text });
        if (!decision.allowed) {
          return NextResponse.json(
            { code: "TRUST_REFUSED", message: decision.reason, details: null, hint: null },
            { status: 403, headers: NO_STORE },
          );
        }
      }
      if (path[0] === "comments" && typeof row.post_id === "string" && text) {
        const decision = await checkComment({
          senderId: callerId,
          postId: row.post_id,
          text,
        });
        if (!decision.allowed) {
          await recordSecurityEvent({
            kind: "trust.incoming_refused",
            severity: "info",
            actorId: callerId,
            details: { table: "comments", reason: decision.reason },
          });
          return NextResponse.json(
            { code: "TRUST_REFUSED", message: decision.reason, details: null, hint: null },
            { status: 403, headers: NO_STORE },
          );
        }
      }
    }

    const run = (query: RestQuery) => {
      if (path[0] === "rpc") {
        if (path.length !== 2) {
          throw new RestError(404, "PGRST202", "fonction introuvable");
        }
        return executeRpc(path[1], body, query);
      }
      if (path.length !== 1) {
        throw new RestError(404, "PGRST205", "relation introuvable");
      }
      return executeRest({
        table: path[0],
        method,
        searchParams: request.nextUrl.searchParams,
        body,
        prefer,
        accept,
        query,
      });
    };

    const output = callerId
      ? await withUser(callerId, run)
      : await withAnon(run);

    // Un message direct qui vient d'être écrit prévient les appareils
    // des autres participants. La passerelle reste le seul chemin : le
    // navigateur n'a rien à déclencher lui-même, et un client tiers qui
    // écrirait par la même route déclencherait la même chose.
    if (callerId && method === "POST" && path[0] === "direct_messages") {
      await dispatchDirectMessagePush(callerId, output.rows);
    }

    // Même principe pour un like ou un commentaire : la bannière part
    // après l'écriture, vers la personne que le geste concerne.
    if (callerId && method === "POST") {
      await dispatchActivityPush(callerId, path[0], output.rows, body);
    }

    return successResponse(output, method);
  } catch (error) {
    if (error instanceof RestError) return errorResponse(error);
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? ` cause=${error.cause.message}`
        : "";
    console.error(
      "[rest] requête impossible",
      `${error instanceof Error ? error.message : String(error)}${cause}`,
    );
    return errorResponse(new RestError(500, "PGRST500", "requête impossible"));
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return handle(request, context);
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return handle(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return handle(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return handle(request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return handle(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return handle(request, context);
}
