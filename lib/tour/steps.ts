import type { IconName } from "@/components/Icon";

/**
 * Prise en main de DevNet — le contenu, séparé de la mécanique.
 *
 * Ce fichier ne décrit que **ce qu'on dit et ce qu'on montre**. Le
 * défilement, la surimpression, la navigation entre écrans et la mémoire
 * du passage vivent dans `components/TourOverlay.tsx` et
 * `components/TourProvider.tsx`. Ajouter une étape ne demande donc aucune
 * ligne de logique : une entrée ici, et un `data-tour="…"` sur l'élément
 * visé.
 *
 * Chaque arrêt porte une **route** et, si possible, une **cible** (la
 * valeur d'un attribut `data-tour`). Quand la cible n'existe pas encore
 * sur l'écran — un compte sans projet, une liste vide — la bulle se
 * pose au centre et explique quand même la section : la visite ne casse
 * jamais sur une donnée manquante.
 */

export interface TourSlide {
  icon: IconName;
  eyebrow: string;
  title: string;
  body: string;
  points?: string[];
}

export interface TourStop {
  id: string;
  /** Écran où se joue l'arrêt. */
  route: string;
  /** Attribut `data-tour` visé. Absent : bulle centrée. */
  target?: string;
  /** Où poser la bulle. `auto` choisit selon la place. */
  placement?: "auto" | "top" | "bottom" | "left" | "right";
  icon: IconName;
  title: string;
  body: string;
}

/** L'intro illustrée — trois écrans avant la visite des vraies pages. */
export const INTRO_SLIDES: TourSlide[] = [
  {
    icon: "spark",
    eyebrow: "Bienvenue",
    title: "DevNet, le réseau des développeurs africains",
    body: "Ici, on ne partage pas seulement des publications : on montre son travail, on lit du code, et on progresse ensemble.",
    points: [
      "Étudiants et professionnels, un même fil",
      "Du post au dépôt, puis à l'IDE",
      "Une progression mesurée, jamais déclarée",
    ],
  },
  {
    icon: "terminal",
    eyebrow: "La logique",
    title: "Un espace de travail, pas un fil de plus",
    body: "Chaque écran répond à une question précise : quoi lire, qui suivre, quoi construire, où on en est.",
    points: [
      "Le fil, pour lire et publier",
      "Les groupes pour discuter, les communautés pour publier par thème",
      "Les projets et l'IDE, pour construire et montrer",
    ],
  },
  {
    icon: "target",
    eyebrow: "Prise en main",
    title: "Deux minutes, écran par écran",
    body: "Nous vous guidons dans chaque section et mettons en évidence l'élément à connaître. Vous pouvez passer à tout moment.",
    points: [
      "Suivant et Précédent, à votre rythme",
      "Échap pour quitter",
      "Pour la revoir : Profil → Revoir la visite",
    ],
  },
];

/**
 * Le parcours complet — une station par section.
 *
 * L'ordre suit le trajet naturel : on arrive, on lit le fil, on cherche
 * des gens, on discute, on garde, on se présente, puis on construit.
 */
