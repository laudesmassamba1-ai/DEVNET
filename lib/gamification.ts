/**
 * Gamification DevNet — score, séries, paliers, badges, quêtes, carte d'activité.
 *
 * Choix d'architecture : **tout est dérivé**, rien n'est stocké.
 *
 * Le score n'est pas une colonne `users.xp` qu'on incrémente auHasard : il
 * est recalculé à partir des événements réels (posts, messages de groupe,
 * likes reçus). Conséquences :
 *
 * - la progression ne peut pas mentir — elle est toujours le résumé exact
 *   de ce que l'utilisateur a réellement publié ;
 * - un signalement ou une suppression ne laisse pas de score fantôme ;
 * - aucun trigger Postgres à maintenir, donc aucune migration obligatoire
 *   pour que la fonctionne — l'écran est utile dès le premier commit.
 *
 * Le module est purement fonctionnel : aucun import React, aucun accès
 * réseau. C'est ce qui permet de le tester à fond (`scripts/test-gamification.ts`).
 */

import type { IconName } from "@/components/Icon";

/* ------------------------------------------------------------------ */
/* Dates : tout le raisonnement de série se fait sur des clés de jour  */
/* ------------------------------------------------------------------ */

/** `YYYY-MM-DD` en heure locale — le jour où l'utilisateur a vécu. */
export function dayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const j = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${j}`;
}

export function todayKey(now: Date = new Date()): string {
  return dayKey(now);
}

/** Décale une clé de jour de `n` jours (n négatif = passé). */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Nombre de jours entre deux clés : `dayDiff(a, b)` = a − b. */
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

/** Numéro de jour absolu depuis 1970 — sert à faire tourner les quêtes. */
export function dayIndex(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/* ------------------------------------------------------------------ */
/* Barème                                                             */
/* ------------------------------------------------------------------ */

/**
 * Points par action.
 *
 * Le code pèse plus que le texte : c'est la thesis du produit. Un post qui
 * porte du code vaut deux fois un post, parce que c'est lui qu'on archivera
 * et qu'on relira dans six mois.
 */
export const XP = {
  post: 10,
  postCode: 20,
  groupMessage: 5,
  groupMessageCode: 10,
  likeReceived: 2,
  /** Première action de la journée : encourage le rendez-vous quotidien. */
  presence: 5,
} as const;

/** Bonus de série : +2 par jour, plafonné à sept jours. */
export const STREAK_BONUS_PER_DAY = 2;
export const STREAK_BONUS_CAP = 7;

/** Un gel de série est gagné tous les sept jours d'activité. */
export const FREEZE_EVERY = 7;

export function streakBonus(streak: number): number {
  return Math.min(Math.max(streak, 0), STREAK_BONUS_CAP) * STREAK_BONUS_PER_DAY;
}

/* ------------------------------------------------------------------ */
/* Paliers                                                             */
/* ------------------------------------------------------------------ */

export interface Level {
  level: number;
  /** Score cumulé requis pour entrer dans le palier. */
  min: number;
  title: string;
  motto: string;
}

/**
 * Dix paliers. Les seuils croissent en Fibonacci — le coût marginal d'un
 * palier monte plus vite que le précédent, ce qui donne une courbe qui
 * « s'accélère » puis se calme, au lieu d'une longue plate puis d'un mur.
 */
export const LEVELS: Level[] = [
  { level: 1,  min: 0,    title: "Nouveau",        motto: "Tout le monde commence ici." },
  { level: 2,  min: 60,   title: "Explorateur",    motto: "Tu as publishé. C'est déjà ça." },
  { level: 3,  min: 150,  title: "Apprenti",       motto: "Le fil devient une habitude." },
  { level: 4,  min: 320,  title: "Contributeur",   motto: "On te lit, et on répond." },
  { level: 5,  min: 600,  title: "Bâtisseur",      motto: "Tu ne fais plus qu'ajouter." },
  { level: 6,  min: 1050, title: "Pédagogue",      motto: "Tu aides les autres à avancer." },
  { level: 7,  min: 1700, title: "Architecte",     motto: "Tu penses en structures." },
  { level: 8,  min: 2700, title: "Gardien",        motto: "Le réseau compte sur toi." },
  { level: 9,  min: 4200, title: "Ambassadeur",    motto: "Ta voix porte au-delà." },
  { level: 10, min: 6500, title: "Légende",        motto: "Nkran : le savoir se transmet." },
];

export interface LevelState extends Level {
  /** Score cumulé au palier suivant (null au dernier palier). */
  next: Level | null;
  /** Progression dans le palier, 0 → 1. */
  progress: number;
  /** Points restant avant le palier suivant. */
  toNext: number;
}

export function levelFor(xp: number): LevelState {
  const safe = Math.max(0, Math.round(xp || 0));
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) {
    if (safe >= LEVELS[k].min) i = k;
  }
  const current = LEVELS[i];
  const next = LEVELS[i + 1] ?? null;

  if (!next) {
    return { ...current, next: null, progress: 1, toNext: 0 };
  }
  const span = next.min - current.min;
  const into = safe - current.min;
  return {
    ...current,
    next,
    progress: span > 0 ? Math.min(1, Math.max(0, into / span)) : 1,
    toNext: next.min - safe,
  };
}

/* ------------------------------------------------------------------ */
/* Séries                                                              */
/* ------------------------------------------------------------------ */

export interface Streak {
  /** Jours consécutifs jusqu'à aujourd'hui (ou jusqu'à hier). */
  current: number;
  /** Meilleure série jamais atteinte. */
  best: number;
  /** Une action a déjà été posée aujourd'hui. */
  activeToday: boolean;
  /** La série est préservée mais le jour n'est pas encore validé. */
  atRisk: boolean;
  /** Gels gagnés (1 tous les 7 jours d'activité). */
  freezes: number;
  /** Gels déjà consommés pour sauter un jour manqué. */
  freezesUsed: number;
}

const EMPTY_STREAK: Streak = {
  current: 0, best: 0, activeToday: false, atRisk: false, freezes: 0, freezesUsed: 0,
};

/**
 * Reconstitue la série à partir des jours d'activité.
 *
 * Les **gels de série** sont l'apport DevNet : tous les sept jours d'activité,
 * l'utilisateur gagne un gel qui absorbe un jour manqué. Le Diffuolingo
 * vend ce mécanisme comme une feature payante ; ici il tombe naturellement
 * du calcul, sans table supplémentaire.
 *
 * La reconstitution est *rejouable* : on rejoue les jours du plus ancien au
 * plus récent en dépensant un budget de gels. Deux appels avec le même
 * ensemble de jours donnent le même résultat, dans n'importe quel ordre.
 */
export function computeStreak(days: string[], today: string = todayKey()): Streak {
  const set = new Set(days);
  if (set.size === 0) return { ...EMPTY_STREAK };

  const total = set.size;
  const freezes = Math.floor(total / FREEZE_EVERY);

  // Plus longue série, parcourue chronologiquement.
  const sorted = [...set].sort();
  let run = 0;
  let used = 0;
  let best = 0;
  let prev: string | null = null;

  for (const d of sorted) {
    if (prev === null) {
      run = 1;
    } else {
      const gap = dayDiff(d, prev);
      if (gap === 1) run += 1;
      else if (gap === 2 && used < freezes) { used += 1; run += 1; }
      else run = 1;
    }
    prev = d;
    if (run > best) best = run;
  }

  const activeToday = set.has(today);
  const anchor = activeToday ? today : set.has(shiftDay(today, -1)) ? shiftDay(today, -1) : null;

  if (!anchor) {
    return { current: 0, best, activeToday, atRisk: false, freezes, freezesUsed: 0 };
  }

  // On rembobine depuis l'ancre en consommant les gels au fil de l'eau.
  let cursor = anchor;
  let count = 0;
  let consumed = 0;

  for (;;) {
    count += 1;
    const prevDay = shiftDay(cursor, -1);
    if (set.has(prevDay)) { cursor = prevDay; continue; }

    const beforePrev = shiftDay(prevDay, -1);
    if (set.has(beforePrev) && consumed < freezes) {
      consumed += 1;
      cursor = beforePrev;
      continue;
    }
    break;
  }

  return {
    current: count,
    best: Math.max(best, count),
    activeToday,
    atRisk: !activeToday,
    freezes,
    freezesUsed: consumed,
  };
}

/* ------------------------------------------------------------------ */
/* Événements de score                                                 */
/* ------------------------------------------------------------------ */

export type EventKind =
  | "post"
  | "post_code"
  | "group_message"
  | "group_code"
  | "like"
  | "presence";

export interface XpEvent {
  kind: EventKind;
  points: number;
  /** Clé du jour — c'est elle qui porte la série. */
  day: string;
  /** Libellé court, affiché dans le journal. */
  label: string;
  at: string;
}

/** Forme minimale d'un post dont le score a besoin. */
export interface ScorablePost {
  id: string;
  text?: string | null;
  has_code?: boolean | null;
  code?: string | null;
  lang?: string | null;
  likes?: number | null;
  created_at: string;
}

export interface ScorableMessage {
  id: string;
  text?: string | null;
  is_code?: boolean | null;
  created_at: string;
}

export interface ActivityInput {
  posts?: ScorablePost[];
  messages?: ScorableMessage[];
  /**
   * Likes reçus, par post. On ne les compte pas comme des actions de
   * l'utilisateur mais comme un retour du réseau : ils grantent des points
   * sans coût, donc le score mesure la valeur reçue autant que l'effort.
   */
  likesByPost?: Record<string, number>;
}

/** Points d'un post. */
export function postPoints(hasCode: boolean | null | undefined): number {
  return hasCode ? XP.postCode : XP.post;
}

/** Points d'un message de groupe. */
export function messagePoints(isCode: boolean | null | undefined): number {
  return isCode ? XP.groupMessageCode : XP.groupMessage;
}

/**
 * Transforme une activité brute en journal d'événements, puis applique le
 * bonus de présence (première action de chaque jour).
 *
 * `today` est le jour de référence auquel on rattache les likes. Il est
 * injectable parce que `buildStats` en reçoit un : sans ce paramètre, un
 * appel effectué avec une date de référence calcule ses événements à l'heure
 * réelle, et l'état obtenu n'est pas celui qu'on a demandé.
 */
export function buildEvents(input: ActivityInput, today: string = todayKey()): XpEvent[] {
  const events: XpEvent[] = [];

  for (const p of input.posts ?? []) {
    events.push({
      kind: p.has_code ? "post_code" : "post",
      points: postPoints(p.has_code),
      day: dayKey(p.created_at),
      label: p.has_code ? `Publication de code${p.lang ? ` · ${p.lang}` : ""}` : "Publication",
      at: p.created_at,
    });
  }

  for (const m of input.messages ?? []) {
    events.push({
      kind: m.is_code ? "group_code" : "group_message",
      points: messagePoints(m.is_code),
      day: dayKey(m.created_at),
      label: m.is_code ? "Réponse de code" : "Message de groupe",
      at: m.created_at,
    });
  }

  for (const n of Object.values(input.likesByPost ?? {})) {
    if (!n || n <= 0) continue;
    events.push({
      kind: "like",
      points: n * XP.likeReceived,
      day: today,
      label: `${n} like${n > 1 ? "s" : ""} reçu${n > 1 ? "s" : ""}`,
      at: new Date().toISOString(),
    });
  }

  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  // Bonus de présence : une seule fois par jour, sur le premier événement.
  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.day)) continue;
    seen.add(e.day);
    e.points += XP.presence;
  }

  return events;
}

export function sumXp(events: XpEvent[]): number {
  return events.reduce((acc, e) => acc + e.points, 0);
}

/* ------------------------------------------------------------------ */
/* Carte d'activité (heatmap façon GitHub)                             */
/* ------------------------------------------------------------------ */

export interface HeatCell {
  day: string;
  /** 0 = inactif, 4 = journée dense. */
  level: 0 | 1 | 2 | 3 | 4;
  /** Nombre d'actions ce jour-là. */
  count: number;
  /** Vrai pour les jours à venir de la semaine affichée. */
  future: boolean;
}

/** Seuils d'intensité : `0`, `1`, `2`, `3-4`, `5+` actions. */
export function heatLevel(count: number): HeatCell["level"] {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

/**
 * Grille de `weeks` semaines remplies jusqu'à aujourd'hui, en colonnes.
 * Les colonnes vont de la plus ancienne à la plus récente ; chaque colonne
 * contient 7 lignes, du lundi au dimanche.
 */
export function heatmap(
  days: string[],
  today: string = todayKey(),
  weeks = 15,
): { cells: HeatCell[][]; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1);

  // On recule jusqu'au lundi de la semaine courante, puis on remonte la
  // grille pour que la dernière colonne soit celle d'aujourd'hui.
  const dow = (new Date(`${today}T00:00:00`).getDay() + 6) % 7; // 0 = lundi
  const lastSunday = shiftDay(today, 6 - dow);
  const firstDay = shiftDay(lastSunday, -(weeks * 7 - 1));

  const cells: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const column: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = shiftDay(firstDay, w * 7 + d);
      const count = counts.get(day) ?? 0;
      column.push({ day, level: heatLevel(count), count, future: day > today });
    }
    cells.push(column);
  }
  return { cells, counts };
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

export interface Badge {
  id: string;
  label: string;
  hint: string;
  /** Icône du registre `Icon`. */
  icon: IconName;
  /** Avancement vers l'obtention. */
  progress: number;
  target: number;
  earned: boolean;
}

export interface BadgeInput {
  posts: number;
  codePosts: number;
  groupMessages: number;
  likes: number;
  streak: number;
  best: number;
  languages: number;
  hasBio: boolean;
  /** Activité dans la nuit (avant 6 h ou après 23 h). */
  nocturnal: boolean;
  /** Palier atteint — pour le badge « Architecte ». */
  level: number;
}

/** Définition d'un badge : ses métadonnées plus sa règle d'obtention. */
type BadgeDef = Omit<Badge, "earned" | "progress"> & { test: (i: BadgeInput) => number };

export const BADGES: BadgeDef[] = [
  {
    id: "first-post",
    label: "Première plume",
    hint: "Publier ton premier post",
    icon: "send",
    target: 1,
    test: (i) => i.posts,
  },
  {
    id: "code-singer",
    label: "Chanteur de code",
    hint: "Publier 5 posts contenant du code",
    icon: "code",
    target: 5,
    test: (i) => i.codePosts,
  },
  {
    id: "streak-3",
    label: "Trois jours",
    hint: "Trois jours d'affilée",
    icon: "flame",
    target: 3,
    test: (i) => i.streak,
  },
  {
    id: "streak-7",
    label: "Semaine de feu",
    hint: "Sept jours d'affilée",
    icon: "flame",
    target: 7,
    test: (i) => i.streak,
  },
  {
    id: "streak-30",
    label: "Mois de fer",
    hint: "Trente jours d'affilée",
    icon: "trophy",
    target: 30,
    test: (i) => i.best,
  },
  {
    id: "helper",
    label: "Secouriste",
    hint: "Répondre 5 fois dans un groupe",
    icon: "groups",
    target: 5,
    test: (i) => i.groupMessages,
  },
  {
    id: "magnetic",
    label: "Magnétique",
    hint: "Recevoir 50 likes",
    icon: "like",
    target: 50,
    test: (i) => i.likes,
  },
  {
    id: "nocturnal",
    label: "Nocturne",
    hint: "Contribuer entre 23 h et 6 h",
    icon: "eye-off",
    target: 1,
    test: (i) => (i.nocturnal ? 1 : 0),
  },
  {
    id: "polyglot",
    label: "Polyglotte",
    hint: "Renseigner 3 langages",
    icon: "globe",
    target: 3,
    test: (i) => i.languages,
  },
  {
    id: "identity",
    label: "Carte d'identité",
    hint: "Renseigner une bio",
    icon: "verified",
    target: 1,
    test: (i) => (i.hasBio ? 1 : 0),
  },
  {
    id: "architect",
    label: "Architecte",
    hint: "Atteindre le palier 7",
    icon: "star",
    target: 7,
    test: (i) => i.level,
  },
];

export function badges(input: BadgeInput): Badge[] {
  return BADGES.map(({ test, ...def }) => {
    const raw = test(input) || 0;
    return {
      ...def,
      progress: Math.min(raw, def.target),
      earned: raw >= def.target,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Quêtes du jour                                                      */
/* ------------------------------------------------------------------ */

export type QuestKind = "post" | "post_code" | "group_message" | "group_code" | "bio";

export interface Quest {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  points: number;
  target: number;
  progress: number;
  done: boolean;
}

/**
 * Réservoir de quêtes. Trois sont tirées chaque jour, en rotation : la
 * rotation garantit qu'un utilisateur ne voit jamais deux fois la même
 * combinaison, tout en gardant un objectif stable et lisible.
 */
const QUEST_POOL: (Omit<Quest, "progress" | "done"> & { kind: QuestKind })[] = [
  { id: "q-post",   kind: "post",          label: "Prendre la parole", hint: "Publie un post dans le fil",        icon: "send",   points: 20, target: 1 },
  { id: "q-code",   kind: "post_code",     label: "Montrer du code",   hint: "Publie un post avec du code",        icon: "code",   points: 30, target: 1 },
  { id: "q-group",  kind: "group_message", label: "Répondre en groupe", hint: "Écris dans un groupe",               icon: "groups", points: 25, target: 1 },
  { id: "q-gcode",  kind: "group_code",    label: "Dépanner en groupe", hint: "Réponds avec du code",               icon: "code",   points: 35, target: 1 },
  { id: "q-bio",    kind: "bio",           label: "Compléter son profil", hint: "Ajoute une bio à ton profil",      icon: "profile", points: 15, target: 1 },
];

export interface QuestCounters {
  post: number;
  post_code: number;
  group_message: number;
  group_code: number;
  bio: number;
}

/** Les trois quêtes du jour, déterministes pour une date donnée. */
export function questsFor(
  day: string,
  counters: QuestCounters,
): Quest[] {
  const start = dayIndex(day) % QUEST_POOL.length;
  const out: Quest[] = [];
  for (let i = 0; i < 3; i++) {
    const q = QUEST_POOL[(start + i) % QUEST_POOL.length];
    const raw = counters[q.kind] ?? 0;
    out.push({ ...q, progress: Math.min(raw, q.target), done: raw >= q.target });
  }
  return out;
}

/** Points déjà gagnés aujourd'hui via les quêtes — à ne pas re-compter. */
export function questBonus(quests: Quest[]): number {
  return quests.filter((q) => q.done).reduce((a, q) => a + q.points, 0);
}

/* ------------------------------------------------------------------ */
/* Agrégat : le snapshot affiché par l'écran                            */
/* ------------------------------------------------------------------ */

export interface ProgressStats {
  xp: number;
  level: LevelState;
  streak: Streak;
  /** Tous les jours d'activité, triés du plus ancien au plus récent. */
  activeDays: string[];
  posts: number;
  codePosts: number;
  groupMessages: number;
  likes: number;
  events: XpEvent[];
  badges: Badge[];
  /** Nombre total de badges obtenus. */
  badgesEarned: number;
  nocturnal: boolean;
  /** Score gagné sur les 7 derniers jours. */
  weekXp: number;
}

export interface SnapshotInput extends ActivityInput {
  languages?: number;
  hasBio?: boolean;
  today?: string;
}

function isNocturnal(iso: string): boolean {
  const h = new Date(iso).getHours();
  return h >= 23 || h < 6;
}

/**
 * Construit l'état complet de progression à partir de l'activité.
 *
 * Note sur les likes : `likesByPost` est réattribué au jour de consultation
 * plutôt qu'à la date du post. C'est un choix délibéré — un like est un
 * retour *récent*, pas une retroactive — et cela évite d'avoir à conserver
 * l'historique des modifications de `posts.likes`.
 */
export function buildStats(input: SnapshotInput, today: string = todayKey()): ProgressStats {
  const posts = input.posts ?? [];
  const messages = input.messages ?? [];
  const likesByPost = input.likesByPost ?? {};

  const likes = Object.values(likesByPost).reduce((a, b) => a + (b || 0), 0);
  const codePosts = posts.filter((p) => p.has_code).length;

  const events = buildEvents({
    posts,
    messages,
    likesByPost,
  }, today);

  const activeDays = [...new Set(events.map((e) => e.day))].sort();
  const streak = computeStreak(activeDays, today);

  const baseXp = sumXp(events);
  const xp = baseXp + streakBonus(streak.current);

  const level = levelFor(xp);
  const nocturnal = [...posts, ...messages].some((a) => isNocturnal(a.created_at));

  const weekStart = shiftDay(today, -6);
  const weekXp = events
    .filter((e) => e.day >= weekStart && e.day <= today)
    .reduce((a, e) => a + e.points, 0);

  const badgeList = badges({
    posts: posts.length,
    codePosts,
    groupMessages: messages.length,
    likes,
    streak: streak.current,
    best: streak.best,
    languages: input.languages ?? 0,
    hasBio: input.hasBio ?? false,
    nocturnal,
    level: level.level,
  });

  return {
    xp,
    level,
    streak,
    activeDays,
    posts: posts.length,
    codePosts,
    groupMessages: messages.length,
    likes,
    events,
    badges: badgeList,
    badgesEarned: badgeList.filter((b) => b.earned).length,
    nocturnal,
    weekXp,
  };
}

/* ------------------------------------------------------------------ */
/* Classement hebdo                                                    */
/* ------------------------------------------------------------------ */

export interface LeaderRow {
  id: string;
  xp: number;
  rank: number;
}

/**
 * Classement par score des sept derniers jours.
 *
 * Les scores nuls sont ignorés : afficher quelqu'un avec 0 point en
 * tête d'un tableau n'apprend rien à personne.
 */
export function leaderboard(rows: { id: string; weekXp: number }[]): LeaderRow[] {
  return rows
    .filter((r) => r.weekXp > 0)
    .sort((a, b) => b.weekXp - a.weekXp)
    .slice(0, 5)
    .map((r, i) => ({ id: r.id, xp: r.weekXp, rank: i + 1 }));
}

/* ------------------------------------------------------------------ */
/* Stories : la contribution des dernières 24 h vue en cartes          */
/* ------------------------------------------------------------------ */

export type SlideKind = "post" | "code" | "group";

export interface StorySlide {
  id: string;
  kind: SlideKind;
  title: string;
  body: string;
  code?: string;
  lang?: string;
  points: number;
  at: string;
}

export interface Story {
  /** Identifiant du propriétaire de la story. */
  id: string;
  slides: StorySlide[];
  /** Horodatage du dernier slide — sert au tri du rail. */
  updatedAt: string;
}

/** Une story = la contribution d'une personne sur les dernières 24 h. */
export function buildStory(
  id: string,
  posts: ScorablePost[],
  messages: ScorableMessage[] = [],
): Story | null {
  const slides: StorySlide[] = [];

  for (const p of posts) {
    slides.push({
      id: p.id,
      kind: p.has_code ? "code" : "post",
      title: p.has_code ? `Code · ${p.lang || "snippet"}` : "Publication",
      body: (p.text ?? "").slice(0, 400),
      code: p.has_code ? (p.code ?? "").slice(0, 900) : undefined,
      lang: p.lang ?? undefined,
      points: postPoints(p.has_code),
      at: p.created_at,
    });
  }

  for (const m of messages) {
    slides.push({
      id: m.id,
      kind: "group",
      title: m.is_code ? "Code en groupe" : "Message de groupe",
      body: (m.text ?? "").slice(0, 400),
      points: messagePoints(m.is_code),
      at: m.created_at,
    });
  }

  if (slides.length === 0) return null;
  slides.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { id, slides, updatedAt: slides[slides.length - 1].at };
}

/** Filtre les posts/message postérieurs à `since`. */
export function recent<T extends { created_at: string }>(items: T[], since: string): T[] {
  return items.filter((i) => i.created_at >= since);
}
