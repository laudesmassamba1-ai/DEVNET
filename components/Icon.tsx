import {
  Archery,
  ArrowLeft,
  BadgeCheck,
  BellNotification,
  Bin,
  Bookmark,
  ChatBubbleEmpty,
  ChatLines,
  Check,
  CodeBrackets,
  Compass,
  Copy,
  CursorPointer,
  DoubleCheck,
  Download,
  Droplet,
  EditPencil,
  Emoji,
  Eye,
  EyeClosed,
  FireFlame,
  Flash,
  Globe,
  GitBranch,
  GitFork,
  GraphUp,
  Group,
  HalfMoon,
  Hashtag,
  Heart,
  HelpCircle,
  Home,
  InfoCircle,
  Key,
  KeyCommand,
  Link,
  Lock,
  LogOut,
  MenuScale,
  Medal,
  MediaImage,
  MoreHoriz,
  MultiplePages,
  NavArrowDown,
  NavArrowLeft,
  NavArrowRight,
  Package,
  Page,
  Pin,
  Play,
  Plus,
  Search,
  SendDiagonal,
  Server,
  Settings,
  ShareAndroid,
  Square,
  Sparks,
  Star,
  SunLight,
  Terminal,
  TriangleFlag,
  Trophy,
  UserCircle,
  UserPlus,
  ViewGrid,
  Xmark,
} from "iconoir-react";
import {
  Bookmark as SolidBookmark,
  ChatBubbleEmpty as SolidChatBubbleEmpty,
  ChatLines as SolidChatLines,
  Compass as SolidCompass,
  Flash as SolidFlash,
  Heart as SolidHeart,
  Medal as SolidMedal,
  Pin as SolidPin,
  Sparks as SolidSparks,
  Star as SolidStar,
} from "iconoir-react/solid";

/** Noms utilisés par l'interface et les données de démonstration. */
export const ICON_NAMES = [
  "feed", "groups", "messages", "profile", "search", "notifications",
  "settings", "help", "logout", "dots",
  "like", "comment", "share", "repost", "bookmark", "follow", "send",
  "plus", "close", "check", "check-double", "edit", "trash", "copy", "link",
  "download", "image", "eye", "eye-off", "arrow-left",
  "chevron-down", "chevron-left", "chevron-right", "menu", "compass",
  "code", "terminal", "branch", "command", "hash", "package", "server",
  "bolt", "layers", "grid", "cursor", "keyboard", "file", "stop", "play",
  "pin", "star", "verified", "globe", "lock", "flame", "trophy", "chart",
  "spark", "medal", "fork", "target", "info", "flag", "smile", "droplet",
  "sun", "moon",
] as const;

export type IconName = (typeof ICON_NAMES)[number];
export type IconSize = 9 | 11 | 12 | 14 | 16 | 18 | 20 | 24;
type IconoirGlyph = typeof Home;

export function isIconName(value: string | null | undefined): value is IconName {
  return (ICON_NAMES as readonly string[]).includes(value ?? "");
}

export function asIconName(
  value: string | null | undefined,
  fallback: IconName,
): IconName {
  return isIconName(value) ? value : fallback;
}

const ICONS: Record<IconName, IconoirGlyph> = {
  feed: Home,
  groups: Group,
  messages: ChatLines,
  profile: UserCircle,
  search: Search,
  notifications: BellNotification,
  settings: Settings,
  help: HelpCircle,
  logout: LogOut,
  dots: MoreHoriz,
  like: Heart,
  comment: ChatBubbleEmpty,
  share: ShareAndroid,
  repost: ChatLines,
  bookmark: Bookmark,
  follow: UserPlus,
  send: SendDiagonal,
  plus: Plus,
  close: Xmark,
  check: Check,
  "check-double": DoubleCheck,
  edit: EditPencil,
  trash: Bin,
  copy: Copy,
  link: Link,
  download: Download,
  image: MediaImage,
  eye: Eye,
  "eye-off": EyeClosed,
  "arrow-left": ArrowLeft,
  "chevron-down": NavArrowDown,
  "chevron-left": NavArrowLeft,
  "chevron-right": NavArrowRight,
  menu: MenuScale,
  compass: Compass,
  code: CodeBrackets,
  terminal: Terminal,
  branch: GitBranch,
  command: KeyCommand,
  hash: Hashtag,
  package: Package,
  server: Server,
  bolt: Flash,
  layers: MultiplePages,
  grid: ViewGrid,
  cursor: CursorPointer,
  keyboard: Key,
  file: Page,
  stop: Square,
  play: Play,
  pin: Pin,
  star: Star,
  verified: BadgeCheck,
  globe: Globe,
  lock: Lock,
  flame: FireFlame,
  trophy: Trophy,
  chart: GraphUp,
  spark: Sparks,
  medal: Medal,
  fork: GitFork,
  target: Archery,
  info: InfoCircle,
  flag: TriangleFlag,
  smile: Emoji,
  droplet: Droplet,
  sun: SunLight,
  moon: HalfMoon,
};

const FILLED_ICONS: Partial<Record<IconName, IconoirGlyph>> = {
  bookmark: SolidBookmark,
  comment: SolidChatBubbleEmpty,
  messages: SolidChatLines,
  like: SolidHeart,
  compass: SolidCompass,
  bolt: SolidFlash,
  pin: SolidPin,
  spark: SolidSparks,
  star: SolidStar,
  medal: SolidMedal,
};

export function Icon({
  name,
  size = 16,
  className = "",
  strokeWidth = 1.5,
  fill = "none",
}: {
  name: IconName;
  size?: IconSize;
  className?: string;
  strokeWidth?: number;
  fill?: string;
}) {
  const Glyph = fill !== "none" ? (FILLED_ICONS[name] ?? ICONS[name]) : ICONS[name];

  return (
    <Glyph
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      fill={fill}
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
    />
  );
}
