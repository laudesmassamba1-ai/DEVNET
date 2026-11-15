/**
 * Les défis quotidiens de DevNet.
 *
 * ## Le principe
 *
 * Chaque jour, **le même défi pour tout le monde** : trois défis tirés
 * d'un réservoir par une graine dérivée de la date — `fnv1a` du caché
 * `"devnet::<jour>::defi-<n>"`, passée à `mulberry32`. Deux développeurs
 * à Alger et à Nairobi voient le même tirage la même nuit, sans serveur
 * d'orchestration : la date **est** l'autorité.
 *
 * ## La difficulté
 *
 * Un défi porte un multiplicateur de difficulté (1×, 1.5×, 2×), et le
 * choix du réservoir tient compte d'une roue de difficulté sur 7 jours
 * : facile au début de la semaine, raide le week-end — les habitudes de
 * code suivent le calendrier réel.
 *
 * Le module est **pur** : il ne lit rien, n'écrit rien, il transforme
 * une date et des compteurs en défis affichables.
 */

import type { IconName } from "../components/Icon";
import { fnv1a, mulberry32, sampleUnique } from "./mathx";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type ChallengeKind =
  | "post"          // publier
  | "post_code"     // publier du code
  | "group_message" // écrire dans un groupe
  | "group_code"    // répondre avec du code dans un groupe
  | "project"       // travailler sur un projet
  | "fork"          // forker un projet
  | "review"        // corriger une épreuve de quelqu'un
  | "rating"        // noter le projet de quelqu'un
  | "snippet";      // publier un extrait de code réutilisable

export interface Challenge {
  id: string;
  kind: ChallengeKind;
  label: string;
  hint: string;
  icon: IconName;
  /** Multiplicateur appliqué au gain de base (1, 1.5, 2). */
  difficulty: 1 | 1.5 | 2;
  /** Poids de base du gain en XP si l'objectif est atteint. */
  xp: number;
  target: number;
  progress: number;
  done: boolean;
}

/** Compteurs d'activité du jour — alimentés par les écrans. */
export interface ChallengeCounters {
  post: number;
  post_code: number;
  group_message: number;
  group_code: number;
  project: number;
  fork: number;
  review: number;
  rating: number;
  snippet: number;
}

/* ------------------------------------------------------------------ */
/* Réservoir de défis                                                 */
/* ------------------------------------------------------------------ */

type ChallengeSpec = Omit<Challenge, "progress" | "done">;

export const CHALLENGE_POOL: ChallengeSpec[] = [
  { id: "c-post",    kind: "post",          label: "Prendre la parole",      hint: "Publie un post dans le fil",             icon: "send",    difficulty: 1,   xp: 25, target: 1 },
  { id: "c-code",    kind: "post_code",     label: "Montrer du code",        hint: "Publie un post avec du code",            icon: "code",    difficulty: 1.5, xp: 40, target: 1 },
  { id: "c-group",   kind: "group_message", label: "Répondre en groupe",     hint: "Écris dans un groupe",                   icon: "groups",  difficulty: 1,   xp: 25, target: 1 },
  { id: "c-gcode",   kind: "group_code",    label: "Dépanner en groupe",     hint: "Réponds avec du code en groupe",         icon: "code",    difficulty: 1.5, xp: 45, target: 1 },
  { id: "c-project", kind: "project",       label: "Faire avancer le chantier", hint: "Pousse un commit sur un projet",      icon: "branch",  difficulty: 2,   xp: 60, target: 1 },
  { id: "c-fork",    kind: "fork",          label: "Greffon du jour",        hint: "Fork une projet de la communauté",       icon: "fork",    difficulty: 2,   xp: 65, target: 1 },
  { id: "c-review",  kind: "review",        label: "Œil neuf",               hint: "Propose une correction de relecture",    icon: "eye",     difficulty: 1.5, xp: 50, target: 1 },
  { id: "c-rating",  kind: "rating",        label: "Jury du jour",           hint: "Note le projet d'un autre dev",          icon: "star",    difficulty: 1,   xp: 30, target: 1 },
  { id: "c-snippet", kind: "snippet",       label: "Outil de poche",         hint: "Publie un extrait réutilisable",         icon: "package", difficulty: 1,   xp: 35, target: 2 },
  { id: "c-multi",   kind: "post",          label: "Rythme de croisière",    hint: "Publie trois posts dans la journée",     icon: "flame",   difficulty: 2,   xp: 70, target: 3 },
  { id: "c-review2", kind: "review",        label: "Double contrôle",        hint: "Soumets deux relectures",                icon: "check-double", difficulty: 2, xp: 75, target: 2 },
];

