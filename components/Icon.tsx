import * as Lucide from "lucide-react";

/**
 * Les noms historiques restent stables; Lucide fournit les glyphes usuels.
 * Les tracés locaux servent de repli pour les noms sans équivalent direct.
 */

/** Noms exposés — l'union garantit qu'une icône demandée existe. */
export const ICON_NAMES = [
  // Navigation
  "feed", "groups", "messages", "profile", "search", "notifications",
  "settings", "help", "logout", "dots",
  // Actions
  "like", "comment", "share", "repost", "bookmark", "follow", "send",
  "plus", "close", "check", "check-double", "edit", "trash", "copy", "link",
  "download",
  "image", "eye", "eye-off", "arrow-left",
  // Navigation dans l'espace
  "chevron-down", "chevron-left", "chevron-right", "menu",
  // Contenu
  "code", "terminal", "branch", "command", "hash", "package", "server",
  "bolt", "layers", "grid", "cursor", "keyboard", "file", "stop", "play",
  // Statut & State
  "pin", "star", "verified", "globe", "lock", "flame", "trophy", "chart",
  "spark", "medal", "fork", "target", "info", "flag", "smile", "droplet",
  "sun",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** Résout un nom d'icône stocké (base de données, démo) vers une icône
 *  du jeu, avec repli sûr : une valeur inconnue ne casse jamais le rendu. */
export function asIconName(
  value: string | null | undefined,
  fallback: IconName,
): IconName {
  return (ICON_NAMES as readonly string[]).includes(value ?? "")
    ? (value as IconName)
    : fallback;
}
  const ICONS: Partial<Record<IconName, Lucide.LucideIcon>> = {
    feed: Lucide.Home,
    groups: Lucide.UsersRound,
    messages: Lucide.MessagesSquare,
    profile: Lucide.UserRound,
    search: Lucide.Search,
    notifications: Lucide.Bell,
    settings: Lucide.Settings,
    help: Lucide.CircleHelp,
    logout: Lucide.LogOut,
    dots: Lucide.Ellipsis,
    like: Lucide.Heart,
    comment: Lucide.MessageCircle,
    share: Lucide.Share2,
    repost: Lucide.Repeat2,
    bookmark: Lucide.Bookmark,
    follow: Lucide.UserRoundPlus,
    send: Lucide.Send,
    plus: Lucide.Plus,
    close: Lucide.X,
    check: Lucide.Check,
    "check-double": Lucide.CheckCheck,
    edit: Lucide.Pencil,
    trash: Lucide.Trash2,
    copy: Lucide.Copy,
    link: Lucide.Link2,
    download: Lucide.Download,
    image: Lucide.Image,
    eye: Lucide.Eye,
    "eye-off": Lucide.EyeOff,
    "arrow-left": Lucide.ArrowLeft,
    "chevron-down": Lucide.ChevronDown,
    "chevron-left": Lucide.ChevronLeft,
    "chevron-right": Lucide.ChevronRight,
    menu: Lucide.Menu,
    code: Lucide.Code2,
    terminal: Lucide.Terminal,
    branch: Lucide.GitBranch,
    command: Lucide.Command,
    hash: Lucide.Hash,
    package: Lucide.Package,
    server: Lucide.Server,
    bolt: Lucide.Zap,
    layers: Lucide.Layers,
    grid: Lucide.LayoutGrid,
    cursor: Lucide.MousePointer2,
    keyboard: Lucide.Keyboard,
    file: Lucide.File,
    stop: Lucide.Square,
    play: Lucide.Play,
    pin: Lucide.Pin,
    star: Lucide.Star,
    verified: Lucide.BadgeCheck,
    globe: Lucide.Globe,
    lock: Lucide.LockKeyhole,
    flame: Lucide.Flame,
    trophy: Lucide.Trophy,
    chart: Lucide.ChartNoAxesColumnIncreasing,
    spark: Lucide.Lightbulb,
    medal: Lucide.Award,
    fork: Lucide.GitFork,
    target: Lucide.Target,
    info: Lucide.Info,
    flag: Lucide.Flag,
    smile: Lucide.Smile,
    droplet: Lucide.Droplet,
    sun: Lucide.Sun,
  };


/**
 * Tracés au format 24×24, géométrie courbe.
 *
 * Convention : les boîtiers sont des `<rect rx>` (jamais des carrés secs),
 * les points des cercles pleins (`fill`), et les angles des jointures
 * arrondies. Un glyphe ne doit présenter aucun angle droit à l'œil.
 */
const PATHS: Record<IconName, React.ReactNode> = {
  /* ── Navigation ─────────────────────────────────────────────── */

  feed: (
    <>
      <path d="M3.5 11.2 12 3.9l8.5 7.3" />
      <rect x="6" y="9.5" width="12" height="10.5" rx="2.6" />
      <path d="M10 20v-4.6a2 2 0 0 1 4 0V20" />
    </>
  ),
  groups: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.2 20.2a5.8 5.8 0 0 1 11.6 0" />
      <path d="M16.2 5.2a2.6 2.6 0 0 1 0 5" />
      <path d="M17 14.4a4.6 4.6 0 0 1 4 4.6" />
    </>
  ),
  messages: (
    <path d="M12 4c4.7 0 8.5 3 8.5 6.8 0 3.8-3.8 6.8-8.5 6.8c-1 0-2-.1-2.9-.4L4.5 20l.9-3.7A6.6 6.6 0 0 1 3.5 10.8C3.5 7 7.3 4 12 4Z" />
  ),
  profile: (
    <>
      <circle cx="12" cy="8.4" r="3.6" />
      <path d="M5 20.6a7 7 0 0 1 14 0" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.2" />
      <path d="M20 20l-3.7-3.7" />
    </>
  ),
  notifications: (
    <>
      <path d="M6.6 16.6c0-1 .5-1.7.5-3.6v-2.6a4.9 4.9 0 0 1 9.8 0V13c0 1.9.5 2.6.5 3.6.1.4-.2.8-.6.8H7.2c-.4 0-.7-.4-.6-.8Z" />
      <path d="M10 20.4a2 2 0 0 0 4 0" />
      <path d="M12 3.4V2.6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.3" />
      <path d="M12 3.4v2.4M12 18.2v2.4M3.4 12h2.4M18.2 12h2.4" />
      <path d="M5.9 5.9l1.7 1.7M16.4 16.4l1.7 1.7M18.1 5.9l-1.7 1.7M7.6 16.4l-1.7 1.7" />
    </>
  ),
  help: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="6" />
      <path d="M9.4 9.3a2.7 2.7 0 1 1 3.6 2.5c-.9.4-1.2 1-1.2 1.8v.3" />
      <circle cx="12" cy="16.7" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4H8a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h2" />
      <path d="M14 8l4 4-4 4" />
      <path d="M18 12H9" />
    </>
  ),
  dots: (
    <>
      <circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),

  /* ── Actions ────────────────────────────────────────────────── */

  like: (
    <path d="M12 20.6C11.6 20.6 3.5 15.6 3.5 9.6 3.5 6.8 5.6 4.8 8 4.8c1.8 0 3.2 1 4 2.5.8-1.5 2.2-2.5 4-2.5 2.4 0 4.5 2 4.5 4.8 0 6-8.1 11-8.5 11Z" />
  ),
  comment: (
    <path d="M12 4.5c4.7 0 8.5 3.2 8.5 7.2 0 4-3.8 7.2-8.5 7.2c-1.2 0-2.3-.2-3.4-.5L4 20.5l1-3.6A6.8 6.8 0 0 1 3.5 11.7c0-4 3.8-7.2 8.5-7.2Z" />
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="5.5" r="2.6" />
      <circle cx="18" cy="18.5" r="2.6" />
      <path d="M8.3 10.8 15.7 7" />
      <path d="M8.3 13.2l7.4 3.8" />
    </>
  ),
  repost: (
    <>
      <path d="M5 9.6A3.6 3.6 0 0 1 8.6 6H16" />
      <path d="M13.6 3.4 16.4 6l-2.8 2.6" />
      <path d="M19 14.4A3.6 3.6 0 0 1 15.4 18H8" />
      <path d="M10.4 20.6 7.6 18l2.8-2.6" />
    </>
  ),
  bookmark: (
    <path d="M7 3.5h10a2 2 0 0 1 2 2v15l-7-4.4L5 20.5v-15a2 2 0 0 1 2-2Z" />
  ),
  follow: (
    <>
      <circle cx="10" cy="8" r="3.4" />
      <path d="M4 20.4a6 6 0 0 1 12 0" />
      <path d="M19 7.5v5.5M16.3 10.2h5.5" />
    </>
  ),
  send: (
    <>
      <path d="M20.2 3.8 3.8 10.3c-.6.3-.6 1.2.1 1.4l5.9 2.2 2.2 5.9c.3.6 1.2.7 1.5.1l7.5-14.6c.3-.7-.4-1.4-1.1-1.1Z" />
      <path d="M9.8 14.2 19.6 4.4" />
    </>
  ),
  plus: (
    <path d="M12 4.5v15M4.5 12h15" />
  ),
  close: (
    <path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" />
  ),
  check: <path d="M20 6.5 9.3 17.2 4 11.9" />,
  "check-double": (
    <>
      <path d="M17 6.5 7.6 15.9 3.8 12.1" />
      <path d="M20.5 10.5 13.5 17.5" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20.2l.9-3.7L15.6 5.8a2.1 2.1 0 0 1 3 0l.9.9a2.1 2.1 0 0 1 0 3L8.8 20.3 5 20.9Z" />
      <path d="M14.4 7.2 17 9.8" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.2 7V5.6A1.6 1.6 0 0 1 10.8 4h2.4a1.6 1.6 0 0 1 1.6 1.6V7" />
      <path d="M6 7l.9 12.4A1.6 1.6 0 0 0 8.5 21h7a1.6 1.6 0 0 0 1.6-1.6L18 7" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2.8" />
      <path d="M5.5 15H4.8A1.8 1.8 0 0 1 3 13.2V4.8A1.8 1.8 0 0 1 4.8 3h8.4A1.8 1.8 0 0 1 15 4.8V5.5" />
    </>
  ),
  link: (
    <>
      <path d="M9.6 14.4 14.4 9.6" />
      <path d="M8 10.6 6.2 12.4a3.6 3.6 0 0 0 5 5l1.8-1.8" />
      <path d="M16 13.4l1.8-1.8a3.6 3.6 0 0 0-5-5l-1.8 1.8" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.2v11.4" />
      <path d="M7.8 10.4 12 14.6l4.2-4.2" />
      <path d="M5 20.6h14" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.6" />
      <circle cx="12" cy="7.9" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.4 14.2a4.3 4.3 0 0 0 7.2 0" />
      <circle cx="9" cy="9.8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9.8" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3.6" />
      <circle cx="8.6" cy="9.4" r="1.7" />
      <path d="M3.6 17.4 8 13.2a2 2 0 0 1 2.8 0l4 3.9" />
      <path d="M13.4 15.2 15 13.6a2 2 0 0 1 2.8 0l2.6 2.4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.6 12S6.2 6.2 12 6.2 21.4 12 21.4 12 17.8 17.8 12 17.8 2.6 12 2.6 12Z" />
      <circle cx="12" cy="12" r="2.7" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M4.2 8.6A14 14 0 0 0 2.6 12s3.6 5.8 9.4 5.8c1.4 0 2.7-.3 3.8-.9" />
      <path d="M9.3 6.6A9.5 9.5 0 0 1 12 6.2c5.8 0 9.4 5.8 9.4 5.8a14.5 14.5 0 0 1-2.7 3.3" />
      <path d="M9.8 9.8a3.1 3.1 0 0 0 4.4 4.4" />
      <path d="M3.5 3.5 20.5 20.5" />
    </>
  ),
  "arrow-left": (
    <>
      <path d="M20 12H4" />
      <path d="M10.4 5.6 4 12l6.4 6.4" />
    </>
  ),

  /* ── Navigation dans l'espace ────────────────────────────────── */

  "chevron-down": <path d="M6 9.4 12 15.4 18 9.4" />,
  "chevron-left": <path d="M15 5.4 8.6 12 15 18.6" />,
  "chevron-right": <path d="M9 5.4 15.4 12 9 18.6" />,
  menu: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </>
  ),

  /* ── Contenu : le vocabulaire de l'outillage ─────────────────── */

  code: (
    <>
      <path d="M8.6 7 3.6 12l5 5" />
      <path d="M15.4 7l5 5-5 5" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3.6" />
      <path d="M7 9.4 9.8 12 7 14.6" />
      <path d="M12.8 15h4.2" />
    </>
  ),
  branch: (
    <>
      <circle cx="7" cy="5.5" r="2.6" />
      <circle cx="7" cy="18.5" r="2.6" />
      <circle cx="17" cy="5.5" r="2.6" />
      <path d="M7 8.1v7.8" />
      <path d="M17 8.1v2.4a3 3 0 0 1-3 3H9" />
    </>
  ),
  command: (
    <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
  ),
  hash: (
    <>
      <path d="M9.4 3.5 7.2 20.5" />
      <path d="M16.8 3.5 14.6 20.5" />
      <path d="M4.2 9h15.4" />
      <path d="M3.6 15h15.4" />
    </>
  ),
  package: (
    <>
      <path d="M12 2.8 20.6 7.5v9L12 21.2 3.4 16.5v-9Z" />
      <path d="M3.4 7.5 12 12.2l8.6-4.7" />
      <path d="M12 12.2v9" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="3" />
      <rect x="3" y="13" width="18" height="7" rx="3" />
      <circle cx="7.4" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="7.4" cy="16.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  bolt: (
    <path d="M13.2 2.8 5.6 13.1a.7.7 0 0 0 .6 1.1h4.9l-.9 7 7.8-10.5a.7.7 0 0 0-.6-1.1h-4.9Z" />
  ),
  stop: <rect x="5" y="5" width="14" height="14" rx="3.2" />,
  play: (
    <path d="M7.2 5.6c0-.9 1-1.5 1.8-1l9.6 6a1.2 1.2 0 0 1 0 2l-9.6 6c-.8.5-1.8-.1-1.8-1Z" />
  ),
  layers: (
    <>
      <path d="M12 2.8 21 7.5 12 12.2 3 7.5Z" />
      <path d="M3 12.2 12 16.9 21 12.2" />
      <path d="M3 16.5 12 21.2 21 16.5" />
    </>
  ),
  grid: (
    <>
      <rect x="3.4" y="3.4" width="7.2" height="7.2" rx="2.4" />
      <rect x="13.4" y="3.4" width="7.2" height="7.2" rx="2.4" />
      <rect x="3.4" y="13.4" width="7.2" height="7.2" rx="2.4" />
      <rect x="13.4" y="13.4" width="7.2" height="7.2" rx="2.4" />
    </>
  ),
  cursor: (
    <path d="M6 3.4v14.2l3.7-3.4 2.2 5 2.1-.9-2.2-5H17Z" />
  ),
  keyboard: (
    <>
      <rect x="2.6" y="6" width="18.8" height="12" rx="3" />
      <path d="M6 10h.01M9.4 10h.01M12.8 10h.01M16.2 10h.01M18 10h.01" />
      <path d="M8 14h8" />
    </>
  ),
  file: (
    <>
      <path d="M6 3.6A1.6 1.6 0 0 1 7.6 2H14l5.4 5.4v12.9A1.6 1.6 0 0 1 17.8 22H7.6A1.6 1.6 0 0 1 6 20.4Z" />
      <path d="M14 2v5.4h5.4" />
    </>
  ),

  /* ── Statut ─────────────────────────────────────────────────── */

  pin: (
    <>
      <path d="M14.4 3.5 20.5 9.6l-2.2.6a4.2 4.2 0 0 0-2 1.3l-1.7 2.3-4.4-4.4 2.3-1.7a4.2 4.2 0 0 0 1.3-2Z" />
      <path d="M11.1 13.9 5 20.1" />
    </>
  ),
  star: (
    <path d="M12 3.1c.3 0 .6.2.7.5l2.1 4.2 4.6.7c.7.1 1 1 .5 1.5l-3.4 3.3.8 4.6c.1.7-.6 1.2-1.3.9L12 16.6l-4 2.2c-.6.3-1.4-.2-1.2-.9l.8-4.6-3.4-3.3c-.5-.5-.2-1.4.5-1.5l4.6-.7 2.1-4.2c.1-.3.4-.5.6-.5Z" />
  ),
  verified: (
    <>
      <path d="M12 2.6l2.1 1.8 2.7-.5 1.4 2.4 2.6 1-.3 2.7L22 12l-1.5 2 .3 2.7-2.6 1-1.4 2.4-2.7-.5L12 21.4l-2.1-1.8-2.7.5-1.4-2.4-2.6-1 .3-2.7L2 12l1.5-2-.3-2.7 2.6-1 1.4-2.4 2.7.5Z" />
      <path d="M8.8 12l2.2 2.2 4.3-4.6" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.2 12h17.6" />
      <path d="M12 3c2.5 2.4 3.9 5.6 3.9 9s-1.4 6.6-3.9 9c-2.5-2.4-3.9-5.6-3.9-9S9.5 5.4 12 3Z" />
    </>
  ),
  lock: (
    <>
      <rect x="4.6" y="10.4" width="14.8" height="10.2" rx="3.2" />
      <path d="M8 10.4V7.4a4 4 0 0 1 8 0v3" />
      <path d="M12 14.4v2.6" />
    </>
  ),
  flame: (
    <path d="M12 22c5 0 8-3.5 8-8 0-5.5-6-7.5-5.5-11.5C10.5 4.5 8 7.5 8 10.5c0 1.5.4 2.3.4 2.3C7 12.2 5.7 11 5 9.1c-2 1.9-3 4.1-3 6.6C2 19.2 6 22 12 22Z" />
  ),
  droplet: (
    <path d="M12 2.6S5.6 10.6 5.6 15.1a6.4 6.4 0 0 0 12.8 0C18.4 10.6 12 2.6 12 2.6Z" />
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.4" />
      <path d="M12 2.4v2.6M12 19v2.6M2.4 12H5M19 12h2.6M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9M18.8 5.2l-1.9 1.9M7.1 16.9l-1.9 1.9" />
    </>
  ),
  trophy: (
    <>
      <path d="M7.6 3.6h8.8v4.6a4.4 4.4 0 0 1-8.8 0Z" />
      <path d="M16.4 4.6H19a2.6 2.6 0 0 1-2.6 4.2" />
      <path d="M7.6 4.6H5a2.6 2.6 0 0 0 2.6 4.2" />
      <path d="M12 12.8v3" />
      <path d="M9.2 20.4h5.6" />
      <path d="M9.8 15.8h4.4l.6 4.6H9.2Z" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20.4h16" />
      <rect x="5.4" y="12" width="3.6" height="6" rx="1.6" />
      <rect x="10.2" y="6" width="3.6" height="12" rx="1.6" />
      <rect x="15" y="9.6" width="3.6" height="8.4" rx="1.6" />
    </>
  ),
  spark: (
    <path d="M12 2.4c.4 3.4 1.7 5.9 3.2 7.2 1.5 1.3 4 2 7.4 2.2-3.4.2-5.9.9-7.4 2.2-1.5 1.3-2.8 3.8-3.2 7.2-.4-3.4-1.7-5.9-3.2-7.2-1.5-1.3-4-2-7.4-2.2 3.4-.2 5.9-.9 7.4-2.2C10.3 8.3 11.6 5.8 12 2.4Z" />
  ),
  medal: (
    <>
      <path d="M8.4 2.6 10.8 9M15.6 2.6 13.2 9" />
      <circle cx="12" cy="15" r="5.6" />
      <path d="M10 15.1l1.6 1.6 2.8-3.1" />
    </>
  ),
  fork: (
    <>
      <circle cx="6.5" cy="5.8" r="2.6" />
      <circle cx="17.5" cy="5.8" r="2.6" />
      <circle cx="12" cy="18.4" r="2.6" />
      <path d="M17.5 8.4v1.2a2.4 2.4 0 0 1-2.4 2.4H8.9a2.4 2.4 0 0 1-2.4-2.4V8.4" />
      <path d="M12 12v3.8" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  flag: (
    <>
      <path d="M5.5 21V4" />
      <path d="M5.5 4.6h11.4c.7 0 1.1.8.6 1.3l-2.6 3 2.6 3.1c.5.5.1 1.3-.6 1.3H5.5" />
    </>
  ),
};

/**
 * Tailles autorisées — la cohérence commence ici.
 *
 * Liste tenue à la main plutôt qu'un `number` : c'est ce qui empêche
 * l'introduction d'un `size={17}` qui dériverait du jeu d'icônes.
 */
export type IconSize = 9 | 11 | 12 | 14 | 16 | 18 | 20 | 24;

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
  const Glyph = ICONS[name];

  if (Glyph) {
    return (
      <Glyph
        size={size}
        strokeWidth={strokeWidth}
        fill={fill}
        className={`shrink-0 ${className}`}
        aria-hidden="true"
        focusable="false"
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
