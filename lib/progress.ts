/**
 * Couche de données de la progression.
 *
 * Assemblage des requêtes réelles → entrées pures de `lib/gamification.ts`.
 * Aucune décision ici : ce fichier *collecte*, le moteur calcule.
 *
 * Règle de résilience : si une table est inaccessible (RLS trop strict,
 * migration absente, réseau instable), on rend un snapshot vide plutôt
 * qu'une exception. L'écran de progression doit toujours s'afficher.
 */

import { api } from "@/lib/api/client";
import {
  buildStats, buildStory, dayKey, postPoints, questsFor, recent, shiftDay, todayKey,
  type ProgressStats, type Quest, type QuestCounters, type ScorableMessage,
  type ScorablePost, type Story,
} from "@/lib/gamification";
import type { Post, User } from "@/lib/types";
import { loadAuthorXp } from "@/lib/author-xp";

const DAY = 86_400_000;

/** Colonne minimale d'un post pour la progression. */
type SlimPost = Pick<Post, "id" | "text" | "has_code" | "code" | "lang" | "likes" | "created_at">;

export interface Progress {
  stats: ProgressStats;
  quests: Quest[];
}

/**
 * Le strict nécessaire pour calculer une progression.
 *
 * Un profil public n'a ni email, ni ville, ni pays, ni date d'inscription :
 * typer ce paramètre sur `User` interdisait de lire la progression de
 * quelqu'un d'autre. Ce sous-ensemble dit ce qui est réellement lu.
 */
export type ProgressProfile = Pick<User, "id" | "bio" | "langages">;

/**
 * `created_at` est en UTC, mais « aujourd'hui » se vit en heure locale.
 * On compare donc les deux clés de jour rendues dans le même fuseau, sinon
 * un post de 23 h atterrit sur la quête de demain.
 */
function isToday(iso: string, today: string): boolean {
  return dayKey(iso) === today;
}

function questCounters(
  posts: SlimPost[],
  messages: ScorableMessage[],
  profile: Pick<User, "bio">,
  today: string,
): QuestCounters {
  const todays = posts.filter((p) => isToday(p.created_at, today));
  const todayMs = messages.filter((m) => isToday(m.created_at, today));

  return {
    post: todays.length,
    post_code: todays.filter((p) => p.has_code).length,
    group_message: todayMs.length,
    group_code: todayMs.filter((m) => m.is_code).length,
    bio: profile.bio && profile.bio.trim().length > 0 ? 1 : 0,
  };
}

/**
 * Await qui ne lève jamais. Le type de repli est fixé explicitement à
 * l'appel : PostgREST renvoie `any`, donc l'inférence prendrait sinon le
 * type de la chaîne pour le résultat, et le `?? []` masquerait l'erreur.
 */
