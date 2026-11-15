/**
 * Point d'entrée unique des icônes.
 *
 * Le dépôt a longtemps eu deux familles : des dessins maison pour les
 * sections et une bibliothèque générique pour le reste. Deux traits, deux
 * poids, deux façons de dire la même chose. Il n'en reste qu'une : tous les
 * dessins vivent dans `components/icons/drawings.tsx` et sont rendus par
 * `SectionIcon`. Aucune dépendance d'icônes n'est importée ici.
 *
 * `ICON_NAMES` reste la liste publique : les écrans, les réglages et les
 * Des noms sont enregistrés, pas des composants.
 */
import { SectionIcon } from "./SectionIcon";

export const ICON_NAMES = [
  "feed", "groups", "messages", "profile", "search", "notifications",
  "settings", "help", "logout", "dots",
  "like", "heart", "comment", "reply", "share", "repost", "refresh", "bookmark", "follow", "send",
  "plus", "close", "check", "check-double", "edit", "trash", "copy", "link",
  "download", "image", "eye", "eye-off", "arrow-left",
  "chevron-down", "chevron-left", "chevron-right", "menu", "compass",
  "code", "terminal", "branch", "command", "hash", "package", "server",
  "bolt", "layers", "grid", "cursor", "keyboard", "file", "stop", "play",
  "pin", "star", "verified", "globe", "lock", "flame", "trophy", "chart",
  "medal", "fork", "target", "info", "flag", "smile", "droplet", "align",
  "sun", "moon", "gif", "video", "pause", "volume", "volume-off",
  "studio", "execute", "sticker",
  "undo", "redo", "text", "pen", "crop", "filter",
] as const;

export type IconName = (typeof ICON_NAMES)[number];
export type IconSize = 9 | 11 | 12 | 14 | 16 | 18 | 20 | 24;

export function isIconName(value: string | null | undefined): value is IconName {
  return (ICON_NAMES as readonly string[]).includes(value ?? "");
}

export function asIconName(
  value: string | null | undefined,
  fallback: IconName,
): IconName {
  return isIconName(value) ? value : fallback;
}

export function Icon({
  name,
  size = 16,
  className = "",
  strokeWidth = 1.7,
  fill = "none",
}: {
  name: IconName;
  size?: IconSize;
  className?: string;
  strokeWidth?: number;
  fill?: string;
}) {
  return (
    <SectionIcon
      name={name}
      size={size}
      strokeWidth={strokeWidth}
      fill={fill}
      className={`shrink-0 ${className}`}
    />
  );
}
