import { api } from "@/lib/api/client";
import { withAuthorXp, loadAuthorXp } from "@/lib/author-xp";
import { AUTHOR_COLUMNS } from "@/lib/social";
import { fetchCommunities, fetchMyCommunityIds } from "@/lib/communities";
import { loadLeaderboard, type LeaderEntry } from "@/lib/progress";
import { fetchDiscoverProjects } from "@/lib/repo";
import type { Community, PostWithAuthor, Project, User } from "@/lib/types";

const PROOF_COLUMNS = `id, text, lang, code, has_code, likes, comments, created_at, author:users!posts_author_id_fkey(${AUTHOR_COLUMNS})`;

const WEEK = 7 * 86_400_000;

export interface Discover {
  proofs: PostWithAuthor[];
  rising: LeaderEntry[];
  ateliers: Project[];
  cercles: Community[];
  joined: Set<string>;
  signalsWeek: number;
  myXp?: number;
}

function errorFree<T>(result: { data: unknown; error: unknown; count?: number | null }, fallback: T): T {
  if (result.error) return fallback;
  return (result.data as T | null) ?? fallback;
}

export async function fetchDiscover(me: User | null): Promise<Discover> {
  const since = new Date(Date.now() - WEEK).toISOString();

  const [proofsRes, countRes, projects, communities, joined, rising] = await Promise.all([
    api
      .from("posts")
      .select(PROOF_COLUMNS)
      .eq("has_code", true)
      .order("created_at", { ascending: false })
      .limit(18),
    api
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("has_code", true)
      .gte("created_at", since),
    fetchDiscoverProjects(),
    fetchCommunities(),
    me ? fetchMyCommunityIds(me.id) : Promise.resolve(new Set<string>()),
    me ? loadLeaderboard(me) : Promise.resolve([] as LeaderEntry[]),
  ]);

  const [proofs, myXp] = await Promise.all([
    withAuthorXp(errorFree<PostWithAuthor[]>(proofsRes, []).filter((p) => p.author)),
    me ? loadAuthorXp([me.id]) : Promise.resolve(new Map<string, number>()),
  ]);

  const ateliers = projects
    .filter((p) => p.seeking)
    .sort((a, b) => {
      const weight = (p: Project) => p.demand_languages.length * 2 + p.demand_roles.length;
      return weight(b) - weight(a) || b.created_at.localeCompare(a.created_at);
    })
    .slice(0, 4);

  return {
    proofs: proofs.slice(0, 8),
    rising: rising.slice(0, 3),
    ateliers,
    cercles: communities.slice(0, 4),
    joined,
    signalsWeek: countRes.error ? proofs.length : (countRes.count ?? 0),
    myXp: me ? myXp.get(me.id) : undefined,
  };
}