async function safe<T>(p: PromiseLike<{ data: unknown }>, fallback: T): Promise<T> {
  try {
    const { data } = await p;
    return (data as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Charge l'état de progression complet.
 *
 * Deux lectures indépendantes : les posts de l'utilisateur et ses messages
 * de groupe. Si l'une échoue, l'autre suffit — l'écran affiche un score
 * partiel plutôt qu'une page blanche.
 */
export async function loadProgress(profile: ProgressProfile): Promise<Progress> {
  const today = todayKey();

  const [posts, messages] = await Promise.all([
    safe(
      api
        .from("posts")
        .select("id, text, has_code, code, lang, likes, created_at")
        .eq("author_id", profile.id)
        .order("created_at", { ascending: true })
        .limit(400),
      [] as SlimPost[],
    ),
    safe(
      api
        .from("group_messages")
        .select("id, text, is_code, created_at")
        .eq("author_id", profile.id)
        .order("created_at", { ascending: true })
        .limit(400),
      [] as ScorableMessage[],
    ),
  ]);

  const likesByPost: Record<string, number> = {};
  for (const p of posts) likesByPost[p.id] = p.likes ?? 0;

  const stats = buildStats(
    {
      posts: posts as ScorablePost[],
      messages,
      likesByPost,
      languages: (profile.langages ?? []).length,
      hasBio: Boolean(profile.bio && profile.bio.trim()),
    },
    today,
  );

  return {
    stats,
    quests: questsFor(today, questCounters(posts, messages, profile, today)),
  };
}

/* ------------------------------------------------------------------ */
/* Classement hebdomadaire                                             */
/* ------------------------------------------------------------------ */

export interface LeaderEntry {
  id: string;
  /** Pseudo affiché — jamais l'uuid. */
  pseudo: string;
  prenom: string;
  avatarColor: string;
  xp: number;
  rank: number;
  /** Vrai si c'est la ligne de l'utilisateur courant. */
  me: boolean;
  verified: boolean;
  isAdmin: boolean;
  /**
   * L'XP **cumulée**, pour le palier du badge — distincte de `xp`, qui
   * mesure la semaine. `undefined` = non chargée : le badge retombe alors
   * sur le cachet de base, jamais sur un palier inventé.
   */
  totalXp?: number;
}

/**
 * Classement des contributions sur les sept derniers jours.
 *
 * On compare une fenêtre glissante, pas le score cumulé : au bout de six
 * mois, le classement cumulé ne distingue plus rien — il ne mesure plus que
 * l'ancienneté d'inscription.
 */
export async function loadLeaderboard(profile: User): Promise<LeaderEntry[]> {
  const today = todayKey();
  const weekStart = shiftDay(today, -6);

  const rows = await safe(
    api
      .from("posts")
      // `posts` mène à `users` par cinq chemins (`author_id` plus les
      // quatre tables de liaison). PostgREST exige donc qu'on nomme la
      // contrainte — sinon il répond 300 et le fil est vide.
      .select("author_id, has_code, created_at, author:users!posts_author_id_fkey(id, prenom, pseudo, avatar_color, verified, is_admin)")
      .gte("created_at", new Date(Date.now() - 7 * DAY).toISOString())
      .order("created_at", { ascending: false })
      .limit(300),
    [] as LeaderRow[],
  );

  const totals = new Map<string, { xp: number; row: LeaderRow }>();
  for (const r of rows) {
    const day = dayKey(r.created_at);
    if (day < weekStart || day > today) continue;
    const seen = totals.get(r.author_id);
    totals.set(r.author_id, {
      xp: (seen?.xp ?? 0) + postPoints(r.has_code),
      row: seen?.row ?? r,
    });
  }

  // Un utilisateur nul n'apprend rien : on ne l'affiche pas.
  const top = [...totals.entries()]
    .filter(([, v]) => v.xp > 0)
    .sort((a, b) => b[1].xp - a[1].xp)
    .slice(0, 5);

  const totalXp = await loadAuthorXp(top.map(([id]) => id));

  return top.map(([id, { xp, row }], i) => ({
    id,
    xp,
    rank: i + 1,
    me: id === profile.id,
    verified: Boolean(row.author?.verified),
    isAdmin: Boolean(row.author?.is_admin),
    totalXp: totalXp.get(id),
    // L'identité vient de la jointure `users`, comme partout ailleurs.
    // Le repli s'affiche sur l'identifiant, ce qui est au pire moche
    // mais au moins véridique — un pseudo périmé serait un mensonge.
    pseudo: row.author?.pseudo || `@${id.slice(0, 8)}`,
    prenom: row.author?.prenom || row.author?.pseudo || "?",
    avatarColor: row.author?.avatar_color || "av-sage",
  }));
}

interface LeaderRow {
  author_id: string;
  has_code: boolean | null;
  created_at: string;
  author: {
    id: string;
    prenom: string;
    pseudo: string;
    avatar_color: string;
    verified?: boolean;
    is_admin?: boolean;
  } | null;
}

/* ------------------------------------------------------------------ */
/* Stories : qui a contribué dans les dernières 24 h                   */
/* ------------------------------------------------------------------ */

type StoryPost = Post & { author_id: string };

/**
 * Construit le rail de stories à partir des posts et messages récents.
 *
 * Chaque personne qui a publié devient une story ; ses posts sont les
 * slides. Une story sans slide n'existe pas — on ne dessine pas de
 * contour autour de quelqu'un qui n'a rien fait.
 */
export function buildStories(input: {
  posts: StoryPost[];
  messages?: (ScorableMessage & { author_id: string })[];
  since?: number;
}): Story[] {
  const since = input.since ?? Date.now() - DAY;
  const iso = new Date(since).toISOString();

  const byUser = new Map<string, { posts: StoryPost[]; messages: ScorableMessage[] }>();
  const bucket = (id: string) => {
    const b = byUser.get(id) ?? { posts: [], messages: [] };
    byUser.set(id, b);
    return b;
  };

  for (const p of recent(input.posts, iso)) bucket(p.author_id).posts.push(p);
  for (const m of recent(input.messages ?? [], iso)) bucket(m.author_id).messages.push(m);

  const stories: Story[] = [];
  for (const [id, { posts, messages }] of byUser) {
    const s = buildStory(id, posts, messages);
    if (s) stories.push(s);
  }
  stories.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return stories;
}
