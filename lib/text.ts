/**
 * Découpage d'un texte en segments affichables.
 *
 * Un post contient deux vocabulaires cliquables : les hashtags
 * (`lib/tags.ts`) et les mentions (`lib/mentions.ts`). Les faire
 * cliquables séparément, avec deux parcours du texte, poserait deux
 * fois la même question — « quel segment commence en premier ? » — et
 * la réponse fausse est facile : deux boucles qui avancent chacune de
 * leur côté finissent par se chevaucher ou par se manger.
 *
 * On les fusionne donc ici, en un seul parcours, et on garde les deux
 * modules de règles intacts : chacun connaît **sa** grammaire, et
 * personne n'a à connaître celle de l'autre.
 *
 * Ce module est pur comme les deux autres, et c'est le troisième point
 * où la règle d'égalité entre les deux modes s'applique : le texte
 * affiché doit porter exactement les mêmes liens que la base, sinon on
 * met en avant un hashtag qui n'est pas indexé, ou une mention qui
 * n'avertit personne.
 */

import { isMentionToken, MENTION_WORD } from "./mentions";
import { isTagToken, TAG_WORD } from "./tags";

/**
 * Un fragment de texte.
 *
 * Le texte reste du **texte** : aucun HTML n'est produit ici. L'écran
 * échappe chaque segment comme il le ferait pour n'importe quelle
 * chaîne, donc un `@` ou un `#` écrit dans un post ne peut pas devenir
 * une balise.
 */
export interface TextSegment {
  text: string;
  /** Renseigné pour un segment qui est un hashtag. */
  tag?: string;
  /** Renseigné pour un segment qui est une mention. */
  mention?: string;
}

/**
 * Découpe un texte en segments texte / hashtags / mentions.
 *
 * À chaque tour on prend **le plus tôt** des deux candidats, donc
 * l'ordre du texte tient même quand les deux vocabulaires se suivent,
 * ce qui arrive dès qu'on écrit « voir #python avec @koffi ».
 *
 * Le point délicat est le groupe de tête de la mention
 * (`(^|[^…])`) : il **consomme** le caractère qui précède le `@`, et
 * ce caractère fait partie du texte affiché. Il faut donc le remettre
 * dans un segment à part — sinon « bonjour @koffi » se lit
 * « bonjour@koffi ». C'est invisible en relecture et très visible à
 * l'écran, d'où le découpage explicite ci-dessous.
 */
export function splitContent(body: string | null | undefined): TextSegment[] {
  if (!body) return [];

  const tag = new RegExp(TAG_WORD.source, "gu");
  const mention = new RegExp(MENTION_WORD.source, "g");

  const segments: TextSegment[] = [];
  let last = 0;

  for (;;) {
    tag.lastIndex = last;
    mention.lastIndex = last;

    const t = tag.exec(body);
    const m = mention.exec(body);

    if (!t && !m) break;

    // À égalité de position, la mention l'emporte : son motif commence
    // par le caractère précédent, donc elle ne peut pas se trouver
    // devant un hashtag sans le chevaucher.
    const mentionWins = Boolean(m) && (!t || m!.index <= t.index);

    if (mentionWins) {
      const token = m![2];
      // `pseudoStart` pointe sur le `@` : le motif est
      // « caractère de tête, puis @, puis le mot », donc la fin du mot
      // est à `index + length - token.length`.
      const pseudoStart = m!.index + m![0].length - token.length;
      const end = m!.index + m![0].length;

      // Le caractère de tête et tout ce qui précède restent du texte.
      if (pseudoStart > last) segments.push({ text: body.slice(last, pseudoStart) });

      segments.push(
        isMentionToken(token)
          ? { text: body.slice(pseudoStart, end), mention: token.toLowerCase() }
          : { text: body.slice(pseudoStart, end) },
      );

      last = end;
      continue;
    }

    const token = t![1];
    const end = t!.index + t![0].length;

    if (t!.index > last) segments.push({ text: body.slice(last, t!.index) });

    segments.push(
      isTagToken(token)
        ? { text: body.slice(t!.index, end), tag: token.toLowerCase() }
        : { text: body.slice(t!.index, end) },
    );

    last = end;
  }

  if (last < body.length) segments.push({ text: body.slice(last) });

  return segments;
}