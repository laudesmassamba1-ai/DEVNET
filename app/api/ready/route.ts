import { after, NextResponse } from "next/server";
import { checkDatabase, checkFailover } from "@/platform/infrastructure/postgres/pool";
import { probeInactive } from "@/platform/infrastructure/postgres/failover";
import { checkActiveSchema } from "@/platform/infrastructure/postgres/schema-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fenêtre de mutualisation de la sonde base.
 *
 * La sonde ouvre une connexion et lit le contrat de schéma : c'est une
 * opération de bord, pas une route de navigation. Cent requêtes simultanées
 * qui la déclenchent saturent le pool et transforment une mesure de
 * disponibilité en panne. On garde donc le résultat quinze secondes et une
 * seule évaluation en vol par instance.
 *
 * L'état de bascule, lui, n'est **pas** mis en cache : il est déjà servi en
 * mémoire par `checkFailover()` et doit rester frais. Un schéma de secours
 * écrit après la réponse devient ainsi visible au tour suivant, sans
 * attendre l'expiration du cache.
 */
const HEALTH_TTL_MS = 15_000;

type HealthSnapshot = {
  at: number;
  health: Awaited<ReturnType<typeof checkDatabase>>;
  contract: Awaited<ReturnType<typeof checkActiveSchema>> | null;
};

let cachedHealth: HealthSnapshot | null = null;
let inFlightHealth: Promise<HealthSnapshot> | null = null;

async function evaluateHealth(): Promise<HealthSnapshot> {
  const health = await checkDatabase(2_000);

  /* La sonde de secours n'est pas sur le chemin de la réponse : `after`
     prolonge l'invocation serverless après l'envoi. Un `void` nu serait gelé
     dès que la réponse part ; l'attendre ferait payer son délai à chaque
     instance froide et, sous charge, toute la file attendrait. On laisse la
     sonde aller au bout de son propre budget (7 s) pour qu'elle écrive
     réellement l'empreinte de schéma, au lieu de couper à 1,5 s. */
  after(() => probeInactive().catch(() => undefined));

  const contract = health.ok ? await checkActiveSchema().catch(() => null) : null;
  return { at: Date.now(), health, contract };
}

async function healthSnapshot(): Promise<HealthSnapshot> {
  if (cachedHealth && Date.now() - cachedHealth.at < HEALTH_TTL_MS) return cachedHealth;
  if (inFlightHealth) return inFlightHealth;
  inFlightHealth = evaluateHealth();
  try {
    cachedHealth = await inFlightHealth;
    return cachedHealth;
  } finally {
    inFlightHealth = null;
  }
}

export async function GET(): Promise<NextResponse> {
  const snapshot = await healthSnapshot();
  const failover = await checkFailover().catch(() => null);
  let health = snapshot.health;

  /* La bascule a eu lieu pendant cette requête : on remesure sur la secours
     plutôt que d'annoncer une panne déjà réparée. */
  if (!health.ok && failover && failover.active !== "primary") {
    health = await checkDatabase(2_000);
  }

  const ready = health.ok && (!snapshot.contract || snapshot.contract.ok);
  const body = {
    status: ready ? "ready" : "degraded",
    database: health.ok ? "ok" : health.reason,
    ...(health.ok ? { latencyMs: health.latencyMs } : {}),
    ...(snapshot.contract
      ? {
          activeSchema: snapshot.contract.ok ? "ok" : "incomplete",
          schemaMissingCount: snapshot.contract.missing.length,
        }
      : {}),
    ...(failover
      ? {
          active: failover.active,
          standbyConfigured: failover.standbyConfigured,
          schemaMatches: failover.schemaMatches,
          ...(failover.schemaNote ? { schemaNote: failover.schemaNote } : {}),
          ...(failover.standbyError ? { standbyError: failover.standbyError } : {}),
          ...(failover.switchedAt ? { switchedAt: failover.switchedAt } : {}),
          ...(failover.reason ? { reason: failover.reason } : {}),
        }
      : {}),
  };

  return NextResponse.json(body, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
