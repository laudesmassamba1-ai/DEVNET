import { supabase } from "@/lib/supabase/client";
import { xpByAuthor, type XpActivityRow } from "@/lib/xp-by-author";
import type { AuthorWithBadge } from "@/lib/types";

export { xpByAuthor };
export type { XpActivityRow };

/** Nombre de lignes d'activité lues au plus par auteur et par source. */
export const AUTHOR_ACTIVITY_LIMIT = 5000;

type AuthorRow = { author_id: string | null; author: AuthorWithBadge | null };

export async function loadAuthorXp(
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, number>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const [posts, messages] = await Promise.all([
    supabase
      .from("posts")
      .select("id, author_id, has_code, likes, created_at")
      .in("author_id", unique)
      .order("created_at", { ascending: false })
      .limit(AUTHOR_ACTIVITY_LIMIT),
    supabase
      .from("group_messages")
      .select("id, author_id, is_code, created_at")
      .in("author_id", unique)
      .order("created_at", { ascending: false })
      .limit(AUTHOR_ACTIVITY_LIMIT),
  ]);

  // Une lecture partielle produirait un palier inférieur au vrai : on
  // préfère ne rien savoir, et l'écran retombe sur le cachet de base.
  if (posts.error || messages.error) return new Map();

  return xpByAuthor(
    (posts.data ?? []) as XpActivityRow[],
    (messages.data ?? []) as XpActivityRow[],
  );
}

export async function withAuthorXp<T extends AuthorRow>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const xp = await loadAuthorXp(rows.map((r) => r.author_id));
  if (xp.size === 0) return rows;
  return rows.map((row) => {
    const value = row.author_id ? xp.get(row.author_id) : undefined;
    if (!row.author || value === undefined) return row;
    return { ...row, author: { ...row.author, xp: value } };
  });
}
