import type {
  ReportReason,
  ReportStatus,
  ReportTarget,
  ReportWithReporter,
} from "@/lib/types";
import type { ReportRepository, ReportScope } from "../ports/report-repository";

/**
 * Cas d'usage des signalements.
 *
 * Le service ne décide d'aucun droit : il compose ce que le dépôt renvoie. Il
 * porte en revanche trois décisions qui sont du produit, pas du stockage :
 *
 * - un **doublon** n'est pas un échec — la personne a bien signalé ;
 * - une mise à jour **refusée** est un échec — la RLS a dit non et l'écran ne
 *   doit pas prétendre le contraire ;
 * - `can_classify` se déduit du lecteur : on ne classe pas son propre
 *   signalement, et c'est l'écran qui l'exprime.
 */
export function createReportService(getRepository: () => ReportRepository) {
  return {
    async reportTarget(
      me: string,
      target: { type: ReportTarget; id: string },
      reason: ReportReason,
      details = "",
    ): Promise<{ error: string | null; duplicate: boolean }> {
      if (!me) return { error: "Connecte-toi pour signaler", duplicate: false };

      const { error } = await getRepository().insert({
        reporterId: me,
        reason,
        details: details.trim().slice(0, 1000),
        target,
      });

      if (!error) return { error: null, duplicate: false };
      if (/duplicate key|23505/i.test(error)) {
        return { error: null, duplicate: true };
      }
      return { error, duplicate: false };
    },

    async fetchReports(
      me: string,
      scope: ReportScope,
    ): Promise<ReportWithReporter[]> {
      if (!me) return [];

      const rows = await getRepository().list(me, scope);
      return rows.map((row) => ({
        ...row,
        can_classify: row.reporter_id !== me,
      }));
    },

    async classifyReport(
      id: string,
      status: Exclude<ReportStatus, "open">,
    ): Promise<{ error: string | null }> {
      const { error, updated } = await getRepository().classify(id, status);

      if (error) return { error };
      if (!updated) return { error: "Ce signalement ne peut pas être classé" };
      return { error: null };
    },

    async fetchOpenReportCount(me: string): Promise<number> {
      if (!me) return 0;
      return getRepository().countOpen(me);
    },
  };
}
