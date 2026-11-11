/**
 * Le jeu d'icônes de DevNet — un seul trait, une seule main.
 *
 * Rien ici ne vient d'une bibliothèque : chaque dessin part d'une métaphore
 * de l'application. Un engrenage dirait « réglages » comme il dirait
 * « moteur » ; trois curseurs disent qu'on règle quelque chose. Une loupe
 * dirait « chercher » comme dans un navigateur ; la rose des vents dit
 * qu'on explore un réseau.
 *
 * Contraintes communes : grille 24 × 24, trait 1,7, bouts ronds, aucune
 * couleur en dur (`currentColor`), rien qui dépende du thème. Les formes
 * fermées (cœur, signet, étoile, éclair) restent justes quand `fill` les
 * remplit ; les tracés ouverts ne sont jamais remplis.
 */
import type { ReactNode } from "react";

export type GlyphName =
  // sections
  | "feed"
  | "groups"
  | "messages"
  | "profile"
  | "search"
  | "notifications"
  | "settings"
  | "help"
  | "logout"
  | "dots"
  // gestes
  | "like"
  | "heart"
  | "comment"
  | "reply"
  | "share"
  | "repost"
  | "bookmark"
  | "follow"
  | "send"
  // primitives
  | "plus"
  | "close"
  | "check"
  | "check-double"
  | "edit"
  | "trash"
  | "copy"
  | "link"
  | "download"
  | "image"
  | "eye"
  | "eye-off"
  | "arrow-left"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "menu"
  | "compass"
  // développement
  | "code"
  | "terminal"
  | "branch"
  | "command"
  | "hash"
  | "package"
  | "server"
  | "bolt"
  | "layers"
  | "grid"
  | "cursor"
  | "keyboard"
  | "file"
  | "stop"
  | "play"
  | "fork"
  // signaux
  | "pin"
  | "star"
  | "verified"
  | "globe"
  | "lock"
  | "flame"
  | "trophy"
  | "chart"
  | "spark"
  | "medal"
  | "target"
  | "info"
  | "flag"
  | "smile"
  | "droplet"
  | "sun"
  | "moon"
  | "gif"
  | "video"
  | "pause"
  | "volume"
  | "volume-off"
  // surfaces
  | "studio"
  | "execute"
  | "sticker";

