/**
 * Adaptateur PostgreSQL des stories.
 *
 * Deux principes, hérités de l'adaptateur du fil :
 *
 * - l'exécution passe par `withUser`, donc la RLS est la seule juge de ce
 *   qu'un lecteur peut voir ;
 * - une lecture de story = deux requêtes au plus (les stories, puis leurs
 *   stickers), jamais une par story.
 *
 * Les compteurs de likes et de vues ne sont calculés que si le lecteur est
 * l'auteur ; sinon la requête renvoie `0` et l'écran n'affiche rien.
 */
import type { AuthorWithBadge, StoryWithAuthor } from "@/lib/types";
import type {
  PlaceStickerInput,
  PlacedSticker,
  StickerCatalogEntry,
  StoriesRepository,
  StoryCursor,
  StoryEntry,
  StoryFeed,
  StoryViewerEntry,
} from "../../ports/stories-repository";
import { StoriesRepositoryError } from "../../ports/stories-repository";

export type StoriesSqlQuery = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  values?: unknown[],
) => Promise<T[]>;

export interface PostgresStoriesDependencies {
  /** Exécute `run` dans une transaction sous l'identité de `userId`. */
  asUser: <T>(userId: string, run: (query: StoriesSqlQuery) => Promise<T>) => Promise<T>;
}

const AUTHOR_JSON = `case when u.id is null then null else json_build_object(
    'id', u.id, 'prenom', u.prenom, 'pseudo', u.pseudo,
    'avatar_color', u.avatar_color, 'account_type', u.account_type,
    'verified', u.verified, 'is_admin', u.is_admin,
    'filiere', u.filiere, 'niveau', u.niveau
  ) end as author`;

interface StoryRow extends Record<string, unknown> {
  id: string;
  author_id: string;
  caption: string;
  media_url: string;
  created_at: Date | string;
  expires_at: Date | string;
  author: AuthorWithBadge | null;
  likes: number | string | null;
  views: number | string | null;
  liked: boolean | null;
  seen: boolean | null;
}

interface StickerRow extends Record<string, unknown> {
  id: string;
  story_id: string;
  sticker_id: string;
  kind?: string;
  glyph: string;
  name: string;
  fg?: string;
  bg?: string;
  x: number | string;
  y: number | string;
  scale: number | string;
  rotation: number | string;
  z: number | string;
}

function pgCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "postgres";
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function num(value: number | string | null | undefined, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class PostgresStoriesRepository implements StoriesRepository {
  constructor(private readonly dependencies: PostgresStoriesDependencies) {}

  async fetchFeed(readerId: string | null, cursor?: StoryCursor | null): Promise<StoryFeed> {
    // Le catalogue part en parallèle : il ne dépend pas du lecteur, et
    // l'attendre en série ajoutait une transaction entière au temps
    // d'ouverture des stories.
    const catalogPromise = this.fetchCatalog();
    if (!readerId) return { stories: [], catalog: await catalogPromise, nextCursor: null };

    let rows: StoryRow[];
    try {
      rows = await this.dependencies.asUser(readerId, (query) =>
        query<StoryRow>(
          `select s.id, s.author_id, s.caption, s.media_url, s.audience,
                  s.created_at, s.expires_at, ${AUTHOR_JSON},
                  case when s.author_id = $1 then (
                    select count(*) from public.story_likes l where l.story_id = s.id
                  ) else 0 end as likes,
                  case when s.author_id = $1 then (
                    select count(*) from public.story_views v where v.story_id = s.id
                  ) else 0 end as views,
                  exists (
                    select 1 from public.story_likes l
                     where l.story_id = s.id and l.user_id = $1
                  ) as liked,
                  exists (
                    select 1 from public.story_views v
                     where v.story_id = s.id and v.viewer_id = $1
                  ) as seen
             from public.stories s
             left join public.users u on u.id = s.author_id
            where s.expires_at > now()
              and ($2::timestamptz is null or (s.created_at, s.id) < ($2::timestamptz, $3::uuid))
            order by s.created_at desc, s.id desc
            limit 61`,
          [readerId, cursor?.createdAt ?? null, cursor?.id ?? null],
        ),
      );
    } catch (error) {
      throw new StoriesRepositoryError("list-stories", pgCode(error), { cause: error });
    }

    const catalog = await catalogPromise;
    if (rows.length === 0) return { stories: [], catalog, nextCursor: null };

    // On lit 61 lignes : la 61e prouve qu'il reste une page, sans compter
    // toute la table. Le curseur est la dernière ligne **rendue**.
    const hasMore = rows.length > 60;
    const pageRows = hasMore ? rows.slice(0, 60) : rows;
    const nextCursor = hasMore
      ? {
          createdAt: iso(pageRows[pageRows.length - 1].created_at),
          id: String(pageRows[pageRows.length - 1].id),
        }
      : null;

    const ids = pageRows.map((row) => String(row.id));
    // Stickers et médias dans la même transaction : deux allers-retours au
    // lieu de deux transactions complètes, qui coûtaient chacune leur
    // poignée de main avec Postgres.
    let payload: {
      stickers: StickerRow[];
      media: { story_id: string; mime: string }[];
    };
    try {
      payload = await this.dependencies.asUser(readerId, async (query) => {
        const stickers = await query<StickerRow>(
          `select ss.id, ss.story_id::text as story_id, ss.sticker_id,
                  st.kind, st.glyph, st.name,
                  case when st.owner_id is null then '' else st.fg end as fg,
                  case when st.owner_id is null then '' else st.bg end as bg,
                  ss.x, ss.y, ss.scale, ss.rotation, ss.z
             from public.story_stickers ss
             join public.stickers st on st.id = ss.sticker_id
            where ss.story_id = any($1::uuid[])
            order by ss.z, ss.created_at`,
          [ids],
        );
        const media = await query<{ story_id: string; mime: string }>(
          "select story_id::text as story_id, mime from public.story_media where story_id = any($1::uuid[])",
          [ids],
        ).catch(() => [] as { story_id: string; mime: string }[]);
        return { stickers, media };
      });
    } catch (error) {
      throw new StoriesRepositoryError("list-stories", pgCode(error), { cause: error });
    }

    const { stickers, media } = payload;
    const mediaByStory = new Map(media.map((row) => [String(row.story_id), row.mime]));

    const byStory = new Map<string, PlacedSticker[]>();
    for (const sticker of stickers) {
      const list = byStory.get(String(sticker.story_id)) ?? [];
      list.push({
        id: String(sticker.id),
        stickerId: String(sticker.sticker_id),
        kind: (sticker.kind ?? "texte") as PlacedSticker["kind"],
        glyph: String(sticker.glyph),
        name: String(sticker.name),
        fg: String(sticker.fg ?? ""),
        bg: String(sticker.bg ?? ""),
        x: num(sticker.x),
        y: num(sticker.y),
        scale: num(sticker.scale, 1),
        rotation: num(sticker.rotation),
        z: num(sticker.z),
      });
      byStory.set(String(sticker.story_id), list);
    }

    const stories: StoryEntry[] = pageRows.map((row) => {
      const { author, ...rest } = row;
      const story: StoryWithAuthor = {
        ...(rest as unknown as StoryWithAuthor),
        created_at: iso(row.created_at),
        expires_at: iso(row.expires_at),
        author: (author as AuthorWithBadge | null) ?? null,
      };
      return {
        ...story,
        likes: num(row.likes),
        views: num(row.views),
        liked: row.liked === true,
        seen: row.seen === true,
        stickers: byStory.get(String(row.id)) ?? [],
        media: mediaByStory.has(String(row.id))
          ? { mime: String(mediaByStory.get(String(row.id))) }
          : null,
      };
    });

    return { stories, catalog, nextCursor };
  }

  async toggleLike(
    readerId: string,
    storyId: string,
  ): Promise<{ liked: boolean; likes: number }> {
    let liked: boolean;
    try {
      await this.dependencies.asUser(readerId, (query) =>
        query("insert into public.story_likes (story_id, user_id) values ($1, $2)", [
          storyId,
          readerId,
        ]),
      );
      liked = true;
    } catch (error) {
      if (pgCode(error) !== "23505") {
        throw new StoriesRepositoryError("toggle-like", pgCode(error), { cause: error });
      }
      try {
        await this.dependencies.asUser(readerId, (query) =>
          query("delete from public.story_likes where story_id = $1 and user_id = $2", [
            storyId,
            readerId,
          ]),
        );
      } catch (deleteError) {
        throw new StoriesRepositoryError("toggle-like", pgCode(deleteError), {
          cause: deleteError,
        });
      }
      liked = false;
    }

    try {
      const rows = await this.dependencies.asUser(readerId, (query) =>
        query<{ n: string }>(
          "select count(*)::text as n from public.story_likes where story_id = $1",
          [storyId],
        ),
      );
      return { liked, likes: num(rows[0]?.n) };
    } catch {
      // Le geste est enregistré ; seul le compteur est indisponible. On le
      // dit par `-1` plutôt que d'inventer un chiffre.
      return { liked, likes: -1 };
    }
  }

  async markSeen(readerId: string, storyId: string): Promise<void> {
    try {
      await this.dependencies.asUser(readerId, (query) =>
        query("insert into public.story_views (story_id, viewer_id) values ($1, $2)", [
          storyId,
          readerId,
        ]),
      );
    } catch (error) {
      // La clé primaire (story_id, viewer_id) rend le second passage
      // inoffensif. `on conflict do nothing` a été écarté : sous RLS, la
      // détection du conflit exige de lire la ligne existante, que la
      // politique de lecture réserve à l'auteur. Le doublon est donc
      // traité comme un succès, pas comme un échec.
      if (pgCode(error) === "23505") return;
      throw new StoriesRepositoryError("mark-seen", pgCode(error), { cause: error });
    }
  }

  async reply(
    readerId: string,
    storyId: string,
    body: string,
  ): Promise<{ id: string; conversationId: string; messageId: string }> {
    const text = `Réponse à ta story : ${body}`;

    try {
      return await this.dependencies.asUser(readerId, async (query) => {
        const rows = await query<{ id: string; to_id: string }>(
          `insert into public.story_replies (story_id, from_id, to_id, body)
           select s.id, $2, s.author_id, $3
             from public.stories s
            where s.id = $1 and s.expires_at > now() and s.author_id <> $2
           returning id::text as id, to_id::text as to_id`,
          [storyId, readerId, body],
        );

        const row = rows[0];
        if (!row) throw new StoriesRepositoryError("reply", "story-inaccessible");

        // Même identifiant de conversation que l'écran des messages :
        // `[a, b].sort().join("|")`. Deux conventions différentes
        // ouvriraient deux fils pour la même paire de personnes.
        const conversationId = [readerId, row.to_id].sort().join("|");

        const existing = await query<{ one: number }>(
          "select 1 as one from public.conversations where id = $1 limit 1",
          [conversationId],
        );
        if (existing.length === 0) {
          try {
            // Le déclencheur `conversations_sync_members` remplit
            // `conversation_members` : la lecture du fil en dépend.
            await query(
              `insert into public.conversations (id, participants, last_message, last_message_at)
               values ($1, array[$2::uuid, $3::uuid], $4, now())`,
              [conversationId, readerId, row.to_id, text],
            );
          } catch (error) {
            // Conversation créée entre-temps par l'autre personne :
            // c'est le résultat voulu, pas un échec.
            if (pgCode(error) !== "23505") throw error;
          }
        }

        const pseudo = await query<{ pseudo: string | null }>(
          "select pseudo from public.users where id = $1 limit 1",
          [readerId],
        );

        // `story_id` garde le lien vers la story d'origine : l'écran des
        // messages peut alors afficher une carte, même si le texte a été
        // corrigé depuis.
        const message = await query<{ id: string }>(
          `insert into public.direct_messages
             (conversation_id, author_id, author_name, text, story_id)
           values ($1, $2, $3, $4, $5)
           returning id::text as id`,
          [conversationId, readerId, pseudo[0]?.pseudo ?? "", text, storyId],
        );

        await query(
          "update public.conversations set last_message = $2, last_message_at = now() where id = $1",
          [conversationId, text],
        );

        return {
          id: String(row.id),
          conversationId,
          messageId: String(message[0]?.id ?? ""),
        };
      });
    } catch (error) {
      if (error instanceof StoriesRepositoryError) throw error;
      throw new StoriesRepositoryError("reply", pgCode(error), { cause: error });
    }
  }

  async placeSticker(
    readerId: string,
    storyId: string,
    input: PlaceStickerInput,
  ): Promise<PlacedSticker> {
    try {
      const rows = await this.dependencies.asUser(readerId, (query) =>
        query<StickerRow>(
          `insert into public.story_stickers
             (story_id, sticker_id, placed_by, x, y, scale, rotation, z)
           select $1, $3, $2, $4, $5, $6, $7,
                  coalesce((select max(z) + 1 from public.story_stickers where story_id = $1), 0)
             from public.stories s
            where s.id = $1 and s.author_id = $2 and s.expires_at > now()
           returning id::text as id,
                     story_id::text as story_id,
                     sticker_id,
                     (select kind from public.stickers where id = sticker_id) as kind,
                     (select glyph from public.stickers where id = sticker_id) as glyph,
                     (select name from public.stickers where id = sticker_id) as name,
                     (select fg from public.stickers where id = sticker_id) as fg,
                     (select bg from public.stickers where id = sticker_id) as bg,
                     x, y, scale, rotation, z`,
          [
            storyId,
            readerId,
            input.stickerId,
            input.x,
            input.y,
            input.scale,
            input.rotation,
          ],
        ),
      );

      const row = rows[0];
      if (!row) throw new StoriesRepositoryError("place-sticker", "story-inaccessible");
      return {
        id: String(row.id),
        stickerId: String(row.sticker_id),
        kind: (row.kind ?? "texte") as PlacedSticker["kind"],
        glyph: String(row.glyph ?? ""),
        name: String(row.name ?? ""),
        fg: String(row.fg ?? ""),
        bg: String(row.bg ?? ""),
        x: num(row.x),
        y: num(row.y),
        scale: num(row.scale, 1),
        rotation: num(row.rotation),
        z: num(row.z),
      };
    } catch (error) {
      if (error instanceof StoriesRepositoryError) throw error;
      throw new StoriesRepositoryError("place-sticker", pgCode(error), { cause: error });
    }
  }

  async moveSticker(
    authorId: string,
    storyId: string,
    placedId: string,
    input: Omit<PlaceStickerInput, "stickerId">,
  ): Promise<PlacedSticker> {
    try {
      const rows = await this.dependencies.asUser(authorId, (query) =>
        query<StickerRow>(
          `update public.story_stickers ss
              set x = $4, y = $5, scale = $6, rotation = $7
             from public.stories s
            where ss.id = $3
              and ss.story_id = $1
              and ss.placed_by = $2
              and s.id = ss.story_id
              and s.expires_at > now()
           returning ss.id::text as id,
                     story_id::text as story_id,
                     sticker_id,
                     (select kind from public.stickers where id = sticker_id) as kind,
                     (select glyph from public.stickers where id = sticker_id) as glyph,
                     (select name from public.stickers where id = sticker_id) as name,
                     (select fg from public.stickers where id = sticker_id) as fg,
                     (select bg from public.stickers where id = sticker_id) as bg,
                     x, y, scale, rotation, z`,
          [storyId, authorId, placedId, input.x, input.y, input.scale, input.rotation],
        ),
      );
      const row = rows[0];
      if (!row) throw new StoriesRepositoryError("move-sticker", "sticker-inaccessible");
      return {
        id: String(row.id),
        stickerId: String(row.sticker_id),
        kind: (row.kind ?? "texte") as PlacedSticker["kind"],
        glyph: String(row.glyph ?? ""),
        name: String(row.name ?? ""),
        fg: String(row.fg ?? ""),
        bg: String(row.bg ?? ""),
        x: num(row.x),
        y: num(row.y),
        scale: num(row.scale, 1),
        rotation: num(row.rotation),
        z: num(row.z),
      };
    } catch (error) {
      if (error instanceof StoriesRepositoryError) throw error;
      throw new StoriesRepositoryError("move-sticker", pgCode(error), { cause: error });
    }
  }

  async createStory(
    authorId: string,
    input: {
      caption: string;
      audience?: "public" | "followers" | "private";
      media?: {
        bytes: Buffer;
        mime: string;
        width: number | null;
        height: number | null;
        durationMs: number | null;
      };
      mediaUrl?: string;
    },
  ): Promise<{ id: string }> {
    try {
      return await this.dependencies.asUser(authorId, async (query) => {
        const rows = await query<{ id: string }>(
          `insert into public.stories (author_id, caption, media_url, audience)
           values ($1, $2, $3, $4)
           returning id::text as id`,
          [authorId, input.caption, input.mediaUrl ?? "", input.audience ?? "public"],
        );
        const id = rows[0]?.id;
        if (!id) throw new StoriesRepositoryError("create-story", "insertion-sans-ligne");

        if (input.media) {
          await query(
            `insert into public.story_media
               (story_id, mime, bytes, byte_size, width, height, duration_ms)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              id,
              input.media.mime,
              input.media.bytes,
              input.media.bytes.length,
              input.media.width,
              input.media.height,
              input.media.durationMs,
            ],
          );
        }
        return { id: String(id) };
      });
    } catch (error) {
      if (error instanceof StoriesRepositoryError) throw error;
      throw new StoriesRepositoryError("create-story", pgCode(error), { cause: error });
    }
  }

  async fetchStoryMedia(
    readerId: string | null,
    storyId: string,
  ): Promise<{ mime: string; bytes: Buffer } | null> {
    try {
      const rows = await this.dependencies.asUser(
        readerId ?? "00000000-0000-0000-0000-000000000000",
        (query) =>
          query<{ mime: string; bytes: Buffer }>(
            "select mime, bytes from public.story_media where story_id = $1",
            [storyId],
          ),
      );
      const row = rows[0];
      return row ? { mime: row.mime, bytes: row.bytes } : null;
    } catch (error) {
      throw new StoriesRepositoryError("read-story-media", pgCode(error), { cause: error });
    }
  }

  async listViewers(
    readerId: string,
    storyId: string,
  ): Promise<StoryViewerEntry[]> {
    try {
      const rows = await this.dependencies.asUser(readerId, (query) =>
        query<{
          id: string;
          prenom: string | null;
          pseudo: string | null;
          avatar_color: string | null;
          seen_at: Date | string;
        }>(
          // La jointure porte sur `users`, pas sur la story : on veut le nom
          // de la personne et l'instant de sa vue. La RLS de `story_views`
          // ne rend ces lignes qu'à l'auteur de la story.
          `select u.id::text as id, u.prenom, u.pseudo, u.avatar_color, v.seen_at
             from public.story_views v
             join public.users u on u.id = v.viewer_id
            where v.story_id = $1
            order by v.seen_at desc
            limit 200`,
          [storyId],
        ),
      );
      return rows.map((row) => ({
        id: String(row.id),
        prenom: String(row.prenom ?? ""),
        pseudo: String(row.pseudo ?? ""),
        avatar_color: String(row.avatar_color ?? "av-sage"),
        seenAt: iso(row.seen_at),
      }));
    } catch (error) {
      throw new StoriesRepositoryError("list-viewers", pgCode(error), { cause: error });
    }
  }

  async removeSticker(authorId: string, storyId: string, placedId: string): Promise<void> {
    try {
      const rows = await this.dependencies.asUser(authorId, (query) =>
        query<{ id: string }>(
          `delete from public.story_stickers
            where id = $3 and story_id = $1 and placed_by = $2
            returning id::text as id`,
          [storyId, authorId, placedId],
        ),
      );
      if (!rows[0]) throw new StoriesRepositoryError("remove-sticker", "sticker-inaccessible");
    } catch (error) {
      if (error instanceof StoriesRepositoryError) throw error;
      throw new StoriesRepositoryError("remove-sticker", pgCode(error), { cause: error });
    }
  }

  /** Catalogue de base — public, indépendant du lecteur. */
  async fetchCatalog(): Promise<StickerCatalogEntry[]> {
    const rows = await this.dependencies
      .asUser("00000000-0000-0000-0000-000000000000", (query) =>
        query<StickerCatalogEntry & Record<string, unknown>>(
          // Un sticker est un média : le catalogue de la maison, fait de
          // glyphes, ne propose plus rien dans la pellicule. Seuls les
          // stickers d'image créés par des personnes y entrent.
          `select id, pack, kind, glyph, name, fg, bg
             from public.stickers
            where status = 'actif' and kind = 'image' and owner_id is not null
            order by created_at desc, name
            limit 60`,
        ),
      )
      .catch(() => [] as (StickerCatalogEntry & Record<string, unknown>)[]);

    return rows.map((row) => ({
      id: String(row.id),
      pack: String(row.pack),
      kind: row.kind as StickerCatalogEntry["kind"],
      glyph: String(row.glyph ?? ""),
      name: String(row.name),
      fg: String(row.fg ?? ""),
      bg: String(row.bg ?? ""),
    }));
  }
}
