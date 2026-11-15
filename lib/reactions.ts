/** Réactions possibles sur une publication — seule source UI de vérité.
 *
 *  Ce sont de vrais emojis Unicode. Le projet garde le code sans emoji
 *  décoratif, mais une réaction **est** un emoji : c'est le contenu, pas
 *  une décoration, et un trait maison rendait l'émotion moins lisible
 *  qu'un glyphe déjà appris par tout le monde. Le libellé reste la seule
 *  vérité pour l'accessibilité (`aria-label`) : l'emoji est décoratif. */
export const POST_REACTIONS = [
  { emoji: "\u{1F44D}", label: "Approuver" },
  { emoji: "\u{2764}\u{FE0F}", label: "Aimer" },
  { emoji: "\u{1F602}", label: "Rire" },
  { emoji: "\u{1F62E}", label: "Surpris" },
  { emoji: "\u{1F622}", label: "Triste" },
  { emoji: "\u{1F525}", label: "Partager l'élan" },
] as const;

export type PostReaction = (typeof POST_REACTIONS)[number]["emoji"];
