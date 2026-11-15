/**
 * Adaptateur PostgreSQL des stickers personnels.
 *
 * Le catalogue ne remonte **jamais** les octets : `bytes` pèse jusqu'à
 * 60 Ko, et le multiplier par cinquante stickers transformerait une liste en
 * téléchargement. Les octets sont lus par une route dédiée, sur un seul
 * sticker à la fois.
 */
import type { StickerColorToken } from "../../application/sticker-input";
import type {
  StickerAsset,
  StickerEntry,
  StickerInput,
  StickersRepository,
} from "../../ports/stickers-repository";
import { StickersRepositoryError } from "../../ports/stickers-repository";

export type StickersSqlQuery = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  values?: unknown[],
) => Promise<T[]>;

export interface PostgresStickersDependencies {
  asUser: <T>(userId: string, run: (query: StickersSqlQuery) => Promise<T>) => Promise<T>;
  /** Re-encode une image déjà validée ; `null` si le serveur ne peut pas. */
  reencode?: (
    source: Buffer,
  ) => Promise<
    | { ok: true; sticker: { bytes: Buffer; mime: string; width: number; height: number; sha256: string } }
    | { ok: false; error: string }
  >;
}

interface StickerRow extends Record<string, unknown> {
  id: string;
  pack: string;
  kind: string;
  glyph: string;
  name: string;
  owner_id: string | null;
  visibility: string;
  status: string;
  fg: string;
  bg: string;
  byte_size: number | string | null;
  created_at: Date | string;
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

function toEntry(row: StickerRow, readerId: string | null): StickerEntry {
  return {
    id: String(row.id),
    pack: String(row.pack),
    kind: row.kind as StickerEntry["kind"],
    glyph: String(row.glyph ?? ""),
    name: String(row.name),
    visibility: row.visibility === "public" ? "public" : "prive",
    status: row.status === "retire" ? "retire" : "actif",
    fg: String(row.fg ?? ""),
    bg: String(row.bg ?? ""),
    mine: row.owner_id !== null && row.owner_id === readerId,
    byteSize: Number(row.byte_size ?? 0),
    createdAt: iso(row.created_at),
  };
}

const LIST_COLUMNS = `id, pack, kind, glyph, name, owner_id::text as owner_id,
  visibility, status, fg, bg, coalesce(octet_length(bytes), 0) as byte_size, created_at`;

export class PostgresStickersRepository implements StickersRepository {
  constructor(private readonly dependencies: PostgresStickersDependencies) {}

  async list(readerId: string | null): Promise<StickerEntry[]> {
    if (!readerId) {
      const rows = await this.dependencies.asUser(
        "00000000-0000-0000-0000-000000000000",
        (query) =>
          query<StickerRow>(
            `select ${LIST_COLUMNS} from public.stickers
              where status = 'actif' and owner_id is null
              order by pack, name
              limit 200`,
          ),
      );
      return rows.map((row) => toEntry(row, null));
    }

    try {
      const rows = await this.dependencies.asUser(readerId, (query) =>
        query<StickerRow>(
          `select ${LIST_COLUMNS} from public.stickers
            order by (owner_id = $1) desc, created_at desc
            limit 200`,
          [readerId],
        ),
      );
      return rows.map((row) => toEntry(row, readerId));
    } catch (error) {
      throw new StickersRepositoryError("list-stickers", pgCode(error), undefined, {
        cause: error,
      });
    }
  }

  async create(readerId: string, input: StickerInput): Promise<StickerEntry> {
    if (input.kind === "texte") {
      try {
        const rows = await this.dependencies.asUser(readerId, (query) =>
          query<StickerRow>(
            `insert into public.stickers
               (id, pack, kind, glyph, name, owner_id, visibility, status, mime, fg, bg)
             values ($1, 'perso', 'texte', $2, $3, $4, $5, 'actif', '', $6, $7)
             returning ${LIST_COLUMNS}`,
            [
              `custom-${crypto.randomUUID()}`,
              input.glyph,
              input.name,
              readerId,
              input.visibility,
              input.fg,
              input.bg,
            ],
          ),
        );
        const row = rows[0];
        if (!row) throw new StickersRepositoryError("create-sticker", "insertion-sans-ligne");
        return toEntry(row, readerId);
      } catch (error) {
        if (error instanceof StickersRepositoryError) throw error;
        throw new StickersRepositoryError("create-sticker", pgCode(error), undefined, {
          cause: error,
        });
      }
    }

    if (!this.dependencies.reencode) {
      throw new StickersRepositoryError(
        "create-sticker",
        "reencodage-indisponible",
        "Le re-encodage d’image n’est pas disponible sur ce serveur.",
      );
    }

    const encoded = await this.dependencies.reencode(input.source);
    if (!encoded.ok) {
      throw new StickersRepositoryError("create-sticker", "image-refusee", encoded.error);
    }

    try {
      const rows = await this.dependencies.asUser(readerId, (query) =>
        query<StickerRow>(
          `insert into public.stickers
             (id, pack, kind, glyph, name, owner_id, visibility, status,
              bytes, mime, sha256)
           values ($1, 'perso', 'image', '', $2, $3, $4, 'actif',
                   $5, $6, $7)
           returning ${LIST_COLUMNS}`,
          [
            `custom-${crypto.randomUUID()}`,
            input.name,
            readerId,
            input.visibility,
            encoded.sticker.bytes,
            encoded.sticker.mime,
            encoded.sticker.sha256,
          ],
        ),
      );
      const row = rows[0];
      if (!row) throw new StickersRepositoryError("create-sticker", "insertion-sans-ligne");
      return toEntry(row, readerId);
    } catch (error) {
      if (error instanceof StickersRepositoryError) throw error;
      throw new StickersRepositoryError("create-sticker", pgCode(error), undefined, {
        cause: error,
      });
    }
  }

  async retire(readerId: string, stickerId: string): Promise<void> {
    try {
      await this.dependencies.asUser(readerId, (query) =>
        query(
          `update public.stickers set status = 'retire', updated_at = now()
            where id = $1 and owner_id = $2`,
          [stickerId, readerId],
        ),
      );
    } catch (error) {
      throw new StickersRepositoryError("retire-sticker", pgCode(error), undefined, {
        cause: error,
      });
    }
  }

  async fetchAsset(readerId: string | null, stickerId: string): Promise<StickerAsset | null> {
    try {
      const rows = await this.dependencies.asUser(
        readerId ?? "00000000-0000-0000-0000-000000000000",
        (query) =>
          query<{ mime: string; bytes: Buffer | null; visibility: string }>(
            "select mime, bytes, visibility from public.stickers where id = $1 and bytes is not null",
            [stickerId],
          ),
      );
      const row = rows[0];
      if (!row?.bytes) return null;
      return {
        mime: String(row.mime || "image/webp"),
        bytes: row.bytes,
        visibility: row.visibility === "public" ? "public" : "prive",
      };
    } catch (error) {
      throw new StickersRepositoryError("read-asset", pgCode(error), undefined, {
        cause: error,
      });
    }
  }
}

/**
 * Conservé pour la lisibilité du type : les couleurs sont des jetons, pas
 * des valeurs, et c'est l'écran qui les résout.
 */
export type StickerToken = StickerColorToken;
