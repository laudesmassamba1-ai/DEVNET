/**
 * Inventaire des stockages de l'application.
 *
 * L'écran « Données » disait la base et les sauvegardes. Il manquait la
 * moitié de la vérité : **où vivent les fichiers**. Un média peut être sur
 * R2, sur Vercel Blob, ou dans `public.media_files` quand aucun stockage
 * objet n'est configuré — et ces trois chemins n'ont ni le même coût, ni la
 * même durabilité, ni la même vitesse.
 *
 * Ce module lit, il ne modifie rien :
 *  - R2 : `ListObjectsV2` avec le préfixe des médias, 1 000 objets au plus ;
 *  - Vercel Blob : `list()` du SDK, même limite ;
 *  - PostgreSQL : compte et octets de `media_files`, plus le nombre de
 *    références par table (posts, messages, statuts) — un fichier orphelin
 *    n'est pas un fichier utile.
 *
 * Aucune clé, aucune URL signée, aucun nom d'objet complet ne sort de cette
 * fonction. Seulement des fournisseurs, des volumes et un verdict.
 */
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";

export type StorageProviderState = {
  id: "r2" | "vercel-blob" | "postgres";
  label: string;
  configured: boolean;
  reachable: boolean | null;
  objects: number | null;
  bytes: number | null;
  /** Vrai quand la liste est plafonnée : le total est un minimum. */
  truncated: boolean;
  detail: string;
};

export type StorageInventory = {
  checkedAt: string;
  providers: StorageProviderState[];
  references: {
    postsWithMedia: number;
    directMessagesWithMedia: number;
    groupMessagesWithMedia: number;
    storiesWithMedia: number;
  } | null;
  /** Fichiers présents en base mais référencés nulle part. */
  orphaned: number | null;
  /** Ce que l'application sait lire, indépendamment du fournisseur. */
  readable: boolean;
};

async function inspectR2(): Promise<StorageProviderState> {
  const endpoint = (process.env.R2_ENDPOINT?.trim() ?? "").replace(/\/+$/, "");
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  const base: StorageProviderState = {
    id: "r2",
    label: "Cloudflare R2",
    configured: Boolean(endpoint && accessKeyId && secretAccessKey && bucket),
    reachable: null,
    objects: null,
    bytes: null,
    truncated: false,
    detail: "R2 n'est pas configuré : les médias restent en base.",
  };
  if (!base.configured) return base;

  try {
    const { AwsClient } = await import("aws4fetch");
    const client = new AwsClient({
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
      service: "s3",
      region: process.env.R2_REGION?.trim() || "auto",
    });
    // Les sauvegardes vivent sous `db-backups/` : on les exclut pour ne pas
    // mélanger « stockage des médias » et « archives de la base ».
    const response = await client.fetch(
      `${endpoint}/${bucket}?list-type=2&max-keys=1000`,
      { method: "GET" },
    );
    if (!response.ok) {
      return {
        ...base,
        reachable: false,
        detail: `Le stockage a refusé la lecture (HTTP ${response.status}).`,
      };
    }
    const xml = await response.text();
    const entries = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((match) => {
      const block = match[1];
      const key = /<Key>([^<]*)<\/Key>/.exec(block)?.[1] ?? "";
      const size = Number(/<Size>(\d+)<\/Size>/.exec(block)?.[1] ?? 0);
      return { key, size };
    });
    const media = entries.filter((entry) => !entry.key.startsWith("db-backups/"));
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    return {
      ...base,
      reachable: true,
      objects: media.length,
      bytes: media.reduce((sum, entry) => sum + entry.size, 0),
      truncated,
      detail: truncated
        ? "Liste plafonnée à 1 000 objets : les totaux sont des minimums."
        : `${media.length} objet(s) média dans le compartiment.`,
    };
  } catch (error) {
    return {
      ...base,
      reachable: false,
      detail:
        error instanceof Error && /timeout|abort/i.test(error.message)
          ? "Le stockage n'a pas répondu dans le délai."
          : "Le stockage est injoignable.",
    };
  }
}

