/**
 * Envoi d'un gros fichier en plusieurs parties, directement vers R2.
 *
 * Le navigateur ne téléverse plus rien à travers Vercel : il demande ici des
 * URL signées, puis envoie chaque partie (8 à 12 Mo) en direct à Cloudflare.
 * C'est ce qui lève la limite de 4,5 Mo du corps de requête des fonctions —
 * une simple requête JSON traverse la plateforme, pas le fichier.
 *
 * Trois actions :
 *
 *  - `create`   ouvre l'envoi et rend la taille de partie et les URL signées ;
 *  - `complete` assemble les parties et enregistre le média ;
 *  - `abort`    jette les parties d'un envoi abandonné (sinon elles restent
 *               facturées sur le stockage).
 *
 * Sans clés R2, la route répond 501 : le client retombe sur `/api/media`.
 */
import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import {
  MULTIPART_MAX_BYTES,
  abortMultipartUpload,
  completeMultipartUpload,
  deleteMediaObject,
  inspectMediaObject,
  isMultipartCapable,
  multipartPartSize,
  presignPartUrl,
  startMultipartUpload,
} from "@/lib/media-storage";
import { matchesDeclaredType, sniffMedia } from "@/lib/media-signature";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const PATH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
// R2 rend des identifiants d'envoi bien plus longs que S3 : 343 caractères
// observés, base64 url avec `_` et `-`.
const UPLOAD_ID = /^[A-Za-z0-9._~+/=-]{8,1024}$/;
const ETAG = /^"?[A-Za-z0-9-]{8,80}"?$/;

function kindOf(mime: string): "image" | "video" | null {
  if (/^image\/(png|jpeg|webp|gif|avif)$/.test(mime)) return "image";
  if (/^video\/(mp4|webm|quicktime)/.test(mime)) return "video";
  return null;
}

type Body = {
  action?: string;
  path?: string;
  size?: number;
  contentType?: string;
  uploadId?: string;
  parts?: { partNumber?: number; etag?: string }[];
};

export async function POST(request: Request) {
  const ownerId = await currentUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "authentification requise" }, { status: 401, headers: NO_STORE });
  }
  if (!isMultipartCapable()) {
    return NextResponse.json(
      { error: "envoi par morceaux indisponible" },
      { status: 501, headers: NO_STORE },
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || !body.path || !PATH.test(body.path)) {
    return NextResponse.json({ error: "nom de fichier invalide" }, { status: 400, headers: NO_STORE });
  }
  const path = body.path;

  try {
    if (body.action === "create") {
      const size = Number(body.size);
      const mime = String(body.contentType ?? "");
      if (!Number.isFinite(size) || size <= 0 || size > MULTIPART_MAX_BYTES) {
        return NextResponse.json(
          {
            error: `Fichier trop lourd — ${Math.round(MULTIPART_MAX_BYTES / 1024 / 1024)} Mo maximum.`,
          },
          { status: 413, headers: NO_STORE },
        );
      }
      if (!kindOf(mime)) {
        return NextResponse.json(
          { error: "Formats acceptés : photos et vidéos." },
          { status: 415, headers: NO_STORE },
        );
      }
      const uploadId = await startMultipartUpload(path, mime);
      const partSize = multipartPartSize(size);
      const partCount = Math.ceil(size / partSize);
      const urls = await Promise.all(
        Array.from({ length: partCount }, (_, index) =>
          presignPartUrl(path, uploadId, index + 1),
        ),
      );
      return NextResponse.json(
        { uploadId, partSize, partCount, urls },
        { headers: NO_STORE },
      );
    }

    if (body.action === "complete") {
      const uploadId = String(body.uploadId ?? "");
      const mime = String(body.contentType ?? "");
      const declaredKind = kindOf(mime);
      const size = Number(body.size);
      const parts = Array.isArray(body.parts) ? body.parts : [];
      if (!UPLOAD_ID.test(uploadId) || !declaredKind) {
        return NextResponse.json({ error: "envoi invalide" }, { status: 400, headers: NO_STORE });
      }
      if (!Number.isFinite(size) || size <= 0 || size > MULTIPART_MAX_BYTES) {
        return NextResponse.json({ error: "taille invalide" }, { status: 400, headers: NO_STORE });
      }
      if (parts.length === 0 || parts.length > 64) {
        return NextResponse.json({ error: "parties manquantes" }, { status: 400, headers: NO_STORE });
      }
      const normalized: { partNumber: number; etag: string }[] = [];
      for (const part of parts) {
        const partNumber = Number(part.partNumber);
        const etag = String(part.etag ?? "");
        if (
          !Number.isInteger(partNumber) ||
          partNumber < 1 ||
          partNumber > 64 ||
          !ETAG.test(etag)
        ) {
          return NextResponse.json({ error: "partie invalide" }, { status: 400, headers: NO_STORE });
        }
        normalized.push({ partNumber, etag });
      }

      const url = await completeMultipartUpload(path, uploadId, normalized);

      // Le `Content-Type` du client n'est pas une preuve : après assemblage,
      // on lit la taille réelle et les premiers octets de l'objet. Un HTML
      // renommé en `video/mp4` est supprimé et refusé, jamais enregistré.
      let inspection;
      try {
        inspection = await inspectMediaObject(url);
      } catch (error) {
        await deleteMediaObject(path);
        console.error("[media] objet assemblé illisible", error);
        return NextResponse.json({ error: "objet assemblé illisible" }, { status: 502, headers: NO_STORE });
      }
      if (inspection.bytes !== size) {
        await deleteMediaObject(path);
        return NextResponse.json(
          { error: "taille assemblée différente de la taille annoncée" },
          { status: 400, headers: NO_STORE },
        );
      }
      const sniffed = sniffMedia(inspection.prefix);
      if (!sniffed || sniffed.kind !== declaredKind || !matchesDeclaredType(sniffed, mime)) {
        await deleteMediaObject(path);
        return NextResponse.json(
          { error: "le contenu ne correspond pas au type annoncé" },
          { status: 415, headers: NO_STORE },
        );
      }

      const inserted = await withUser(ownerId, (query) =>
        query<{ path: string }>(
          `insert into public.media_files (path, owner_id, mime, kind, bytes, byte_size, url)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (path) do nothing
           returning path`,
          [path, ownerId, sniffed.mime, sniffed.kind, Buffer.alloc(0), inspection.bytes, url],
        ),
      );
      if (inserted.length === 0) {
        await deleteMediaObject(path);
        return NextResponse.json(
          { error: "ce nom de fichier est déjà pris" },
          { status: 409, headers: NO_STORE },
        );
      }
      return NextResponse.json({ path, url }, { headers: NO_STORE });
    }

    if (body.action === "abort") {
      const uploadId = String(body.uploadId ?? "");
      if (UPLOAD_ID.test(uploadId)) {
        await abortMultipartUpload(path, uploadId);
      }
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    return NextResponse.json({ error: "action inconnue" }, { status: 400, headers: NO_STORE });
  } catch (error) {
    console.error("[media] envoi par morceaux impossible", error);
    return NextResponse.json({ error: "envoi indisponible" }, { status: 503, headers: NO_STORE });
  }
}