export const GLYPHS: Record<GlyphName, ReactNode> = {
  /* ── Sections ───────────────────────────────────────────────────── */

  // Le fil : un graphe qui se propage, pas un journal.
  feed: (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="7" r="1.8" />
      <circle cx="9" cy="17" r="2.2" />
      <path d="M8 7.4 15.9 7M7.2 8.1l1.2 6.8M11.1 16.3l5.3-6.9" />
    </>
  ),

  // Trois personnes autour d'un même point.
  groups: (
    <>
      <circle cx="12" cy="8.4" r="2.6" />
      <circle cx="5.6" cy="15.2" r="2.2" />
      <circle cx="18.4" cy="15.2" r="2.2" />
      <path d="M7.9 17.2c.7-2 2.3-3.1 4.1-3.1s3.4 1.1 4.1 3.1M10.9 8.4c0-1.2.5-2 1.1-2.6M3.4 16.9c.3-.9.9-1.6 1.7-1.9M20.6 16.9c-.3-.9-.9-1.6-1.7-1.9" />
    </>
  ),

  // Deux bulles qui se répondent, décalées.
  messages: (
    <>
      <path d="M3.5 6.2A2.2 2.2 0 0 1 5.7 4h7.6a2.2 2.2 0 0 1 2.2 2.2v4.1a2.2 2.2 0 0 1-2.2 2.2H7.4L3.5 15z" />
      <path d="M9.5 12.2h8.8a2.2 2.2 0 0 1 2.2 2.2v3.4a2.2 2.2 0 0 1-2.2 2.2h-1.6L14 21.4v-1.4H9.5a2.2 2.2 0 0 1-2.2-2.2" />
    </>
  ),

  // Un buste avec sa pastille d'état : une personne, pas un pion.
  profile: (
    <>
      <circle cx="12" cy="9" r="3.4" />
      <path d="M5.2 20c.6-3.3 3.3-5.3 6.8-5.3s6.2 2 6.8 5.3" />
      <circle cx="18.4" cy="17.6" r="2.1" />
      <path d="M18.4 16.4v2.4" />
    </>
  ),

  // Explorer : une rose des vents, pas une loupe de navigateur.
  search: (
    <>
      <circle cx="10.6" cy="10.6" r="6.2" />
      <path d="m15.2 15.2 4.6 4.6" />
      <path d="M8.2 12.8a3.4 3.4 0 0 0 4.8-4.8" />
    </>
  ),

  // Une cloche et son arc de signal.
  notifications: (
    <>
      <path d="M6.4 16.8v-5.2a5.6 5.6 0 0 1 11.2 0v5.2l1.4 2H5z" />
      <path d="M10 20.2a2 2 0 0 0 4 0" />
      <path d="M19.6 4.2a5.4 5.4 0 0 1 1.8 4" />
    </>
  ),

  // Trois curseurs, pas un engrenage.
  settings: (
    <>
      <path d="M4 7.2h16M4 12h16M4 16.8h16" />
      <circle cx="9" cy="7.2" r="2.1" />
      <circle cx="15.2" cy="12" r="2.1" />
      <circle cx="7.6" cy="16.8" r="2.1" />
    </>
  ),

  // Une bouée : de l'aide qui se saisit, pas un « ? » abstrait.
  help: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M9.4 9.4a2.7 2.7 0 1 1 4.1 2.4c-.8.5-1.5 1-1.5 2.1" />
      <path d="M12 16.9h.01" />
    </>
  ),

  // La porte et la flèche : partir, sans ambiguïté.
  logout: (
    <>
      <path d="M13 4.5H6.6A1.6 1.6 0 0 0 5 6.1v11.8a1.6 1.6 0 0 0 1.6 1.6H13" />
      <path d="M10.4 12H21M17.6 8.4 21.2 12l-3.6 3.6" />
    </>
  ),

  // Trois points : un menu, pas une action nommée.
  dots: (
    <>
      <circle cx="5.6" cy="12" r="1.35" />
      <circle cx="12" cy="12" r="1.35" />
      <circle cx="18.4" cy="12" r="1.35" />
    </>
  ),

  /* ── Gestes ─────────────────────────────────────────────────────── */

  // Un cœur fermé : il reste lisible quand l'état « aimé » le remplit.
  like: (
    <path d="M12 20.2s-7.4-4.6-7.4-9.4A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.4 2.8c0 4.8-7.4 9.4-7.4 9.4z" />
  ),
  heart: (
    <path d="M12 20.2s-7.4-4.6-7.4-9.4A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.4 2.8c0 4.8-7.4 9.4-7.4 9.4z" />
  ),

  // Une seule bulle, avec sa queue : commenter.
  comment: (
    <path d="M4.2 6.6A2.4 2.4 0 0 1 6.6 4.2h10.8a2.4 2.4 0 0 1 2.4 2.4v7a2.4 2.4 0 0 1-2.4 2.4H9.4l-4.4 3.6v-3.6H6.6" />
  ),

  // La réponse revient en arrière : une flèche qui se courbe.
  reply: (
    <>
      <path d="M9.4 6.2 3.6 11l5.8 4.8" />
      <path d="M3.6 11h9.2a7.2 7.2 0 0 1 7.2 7.2v1" />
    </>
  ),

  // Partager : trois nœuds reliés, pas une flèche sortante.
  share: (
    <>
      <circle cx="17.8" cy="5.8" r="2.1" />
      <circle cx="6.2" cy="12" r="2.1" />
      <circle cx="17.8" cy="18.2" r="2.1" />
      <path d="m8.1 11 7.8-4.1M8.1 13l7.8 4.1" />
    </>
  ),

  // Republier : deux flèches qui tournent, l'une vers l'autre.
  repost: (
    <>
      <path d="M5.8 9.2V8.4a3.2 3.2 0 0 1 3.2-3.2h8.2" />
      <path d="m14.6 2.8 2.8 2.4-2.8 2.4" />
      <path d="M18.2 14.8v.8a3.2 3.2 0 0 1-3.2 3.2H6.8" />
      <path d="m9.4 21.2-2.8-2.4 2.8-2.4" />
    </>
  ),

  // Un ruban plié : garder pour soi, pas « enregistrer » générique.
  bookmark: (
    <>
      <path d="M6.4 3.8h11.2v16.4L12 16.4 6.4 20.2z" />
      <path d="M9.4 8.6h5.2" />
    </>
  ),

  // Suivre : une personne, et le plus qui l'ajoute.
  follow: (
    <>
      <circle cx="9.4" cy="8.6" r="3.1" />
      <path d="M3.6 19.8c.6-3 3-4.8 5.8-4.8 1 0 2 .2 2.9.7" />
      <path d="M17.6 13.2v6M14.6 16.2h6" />
    </>
  ),

  // Envoyer : un avion de papier, plié par une seule arête.
  send: (
    <>
      <path d="M3.8 11.2 20.2 4l-6.4 16-2.6-7z" />
      <path d="M11.2 13 20.2 4" />
    </>
  ),

  /* ── Primitives ─────────────────────────────────────────────────── */

  plus: <path d="M12 4.4v15.2M4.4 12h15.2" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m4.6 12.6 4.8 4.8 9.8-11" />,

  // Deux accusés de réception, décalés.
  "check-double": (
    <path d="m2.8 12.6 3.6 3.6 5.6-6.4M10.2 15.8l.6.6 9.4-10.4" />
  ),

  // Un crayon : écrire, pas « modifier ».
  edit: (
    <>
      <path d="M4 20l1-4.2L16.2 4.6a2.2 2.2 0 0 1 3.2 3.2L8.2 19z" />
      <path d="M14.8 6.2l3 3" />
    </>
  ),

  trash: (
    <>
      <path d="M4.8 7.2h14.4" />
      <path d="M9.2 7.2V5.4a1.4 1.4 0 0 1 1.4-1.4h2.8a1.4 1.4 0 0 1 1.4 1.4v1.8" />
      <path d="M6.4 7.2 7 19a1.4 1.4 0 0 0 1.4 1.3h7.2A1.4 1.4 0 0 0 17 19l.6-11.8" />
      <path d="M10.4 11v5.6M13.6 11v5.6" />
    </>
  ),

  copy: (
    <>
      <rect x="8.4" y="8.4" width="10.2" height="10.2" rx="2" />
      <path d="M15.6 8.4V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.6a2 2 0 0 0 2 2h2.4" />
    </>
  ),

  // Deux maillons qui se tiennent : un lien, pas une chaîne infinie.
  link: (
    <>
      <path d="M9.4 14.6 14.6 9.4" />
      <path d="M11 6.6l1.4-1.4a3.6 3.6 0 0 1 5.1 5.1L16 11.8" />
      <path d="M13 17.4l-1.4 1.4a3.6 3.6 0 0 1-5.1-5.1L8 12.2" />
    </>
  ),

  download: (
    <>
      <path d="M12 3.8v10.4M7.6 10.4 12 14.8l4.4-4.4" />
      <path d="M4 16.8v1.8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.8" />
    </>
  ),

  image: (
    <>
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="2.2" />
      <circle cx="8.8" cy="9" r="1.4" />
      <path d="m4 17.6 4.8-4.8 3.6 3.4 3.2-3.2 4.4 4.4" />
    </>
  ),

  eye: (
    <>
      <path d="M2.8 12S6.4 6.2 12 6.2 21.2 12 21.2 12 17.6 17.8 12 17.8 2.8 12 2.8 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),

  "eye-off": (
    <>
      <path d="M4.2 8.4C3.4 9.6 2.8 12 2.8 12S6.4 17.8 12 17.8c1.7 0 3.2-.6 4.5-1.4M8.6 6.9C9.6 6.4 10.8 6.2 12 6.2c5.6 0 9.2 5.8 9.2 5.8a17 17 0 0 1-2.4 3" />
      <path d="M4 4l16 16" />
      <path d="M10.4 10.4a2.4 2.4 0 0 0 3.2 3.2" />
    </>
  ),

  "arrow-left": <path d="M20 12H4M9.6 6.4 4 12l5.6 5.6" />,
  "chevron-down": <path d="m6.4 9.2 5.6 5.6 5.6-5.6" />,
  "chevron-left": <path d="m14.8 6.4-5.6 5.6 5.6 5.6" />,
  "chevron-right": <path d="m9.2 6.4 5.6 5.6-5.6 5.6" />,

  // Trois lignes de longueurs différentes : un rythme, pas un hamburger.
  menu: <path d="M4 7h16M4 12h11M4 17h16" />,

  compass: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M14.9 9.1 13.4 13.4 9.1 14.9l1.5-4.3z" />
      <path d="M12 2.6v1.6M12 19.8v1.6M2.6 12h1.6M19.8 12h1.6" />
    </>
  ),

  /* ── Développement ──────────────────────────────────────────────── */

  // Le code : un graphe de dépendances, pas des chevrons génériques.
  code: (
    <>
      <circle cx="6.4" cy="6.4" r="2.1" />
      <circle cx="6.4" cy="17.6" r="2.1" />
      <circle cx="17.6" cy="10.4" r="2.1" />
      <path d="M8.4 6.6c3 .3 4.8 1.4 7 3.4M8.4 17.3c3-.3 5.2-1.8 7.2-4.6" />
      <path d="M6.4 8.5v7" />
    </>
  ),

  // Un terminal : l'invite, et le curseur qui attend.
  terminal: (
    <>
      <rect x="3.2" y="4.4" width="17.6" height="15.2" rx="2.2" />
      <path d="m7 9.4 2.8 2.6L7 14.6" />
      <path d="M12.4 15h4.4" />
    </>
  ),

  // Une bifurcation de commits.
  branch: (
    <>
      <circle cx="6.4" cy="5.6" r="2.2" />
      <circle cx="6.4" cy="18.4" r="2.2" />
      <circle cx="17.6" cy="8" r="2.2" />
      <path d="M6.4 7.8v8.4" />
      <path d="M8.4 6.2c3.8.4 6.4 1.6 7.4 3.6" />
      <path d="M17.6 10.2v2.2c0 2.6-2 4-5.6 4.2" />
    </>
  ),

  // La boucle ⌘, dessinée d'un seul trait.
  command: (
    <>
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 9H7.2A2.2 2.2 0 1 1 9.4 6.8zM15 9h1.8A2.2 2.2 0 1 0 14.6 6.8zM9 15H7.2A2.2 2.2 0 1 0 9.4 17.2zM15 15h1.8a2.2 2.2 0 1 1-2.2 2.2z" />
    </>
  ),

  hash: <path d="M9.6 4 8 20M16 4l-1.6 16M4.6 9h15M4 15h15" />,

  package: (
    <>
      <path d="M12 3.6 20 8l-8 4.4L4 8z" />
      <path d="M4 8v7.6L12 20l8-4.4V8" />
      <path d="M12 12.4V20" />
      <path d="m8 5.8 8 4.4" />
    </>
  ),

  // Deux baies et leurs témoins : un serveur qui se voit.
  server: (
    <>
      <rect x="3.8" y="4.8" width="16.4" height="5.8" rx="1.6" />
      <rect x="3.8" y="13.4" width="16.4" height="5.8" rx="1.6" />
      <path d="M7.2 7.7h.01M10 7.7h.01M7.2 16.3h.01M10 16.3h.01" />
    </>
  ),

  bolt: <path d="M13.2 2.8 5.6 13.4h5.2L10.8 21.2l7.6-10.6h-5.2z" />,

  // Des couches empilées : du travail en cours, pas un cube de stockage.
  layers: (
    <>
      <path d="m12 3.6 8.4 4.2-8.4 4.2L3.6 7.8z" />
      <path d="m3.6 12 8.4 4.2 8.4-4.2" />
      <path d="m3.6 16.2 8.4 4.2 8.4-4.2" />
    </>
  ),

  grid: (
    <>
      <rect x="3.6" y="3.6" width="7" height="7" rx="1.4" />
      <rect x="13.4" y="3.6" width="7" height="7" rx="1.4" />
      <rect x="3.6" y="13.4" width="7" height="3.2" rx="1.2" />
      <path d="M13.4 14.2h4.2a2.4 2.4 0 0 1 0 4.8h-4.2z" />
    </>
  ),

  cursor: (
    <>
      <path d="M6 3.4 18.8 10l-5.2 1.6-2.4 5.4z" />
      <path d="m13.6 12 4.6 4.6" />
    </>
  ),

  // Un clavier avec sa barre d'espace : la saisie, pas une touche.
  keyboard: (
    <>
      <rect x="2.8" y="6" width="18.4" height="12" rx="2" />
      <path d="M6.2 9.6h.01M9.4 9.6h.01M12.6 9.6h.01M15.8 9.6h.01M18 9.6h.01M6.2 12.4h.01M9.4 12.4h.01M12.6 12.4h.01M15.8 12.4h.01M8.8 15.2h6.4" />
    </>
  ),

  file: (
    <>
      <path d="M6.4 3.8h6.8L18 8.6v11.6H6.4z" />
      <path d="M13 3.8v5h5" />
    </>
  ),

  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  play: <path d="M8.4 5.2 18.6 12 8.4 18.8z" />,
  pause: (
    <>
      <rect x="7" y="5.5" width="3.4" height="13" rx="0.8" />
      <rect x="13.6" y="5.5" width="3.4" height="13" rx="0.8" />
    </>
  ),

  // Une pellicule : le cadre du film, pas un triangle de lecture.
  video: (
    <>
      <rect x="3" y="5" width="13.4" height="14" rx="2" />
      <path d="m16.4 10.4 4.2-2.6v8.4l-4.2-2.6z" />
    </>
  ),

  volume: (
    <>
      <path d="M4.4 9.4h3.2L12 6.2v11.6l-4.4-3.2H4.4z" />
      <path d="M15.4 9.2a4 4 0 0 1 0 5.6M17.8 6.8a7.4 7.4 0 0 1 0 10.4" />
    </>
  ),

  "volume-off": (
    <>
      <path d="M4.4 9.4h3.2L12 6.2v11.6l-4.4-3.2H4.4z" />
      <path d="m16 9.6 4.2 4.8M20.2 9.6 16 14.4" />
    </>
  ),

  // Une divergence : un commit qui se sépare en deux.
  fork: (
    <>
      <circle cx="5.6" cy="12" r="2.2" />
      <circle cx="18.4" cy="6.4" r="2.2" />
      <circle cx="18.4" cy="17.6" r="2.2" />
      <path d="M7.8 11.2c3.2-.6 6-1.8 8.4-3.4M7.8 12.8c3.2.6 6 1.8 8.4 3.4" />
    </>
  ),

  /* ── Signaux ────────────────────────────────────────────────────── */

  // Une punaise : garder en haut de l'écran.
  pin: (
    <>
      <path d="M8.6 4h6.8l-1 5.2 2.8 2.8v1.4H6.8V12l2.8-2.8z" />
      <path d="M12 13.4v7.4" />
    </>
  ),

  star: (
    <path d="m12 3.2 2.6 5.8 6.2.6-4.7 4.2 1.4 6.1L12 16.7l-5.5 3.2 1.4-6.1-4.7-4.2 6.2-.6z" />
  ),

  // Un sceau et sa coche : vérifié par une institution, pas un badge publicitaire.
  verified: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="m8 12.2 2.7 2.7 5.3-5.7" />
    </>
  ),

  globe: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="20.1" cy="6.4" r="1.3" />
      <circle cx="4" cy="17.8" r="1.3" />
      <path d="M19.1 7.4 15 10M5.1 16.8 9 14" />
    </>
  ),

  // Un écu : protéger, pas fermer un cadenas.
  lock: (
    <>
      <path d="M12 2.8 19 5.6v5.2c0 4.4-2.9 7.7-7 9.4-4.1-1.7-7-5-7-9.4V5.6z" />
      <circle cx="12" cy="10.4" r="2" />
      <path d="M12 12.4v3.1" />
    </>
  ),

  flame: (
    <path d="M12 21c3.6 0 6-2.4 6-5.6 0-2.6-1.6-4.4-3-6.2-.8-1-1.6-2-2-3.4-2.8 2.2-4 4.4-4 6.6 0 1.2.4 2 .4 2-1 .2-1.8-.8-2-1.8-.9 1.4-1.4 2.8-1.4 4.2C6 18.6 8.4 21 12 21z" />
  ),

  trophy: (
    <>
      <path d="M7 4.4h10v4.2a5 5 0 0 1-10 0z" />
      <path d="M7 6H4.6v1.4a3 3 0 0 0 3 3M17 6h2.4v1.4a3 3 0 0 1-3 3" />
      <path d="M12 13.6v4M8.6 19.6h6.8" />
    </>
  ),

  // Des barres et un axe : une progression, pas un camembert.
  chart: (
    <>
      <path d="M4 4v16h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </>
  ),

  spark: (
    <>
      <path d="M11.4 2.8c.6 4.6 2.2 6.2 6.8 6.8-4.6.6-6.2 2.2-6.8 6.8-.6-4.6-2.2-6.2-6.8-6.8 4.6-.6 6.2-2.2 6.8-6.8z" />
      <path d="M18 15.2c.3 1.9.9 2.5 2.8 2.8-1.9.3-2.5.9-2.8 2.8-.3-1.9-.9-2.5-2.8-2.8 1.9-.3 2.5-.9 2.8-2.8z" />
    </>
  ),

  medal: (
    <>
      <circle cx="12" cy="14.4" r="4.6" />
      <path d="m8.4 10.4-2.2-6.6h4.2M15.6 10.4l2.2-6.6h-4.2" />
    </>
  ),

  target: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="4.8" />
      <circle cx="12" cy="12" r="1.4" />
    </>
  ),

  info: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 10.8v5.4M12 7.6h.01" />
    </>
  ),

  // Drapeau planté, avec la coche du signalement traité.
  flag: (
    <>
      <path d="M6 21V3.8" />
      <path d="M6 4.6h9.4l-1.6 3.6 1.6 3.6H6" />
      <path d="M16.4 16.4 18 18l3-3.2" />
    </>
  ),

  smile: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.6 14.2c.8 1.6 2 2.4 3.4 2.4s2.6-.8 3.4-2.4" />
      <path d="M9.4 9.8h.01M14.6 9.8h.01" />
    </>
  ),

  droplet: (
    <path d="M12 3.2c3 3.4 5.6 6 5.6 9.2A5.6 5.6 0 0 1 12 18a5.6 5.6 0 0 1-5.6-5.6c0-3.2 2.6-5.8 5.6-9.2z" />
  ),

  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v1.8M12 19.4v1.8M2.8 12h1.8M19.4 12h1.8M5.5 5.5l1.3 1.3M17.2 17.2l1.3 1.3M18.5 5.5l-1.3 1.3M6.8 17.2l-1.3 1.3" />
    </>
  ),

  moon: (
    <path d="M19.2 14.6A7.6 7.6 0 0 1 9.4 4.8 7.8 7.8 0 1 0 19.2 14.6z" />
  ),

  // Les trois lettres, dessinées : un GIF est un format, pas une image.
  gif: (
    <>
      <path d="M9.8 9.4a2.4 2.4 0 1 0 0 4.8h1.2v-1.8H9.6" />
      <path d="M13.4 9.4v4.8" />
      <path d="M16.4 14.2V9.4h2.6M16.4 11.8h2.2" />
    </>
  ),

  /* ── Surfaces ───────────────────────────────────────────────────── */

  // Une planche de stickers qui se décolle.
  studio: (
    <>
      <path d="M4.4 6.2A1.8 1.8 0 0 1 6.2 4.4h7.2l6.2 6.2v7.2a1.8 1.8 0 0 1-1.8 1.8H6.2a1.8 1.8 0 0 1-1.8-1.8z" />
      <path d="M13.4 4.4v5.2a1.4 1.4 0 0 0 1.4 1.4h4.8" />
      <path d="M8.2 13.4h3.4v3.4H8.2z" />
    </>
  ),

  // Exécuter : des chevrons qui laissent passer un triangle.
  execute: (
    <>
      <path d="m8 6.4-3.6 5.6L8 17.6M16 6.4l3.6 5.6L16 17.6" />
      <path d="m13.4 8.2-2.8 7.6" />
    </>
  ),

  // Un sticker : une feuille qui se décolle, avec ses trois reliefs.
  sticker: (
    <>
      <path d="M4.4 6.6A2.2 2.2 0 0 1 6.6 4.4h10.8a2.2 2.2 0 0 1 2.2 2.2v6.6l-6.2 6.4H6.6a2.2 2.2 0 0 1-2.2-2.2z" />
      <path d="M13.4 19.6v-4a2.2 2.2 0 0 1 2.2-2.2h4" />
      <path d="M8 9.2h.01M12 8.4h.01M15.6 10.4h.01" />
    </>
  ),
};
