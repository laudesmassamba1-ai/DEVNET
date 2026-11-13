/**
 * Stockage objet des médias.
 *
 * Deux fournisseurs, dans cet ordre :
 *
 *  1. **Cloudflare R2** (10 Go gratuits, sans frais de sortie) dès que les
 *     variables `R2_*` sont présentes ;
 *  2. **Vercel Blob** (1 Go gratuit) dès que `BLOB_READ_WRITE_TOKEN` est
 *     connecté au projet — c'est le cas en production, sans compte externe.
 *
 * Sans aucun des deux, `putMediaObject` rend `null` : l'appelant garde les
 * octets dans `public.media_files`, comme avant. Une panne du stockage objet
 * ne casse donc pas l'envoi d'un média.
 */
import { put } from "@vercel/blob";
import { AwsClient } from "aws4fetch";

interface ObjectStorage {
  endpoint: string;
  bucket: string;
  publicUrl: string;
  client: AwsClient;
}

function readStorage(): ObjectStorage | null {
  const accounted = process.env.R2_ACCOUNT_ID?.trim();
  const endpoint = (
    process.env.R2_ENDPOINT?.trim() ||
    (accounted ? `https://${accounted}.r2.cloudflarestorage.com` : "")
  ).replace(/\/+$/, "");
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  const publicUrl = (process.env.R2_PUBLIC_URL?.trim() ?? "").replace(/\/+$/, "");

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    return null;
  }

  return {
    endpoint,
    bucket,
    publicUrl,
    client: new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: "s3",
      region: process.env.R2_REGION?.trim() || "auto",
    }),
  };
}

function requireStorage(): ObjectStorage {
  const storage = readStorage();
  if (!storage) {
    throw new Error("stockage objet R2 non configuré");
  }
  return storage;
}

/** R2 seul sait faire un envoi par morceaux ; Vercel Blob ne le propose pas. */
export function isMultipartCapable(): boolean {
  return readStorage() !== null;
}

export function isObjectStorageConfigured(): boolean {
  return readStorage() !== null || Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/**
 * Plafond d'un fichier envoyé par morceaux : 100 Mo.
 *
 * La limite de 4,5 Mo d'une fonction Vercel ne s'applique plus, puisque les
 * morceaux vont du navigateur directement à R2 : seule la petite requête de
 * signature traverse Vercel. Le plafond de 100 Mo est un choix de produit —
 * au-delà, un mobile qui tient la connexion ouverte pendant l'envoi devient
 * rare, et le coût de stockage sort du gratuit.
 */
export const MULTIPART_MAX_BYTES = 100 * 1024 * 1024;

/** S3 refuse une partie de moins de 5 Mo (sauf la dernière). */
const MIN_PART_BYTES = 5 * 1024 * 1024;
const TARGET_PARTS = 12;

/**
 * Taille de partie : la plus petite qui garde le nombre de parties raisonnable.
 * 100 Mo → 9 parties de 11,2 Mo, soit ~1,4 Mo/s suffisant sur une 4G correcte.
 */
export function multipartPartSize(size: number): number {
  const byCount = Math.ceil(size / TARGET_PARTS);
  return Math.max(MIN_PART_BYTES, Math.ceil(byCount / (1024 * 1024)) * 1024 * 1024);
}

function objectUrl(storage: ObjectStorage, key: string, query = ""): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${storage.endpoint}/${storage.bucket}/${encoded}${query}`;
}

function publicUrlOf(storage: ObjectStorage, key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${storage.publicUrl}/${encoded}`;
}

async function s3Error(response: Response, what: string): Promise<Error> {
  const detail = await response.text().catch(() => "");
  return new Error(`${what} ${response.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
}

/** Ouvre un envoi en plusieurs parties et rend son identifiant S3. */
export async function startMultipartUpload(
  key: string,
  contentType: string,
): Promise<string> {
  const storage = requireStorage();
  const response = await storage.client.fetch(
    objectUrl(storage, key, "?uploads"),
    {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
  );
  if (!response.ok) throw await s3Error(response, "R2 initiate");
  const xml = await response.text();
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1];
  if (!uploadId) throw new Error("R2 initiate — identifiant d'envoi absent");
  return uploadId;
}

/**
 * URL signée d'une partie. Elle autorise un `PUT` direct du navigateur vers
 * R2 pendant 24 h : les octets ne traversent jamais Vercel.
 */
export async function presignPartUrl(
  key: string,
  uploadId: string,
  partNumber: number,
): Promise<string> {
  const storage = requireStorage();
  const query = `?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;
  // Aucun en-tête ici : tout en-tête fourni entrerait dans la signature et
  // devrait être renvoyé à l'identique par le navigateur — un `PUT` de
  // morceau n'en envoie aucun. aws4fetch pose lui-même `X-Amz-Expires`
  // (24 h) pour S3.
  const signed = await storage.client.sign(objectUrl(storage, key, query), {
    method: "PUT",
    aws: { signQuery: true },
  });
  return signed.url;
}

/** Assemble les parties et rend l'URL publique de l'objet. */
export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<string> {
  const storage = requireStorage();
  const body = [
    "<CompleteMultipartUpload>",
    ...parts
      .slice()
      .sort((a, b) => a.partNumber - b.partNumber)
      .map(
        (part) =>
          `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag}</ETag></Part>`,
      ),
    "</CompleteMultipartUpload>",
  ].join("");
  const response = await storage.client.fetch(
    objectUrl(storage, key, `?uploadId=${encodeURIComponent(uploadId)}`),
    { method: "POST", headers: { "Content-Type": "application/xml" }, body },
  );
  if (!response.ok) throw await s3Error(response, "R2 complete");
  return publicUrlOf(storage, key);
}

/** Abandonne un envoi interrompu : sans cela, R2 garde les parties payantes. */
export async function abortMultipartUpload(
  key: string,
  uploadId: string,
): Promise<void> {
  const storage = readStorage();
  if (!storage) return;
  await storage.client
    .fetch(objectUrl(storage, key, `?uploadId=${encodeURIComponent(uploadId)}`), {
      method: "DELETE",
    })
    .catch(() => undefined);
}

/**
 * Dépose un objet et rend son URL publique, ou `null` si R2 n'est pas configuré.
 * Une erreur réseau/S3 est levée : l'appelant décide du repli.
 */
export async function putMediaObject(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string | null> {
  const storage = readStorage();
  if (!storage) {
    const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
    if (!token) return null;
    const blob = await put(path, Buffer.from(bytes), {
      access: "public",
      contentType,
      addRandomSuffix: false,
      cacheControlMaxAge: 31_536_000,
      token,
    });
    return blob.url;
  }

  const key = path.split("/").map(encodeURIComponent).join("/");
  // Copie dans un ArrayBuffer simple : `BodyInit` n'accepte pas un tampon
  // typé dont le buffer peut être partagé (SharedArrayBuffer).
  const body = new Uint8Array(bytes).buffer;
  const response = await storage.client.fetch(
    `${storage.endpoint}/${storage.bucket}/${key}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
      body,
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`R2 ${response.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}`);
  }

  return `${storage.publicUrl}/${key}`;
}
