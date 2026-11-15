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
import { isConnectionFailure } from "@/shared/postgres/connection-error";
import { rankPosts } from "@/lib/recommendation";

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
  const { author, created_at: createdAt, open_reports: _reports, ...rest } = row;
  void _reports;
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
    /*
     * Sans session, la RLS ne rendrait aucune ligne : renvoyer un fil vide
     * est correct, et c'était même le comportement voulu.
     *
     * Le défaut était ailleurs : ce retour se faisait **avant** de toucher
     * la base, donc pendant une panne un visiteur non connecté lisait
     * « aucun contenu » au lieu de « fil indisponible ». Le 14 novembre,
     * `/api/feed` répondait 200 avec un fil vide alors que la base était
     * morte — exactement le silence qu'une panne ne doit pas avoir.
     *
     * On sonde donc la base avant de répondre : une ligne suffit, et elle
     * coûte moins qu'une réponse qui ment.
     */
    if (!request.readerId) {
      try {
        await this.dependencies.asUser(
          "00000000-0000-0000-0000-000000000000",
          (query) => query("select 1 from public.posts limit 1"),
        );
      } catch (error) {
        if (isConnectionFailure(error)) {
          throw new FeedRepositoryError("list-feed", pgCode(error), { cause: error });
        }
        /* Erreur de données (table absente) : un fil vide reste honnête. */
      }
      return { rows: [], more: false, emptyScope: false };
    }
    const readerId = request.readerId;

    /*
     * « Pour toi » : un lot de candidats récents, classé par le module pur
     * `lib/recommendation.ts`. La base fait le tri grossier (fenêtre de dix
     * jours, plafond de 240 lignes) ; le classement se fait en mémoire parce
     * qu'il doit rester lisible et testable. Un classement en SQL serait plus
     * rapide et impossible à expliquer.
     */
    if (request.scope === "for-you") {
      return this.fetchRanked(readerId, request);
    }

    const followedIds =
      request.scope === "followed" ? await this.followedAuthorIds(readerId) : null;
    if (hasNoFollowedAuthors(followedIds)) {
      return { rows: [], more: false, emptyScope: true };
    }

    const values: unknown[] = [request.pageSize + 1, readerId];
    /*
     * Blocage et sourdine s'appliquent au fil, pas seulement à l'écran :
     * masquer côté client laisserait le contenu dans le HTML et dans la
     * pagination. Le prédicat est le même pour les deux relations ; un
     * blocage retire aussi les posts d'un compte que je ne suis plus.
     */
    const filters: string[] = [
      `and not exists (
         select 1 from public.user_blocks b
          where b.blocker_id = $2 and b.blocked_id = p.author_id)`,
      `and not exists (
         select 1 from public.user_mutes m
          where m.muter_id = $2 and m.muted_id = p.author_id)`,
    ];
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

  /**
   * Fil classé. `before` reste un curseur temporel : on classe le lot, puis on
   * ne garde que ce qui est plus ancien. C'est imparfait — un post très bien
   * classé peut apparaître en page 2 — mais c'est stable et sans doublon,
   * ce qui est la propriété qui compte pour un fil paginé.
   */
  private async fetchRanked(
    readerId: string,
    request: FeedPageRequest,
  ): Promise<FeedPage> {
    const [candidates, viewer, followed] = await Promise.all([
      this.dependencies
        .asUser(readerId, (query) =>
          query<Record<string, unknown>>(
            `select p.*, ${AUTHOR_JSON},
                    (select count(*) from public.reports r
                      where r.post_id = p.id and r.status = 'open')::int as open_reports
               from public.posts p
               left join public.users u on u.id = p.author_id
              where p.created_at > now() - interval '10 days'
                and not exists (
                  select 1 from public.user_blocks b
                   where b.blocker_id = $1 and b.blocked_id = p.author_id)
                and not exists (
                  select 1 from public.user_mutes m
                   where m.muter_id = $1 and m.muted_id = p.author_id)
              order by p.created_at desc
              limit 240`,
            [readerId],
          ),
        )
        .catch((error) => {
          if (isConnectionFailure(error)) {
            throw new FeedRepositoryError("list-feed", pgCode(error), { cause: error });
          }
          throw new FeedRepositoryError("list-feed", pgCode(error), { cause: error });
        }),
      this.dependencies
        .asUser(readerId, (query) =>
          query<{ filiere: string | null }>(
            "select filiere from public.users where id = $1 limit 1",
            [readerId],
          ),
        )
        .catch(() => []),
      this.followedAuthorIds(readerId).catch(() => [] as string[]),
    ]);

    /*
     * `open_reports` est retiré par `toPostWithAuthor` (il ne fait pas partie
     * du contrat d'une publication). On le conserve ici, le temps du
     * classement : sans lui, la pénalité de signalement ne s'appliquait
     * jamais, et une publication signalée trois fois remontait normalement.
     */
    const rankable = candidates.map((row) => ({
      ...toPostWithAuthor(row),
      open_reports: Number(row.open_reports ?? 0),
    }));

    const ranked = rankPosts(rankable, {
      followedAuthorIds: followed,
      viewerFiliere: viewer[0]?.filiere ?? null,
    }).map(({ open_reports: _reports, ...post }) => {
      void _reports;
      return post as PostWithAuthor;
    });

    const cursor = request.before;
    const afterCursor = cursor
      ? ranked.filter((post) => (post.created_at ?? "") < cursor)
      : ranked;

    return {
      rows: afterCursor.slice(0, request.pageSize),
      more: afterCursor.length > request.pageSize,
      emptyScope: ranked.length === 0,
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
