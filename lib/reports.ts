import { reportService } from "@/platform/container";
import {
  OPEN_REPORT_CAP,
  REPORT_PAGE_SIZE,
} from "@/modules/moderation";
import type {
  ReportReason,
  ReportStatus,
  ReportTarget,
  ReportWithReporter,
} from "@/lib/types";

/**
 * Les signalements, côté API publique.
 *
 * Ce fichier **ne contient plus de requête**. Il garde les libellés que
 * l'écran affiche et délègue les quatre cas d'usage au service du domaine
 * (`modules/moderation`), composé dans `platform/container.ts`.
 *
 * Pourquoi la façade reste : les écrans appellent `reportTarget` et
 * `fetchReports` depuis la vague 2 ; les faire tous changer de chemin en même
 * temps qu'on déplace la frontière mêlerait deux migrations dans un seul
 * diff. La façade est mince et sans logique — c'est ce qui rend le
 * déplacement vérifiable.
 *
 * Ce qui **n'est pas** ici, volontairement : aucune vérification de
 * permission. La RLS décide qui peut signaler et qui peut classer ; une
 * vérification ici serait une seconde règle, donc un second endroit où se
 * tromper, et un endroit qu'un autre client contournerait.
 */

/** Motifs affichés, dans l'ordre où on les propose à la lecture. */
export const REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: "harassment", label: "Harcèlement", hint: "propos insultants, menaces" },
  { value: "spam", label: "Spam", hint: "publicité, contenu répété" },
  { value: "hate", label: "Haine", hint: "discrimination, propos sexiste" },
  { value: "scam", label: "Arnaque", hint: "demande d'argent, faux recruteur" },
  { value: "other", label: "Autre", hint: "explique dans le champ libre" },
];

/** Les quatre cibles, avec le libellé de chacune. */
export const TARGET_LABEL: Record<ReportTarget, string> = {
  post: "publication",
  comment: "commentaire",
  group_message: "message de groupe",
  user: "compte",
};

/** Statuts, du plus récent au plus ancien côté écran. */
export const STATUS_LABEL: Record<ReportStatus, string> = {
  open: "à traiter",
  resolved: "traité",
  dismissed: "écarté",
};

/** Signalements reçus par page dans la vue de modération. */
export const PAGE_SIZE = REPORT_PAGE_SIZE;

/**
 * Plafond de lecture du compteur de pastille.
 *
 * Même raison que `UNREAD_CAP` dans `lib/notifications.ts` : compter
 * exactement exigerait de lire toutes les lignes ouvertes, ce qui n'a pas de
 * borne. Au-delà du plafond, le nombre est un plancher.
 */
export const OPEN_CAP = OPEN_REPORT_CAP;

/**
 * Signaler un contenu.
 *
 * `target` décrit **une seule** cible : c'est le seul moyen d'éviter qu'un
 * appel signale trois choses à la fois, et la contrainte `reports_one_target`
 * refuserait de toute façon la ligne.
 */
export function reportTarget(
  me: string,
  target: { type: ReportTarget; id: string },
  reason: ReportReason,
  details = "",
): Promise<{ error: string | null; duplicate: boolean }> {
  return reportService.reportTarget(me, target, reason, details);
}

/**
 * Les signalements reçus, et les miens.
 *
 * La RLS ne renvoie que ce que la personne courante a le droit de voir : ses
 * propres signalements et ceux visant son contenu. Le seul filtre ajouté est
 * donc le **sens** de la liste — c'est un choix d'écran, pas une permission.
 */
export function fetchReports(
  me: string,
  scope: "received" | "mine",
): Promise<ReportWithReporter[]> {
  return reportService.fetchReports(me, scope);
}

/**
 * Classe un signalement : « traité » ou « écarté ».
 *
 * `resolved_at` n'est jamais écrit par ce chemin : le trigger
 * `sync_report_resolution` le déduit de `status`. Si l'application envoyait sa
 * propre date, elle pourrait dater un classement d'aujourd'hui alors qu'il a
 * eu lieu la semaine dernière.
 */
export function classifyReport(
  id: string,
  status: Exclude<ReportStatus, "open">,
): Promise<{ error: string | null }> {
  return reportService.classifyReport(id, status);
}

/** Combien de signalements restent ouverts — le chiffre de la pastille. */
export function fetchOpenReportCount(me: string): Promise<number> {
  return reportService.fetchOpenReportCount(me);
}
