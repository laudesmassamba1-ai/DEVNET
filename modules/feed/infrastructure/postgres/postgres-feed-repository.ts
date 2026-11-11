/**
 * Adaptateur PostgreSQL du fil.
 *
 * Le module ne connaît ni `pg` ni la composition : il reçoit la capacité
 * d'exécuter une requête **sous l'identité d'un utilisateur** — transaction,
 * `SET LOCAL ROLE authenticated`, claim `sub` — fournie par `withUser`.
 * C'est ce qui rend l'adaptateur remplaçable et la RLS effective sans
 * dupliquer la règle d'identité dans le code de lecture.
 *
 * Sans identité, aucune ligne n'est lisible : `posts_read` exige
 * `auth.role() = 'authenticated'`. On renvoie donc une page vide, exactement
 * comme l'adaptateur Supabase avec une clé anonyme — une absence de session
 * n'est pas une panne.
 */
import type { AuthorWithBadge, Post, PostWithAuthor } from "@/lib/types";
import type { FeedPage, FeedPageRequest, FeedRepository } from "../../ports/feed-repository";
import { FeedRepositoryError, hasNoFollowedAuthors } from "../../ports/feed-repository";

/** Exécuteur de requêtes fourni par la composition. */
export type SqlQuery = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  values?: unknown[],
) => Promise<T[]>;

export interface PostgresFeedDependencies {
  /** Exécute `run` dans une transaction sous l'identité de `userId`. */
  asUser: <T>(userId: string, run: (query: SqlQuery) => Promise<T>) => Promise<T>;
}

/** Auteur joint, à la forme attendue par `AuthorWithBadge`. */
const AUTHOR_JSON = `case when u.id is null then null else json_build_object(
    'id', u.id, 'prenom', u.prenom, 'pseudo', u.pseudo,
    'avatar_color', u.avatar_color, 'account_type', u.account_type,
    'verified', u.verified, 'is_admin', u.is_admin,
    'filiere', u.filiere, 'niveau', u.niveau
  ) end as author`;

function pgCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "postgres";
}

/** `created_at` arrive en `Date` côté pilote ; le contrat du port veut une chaîne ISO. */
function toPostWithAuthor(row: Record<string, unknown>): PostWithAuthor {
  const { author, created_at: createdAt, ...rest } = row;
  return {
    ...(rest as unknown as Post),
    created_at:
      createdAt instanceof Date ? createdAt.toISOString() : String(createdAt ?? ""),
    author: (author as AuthorWithBadge | null | undefined) ?? null,
  };
}

export class PostgresFeedRepository implements FeedRepository {
  constructor(private readonly dependencies: PostgresFeedDependencies) {}

  async fetchPage(request: FeedPageRequest): Promise<FeedPage> {
    if (!request.readerId) return { rows: [], more: false, emptyScope: false };
    const readerId = request.readerId;

    const followedIds =
      request.scope === "followed" ? await this.followedAuthorIds(readerId) : null;
    if (hasNoFollowedAuthors(followedIds)) {
      return { rows: [], more: false, emptyScope: true };
    }

    const values: unknown[] = [request.pageSize + 1];
    const filters: string[] = [];
    if (followedIds) {
      values.push(followedIds);
      filters.push(`and p.author_id = any($${values.length}::uuid[])`);
    }
    if (request.before) {
      values.push(request.before);
      filters.push(`and p.created_at < $${values.length}::timestamptz`);
    }

    let rows: Record<string, unknown>[];
    try {
      rows = await this.dependencies.asUser(readerId, (query) =>
        query<Record<string, unknown>>(
          `select p.*, ${AUTHOR_JSON}
             from public.posts p
             left join public.users u on u.id = p.author_id
            where true ${filters.join(" ")}
            order by p.created_at desc
            limit $1`,
          values,
        ),
      );
    } catch (error) {
      throw new FeedRepositoryError("list-feed", pgCode(error), { cause: error });
    }

    const page = rows.map(toPostWithAuthor);
    return {
      rows: page.slice(0, request.pageSize),
      more: page.length > request.pageSize,
      emptyScope: false,
    };
  }

  async addLike(
    postId: string,
    userId: string,
  ): Promise<"created" | "already-exists"> {
    try {
      await this.dependencies.asUser(userId, (query) =>
        query("insert into public.post_likes (post_id, user_id) values ($1, $2)", [
          postId,
          userId,
        ]),
      );
      return "created";
    } catch (error) {
      const code = pgCode(error);
      // Clé primaire (post_id, user_id) : le doublon est le signal du retrait.
      if (code === "23505") return "already-exists";
      throw new FeedRepositoryError("add-like", code, { cause: error });
    }
  }

  async removeLike(postId: string, userId: string): Promise<void> {
    try {
      await this.dependencies.asUser(userId, (query) =>
        query("delete from public.post_likes where post_id = $1 and user_id = $2", [
          postId,
          userId,
        ]),
      );
    } catch (error) {
      throw new FeedRepositoryError("remove-like", pgCode(error), { cause: error });
    }
  }

  private async followedAuthorIds(readerId: string): Promise<string[]> {
    let rows: { followee_id: string }[];
    try {
      rows = await this.dependencies.asUser(readerId, (query) =>
        query<{ followee_id: string }>(
          "select followee_id from public.follows where follower_id = $1",
          [readerId],
        ),
      );
    } catch (error) {
      throw new FeedRepositoryError("list-followed-authors", pgCode(error), {
        cause: error,
      });
    }
    return rows.map((row) => String(row.followee_id));
  }
}
