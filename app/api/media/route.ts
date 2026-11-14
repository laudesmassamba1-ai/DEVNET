/**
 * Envoi d'une photo ou d'une vidéo.
 *
 * Le fichier arrive en `multipart/form-data`. Les photos sont d'abord
 * normalisées (orientation, 1920 px maximum, WebP qualité 82) avec `sharp`,
 * puis déposées sur le stockage objet S3-compatible quand il est configuré.
 * Sans stockage objet, les octets restent dans `public.media_files` : le
 * repli est explicite et ne casse jamais l'envoi.
 *
 * La réponse rend le chemin et l'URL publique. `/api/media/<chemin>` redirige
 * vers l'URL distante, ou sert les octets de la base pour les anciens médias.
 */
import sharp from "sharp";
import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import { putMediaObject } from "@/lib/media-storage";
import { recordMetric } from "@/lib/metrics";
import { matchesDeclaredType, sniffMedia } from "@/lib/media-signature";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
// Corps de requête Vercel : 4,5 Mo. On laisse une marge pour le multipart.
// 4 Mo : plafond du corps de requête Vercel (4,5 Mo). Au-delà, la plateforme
// renvoie un 413 avant d'atteindre cette route — la borne ici sert surtout
// aux appels directs, hors plateforme.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_VIDEO_BYTES = 4 * 1024 * 1024;
const PATH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const COMPRESSIBLE = /^image\/(png|jpeg|webp|avif)$/;

function kindOf(mime: string): "image" | "video" | null {
  if (/^image\/(png|jpeg|webp|gif|avif)$/.test(mime)) return "image";
  if (/^video\/(mp4|webm|quicktime)$/.test(mime)) return "video";
  return null;
}

/**
 * Une image n'est acceptée que si `sharp` sait réellement la décoder.
 *
 * La signature binaire prouve que les octets *commencent* comme un PNG ;
 * elle ne prouve pas que le fichier est complet. Un décodeur qui échoue est
 * donc un refus, pas une raison de conserver le fichier d'origine : c'est
 * cette tolérance qui laissait passer un contenu tronqué.
 */
async function decodableImage(bytes: Buffer<ArrayBufferLike>): Promise<boolean> {
  try {
    const metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: 50_000_000,
    }).metadata();
    return Number(metadata.width) > 0 && Number(metadata.height) > 0;
  } catch {
    return false;
  }
}

/**
 * Compression serveur : elle protège aussi les appels qui ne passent pas par
 * le navigateur. Un GIF est laissé intact pour ne pas perdre l'animation.
 */
async function compressImage(
  bytes: Buffer<ArrayBufferLike>,
  mime: string,
): Promise<{ bytes: Buffer<ArrayBufferLike>; mime: string }> {
  if (!COMPRESSIBLE.test(mime)) return { bytes, mime };
  try {
    const output = await sharp(bytes, { failOn: "none" })
      .rotate()
      .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    if (output.length >= bytes.length) return { bytes, mime };
    return { bytes: output, mime: "image/webp" };
  } catch (error) {
    console.error("[media] compression impossible, fichier conservé", error);
    return { bytes, mime };
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let ownerId: string | null;
  try {
    ownerId = await currentUserId();
  } catch (error) {
    console.error("[media] session lookup failed", error);
    return NextResponse.json(
      { error: "envoi indisponible" },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!ownerId) {
    return NextResponse.json(
      { error: "session requise" },
      { status: 401, headers: NO_STORE },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "corps illisible" },
      { status: 400, headers: NO_STORE },
    );
  }

  const file = form.get("file");
  const requested = form.get("path");
  if (!(file instanceof File) || typeof requested !== "string") {
    return NextResponse.json(
      { error: "fichier attendu" },
      { status: 400, headers: NO_STORE },
    );
  }
  if (!PATH.test(requested)) {
    return NextResponse.json(
      { error: "chemin invalide" },
      { status: 400, headers: NO_STORE },
    );
  }

  const kind = kindOf(file.type);
  if (!kind) {
    return NextResponse.json(
      { error: "formats acceptés : photos et vidéos" },
      { status: 415, headers: NO_STORE },
    );
  }

  const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (file.size === 0) {
    return NextResponse.json(
      { error: "fichier vide" },
      { status: 400, headers: NO_STORE },
    );
  }
  if (file.size > max) {
    return NextResponse.json(
      {
        error: `${kind === "image" ? "Photo" : "Vidéo"} trop lourde (${Math.round(file.size / 1024 / 1024)} Mo) — ${max / 1024 / 1024} Mo maximum.`,
      },
      { status: 413, headers: NO_STORE },
    );
  }

  let bytes: Buffer<ArrayBufferLike> = Buffer.from(await file.arrayBuffer());
  let mime = file.type.toLowerCase();

  // Le type déclaré ne suffit jamais : on lit les octets. Un fichier dont
  // la signature ne correspond pas à la famille annoncée est refusé avant
  // tout stockage, y compris quand le client est un script.
  const sniffed = sniffMedia(bytes);
  if (!sniffed || sniffed.kind !== kind || !matchesDeclaredType(sniffed, mime)) {
    return NextResponse.json(
      { error: "le contenu du fichier ne correspond pas à son type" },
      { status: 415, headers: NO_STORE },
    );
  }
  if (kind === "image" && !(await decodableImage(bytes))) {
    return NextResponse.json(
      { error: "image illisible ou corrompue" },
      { status: 415, headers: NO_STORE },
    );
  }
  mime = sniffed.mime;

  if (kind === "image") {
    const compressed = await compressImage(bytes, mime);
    bytes = compressed.bytes;
    mime = compressed.mime;

    // Le réencodage change le type (WebP) : on revérifie la signature pour
    // que la colonne `mime` décrive toujours les octets réellement stockés.
    const finalSniff = sniffMedia(bytes);
    if (!finalSniff || finalSniff.kind !== "image") {
      return NextResponse.json(
        { error: "réencodage de l'image impossible" },
        { status: 422, headers: NO_STORE },
      );
    }
    mime = finalSniff.mime;
  }

  // Le stockage objet est facultatif : une panne ou une absence de clés ne
  // doit pas empêcher de publier. On retombe alors sur les octets en base.
  let remoteUrl = "";
  try {
    remoteUrl = (await putMediaObject(requested, new Uint8Array(bytes), mime)) ?? "";
    if (!remoteUrl) {
      recordMetric("media.storage.fallback_total", 1, { reason: "unconfigured" });
    }
  } catch (error) {
    recordMetric("media.storage.fallback_total", 1, { reason: "provider_error" });
    console.error("[media] stockage objet indisponible, repli PostgreSQL", error);
  }

  const storedBytes = remoteUrl ? Buffer.alloc(0) : bytes;

  try {
    const inserted = await withUser(ownerId, (query) =>
      query<{ path: string }>(
        `insert into public.media_files (path, owner_id, mime, kind, bytes, byte_size, url)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (path) do nothing
         returning path`,
        [requested, ownerId, mime, kind, storedBytes, bytes.length, remoteUrl],
      ),
    );
    if (inserted.length === 0) {
      return NextResponse.json(
        { error: "ce nom de fichier est déjà pris" },
        { status: 409, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      {
        path: requested,
        url: remoteUrl || `/api/media/${encodeURIComponent(requested)}`,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json(
        { error: "ce nom de fichier est déjà pris" },
        { status: 409, headers: NO_STORE },
      );
    }
    console.error("[media] écriture impossible", code ?? error);
    return NextResponse.json(
      { error: "envoi indisponible" },
      { status: 503, headers: NO_STORE },
    );
  }
}
