/**
 * Classement du fil « Pour toi ».
 *
 * ## Pourquoi un algorithme, et lequel
 *
 * Le fil « Tout » est chronologique : c'est prévisible, donc sain, et il reste
 * le défaut. Mais un fil chronologique pur laisse mourir une publication qui a
 * demandé deux jours de travail parce qu'elle est tombée un dimanche soir. Le
 * classement ci-dessous ne cherche pas à « maximiser l'engagement » — cette
 * formule produit des fils qui hurlent. Il cherche trois choses :
 *
 *  1. **La valeur pour la personne qui lit** : ce qu'elle a déjà suivi, sa
 *     filière, les preuves (code, projets) plutôt que le bruit.
 *  2. **La fraîcheur** : une publication d'il y a trois semaines n'est plus
 *     une nouvelle, sauf si elle est encore discutée.
 *  3. **La diversité** : cinq publications du même auteur d'affilée ne sont
 *     pas un fil, c'est un mur. On pénalise la répétition d'auteur et de tag.
 *
 * ## Ce que ce module ne fait pas
 *
 * - Il ne cache rien et ne « déprioritise » personne : les scores sont
 *   explicables, et chaque terme est visible dans `scorePost`.
 * - Il n'utilise ni donnée sensible ni profilage persistant. Le contexte est
 *   la session : abonnements, filière, rien de plus.
 * - Il n'est pas aléatoire d'un rendu à l'autre : le jitter est déterministe
 *   à partir de l'identifiant, donc recharger ne réordonne pas tout.
 *
 * Le module est pur : aucune requête, aucune horloge implicite (sauf `now`
 * passé explicitement). C'est ce qui permet de le tester et de l'expliquer.
 */

export type RankablePost = {
  id: string;
  author_id?: string | null;
  created_at?: string | null;
  likes?: number | null;
  comments?: number | null;
  reposts?: number | null;
  has_code?: boolean | null;
  media_type?: string | null;
  gif_url?: string | null;
  text?: string | null;
  /** Signalements encore ouverts sur cette publication. */
  open_reports?: number | null;
  author?: {
    id?: string;
    verified?: boolean | null;
    filiere?: string | null;
    niveau?: string | null;
  } | null;
};

export type RankingContext = {
  now?: number;
  followedAuthorIds?: Iterable<string>;
  viewerFiliere?: string | null;
};

/** Fraîcheur : au-delà de trois jours, une publication n'est plus « neuve ». */
const FRESHNESS_HOURS = 36;
/** Le jitter reste petit : il casse les ex aequo, il ne décide pas du fil. */
const JITTER_MAX = 0.35;

function number(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Hash déterministe et bon marché d'un identifiant, dans [0, 1). */
function stableJitter(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

function ageHours(createdAt: string | null | undefined, now: number): number {
  if (!createdAt) return FRESHNESS_HOURS * 4;
  const time = Date.parse(createdAt);
  if (!Number.isFinite(time)) return FRESHNESS_HOURS * 4;
  return Math.max(0, (now - time) / 3_600_000);
}

/** Les tags d'un texte, normalisés — servent seulement à la diversité. */
export function tagsOf(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(/#([\p{L}\p{N}_]{2,30})/gu)]
    .map((match) => match[1].toLowerCase())
    .slice(0, 6);
}

export type ScoreBreakdown = {
  score: number;
  affinity: number;
  engagement: number;
  freshness: number;
  quality: number;
  penalty: number;
  jitter: number;
};

/**
 * Score d'une publication, terme par terme.
 *
 * Les poids sont volontairement lisibles et arrondis. Un lecteur qui se
 * demande « pourquoi ce post est là » doit pouvoir le comprendre sans
 * instrumenter quoi que ce soit.
 */
export function scorePost(
  post: RankablePost,
  context: RankingContext = {},
): ScoreBreakdown {
  const now = context.now ?? Date.now();
  const followed = new Set(context.followedAuthorIds ?? []);
  const authorId = post.author_id ?? post.author?.id ?? null;

  let affinity = 0;
  if (authorId && followed.has(authorId)) affinity += 3;
  if (
    context.viewerFiliere
    && post.author?.filiere
    && post.author.filiere === context.viewerFiliere
  ) {
    affinity += 0.8;
  }
  if (post.author?.verified) affinity += 0.4;

  const engagement =
    Math.log1p(number(post.likes)) * 1.1
    + Math.log1p(number(post.comments)) * 1.6
    + Math.log1p(number(post.reposts)) * 1.9;

  const age = ageHours(post.created_at, now);
  const freshness = 4 * Math.exp(-age / FRESHNESS_HOURS);

  let quality = 0;
  if (post.has_code) quality += 1.2;
  if (post.media_type === "image") quality += 0.35;
  if (post.gif_url) quality += 0.15;
  const textLength = (post.text ?? "").trim().length;
  if (textLength >= 140) quality += 0.35;
  else if (textLength > 0 && textLength < 12) quality -= 0.25;

  // Un signalement ouvert n'efface pas la publication — la modération
  // tranche — mais il ne la met pas en avant.
  const penalty = number(post.open_reports) * 2.5;

  const jitter = stableJitter(post.id) * JITTER_MAX;

  return {
    score: affinity + engagement + freshness + quality + jitter - penalty,
    affinity,
    engagement,
    freshness,
    quality,
    penalty,
    jitter,
  };
}

/**
 * Ordonne un lot de candidats.
 *
 * Glouton, avec pénalité de répétition : on choisit toujours le meilleur
 * restant, mais un auteur déjà choisi deux fois perd 1,6 point, et un tag déjà
 * vu perd 0,25. Ce n'est pas un optimum global — c'est une garantie simple
 * qu'aucun auteur ne prend tout le haut du fil.
 */
export function rankPosts<T extends RankablePost>(
  posts: T[],
  context: RankingContext = {},
): T[] {
  const remaining = posts.map((post) => ({
    post,
    ...scorePost(post, context),
    tags: tagsOf(post.text),
  }));

  const ordered: T[] = [];
  const authorCount = new Map<string, number>();
  const tagCount = new Map<string, number>();
  /*
   * 3,2 points par occurrence du même auteur. C'est volontairement plus
   * qu'un « petit bonus » : un fil où les six premières cartes viennent du
   * même compte n'est pas un fil, c'est un mur. Le chiffre est calibré pour
   * qu'un contenu très engageant puisse encore passer deux fois, pas trois
   * fois d'affilée.
   */
  const AUTHOR_PENALTY = 3.2;
  const TAG_PENALTY = 0.25;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index];
      const authorId = entry.post.author_id ?? entry.post.author?.id ?? "";
      const repetition =
        (authorId ? (authorCount.get(authorId) ?? 0) : 0) * AUTHOR_PENALTY
        + entry.tags.reduce((sum, tag) => sum + (tagCount.get(tag) ?? 0) * TAG_PENALTY, 0);
      const adjusted = entry.score - repetition;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIndex = index;
      }
    }

    const [chosen] = remaining.splice(bestIndex, 1);
    ordered.push(chosen.post);
    const authorId = chosen.post.author_id ?? chosen.post.author?.id ?? "";
    if (authorId) authorCount.set(authorId, (authorCount.get(authorId) ?? 0) + 1);
    for (const tag of chosen.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
  }

  return ordered;
}
