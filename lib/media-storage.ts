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

export function isObjectStorageConfigured(): boolean {
  return readStorage() !== null || Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
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