export const TOUR_STOPS: TourStop[] = [
  {
    id: "nav",
    route: "/feed",
    target: "nav-main",
    placement: "auto",
    icon: "menu",
    title: "La navigation",
    body: "Six onglets sur mobile, un explorateur sur grand écran : le fil, la recherche, les messages, les notifications, le profil, les signets.",
  },
  {
    id: "fil",
    route: "/feed",
    target: "feed-scope",
    icon: "feed",
    title: "Le fil",
    body: "« Tout » lit l'ensemble du réseau, « Abonnements » ne lit que les personnes que vous suivez, « Communautés » ne lit que les fils thématiques.",
  },
  {
    id: "stories",
    route: "/feed",
    target: "feed-stories",
    icon: "bolt",
    title: "Les stories",
    body: "Des nouvelles brèves, disparues au bout de 24 h. Le rail montre qui a quelque chose à dire maintenant.",
  },
  {
    id: "composer",
    route: "/feed",
    target: "composer",
    icon: "edit",
    title: "Publier",
    body: "La bulle de rédaction ouvre le composeur : du texte, un extrait de code coloré, et le rattachement — facultatif — à l'un de vos projets.",
  },
  {
    id: "search",
    route: "/search",
    target: "search-input",
    icon: "search",
    title: "La recherche",
    body: "Un seul champ pour tout : un pseudo, une idée, ou un #hashtag. Les résultats portent sur les personnes, les publications et les étiquettes.",
  },
  {
    id: "search-tabs",
    route: "/search",
    target: "search-tabs",
    placement: "bottom",
    icon: "hash",
    title: "Filtrer",
    body: "Trois onglets pour la même recherche : Gens, Publications, Tags. On change de vue sans retaper la requête.",
  },
  {
    id: "groups",
    route: "/groups",
    target: "groups-list",
    icon: "groups",
    title: "Les groupes",
    body: "Des espaces de discussion par promo, filière ou club. On rejoint un groupe parce qu'on le veut — personne n'y est inscrit d'office.",
  },
  {
    id: "group-new",
    route: "/groups",
    target: "groups-new",
    placement: "auto",
    icon: "plus",
    title: "Créer un groupe",
    body: "Un nom, une description, une catégorie et une icône : de quoi ouvrir un espace à votre promotion ou à votre club en deux minutes.",
  },
  {
    id: "messages",
    route: "/messages",
    target: "messages-list",
    icon: "messages",
    title: "Les messages",
    body: "Vos conversations privées. Sur grand écran, la liste et le fil cohabitent ; sur mobile, on entre dans la conversation, puis on revient.",
  },
  {
    id: "signets",
    route: "/signets",
    target: "signets-list",
    icon: "bookmark",
    title: "Les signets",
    body: "Ce que vous gardez pour plus tard. Un signet est privé : personne ne voit ce que vous enregistrez.",
  },
  {
    id: "profil",
    route: "/profile",
    target: "profile-header",
    icon: "profile",
    title: "Votre profil",
    body: "Votre identité et votre parcours, réunis. L'œil, en haut, ouvre votre profil public — la version que les autres voient.",
  },
  {
    id: "profil-tabs",
    route: "/profile",
    target: "profile-tabs",
    icon: "layers",
    title: "Vos espaces",
    body: "Posts, Travail, Progrès, Infos, Paramètres : ce que vous publiez, ce que vous construisez, ce que vous gagnez, et vos réglages.",
  },
  {
    id: "projets",
    route: "/projects",
    target: "projects-list",
    icon: "package",
    title: "Les projets",
    body: "Chaque projet est un dépôt : ses fichiers, son historique, ses forks. Ceux qui recrutent y lisent votre compatibilité et votre régularité.",
  },
  {
    id: "ide",
    route: "/projects",
    target: "projects-new",
    placement: "bottom",
    icon: "code",
    title: "L'IDE intégré",
    body: "Ouvrir un projet mène à l'IDE dans le navigateur : éditeur, exécution, branches et arbre de forks — sans rien installer.",
  },
  {
    id: "communautes",
    route: "/communities",
    target: "communities-list",
    icon: "globe",
    title: "Les communautés",
    body: "Des fils publics par thème : on y publie des posts et on s'y abonne par sujet. Pour discuter en direct, préférez un groupe.",
  },
  {
    id: "extensions",
    route: "/extensions",
    target: "extensions-list",
    icon: "grid",
    title: "Les extensions",
    body: "Des extraits et des commandes que l'on installe dans l'IDE pour écrire plus vite. Un manifeste, pas du code exécuté.",
  },
  {
    id: "notifications",
    route: "/notifications",
    target: "notifications-list",
    icon: "notifications",
    title: "Les notifications",
    body: "Tout ce qui vous concerne, groupé par type : mentions, abonnements, réponses — et les défis du jour.",
  },
  {
    id: "bell",
    route: "/feed",
    target: "bell",
    placement: "bottom",
    icon: "notifications",
    title: "La cloche",
    body: "Elle vit dans la barre de titre, sur tous les écrans. Son compteur est un plancher : il ne promet jamais plus que ce que la liste montre.",
  },
  {
    id: "fin",
    route: "/feed",
    icon: "check-double",
    title: "Vous êtes prêt",
    body: "La progression se gagne en publiant, en aidant et en construisant. Bonne route — et pour revoir cette visite : Profil → Revoir la visite.",
  },
];