async function inspectBlob(): Promise<StorageProviderState> {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  const base: StorageProviderState = {
    id: "vercel-blob",
    label: "Vercel Blob",
    configured: Boolean(token),
    reachable: null,
    objects: null,
    bytes: null,
    truncated: false,
    detail: token
      ? "Le jeton est présent."
      : "Aucun jeton : ce fournisseur n'est pas utilisé.",
  };
  if (!token) return base;

  try {
    const { list } = await import("@vercel/blob");
    const result = await list({ token, limit: 1000 });
    return {
      ...base,
      reachable: true,
      objects: result.blobs.length,
      bytes: result.blobs.reduce((sum, blob) => sum + (blob.size ?? 0), 0),
      truncated: Boolean(result.hasMore),
      detail: result.hasMore
        ? "Liste plafonnée à 1 000 objets : les totaux sont des minimums."
        : `${result.blobs.length} objet(s) dans le magasin.`,
    };
  } catch {
    return { ...base, reachable: false, detail: "Le magasin Blob n'a pas répondu." };
  }
}

async function inspectPostgres(): Promise<{
  provider: StorageProviderState;
  references: StorageInventory["references"];
  orphaned: number | null;
}> {
  const provider: StorageProviderState = {
    id: "postgres",
    label: "PostgreSQL · media_files",
    configured: true,
    reachable: null,
    objects: null,
    bytes: null,
    truncated: false,
    detail: "Lecture impossible : la base ne répond pas.",
  };
  try {
    const pool = getPostgresPool();
    const [files, refs] = await Promise.all([
      pool.query<{ n: string; bytes: string; remote: string }>(
        `select count(*)::text as n,
                coalesce(sum(byte_size), 0)::text as bytes,
                count(*) filter (where url <> '')::text as remote
           from public.media_files`,
      ),
      pool
        .query<{
          posts: string;
          dms: string;
          gms: string;
          stories: string;
          orphaned: string;
        }>(
          `select
             (select count(*) from public.posts where media_url <> '')::text as posts,
             (select count(*) from public.direct_messages where media_url <> '')::text as dms,
             (select count(*) from public.group_messages where media_url <> '')::text as gms,
             (select count(*) from public.stories where media_url <> '')::text as stories,
             (select count(*) from public.media_files m
               where not exists (select 1 from public.posts p where p.media_url like '%' || m.path)
                 and not exists (select 1 from public.direct_messages d where d.media_url like '%' || m.path)
                 and not exists (select 1 from public.group_messages g where g.media_url like '%' || m.path)
                 and not exists (select 1 from public.stories s where s.media_url like '%' || m.path))::text
               as orphaned`,
        )
        .catch(() => null),
    ]);
    const row = files.rows[0];
    const refRow = refs?.rows[0];
    const n = Number(row?.n ?? 0);
    const remote = Number(row?.remote ?? 0);
    return {
      provider: {
        ...provider,
        reachable: true,
        objects: n,
        bytes: Number(row?.bytes ?? 0),
        detail:
          n === 0
            ? "Aucun fichier en base."
            : `${n} fichier(s), dont ${remote} déposé(s) chez un fournisseur objet `
              + `(les octets ne sont alors pas dupliqués ici).`,
      },
      references: refRow
        ? {
            postsWithMedia: Number(refRow.posts),
            directMessagesWithMedia: Number(refRow.dms),
            groupMessagesWithMedia: Number(refRow.gms),
            storiesWithMedia: Number(refRow.stories),
          }
        : null,
      orphaned: refRow ? Number(refRow.orphaned) : null,
    };
  } catch {
    return { provider, references: null, orphaned: null };
  }
}

let storageCache: { at: number; value: StorageInventory } | null = null;
/** Une console n'a pas besoin de relister R2 et Blob à chaque clic. */
const STORAGE_TTL_MS = 30_000;

/**
 * Inventaire des stockages.
 *
 * Le résultat est mémorisé trente secondes : lister un compartiment et un
 * magasin Blob coûte deux allers-retours réseau, et un écran d'administration
 * relu trois fois de suite n'a aucune raison de les payer trois fois. Trente
 * secondes est assez court pour ne pas mentir sur un envoi qui vient d'aboutir.
 */
export async function inspectStorage(): Promise<StorageInventory> {
  if (storageCache && Date.now() - storageCache.at < STORAGE_TTL_MS) {
    return storageCache.value;
  }
  const [r2, blob, postgres] = await Promise.all([
    inspectR2(),
    inspectBlob(),
    inspectPostgres(),
  ]);
  const value: StorageInventory = {
    checkedAt: new Date().toISOString(),
    providers: [r2, blob, postgres.provider],
    references: postgres.references,
    orphaned: postgres.orphaned,
    readable: postgres.provider.reachable === true,
  };
  storageCache = { at: Date.now(), value };
  return value;
}
