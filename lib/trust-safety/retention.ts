/**
 * Rétention des artefacts Trust & Safety.
 *
 * Une preuve de contenu supprimé est conservée 180 jours : assez pour
 * instruire un recours, pas assez pour devenir une archive permanente de
 * contenu nuisible. Les exécutions de moteurs, qui ne contiennent aucun
 * contenu, suivent la même fenêtre.
 *
 * La purge est un travail de fond, jamais un geste d'écran. Elle supprime
 * uniquement ce que la date a rendu expiré, et elle ne touche ni les
 * dossiers ni les décisions.
 */
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";

export async function purgeExpiredTrustSafety(): Promise<{
  evidence: number;
  runs: number;
}> {
  const pool = getPostgresPool();
  const [evidence, runs] = await Promise.all([
    pool.query(
      "delete from public.moderation_evidence where expires_at < now()",
    ),
    pool.query(
      "delete from public.moderation_engine_runs where created_at < now() - interval '180 days'",
    ),
  ]);
  return {
    evidence: evidence.rowCount ?? 0,
    runs: runs.rowCount ?? 0,
  };
}
