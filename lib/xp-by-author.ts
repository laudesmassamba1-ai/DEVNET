import {
  buildStats,
  todayKey,
  type ScorableMessage,
  type ScorablePost,
} from "@/lib/gamification";

export type XpActivityRow = { author_id: string | null } & Record<string, unknown>;

/**
 * Des lignes d'activité → un score cumulé par auteur.
 *
 * Pure et sans réseau : le jour de référence est injectable, donc les
 * tests n'ont pas à attendre demain pour vérifier une série.
 */
export function xpByAuthor(
  posts: readonly XpActivityRow[],
  messages: readonly XpActivityRow[],
  today: string = todayKey(),
): Map<string, number> {
  const byAuthor = new Map<
    string,
    { posts: ScorablePost[]; messages: ScorableMessage[]; likesByPost: Record<string, number> }
  >();

  const slot = (id: string) => {
    let s = byAuthor.get(id);
    if (!s) {
      s = { posts: [], messages: [], likesByPost: {} };
      byAuthor.set(id, s);
    }
    return s;
  };

  for (const row of posts) {
    const id = row.author_id;
    if (!id) continue;
    const s = slot(id);
    const post: ScorablePost = {
      id: String(row.id ?? ""),
      has_code: Boolean(row.has_code),
      likes: Number(row.likes) || 0,
      created_at: String(row.created_at ?? ""),
    };
    s.posts.push(post);
    s.likesByPost[post.id] = post.likes ?? 0;
  }

  for (const row of messages) {
    const id = row.author_id;
    if (!id) continue;
    slot(id).messages.push({
      id: String(row.id ?? ""),
      is_code: Boolean(row.is_code),
      created_at: String(row.created_at ?? ""),
    });
  }

  const out = new Map<string, number>();
  for (const [id, activity] of byAuthor) {
    out.set(id, buildStats(activity, today).xp);
  }
  return out;
}
