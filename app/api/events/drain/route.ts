/**
 * Drainage de la boîte d'envoi.
 *
 * Deux modes :
 *  - synchrone (défaut) : renvoie le rapport, pour un planificateur ;
 *  - `?background=1` : la réponse part tout de suite et le drainage s'exécute
 *    dans `after()`, pour la pompe légère du navigateur.
 *
 * L'appelant est soit un porteur du secret de drainage (planificateur), soit
 * un utilisateur authentifié. Le travail est borné et idempotent : plusieurs
 * drainages concurrents se répartissent les événements grâce à
 * `FOR UPDATE SKIP LOCKED`.
 */
import { timingSafeEqual } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import { getEventDispatcher } from "@/platform/server-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function hasDrainSecret(request: NextRequest): boolean {
  const configured = process.env.EVENTS_DRAIN_SECRET;
  if (!configured) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided.length !== configured.length) return false;
  return timingSafeEqual(
    Buffer.from(provided),
    Buffer.from(configured),
  );
}

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (hasDrainSecret(request)) return true;

  try {
    return Boolean(await currentUserId());
  } catch {
    return false;
  }
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "drainage non autorisé" }, { status: 401 });
  }

  const dispatcher = getEventDispatcher();
  if (!dispatcher) {
    return NextResponse.json(
      {
        error:
          "DATABASE_URL est absent : le drainage des événements exige PostgreSQL direct.",
      },
      { status: 503 },
    );
  }

  if (request.nextUrl.searchParams.get("background") === "1") {
    after(async () => {
      try {
        const report = await dispatcher.dispatch();
        if (report.claimed > 0) {
          console.info("[events] drainage terminé", report);
        }
      } catch (error) {
        console.error("[events] drainage en arrière-plan impossible", error);
      }
    });
    return NextResponse.json({ scheduled: true }, { status: 202 });
  }

  try {
    const report = await dispatcher.dispatch();
    return NextResponse.json(report);
  } catch (error) {
    console.error("[events] drainage impossible", error);
    return NextResponse.json(
      { error: "drainage impossible" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}
