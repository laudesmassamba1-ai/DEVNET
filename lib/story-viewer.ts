/**
 * Le type du média en base ne suffit plus : une vidéo publiable (plus de
 * 3 Mo) vit sur le stockage objet et seule son URL est retenue. On la
 * reconnaît donc à son extension, avant tout autre test.
 */
export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|ogv|mov|m4v)(?:$|[?#])/i.test(url);
}

/** Durée d'affichage d'une story avant de passer à la suivante. */
export const STORY_MS = 7000;

/**
 * Réactions rapides.
 *
 * Un emoji est envoyé comme une réponse privée — c'est exactement ce qu'il
 * est : un mot adressé à l'auteur, qui arrive dans la messagerie. Inventer
 * un second canal de réaction aurait créé deux endroits où lire la même
 * intention.
 */
export const QUICK_REACTIONS = ["🔥", "👏", "😂", "🙌", "💡"] as const;

/** Le geste qui ferme : un glissement vertical franc, pas un frôlement. */
export const CLOSE_SWIPE_PX = 110;
/** Le geste qui tourne la page : horizontal, et plus long que haut. */
export const PAGE_SWIPE_PX = 70;

/**
 * Le fond d'un statut qui n'a que du texte.
 *
 * Les statuts exportés portent leur fond dans l'image ; ceux qui n'ont
 * que du texte — le seed de démonstration, les anciens — tombaient sur
 * un noir plat et une boîte grise derrière les mots. Une teinte tirée de
 * l'identifiant donne un fond stable (le même à chaque ouverture) sans
 * ajouter une colonne en base.
 */
export function storyTint(id: string): number {
  // Seuls les fonds sombres : le texte d'un statut est blanc, et un
  // dégradé clair le rendait illisible — deux fois invisible, une fois
  // sur le fond, une fois sur le mot.
  const dark = [1, 3, 5, 7];
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 997;
  }
  return dark[hash % dark.length];
}
