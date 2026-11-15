import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import {
  assignCase,
  decideCase,
  getCase,
  listCases,
  noteCase,
  readOverview,
  TrustSafetyConflict,
  type CasePriority,
  type CaseStatus,
} from "@/lib/trust-safety/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const STATUSES: ReadonlySet<string> = new Set([
  "open",
  "triaged",
  "investigating",
  "actioned",
  "no_violation",
  "closed",
  "all",
]);
const PRIORITIES: ReadonlySet<string> = new Set(["low", "normal", "high", "urgent"]);

function failure(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "";
  const status = /réservé|permission/i.test(message)
    ? 403
    : /introuvable/i.test(message)
      ? 404
      : error instanceof TrustSafetyConflict
        ? 409
        : /invalide|trop|demande|impossible/i.test(message)
          ? 400
          : 503;
  return NextResponse.json(
    { error: status === 503 ? "console de modération indisponible" : message },
    { status, headers: NO_STORE },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  let userId: string | null;
  try {
    userId = await currentUserId();
  } catch {
    return NextResponse.json(
      { error: "session indisponible" },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!userId) {
    return NextResponse.json({ error: "session requise" }, { status: 401, headers: NO_STORE });
  }

  const url = new URL(request.url);
  try {
    if (url.searchParams.get("view") === "overview") {
      return NextResponse.json({ overview: await readOverview(userId) }, { headers: NO_STORE });
    }

    const status = url.searchParams.get("status") ?? "open";
    const priority = url.searchParams.get("priority");
    const assigned = url.searchParams.get("assigned");
    if (!STATUSES.has(status) || (priority && !PRIORITIES.has(priority))) {
      return NextResponse.json({ error: "filtre invalide" }, { status: 400, headers: NO_STORE });
    }

    const id = url.searchParams.get("id");
    if (id) {
      const detail = await getCase(userId, id);
      if (!detail) {
        return NextResponse.json({ error: "dossier introuvable" }, { status: 404, headers: NO_STORE });
      }
      return NextResponse.json({ case: detail }, { headers: NO_STORE });
    }

    const cases = await listCases(userId, {
      status: status as CaseStatus | "all",
      priority: priority ? (priority as CasePriority) : undefined,
      assigned: assigned === "me" ? "me" : "all",
    });
    return NextResponse.json({ cases }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

const DECISIONS = new Set(["no_violation", "warning", "restrict", "suspend", "ban"]);
const CAPABILITIES = new Set(["post", "comment", "message", "story", "live"]);

export async function POST(request: Request): Promise<NextResponse> {
  let userId: string | null;
  try {
    userId = await currentUserId();
  } catch {
    return NextResponse.json(
      { error: "session indisponible" },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!userId) {
    return NextResponse.json({ error: "session requise" }, { status: 401, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "corps illisible" }, { status: 400, headers: NO_STORE });
  }

  const caseId = typeof body.caseId === "string" ? body.caseId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(caseId)) {
    return NextResponse.json({ error: "dossier invalide" }, { status: 400, headers: NO_STORE });
  }

  try {
    if (body.action === "assign") {
      const assignee =
        typeof body.assigneeId === "string" && body.assigneeId.length > 0
          ? body.assigneeId
          : null;
      await assignCase(userId, caseId, assignee);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    if (body.action === "note") {
      await noteCase(userId, caseId, typeof body.note === "string" ? body.note : "");
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
      if (!DECISIONS.has(decision)) {
        return NextResponse.json(
          { error: "décision invalide" },
          { status: 400, headers: NO_STORE },
        );
      }
      const result = await decideCase(userId, caseId, {
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
