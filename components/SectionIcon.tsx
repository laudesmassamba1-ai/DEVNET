/**
 * Jeu d'icônes maison — une icône par **section**, pas une icône par mot.
 *
 * Le dépôt utilisait une bibliothèque générique : le même engrenage servait
 * aux réglages, aux extensions et à l'administration, et la loupe de la
 * recherche ressemblait à celle d'un navigateur. Une icône qui pourrait
 * appartenir à n'importe quelle application ne dit rien de celle-ci.
 *
 * Chaque dessin ci-dessous part d'une métaphore propre à DevNet :
 *
 *  · **Fil**          un graphe qui se propage (le réseau, pas un journal)
 *  · **Découvrir**    une rose des vents (explorer, pas chercher)
 *  · **Messages**     deux bulles qui se répondent, décalées
 *  · **Profil**       un buste avec sa pastille d'état
 *  · **Groupes**      trois personnes autour d'un même point
 *  · **Communautés**  des nœuds en orbite autour d'un noyau
 *  · **Projets**      des couches empilées (du travail en cours)
 *  · **GitHub**       une bifurcation de commits
 *  · **Extensions**   une pièce rapportée qui s'emboîte
 *  · **Signets**      un ruban plié
 *  · **Notifications** une cloche avec son arc de signal
 *  · **Modération**   un bouclier qui tranche
 *  · **Réglages**     trois curseurs, pas un engrenage
 *  · **Admin**        une clé dans un sceau
 *  · **Studio**       une planche de stickers qui se décolle
 *  · **Exécuter**     des chevrons qui laissent passer un triangle
 *
 * Tracés à 24 × 24, trait 1,7, bouts ronds : lisibles à 16 px comme à 32,
 * et ils suivent `currentColor` — aucun ne dépend du thème.
 */
import type { SVGProps } from "react";

export type SectionIconName =
  | "feed"
  | "compass"
  | "messages"
  | "profile"
  | "groups"
  | "globe"
  | "package"
  | "code"
  | "grid"
  | "bookmark"
  | "notifications"
  | "flag"
  | "settings"
  | "lock"
  | "studio"
  | "execute"
  | "search"
  | "close"
  | "trash"
  | "reply"
  | "send"
  | "sticker"
  | "heart"
  | "eye";

