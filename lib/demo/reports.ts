import type { Report } from "@/lib/types";
import { DEMO_COMMENTS } from "./social";
import { DEMO_POSTS, DEMO_USERS } from "./data";

/**
 * Les signalements du jeu de démonstration.
 *
 * Ils sont **écrits à la main** et non générés, pour la même raison que
 * les commentaires : une démonstration doit ressembler à ce que produit
 * le produit. Un signalement générique « spam » répété dix fois
 * n'apprend rien ; trois signalements plausibles, sur trois contenus
 * différents, avec trois motifs différents, en apprennent beaucoup.
 *
 * On en fait **trois**, pour que l'écran de modération ait à faire un tri
 * et non à recopier une liste. Deux sont « ouverts » et un est déjà traité :
 * sans le troisième, la vue ne montrerait jamais un signalement classé
 * et l'interface de classement semblerait morte.
 *
 * Les cibles sont résolues **par recherche** dans les posts et
 * commentaires de démonstration, jamais par un identifiant recopié : un
 * `p-3` écrit deux fois dans deux fichiers est exactement le genre de
 * double vérité que ce projet refuse (cf. `MEMO.md`, bug B4).
 */

const POST = DEMO_POSTS;
const COMMENT = DEMO_COMMENTS;

/** Le post de Koffi — signalé pour son contenu technique. */
const POST_ID: string | undefined = POST.find(
  (p) => p.author_id === "u-koffi",
)?.id ?? POST[0]?.id;

/** Le commentaire de Marcus le plus commenté de la démonstration. */
const COMMENT_ID: string | undefined = COMMENT.find(
  (c) => c.author_id === "u-marcus",
)?.id;

const RAW: {
  reporter_id: string;
  post_id?: string;
  comment_id?: string;
  reported_user?: string;
  reason: Report["reason"];
  details: string;
  status: Report["status"];
  after_minutes: number;
}[] = [
  {
    reporter_id: "u-zainab",
    post_id: POST_ID,
    reason: "spam",
    details:
      "Deuxième message identique aujourd’hui sur trois fils différents. Peut-être un test.",
    status: "open",
    after_minutes: 12,
  },
  {
    reporter_id: "u-youssef",
    comment_id: COMMENT_ID,
    reason: "harassment",
    details: "La phrase sur les « Forgotten function » a été lue comme une insulte.",
    status: "open",
    after_minutes: 47,
  },
  {
    reporter_id: "u-chioma",
    reported_user: "u-marcus",
    reason: "other",
    details: "Propose des études payées via un lien de contact personnel. Je préfère vérifier.",
    status: "resolved",
    after_minutes: 180,
  },
];

/** Déduit `target_type` comme le fait la colonne générée de Postgres. */
function targetType(r: (typeof RAW)[number]): Report["target_type"] {
  if (r.post_id) return "post";
  if (r.comment_id) return "comment";
  if (r.reported_user) return "user";
  return "group_message";
}

export const DEMO_REPORTS: Report[] = RAW.filter(
  // La cible doit exister : sinon la ligne désignerait un contenu fantôme, et
  // l'écran afficherait un signalement sans objet — un état que la base
  // réelle ne produit jamais, puisqu'elle refuse la clé étrangère.
  (r) =>
    (r.post_id === undefined || POST.some((p) => p.id === r.post_id)) &&
    (r.comment_id === undefined || COMMENT.some((c) => c.id === r.comment_id)) &&
    (r.reported_user === undefined || DEMO_USERS.some((u) => u.id === r.reported_user)) &&
    // On ne signale pas son propre contenu — la RLS le refuse.
    r.reporter_id !== r.reported_user,
).map((r, i) => ({
  id: `rep-${i + 1}`,
  reporter_id: r.reporter_id,
  post_id: r.post_id ?? null,
  comment_id: r.comment_id ?? null,
  message_id: null,
  reported_user: r.reported_user ?? null,
  target_type: targetType(r),
  reason: r.reason,
  details: r.details,
  status: r.status,
  resolved_at:
    r.status === "open"
      ? null
      : new Date(Date.parse("2026-09-01T09:00:00Z") + r.after_minutes * 60_000).toISOString(),
  created_at: new Date(Date.parse("2026-09-01T09:00:00Z") + r.after_minutes * 60_000).toISOString(),
}));