/* ------------------------------------------------------------------ */
/* Graine du jour                                                     */
/* ------------------------------------------------------------------ */

/** La graine canonique d'un défi : `devnet::<jour>::defi-<n>`. */
export function challengeSeed(day: string, index: number): number {
  return fnv1a(`devnet::${day}::defi-${index}`);
}

/**
 * La **roue de difficulté** : à chaque jour de la semaine son ton.
 * Lundi (index 1) amène les défis doux, le week-end serre la vis. La
 * formule Pigé le numéro de semaine pour alterner d'une semaine à
 * l'autre — un lundi de semaine 40 n'a pas le ton d'un lundi de 41.
 */
export function difficultyWheel(day: string): 1 | 1.5 {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const week = Math.floor(Date.UTC(y, m - 1, d) / (7 * 86_400_000));
  const serre = weekday === 0 || weekday === 6 || week % 2 === 0;
  return serre ? 1.5 : 1;
}

/* ------------------------------------------------------------------ */
/* Tirage du jour                                                     */
/* ------------------------------------------------------------------ */

/** Les **trois défis du jour**, déterministes pour une date donnée. */
export function challengesFor(
  day: string,
  counters: ChallengeCounters,
): Challenge[] {
  const rand = mulberry32(challengeSeed(day, 0));
  const roue = difficultyWheel(day);
  const picked = sampleUnique(CHALLENGE_POOL, 3, rand);
  return picked.map((spec) => {
    const progress = Math.min(counters[spec.kind] ?? 0, spec.target);
    return { ...spec, difficulty: (spec.difficulty * roue) as 1 | 1.5 | 2, progress, done: progress >= spec.target };
  });
}

/**
 * L'XP gagnée via les défis du jour : le poids de base, doublé de son
 * multiplicateur de difficulté. Un défi entamé mais non fini ne paie
 * rien — on récompense l'aboutissement, pas l'intention.
 */
export function challengeXp(challenges: Challenge[]): number {
  return challenges.filter((c) => c.done).reduce((a, c) => a + Math.round(c.xp * c.difficulty), 0);
}

/**
 * **Série de défis** : combien de jours consécutifs l'utilisateur a
 * terminé au moins un défi. `doneDays` liste les jours où au moins un
 * défi est fermé, triés. Reprend la logique des suites de
 * gamification mais sur la pierre des défis, pas des publications.
 */
export function challengeStreak(
  doneDays: string[],
  today: string,
): { current: number; best: number } {
  const set = new Set(doneDays);
  if (!set.size) return { current: 0, best: 0 };
  const [ty, tm, td] = today.split("-").map(Number);
  const todayUtc = Date.UTC(ty, tm - 1, td);
  const sorted = [...set].sort();

  let best = 1;
  let running = 1;
  for (let i = 1; i < sorted.length; i++) {
    const [py, pm, pd] = sorted[i - 1].split("-").map(Number);
    const [cy, cm, cd] = sorted[i].split("-").map(Number);
    const gap = (Date.UTC(cy, cm - 1, cd) - Date.UTC(py, pm - 1, pd)) / 86_400_000;
    if (gap === 1) running++;
    else running = 1;
    if (running > best) best = running;
  }

  // La série courante se compte à partir d'aujourd'hui ou d'hier : un
  // jour de pause non encore écoulé ne casse pas la série entamée.
  const [ly, lm, ld] = sorted[sorted.length - 1].split("-").map(Number);
  const lastUtc = Date.UTC(ly, lm - 1, ld);
  if (todayUtc - lastUtc > 86_400_000) return { current: 0, best };

  let current = 1;
  for (let i = sorted.length - 1; i > 0; i--) {
    const [py, pm, pd] = sorted[i - 1].split("-").map(Number);
    const [cy, cm, cd] = sorted[i].split("-").map(Number);
    const gap = (Date.UTC(cy, cm - 1, cd) - Date.UTC(py, pm - 1, pd)) / 86_400_000;
    if (gap === 1) current++;
    else break;
  }
  return { current, best };
}