const DRAWINGS: Record<SectionIconName, React.ReactNode> = {
  feed: (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="7" r="1.8" />
      <circle cx="9" cy="17" r="2.2" />
      <path d="M8 7.4 15.9 7M7.2 8.1l1.2 6.8M11.1 16.3l5.3-6.9" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M14.9 9.1 13.4 13.4 9.1 14.9l1.5-4.3z" />
      <path d="M12 2.6v1.6M12 19.8v1.6M2.6 12h1.6M19.8 12h1.6" />
    </>
  ),
  messages: (
    <>
      <path d="M3.5 6.2A2.2 2.2 0 0 1 5.7 4h7.6a2.2 2.2 0 0 1 2.2 2.2v4.1a2.2 2.2 0 0 1-2.2 2.2H7.4L3.5 15z" />
      <path d="M9.5 12.2h8.8a2.2 2.2 0 0 1 2.2 2.2v3.4a2.2 2.2 0 0 1-2.2 2.2h-1.6L14 21.4v-1.4H9.5a2.2 2.2 0 0 1-2.2-2.2" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="9" r="3.4" />
      <path d="M5.2 20c.6-3.3 3.3-5.3 6.8-5.3s6.2 2 6.8 5.3" />
      <circle cx="18.4" cy="17.6" r="2.1" />
      <path d="M18.4 16.4v2.4" />
    </>
  ),
  groups: (
    <>
      <circle cx="12" cy="8.4" r="2.6" />
      <circle cx="5.6" cy="15.2" r="2.2" />
      <circle cx="18.4" cy="15.2" r="2.2" />
      <path d="M7.9 17.2c.7-2 2.3-3.1 4.1-3.1s3.4 1.1 4.1 3.1M10.9 8.4c0-1.2.5-2 1.1-2.6M3.4 16.9c.3-.9.9-1.6 1.7-1.9M20.6 16.9c-.3-.9-.9-1.6-1.7-1.9" />
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
  package: (
    <>
      <path d="M12 3.6 20 8l-8 4.4L4 8z" />
      <path d="M4 8v7.6L12 20l8-4.4V8" />
      <path d="M12 12.4V20" />
      <path d="m8 5.8 8 4.4" />
    </>
  ),
  code: (
    <>
      <circle cx="6.4" cy="6.4" r="2.1" />
      <circle cx="6.4" cy="17.6" r="2.1" />
      <circle cx="17.6" cy="10.4" r="2.1" />
      <path d="M8.4 6.6c3 .3 4.8 1.4 7 3.4M8.4 17.3c3-.3 5.2-1.8 7.2-4.6" />
      <path d="M6.4 8.5v7" />
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
  bookmark: (
    <>
      <path d="M6.4 3.8h11.2v16.4L12 16.4 6.4 20.2z" />
      <path d="M9.4 8.6h5.2" />
    </>
  ),
  notifications: (
    <>
      <path d="M6.4 16.8v-5.2a5.6 5.6 0 0 1 11.2 0v5.2l1.4 2H5z" />
      <path d="M10 20.2a2 2 0 0 0 4 0" />
      <path d="M19.6 4.2a5.4 5.4 0 0 1 1.8 4" />
    </>
  ),
  flag: (
    <>
      <path d="M6 21V3.8" />
      <path d="M6 4.6h9.4l-1.6 3.6 1.6 3.6H6" />
      <path d="M16.4 16.4 18 18l3-3.2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7.2h16M4 12h16M4 16.8h16" />
      <circle cx="9" cy="7.2" r="2.1" />
      <circle cx="15.2" cy="12" r="2.1" />
      <circle cx="7.6" cy="16.8" r="2.1" />
    </>
  ),
  lock: (
    <>
      <path d="M12 2.8 19 5.6v5.2c0 4.4-2.9 7.7-7 9.4-4.1-1.7-7-5-7-9.4V5.6z" />
      <circle cx="12" cy="10.4" r="2" />
      <path d="M12 12.4v3.1" />
    </>
  ),
  studio: (
    <>
      <path d="M4.4 6.2A1.8 1.8 0 0 1 6.2 4.4h7.2l6.2 6.2v7.2a1.8 1.8 0 0 1-1.8 1.8H6.2a1.8 1.8 0 0 1-1.8-1.8z" />
      <path d="M13.4 4.4v5.2a1.4 1.4 0 0 0 1.4 1.4h4.8" />
      <path d="M8.2 13.4h3.4v3.4H8.2z" />
    </>
  ),
  execute: (
    <>
      <path d="m8 6.4-3.6 5.6L8 17.6M16 6.4l3.6 5.6L16 17.6" />
      <path d="m13.4 8.2-2.8 7.6" />
    </>
  ),
  search: (
    <>
      <circle cx="10.6" cy="10.6" r="6.2" />
      <path d="m15.2 15.2 4.6 4.6" />
      <path d="M8.2 12.8a3.4 3.4 0 0 0 4.8-4.8" />
    </>
  ),
  close: (
    <path d="M6 6l12 12M18 6 6 18" />
  ),
  trash: (
    <>
      <path d="M4.8 7.2h14.4" />
      <path d="M9.2 7.2V5.4a1.4 1.4 0 0 1 1.4-1.4h2.8a1.4 1.4 0 0 1 1.4 1.4v1.8" />
      <path d="M6.4 7.2 7 19a1.4 1.4 0 0 0 1.4 1.3h7.2A1.4 1.4 0 0 0 17 19l.6-11.8" />
      <path d="M10.4 11v5.6M13.6 11v5.6" />
    </>
  ),
  reply: (
    <>
      <path d="M9.4 6.2 3.6 11l5.8 4.8" />
      <path d="M3.6 11h9.2a7.2 7.2 0 0 1 7.2 7.2v1" />
    </>
  ),
  send: (
    <>
      <path d="M3.8 11.2 20.2 4l-6.4 16-2.6-7z" />
      <path d="M11.2 13 20.2 4" />
    </>
  ),
  sticker: (
    <>
      <path d="M4.4 6.6A2.2 2.2 0 0 1 6.6 4.4h10.8a2.2 2.2 0 0 1 2.2 2.2v6.6l-6.2 6.4H6.6a2.2 2.2 0 0 1-2.2-2.2z" />
      <path d="M13.4 19.6v-4a2.2 2.2 0 0 1 2.2-2.2h4" />
      <path d="M8 9.2h.01M12 8.4h.01M15.6 10.4h.01" />
    </>
  ),
  heart: (
    <path d="M12 20.2s-7.4-4.6-7.4-9.4A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.4 2.8c0 4.8-7.4 9.4-7.4 9.4z" />
  ),
  eye: (
    <>
      <path d="M2.8 12S6.4 6.2 12 6.2 21.2 12 21.2 12 17.6 17.8 12 17.8 2.8 12 2.8 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
};

export function SectionIcon({
  name,
  size = 18,
  strokeWidth = 1.7,
  className,
  ...rest
}: {
  name: SectionIconName | string;
  size?: number;
} & Omit<SVGProps<SVGSVGElement>, "name">) {
  const drawing = DRAWINGS[name as SectionIconName];
  if (!drawing) return null;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      {drawing}
    </svg>
  );
}
