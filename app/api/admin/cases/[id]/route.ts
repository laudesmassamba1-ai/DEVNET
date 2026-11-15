import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import {
  assignCase,
  decideCase,
  getCase,
  noteCase,
  TrustSafetyConflict,
} from "@/lib/trust-safety/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECISIONS = new Set(["no_violation", "warning", "restrict", "suspend", "ban"]);
const CAPABILITIES = new Set(["post", "comment", "message", "story", "live"]);
const REASONS = new Set([
  "harassment", "hate", "threats", "sexual", "minor_safety", "self_harm",
  "spam", "scam", "doxxing", "malware_secret", "impersonation", "other",
]);

function failure(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "";
  const status = /réservé|permission/i.test(message)
    ? 403
    : /introuvable/i.test(message)
      ? 404
      : error instanceof TrustSafetyConflict
        ? 409
        : /invalide|trop|déjà clos|demande|impossible|auteur/i.test(message)
          ? 400
          : 503;
  return NextResponse.json(
    { error: status === 503 ? "dossier indisponible" : message },
    { status, headers: NO_STORE },
  );
}

async function session(): Promise<{ userId: string } | { error: NextResponse }> {
  try {
    const userId = await currentUserId();
    return userId
      ? { userId }
      : { error: NextResponse.json({ error: "session requise" }, { status: 401, headers: NO_STORE }) };
  } catch {
    return {
      error: NextResponse.json(
        { error: "session indisponible" },
        { status: 503, headers: NO_STORE },
      ),
    };
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await session();
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "dossier invalide" }, { status: 400, headers: NO_STORE });
  }
  try {
    const detail = await getCase(auth.userId, id);
    if (!detail) {
      return NextResponse.json({ error: "dossier introuvable" }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ case: detail }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await session();
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "dossier invalide" }, { status: 400, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "corps illisible" }, { status: 400, headers: NO_STORE });
  }

  try {
    if (body.action === "assign") {
      const requested =
        typeof body.assigneeId === "string" && body.assigneeId.length > 0
          ? body.assigneeId
          : null;
      const assignee = requested === "me" ? auth.userId : requested;
      await assignCase(auth.userId, id, assignee);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    if (body.action === "note") {
      await noteCase(auth.userId, id, typeof body.note === "string" ? body.note : "");
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    if (body.action === "decide") {
      const decision = typeof body.decision === "string" ? body.decision : "";
      const reasonCode = typeof body.reasonCode === "string" ? body.reasonCode : "other";
      const days = Number.isInteger(body.days) ? Number(body.days) : null;
      const capabilities = Array.isArray(body.capabilities)
        ? body.capabilities.filter(
            (value): value is string => typeof value === "string" && CAPABILITIES.has(value),
          )
        : [];
      if (!DECISIONS.has(decision) || !REASONS.has(reasonCode)) {
        return NextResponse.json(
          { error: "décision ou motif invalide" },
          { status: 400, headers: NO_STORE },
        );
      }
      const result = await decideCase(auth.userId, id, {
        action: decision as "no_violation" | "warning" | "restrict" | "suspend" | "ban",
        reasonCode,
        note: typeof body.note === "string" ? body.note : "",
        days,
        capabilities,
        removeContent: body.removeContent === true,
      });
      return NextResponse.json(result, { headers: NO_STORE });
    }

    return NextResponse.json(
      { error: "action inconnue (assign, note, decide)" },
      { status: 400, headers: NO_STORE },
    );
  } catch (error) {
    return failure(error);
  }
}
