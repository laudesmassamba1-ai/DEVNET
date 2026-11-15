/**
 * Canaux — règles pures.
 *
 * Le même raisonnement que le reste du projet : la logique d'un canal vit
 * ici, la base ne fait que stocker, et l'écran ne fait que dessiner. Ce
 * qui permet de tester le nontrivial — collision de slugs, tri, nom lisible
 * — sans navigateur ni serveur.
 */

/** Un canal, tel que l'écran en a besoin (le type complet vient de `lib/types`). */
export interface ChannelLite {
  id: string;
  slug: string;
  name: string;
  topic: string;
  position: number;
  is_private: boolean;
}

/**
 * Transforme un nom de canal en slug.
 *
 * Deux règles, non négociables :
 *
 * - **minuscules et sans accent** — un canal s'écrit `#developpement` et se
 *   tape ainsi dans tous les clients ; deux variantes du même nom
 *   (« dev » et « Dev ») seraient deux canaux, ce qui est exactement ce
 *   qu'on veut éviter ;
 * - **jamais vide** — un nom entièrement accentué ou ponctuation donne un
 *   slug vide, et un canal `#` n'est pas cliquable.
 */
export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  // Un nom non latin (« 日本語 ») ne survit pas à la normalisation ci-dessus.
  // Plutôt que de refuser le canal, on retombe sur une valeur stable, et
  // l'appelant affichera le nom d'origine — le slug n'est jamais lu par un
  // humain.
  return base || "canal";
}

/**
 * Slug libre parmi ceux déjà pris.
 *
 * Le suffixe est numérique et lisible (`general-2`), pas aléatoire : deux
 * personnes qui créent « général » puis « général » obtiennent des noms
 * qu'on peut se dicter dans une conversation.
 */
export function uniqueSlug(name: string, taken: string[]): string {
  const base = slugify(name);
  if (!taken.includes(base)) return base;

  // On repart du nom normalisé, pas de `general-2-3` : le nom saisi reste
  // la source de vérité.
  const stem = base.replace(/-\d+$/, "");
  let n = 2;
  while (taken.includes(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

/** Le nom tel qu'il s'affiche dans la liste : préfixe dièse compris. */
export const channelLabel = (c: Pick<ChannelLite, "name" | "slug">): string =>
  `#${c.name || c.slug}`;

/**
 * Un nom de canal est-il acceptable ?
 *
 * On refuse les noms vides, les noms de plus de 32 caractères (un onglet
 * tronqué n'est pas lisible) et ceux qui sont uniquement des symboles —
 * « ### » est un bruit, pas un canal.
 */
export function isValidChannelName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 32) return false;
  return /[\p{L}\p{N}]/u.test(trimmed);
}

/**
 * Canaux dans l'ordre d'affichage.
 *
 * `position` d'abord, puis le nom : deux canaux créés dans la même seconde
 * ont la même position, et l'ordre ne doit pas dépendre de l'ordre de
 * lecture de la base, qui n'est pas garanti.
 */
export function orderChannels(channels: ChannelLite[]): ChannelLite[] {
  return [...channels].sort((a, b) =>
    a.position !== b.position ? a.position - b.position : a.name < b.name ? -1 : 1,
  );
}

/** Le canal à ouvrir par défaut : le premier, ou le premier public. */
export function defaultChannel(channels: ChannelLite[]): ChannelLite | null {
  const ordered = orderChannels(channels);
  return ordered.find((c) => !c.is_private) ?? ordered[0] ?? null;
}

/**
 * Retrouve un canal par son slug dans l'URL.
 *
 * Un lien vers un canal supprimé ne renvoie pas « rien » mais le canal par
 * défaut : l'appelant affiche toujours une discussion, et l'URL se corrige
 * d'elle-même en écrivant le slug réellement ouvert.
 */
export function findBySlug(channels: ChannelLite[], slug: string | null): ChannelLite | null {
  if (!slug) return defaultChannel(channels);
  return channels.find((c) => c.slug === slug) ?? defaultChannel(channels);
}

/** Libellé du bouton « nouveau canal », selon la langue de l'interface. */
export function unreadBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

/**
 * Messages d'un groupe, répartis par canal.
 *
 * Les messages **sans canal** sont rattachés à une clé de repli : ils
 * existent encore après une migration, et les laisser hors de tout canal
 * les rendrait invisibles. Ils sont marqués pour que l'écran puisse les
 * distinguer d'un vrai canal.
 */
export function groupByChannel<T extends { channel_id?: string | null }>(
  messages: T[],
): { key: string; messages: T[]; orphan: boolean }[] {
  const buckets = new Map<string, T[]>();

  for (const m of messages) {
    const key = m.channel_id ?? "__sans_canal__";
    const list = buckets.get(key);
    if (list) list.push(m);
    else buckets.set(key, [m]);
  }

  return [...buckets.entries()].map(([key, list]) => ({
    key,
    messages: list,
    orphan: key === "__sans_canal__",
  }));
}