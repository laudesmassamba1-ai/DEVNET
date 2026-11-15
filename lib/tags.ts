/**
 * Hashtags — la même règle, des deux côtés.
 *
 * Ce module doit rester pur : ni base, ni réseau, ni localStorage. Il est
 * importé par l'application **et** par le moteur de démonstration, et les
 * deux doivent en extraire exactement les mêmes tags — sinon un post
 * publié en démo n'apparaîtrait pas dans la même recherche qu'en
 * production, et l'écart se remarquerait seulement le jour J.
 *
 * La fonction SQL `extract_tags(text)` (migration 007) est le référent.
 * Toute divergence ici doit être corrigée là-bas d'abord.
 */

/**
 * Le mot qui suit un `#`, capturé en entier et **sans être interprété**.
 *
 * `é` compte comme un caractère de mot : c'est volontaire. Si on
 * s'arrêtait au premier caractère ASCII, `#référence` deviendrait le tag
 * « r » — un tag qui n'a aucun sens, mais qui serait indexé, indexable,
 * et proposé dans la recherche. Mieux vaut refuser le tag et garder le
 * texte : `#référence` reste un mot, pas une étiquette.
 *
 * Il faut donc `\p{L}`, pas `\w` : en JavaScript, `\w` ne couvre que
 * l'ASCII **même avec le drapeau `u`**. Avec `\w`, on retomberait
 * précisément dans le piège qu'on cherche à éviter.
 *
 * La décision « est-ce un hashtag ? » est prise ensuite, sur le mot
 * entier, par `isTagToken`.
 *
 * Exporté parce que `lib/text.ts` parcourt le texte une seule fois
 * pour hashtags **et** mentions : deux boucles concurrentes
 * finiraient par se chevaucher.
 */
export const TAG_WORD = /#([\p{L}\p{N}_]+)/gu;

/**
 * Un mot devient-il un hashtag ?
 *
 * Trois refus, et pas un seul :
 *
 * - **accentué** : `#référence` n'est pas un hashtag. Le standard
 *   n'admet que l'ASCII dans un tag, et un tag accentué devrait être
 *   translittéré — ce que nous ne faisons pas, faute de savoir vers quoi.
 *   Plutôt qu'un tag faux, pas de tag.
 * - **numérique** : `#42` est un numéro d'issue, pas une étiquette.
 * - **vide** : `#` seul, comme dans « C# » et « F# ».
 */
export function isTagToken(token: string): boolean {
  if (!token) return false;
  // Accents et autres caractères hors ASCII : pas un tag.
  if (!/^[A-Za-z0-9_]+$/.test(token)) return false;
  // Un nombre : un numéro d'issue, pas une étiquette.
  if (/^[0-9]+$/.test(token)) return false;
  return true;
}

/**
 * Extrait les hashtags d'un texte.
 *
 * Le mot qui suit le `#` est capturé en entier, puis validé par
 * `isTagToken`. Le résultat est **normalisé en minuscules** et
 * dédupliqué : `#Python` et `#python` désignent la même chose, et une
 * recherche qui distingue les deux paraît cassée.
 *
 * L'underscore compte dans le tag : `#machine_learning` est une seule
 * étiquette, pas deux comme le partagerait un découpage sur `_`.
 */
export function extractTags(body: string | null | undefined): string[] {
  if (!body) return [];

  const tags = new Set<string>();

  for (const match of body.matchAll(TAG_WORD)) {
    const token = match[1];
    if (isTagToken(token)) tags.add(token.toLowerCase());
  }

  return [...tags];
}

/**
 * Rend les hashtags cliquables dans un texte de post.
 *
 * Le texte affiché n'est pas de la donnée : il est reconstruit à partir
 * des segments, et chaque `#tag` devient un lien. Sans cela, un post qui
 * écrit `#python` ne mènerait nulle part — un tag qu'on peut écrire mais
 * pas suivre est une promesse non tenue.
 *
 * On renvoie des **segments** plutôt que du HTML : le texte passe par
 * `esc()` comme le reste du contenu, donc un hashtag ne peut pas devenir
 * un vecteur d'injection.
 */
export interface TextSegment {
  text: string;
  /** Renseigné uniquement pour un segment qui est un hashtag. */
  tag?: string;
}

/**
 * Découpe un texte en segments texte et hashtags.
 *
 * Même expression que `extractTags`, pour que les deux ne puissent pas
 * diverger : un tag surlignable qui n'est pas le tag indexé serait une
 * incohérence visible immédiatement.
 */
export function splitTags(body: string | null | undefined): TextSegment[] {
  if (!body) return [];

  const segments: TextSegment[] = [];
  // Le séparateur reste dans le segment précédent : le texte doit rester
  // identique, espaces compris.
  const re = new RegExp(TAG_WORD.source, "gu");

  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(body)) !== null) {
    const token = match[1];
    const cliquable = isTagToken(token);

    if (match.index > last) {
      segments.push({ text: body.slice(last, match.index) });
    }

    segments.push(
      cliquable
        ? { text: match[0], tag: token.toLowerCase() }
        : // `#42`, `#référence` : affiché tel quel, mais pas cliquable.
          { text: match[0] },
    );

    last = match.index + match[0].length;
  }

  if (last < body.length) segments.push({ text: body.slice(last) });

  return segments;
}