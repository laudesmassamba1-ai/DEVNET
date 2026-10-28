/**
 * Mentions — la même règle, des deux côtés.
 *
 * Ce module doit rester pur : ni base, ni réseau, ni localStorage. Le
 * moteur de démonstration l'utilise pour rejouer les déclencheurs de la
 * migration 010, et l'application pour rendre `@pseudo` cliquable. Les
 * deux doivent en extraire exactement les mêmes pseudos — sinon un
 * commentaire écrit en démo n'avertirait personne, alors que le même
 * commentaire avertirait en production.
 *
 * La fonction SQL `extract_mentions(text)` (migration 010) est le
 * référent. Toute divergence ici doit être corrigée là-bas d'abord.
 */

/**
 * Le mot qui suit un `@`, avec le caractère qui le précède.
 *
 * Le groupe de tête est la partie la moins évidente de la règle, et la
 * plus nécessaire : sans lui, une adresse email produirait des mentions.
 * Dans `contact@koffi.dev`, le groupe refuse le premier `@` (collé à
 * `contact`) et le second (collé à `koffi`), et rien n'est extrait. La
 * règle est donc « un `@` qui ouvre un mot », et un mot ne commence pas
 * au milieu d'un autre.
 *
 * Les caractères exclus sont ceux qui peuvent appartenir à la partie
 * locale d'une adresse email : `A-Za-z0-9._%+-`.
 *
 * Le mot est capturé en classe **ASCII** `[A-Za-z0-9_]`, ce qui revient
 * à capturer large puis refuser : `@référence` ne capture rien, donc ne
 * produit rien — même résultat, une expression de moins. La version SQL
 * procède de même, avec la même classe.
 *
 * `^` en tête autorise la mention en début de texte sans consommer de
 * caractère : le groupe vaut alors la chaîne vide.
 *
 * Exporté parce que `lib/text.ts` parcours le texte une seule fois
 * pour hashtags **et** mentions.
 */
export const MENTION_WORD = /(^|[^A-Za-z0-9._%+-])@([A-Za-z0-9_]+)/g;

/**
 * Un mot devient-il une mention ?
 *
 * Un seul refus : **numérique**. `@42` est un numéro de ticket, pas un
 * compte. Le mot vide n'arrive pas ici — `[A-Za-z0-9_]+` exige au moins
 * un caractère — et l'accentué non plus, il n'est jamais capturé.
 */
export function isMentionToken(token: string): boolean {
  if (!token) return false;
  return !/^[0-9]+$/.test(token);
}

/**
 * Extrait les pseudos mentionnés d'un texte, sans filtrer.
 *
 * La fonction ne connaît aucun compte : elle rend la liste de ce que le
 * texte **semble** mentionner. C'est à l'appelant de confronter cette
 * liste à la table `users` — c'est lui qui sait, et c'est la seule façon
 * de garder ce module pur.
 *
 * Les pseudos sont normalisés en minuscules : `handle_new_user` les crée
 * ainsi, donc `@Koffi` et `@koffi` désignent le même compte. Sans cette
 * normalisation, une mention écrite en majuscule ne réveillerait
 * personne — et l'écart ne se verrait qu'en production, où le pseudo
 * existe mais ne correspond à aucune ligne.
 */
export function extractMentions(body: string | null | undefined): string[] {
  if (!body) return [];

  const found = new Set<string>();

  for (const match of body.matchAll(new RegExp(MENTION_WORD.source, "g"))) {
    const token = match[2];
    if (isMentionToken(token)) found.add(token.toLowerCase());
  }

  return [...found];
}