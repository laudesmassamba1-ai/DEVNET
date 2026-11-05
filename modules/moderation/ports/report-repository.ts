import type {
  ReportReason,
  ReportStatus,
  ReportTarget,
  ReportWithReporter,
} from "@/lib/types";

/**
 * Port du domaine « modération ».
 *
 * Le contrat ne dit **rien** du fournisseur : il parle de signalements, de
 * portée de lecture et de classement. C'est ce qui permet à `lib/reports.ts`
 * de rester l'API publique de l'écran sans savoir si la ligne vient de
 * Supabase, de la démo ou, plus tard, de PostgreSQL direct.
 *
 * `ReportRow` est `ReportWithReporter` **moins** `can_classify` : le droit de
 * classer n'est pas une donnée de la base, c'est une conséquence de qui lit.
 * Le calcul appartient au service, pas à l'adaptateur — un adaptateur qui
 * déciderait d'un droit serait une seconde règle, et un second endroit où se
 * tromper.
 */
export type ReportRow = Omit<ReportWithReporter, "can_classify">;

export type ReportScope = "received" | "mine";

/** Ce qu'un signalement a besoin de porter pour être écrit. */
export interface ReportInsert {
  reporterId: string;
  reason: ReportReason;
  details: string;
  /** Une seule cible : la base refuse une ligne qui en porterait deux. */
  target: { type: ReportTarget; id: string };
}

export interface ReportRepository {
  /** Écrit le signalement. Une violation de clé unique remonte son message. */
  insert(report: ReportInsert): Promise<{ error: string | null }>;

  /** Ce que la personne courante a le droit de lire, dans un sens donné. */
  list(readerId: string, scope: ReportScope): Promise<ReportRow[]>;

  /**
   * Classe un signalement. `updated: false` signifie que rien n'a été écrit
   * — la RLS a refusé — et doit être traité comme un refus, pas comme un
   * succès silencieux.
   */
  classify(
    id: string,
    status: Exclude<ReportStatus, "open">,
  ): Promise<{ error: string | null; updated: boolean }>;

  /** Nombre de signalements ouverts, plafonné. */
  countOpen(readerId: string): Promise<number>;
}

/** Signalements lus par page dans la vue de modération. */
export const REPORT_PAGE_SIZE = 50;

/**
 * Plafond du compteur de pastille.
 *
 * Compter exactement exigerait de lire toutes les lignes ouvertes, sans
 * borne. Au-delà du plafond, le nombre affiché est un plancher — et l'écran
 * le dit quand il l'atteint.
 */
export const OPEN_REPORT_CAP = 200;
