import { supabase } from "@/lib/supabase/client";
import { AUTHOR_COLUMNS } from "@/lib/social";
import type {
  Report,
  ReportReason,
  ReportReason as Reason,
  ReportStatus,
  ReportTarget,
  ReportWithReporter,
} from "@/lib/types";

/**
 * Les signalements, côté données.
 *
 * **Une seule fonction répond à la même chose en mode démonstration et
 * sur le vrai backend**, comme partout ailleurs dans le projet.
 *
 * Ce module ne décide **de rien**. Il ne vérifie pas qu'on peut signaler,
 * ni qu'on peut classer : la RLS le fait, en base, et une vérification
 * ici serait une seconde règle — donc un second endroit où se tromper,
 * et un endroit que l'appelant pourrait contourner. Le rôle de ce
 * fichier est d'écrire la bonne forme et de relire ce qui est lisible.
 *
 * Trois conséquences, qu'il faut accepter :
 *
 *  · un signalement refusé remonte une **erreur Postgres** (`new row
 *    violates…`), affichée telle quelle. Elle est en anglais et Dense ;
 *    l'écran ne la montre pas, il dit « signalement impossible ». Une
 *    erreur technique n'a pas à être lisible, mais elle doit rester
 *    journalisée.
 *
 *  · un doublon n'est pas une erreur utile : la RLS et les index
 *    partiels renvoient une violation de clé unique. C'est traité ici
 *    comme un succès — l'utilisateur a bien signalé, et l'écran n'a
 *    pas à lui annoncer un échec pour une ligne déjà présente.
 *
 *  · `resolved_at` n'est jamais écrit par ce module. Le trigger
 *    `sync_report_resolution` le déduit de `status` ; si l'application
 *    envoyait sa propre date, elle pourrait dater un classement d'aujourd'hui
 *    alors qu'il a eu lieu la semaine dernière.
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

/**
 * Signaler un contenu.
 *
 * `target` décrit **une seule** cible : c'est le seul moyen d'éviter
 * qu'un appel signale trois choses à la fois, et la contrainte
 * `reports_one_target` refuserait de toute façon la ligne.
 */
export async function reportTarget(
  me: string,
  target: { type: ReportTarget; id: string },
  reason: Reason,
  details = "",
): Promise<{ error: string | null; duplicate: boolean }> {
  if (!me) return { error: "Connecte-toi pour signaler", duplicate: false };

  // La ligne ne porte qu'une clé étrangère, les trois autres restent
  // `null`. C'est ce que la contrainte « exactement une cible » attend.
  const row: Record<string, unknown> = {
    reporter_id: me,
    reason,
    details: details.trim().slice(0, 1000),
  };

  switch (target.type) {
    case "post":
      row.post_id = target.id;
      break;
    case "comment":
      row.comment_id = target.id;
      break;
    case "group_message":
      row.message_id = target.id;
      break;
    case "user":
      row.reported_user = target.id;
      break;
  }

  const { error } = await supabase.from("reports").insert(row);

  if (!error) return { error: null, duplicate: false };

  // Un doublon n'est pas un échec : la ligne existe déjà, et l'écran
  // affiche la même chose dans les deux cas — « c'est signalé ».
  if (/duplicate key|23505/i.test(error.message)) {
    return { error: null, duplicate: true };
  }

  return { error: error.message, duplicate: false };
}

/**
 * Les signalements reçus, et les miens.
 *
 * La RLS ne renvoie que ce que la personne courante a le droit de voir :
 * ses propres signalements et ceux visant son contenu. Le seul filtre
 * qu'on ajoute est donc le **sens** de la liste — « reçus » ou « miens » —
 * parce que c'est un choix d'écran, pas une permission.
 */
export async function fetchReports(
  me: string,
  scope: "received" | "mine",
): Promise<ReportWithReporter[]> {
  if (!me) return [];

  let query = supabase
    .from("reports")
    // `reports` vise `users` par deux chemins (`reporter_id`,
    // `reported_user`) : la contrainte portée ici est celle de l'auteur
    // du signalement.
    .select(`*, reporter:users!reports_reporter_id_fkey(${AUTHOR_COLUMNS})`)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  // « reçus » = ceux visant mon contenu ; « miens » = ceux que j'ai
  // écrits. Sans ce filtre, la liste mélangerait les deux et la
  // distinction affichée — « sur ton contenu » / « par toi » — ne
  // serait plus vraie.
  if (scope === "mine") query = query.eq("reporter_id", me);
  else query = query.neq("reporter_id", me);

  const { data } = await query;
  const rows = ((data ?? []) as (Report & { reporter: unknown })[]).filter(Boolean);

  return rows.map((r) => ({
    ...r,
    reporter: (r.reporter ?? null) as ReportWithReporter["reporter"],
    // La RLS ne montre un signalement qu'à son auteur, au signaleur, et
    // au créateur du groupe. Le seul de ces trois qui ne peut pas le
    // classer est le signaleur : la RLS le lui refuse explicitement.
    can_classify: r.reporter_id !== me,
  }));
}

/** Signalements reçus par page dans la vue de modération. */
export const PAGE_SIZE = 50;

/**
 * Classe un signalement : « traité » ou « écarté ».
 *
 * Ne renvoie `resolved_at` à personne : le trigger l'écrit. On relit la
 * ligne après l'écriture pour être sûr que ce qu'on affiche vient bien
 * de la base.
 */
export async function classifyReport(
  id: string,
  status: Exclude<ReportStatus, "open">,
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from("reports")
    .update({ status })
    .eq("id", id)
    .select("id, status, resolved_at")
    .maybeSingle();

  if (error) return { error: error.message };

  // Mise à jour refusée : la RLS a dit non. C'est la seule source de
  // vérité sur ce qui est permis, donc on la respecte plutôt que de
  // croire l'écriture réussie.
  if (!data) return { error: "Ce signalement ne peut pas être classé" };

  return { error: null };
}

/** Combien de signalements restent ouverts — le chiffre de la pastille. */
export async function fetchOpenReportCount(me: string): Promise<number> {
  if (!me) return 0;

  const { data } = await supabase
    .from("reports")
    .select("id")
    .eq("status", "open")
    .neq("reporter_id", me)
    .limit(OPEN_CAP);

  return (data ?? []).length;
}

/**
 * Plafond de lecture du compteur.
 *
 * Même raison que `UNREAD_CAP` dans `lib/notifications.ts` : compter
 * exactement exigerait de lire toutes les lignes ouvertes, ce qui n'a
 * pas de borne. Au-delà du plafond, le nombre est un plancher.
 */
export const OPEN_CAP = 200;