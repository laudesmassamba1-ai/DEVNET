/**
 * État des sauvegardes, lu en lecture seule sur le stockage hors site.
 *
 * Extrait de `/api/admin/data` pour être partagé avec `/api/admin/platform` :
 * deux écrans qui répondraient la même chose avec deux implémentations
 * finiraient par diverger, et c'est précisément le genre d'écart qui fait
 * croire à une sauvegarde qui n'existe pas.
 *
 * Ce que cette fonction fait : lister les archives (`ListObjectsV2`, préfixe
 * `db-backups/`), compter celles qui sont chiffrées, et rapporter l'âge de la
 * plus récente avec un verdict.
 *
 * Ce qu'elle ne fait jamais : télécharger une archive, exposer une clé,
 * exposer un nom d'objet complet. Le préfixe des sauvegardes porte un jeton
 * aléatoire et le magasin est public : révéler une clé rendrait l'archive
 * téléchargeable par quiconque la connaît.
 */

export type BackupVerdict = "ok" | "stale" | "missing" | "unconfigured" | "error";

export type BackupState = {
  configured: boolean;
  /** Nombre d'archives chiffrées trouvées hors site. */
  count: number | null;
  /** Date de la plus récente, telle que rapportée par le stockage. */
  newestAt: string | null;
  /** Taille de la plus récente. */
  newestBytes: number | null;
  verdict: BackupVerdict;
  detail: string;
};

/** Au-delà, une sauvegarde n'est plus une sauvegarde : c'est un souvenir. */
export const BACKUP_STALE_HOURS = 36;

let backupCache: { at: number; value: BackupState } | null = null;
/** Trente secondes : un état de sauvegarde ne change pas plus vite. */
const BACKUP_TTL_MS = 30_000;

export async function readBackupState(): Promise<BackupState> {
  if (backupCache && Date.now() - backupCache.at < BACKUP_TTL_MS) {
    return backupCache.value;
  }
  const value = await readBackupStateUncached();
  backupCache = { at: Date.now(), value };
  return value;
}

async function readBackupStateUncached(): Promise<BackupState> {
  const endpoint = (process.env.R2_ENDPOINT?.trim() ?? "").replace(/\/+$/, "");
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    return {
      configured: false,
      count: null,
      newestAt: null,
      newestBytes: null,
      verdict: "unconfigured",
      detail: "R2 n'est pas configuré : aucune copie hors site n'est vérifiable.",
    };
  }

  try {
    const { AwsClient } = await import("aws4fetch");
    const client = new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: "s3",
      region: process.env.R2_REGION?.trim() || "auto",
    });

    const response = await client.fetch(
      `${endpoint}/${bucket}?list-type=2&prefix=db-backups%2F&max-keys=200`,
      { method: "GET" },
    );

    if (!response.ok) {
      return {
        configured: true,
        count: null,
        newestAt: null,
        newestBytes: null,
        verdict: "error",
        detail: `Le stockage a refusé la lecture (HTTP ${response.status}).`,
      };
    }

    const xml = await response.text();
    // Analyse volontairement minimale : trois champs, pas un parseur XML.
    const entries = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((match) => {
      const block = match[1];
      const key = /<Key>([^<]*)<\/Key>/.exec(block)?.[1] ?? "";
      const modified = /<LastModified>([^<]*)<\/LastModified>/.exec(block)?.[1] ?? null;
      const size = Number(/<Size>(\d+)<\/Size>/.exec(block)?.[1] ?? 0);
      return { key, modified, size };
    });

    const archives = entries.filter((entry) => entry.key.endsWith(".dump.gpg"));
    if (archives.length === 0) {
      return {
        configured: true,
        count: 0,
        newestAt: null,
        newestBytes: null,
        verdict: "missing",
        detail: "Aucune archive chiffrée trouvée hors site.",
      };
    }

    archives.sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
    const newest = archives[0];
    const ageHours = newest.modified
      ? (Date.now() - Date.parse(newest.modified)) / 3_600_000
      : Number.POSITIVE_INFINITY;

    if (ageHours > BACKUP_STALE_HOURS) {
      return {
        configured: true,
        count: archives.length,
        newestAt: newest.modified,
        newestBytes: newest.size,
        verdict: "stale",
        detail:
          `La sauvegarde la plus récente a ${Math.round(ageHours)} h. `
          + `Au-delà de ${BACKUP_STALE_HOURS} h, la reprise perdrait trop de données.`,
      };
    }

    return {
      configured: true,
      count: archives.length,
      newestAt: newest.modified,
      newestBytes: newest.size,
      verdict: "ok",
      detail: `Sauvegarde de ${Math.round(ageHours)} h, présente hors site.`,
    };
  } catch (error) {
    return {
      configured: true,
      count: null,
      newestAt: null,
      newestBytes: null,
      verdict: "error",
      detail: error instanceof Error ? error.message.slice(0, 160) : "lecture impossible",
    };
  }
}
