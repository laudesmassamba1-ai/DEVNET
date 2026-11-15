import { NextRequest, NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Demandes de conformité côté compte.
 *
 * Un utilisateur peut demander l'export de ses données ou leur
 * suppression. Il n'a besoin d'aucun privilège : c'est son droit, pas une
 * faveur. La route ne permet donc que deux choses — déposer une demande
 * et lire les siennes. La politique RLS de `compliance_requests` fait le
 * reste : même en changeant l'identifiant dans la requête, un compte ne
 * verra jamais la demande d'un autre.
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(): Promise<NextResponse> {
  let userId: string | null;
  try {
    userId = await currentUserId();
  } catch {
    return NextResponse.json({ error: "session indisponible" }, { status: 503, headers: NO_STORE });
  }
  if (!userId) {
    return NextResponse.json({ error: "session requise" }, { status: 401, headers: NO_STORE });
  }

  try {
    const rows = await withUser(userId, (query) =>
      query<{
        id: string;
        kind: string;
        status: string;
        note: string;
        resolution: string | null;
        created_at: string;
        resolved_at: string | null;
      }>(`
        select id, kind, status, note, resolution, created_at, resolved_at
          from public.compliance_requests
         where user_id = $1
         order by created_at desc
         limit 20
      `, [userId]),
    );
    return NextResponse.json({ requests: rows }, { headers: NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "demandes indisponibles" },
      { status: 503, headers: NO_STORE },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let userId: string | null;
  try {
    userId = await currentUserId();
  } catch {
    return NextResponse.json({ error: "session indisponible" }, { status: 503, headers: NO_STORE });
  }
  if (!userId) {
    return NextResponse.json({ error: "session requise" }, { status: 401, headers: NO_STORE });
  }

  let body: { kind?: unknown; note?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "corps JSON invalide" }, { status: 400, headers: NO_STORE });
  }

  const kind = body.kind === "export" || body.kind === "deletion" ? body.kind : null;
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : "";
  if (!kind) {
    return NextResponse.json(
      { error: "type de demande invalide" },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const rows = await withUser(userId, (query) =>
      query<{ id: string }>("select public.submit_compliance_request($1, $2) as id", [
        kind,
        note,
      ]),
    );
    return NextResponse.json({ id: rows[0]?.id ?? null }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("déjà en cours")) {
      return NextResponse.json({ error: message }, { status: 409, headers: NO_STORE });
    }
    if (/inconnu|requise/.test(message)) {
      return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE });
    }
    return NextResponse.json(
      { error: "dépôt impossible" },
      { status: 503, headers: NO_STORE },
    );
  }
}
