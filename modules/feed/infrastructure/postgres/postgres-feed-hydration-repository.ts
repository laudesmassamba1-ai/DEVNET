/**
 * Adaptateur PostgreSQL de l'hydratation du fil.
 *
 * Une seule requête, quatre sous-requêtes : le lecteur est le même, la page
 * aussi, et la base sait déjà filtrer par `user_id`. Comme l'adaptateur du
 * fil, l'exécution passe par `withUser` — la RLS reste la seule juge de ce
 * que le lecteur peut voir de lui-même.
 *
 * Sans identité, ou sans identifiant à hydrater, la réponse est l'état
 * neutre : ce n'est pas une panne, c'est un lecteur anonyme.
 */
import type { FeedHydration, FeedHydrationRepository } from "../../ports/feed-hydration-repository";
import { FeedHydrationError, emptyHydration } from "../../ports/feed-hydration-repository";
import type { SqlQuery } from "./postgres-feed-repository";

export interface PostgresFeedHydrationDependencies {
  /** Exécute `run` dans une transaction sous l'identité de `userId`. */
  asUser: <T>(userId: string, run: (query: SqlQuery) => Promise<T>) => Promise<T>;
}

const HYDRATION_SQL = `
  select
    coalesce(array(
      select l.post_id::text from public.post_likes l
       where l.user_id = $1 and l.post_id = any($2::uuid[])
    ), '{}') as liked,
    coalesce(array(
      select r.post_id::text from public.reposts r
       where r.user_id = $1 and r.post_id = any($2::uuid[])
    ), '{}') as reposted,
    coalesce(array(
      select b.post_id::text from public.bookmarks b
       where b.user_id = $1 and b.post_id = any($2::uuid[])
    ), '{}') as bookmarked,
    coalesce((
      select json_object_agg(x.post_id::text, x.emoji) from public.reactions x
       where x.user_id = $1 and x.post_id = any($2::uuid[])
    ), '{}'::json) as reactions
`;

interface HydrationRow extends Record<string, unknown> {
  liked: string[] | null;
  reposted: string[] | null;
  bookmarked: string[] | null;
  reactions: Record<string, string> | null;
}

function pgCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "postgres";
}

export class PostgresFeedHydrationRepository implements FeedHydrationRepository {
  constructor(private readonly dependencies: PostgresFeedHydrationDependencies) {}

  async fetchHydration(readerId: string | null, postIds: string[]): Promise<FeedHydration> {
    if (!readerId || postIds.length === 0) return emptyHydration();

    let rows: HydrationRow[];
    try {
      rows = await this.dependencies.asUser(readerId, (query) =>
        query<HydrationRow>(HYDRATION_SQL, [readerId, postIds]),
      );
    } catch (error) {
      throw new FeedHydrationError("fetch-hydration", pgCode(error), { cause: error });
    }

    const row = rows[0];
    return {
      likedPostIds: (row?.liked ?? []).map(String),
      repostedPostIds: (row?.reposted ?? []).map(String),
      bookmarkedPostIds: (row?.bookmarked ?? []).map(String),
      reactions: row?.reactions ?? {},
    };
  }
}
