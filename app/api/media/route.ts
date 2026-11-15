/**
 * Envoi d'une photo ou d'une vidéo.
 *
 * Le fichier arrive en `multipart/form-data`. Les photos sont d'abord
 * normalisées (orientation, 1920 px maximum, WebP qualité 82) par
 * `lib/media/image` (`@napi-rs/image`, MIT), puis déposées sur le stockage
 * objet S3-compatible quand il est configuré.
 * Sans stockage objet, les octets restent dans `public.media_files` : le
 * repli est explicite et ne casse jamais l'envoi.
 *
 * La réponse rend le chemin et l'URL publique. `/api/media/<chemin>` redirige
 * vers l'URL distante, ou sert les octets de la base pour les anciens médias.
 */
import { NextResponse } from "next/server";
import { imageMetadata, toWebp } from "@/lib/media/image";
import { currentUserId } from "@/lib/api/server";
import { putMediaObject } from "@/lib/media-storage";
import { recordMetric } from "@/lib/metrics";
import { matchesDeclaredType, sniffMedia } from "@/lib/media-signature";
import { inspectImage } from "@/lib/moderation/image";
import { recordModerationFlag } from "@/lib/moderation/service";
import { recordSecurityEvent } from "@/lib/security/events";
import { rateLimit } from "@/lib/security/rate-limit";
import { analyzeMedia } from "@/lib/trust-safety/engine";
import { transcodeVideo } from "@/lib/video-transcode-server";
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

/** Libère une réservation qui n'a jamais reçu d'octets. */
async function releaseReservation(ownerId: string, path: string): Promise<void> {
  await withUser(ownerId, (query) =>
    query(
      `delete from public.media_files
        where path = $1 and owner_id = $2 and byte_size = 0 and octet_length(bytes) = 0`,
      [path, ownerId],
    ),
  ).catch(() => undefined);
}
const COMPRESSIBLE = /^image\/(png|jpeg|webp|avif)$/;

function kindOf(mime: string): "image" | "video" | null {
  if (/^image\/(png|jpeg|webp|gif|avif)$/.test(mime)) return "image";
  if (/^video\/(mp4|webm|quicktime)$/.test(mime)) return "video";
  return null;
}

/**
 * Une image n'est acceptée que si le décodeur sait réellement la lire.
 *
 * La signature binaire prouve que les octets *commencent* comme un PNG ;
 * elle ne prouve pas que le fichier est complet. Un décodeur qui échoue est
 * donc un refus, pas une raison de conserver le fichier d'origine : c'est
 * cette tolérance qui laissait passer un contenu tronqué.
 */
async function decodableImage(bytes: Buffer<ArrayBufferLike>): Promise<boolean> {
  try {
    const metadata = await imageMetadata(Buffer.from(bytes), {
      limitInputPixels: 50_000_000,
    });
    return metadata.width > 0 && metadata.height > 0;
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
    const output = await toWebp(Buffer.from(bytes), {
      maxWidth: 1920,
      maxHeight: 1920,
      quality: 82,
    });
    // Une ré-écriture plus lourde que l'original ne sert à rien : on garde le
    // fichier tel quel, comme le faisait `sharp` avant nous.
    if (output.data.length >= bytes.length) return { bytes, mime };
    return { bytes: output.data, mime: "image/webp" };
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

  /* Un envoi coûte du stockage et de la bande passante : 40 par minute et
     par compte, ce qui laisse largement de quoi publier sans saturer un
     compartiment. */
  const uploadLimit = rateLimit(`media:upload:${ownerId}`, {
    limit: 40,
    windowMs: 60_000,
    blockMs: 60_000,
  });
  if (!uploadLimit.allowed) {
    await recordSecurityEvent({
      kind: "media.rate_limited",
      severity: "warning",
      actorId: ownerId,
      details: { retryAfter: uploadLimit.retryAfterSeconds },
    });
    return NextResponse.json(
      { error: "trop d'envois en peu de temps" },
      {
        status: 429,
        headers: { ...NO_STORE, "Retry-After": String(uploadLimit.retryAfterSeconds) },
      },
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
  const originMime = sniffed.mime;

  /* Une vidéo est réencodée en H.264/AAC quand le serveur en est capable :
     c'est le format que tous les appareils lisent. Sans `ffmpeg` (Vercel),
     le client a déjà fait le travail (`lib/video-compat.ts`) ; on garde
     alors le fichier tel quel, sans faire semblant. */
  let posterUrl = "";
  let phash: string | null = null;
  let skinRatio: number | null = null;
  let review: { severity: "warning" | "critical"; reason: string } | null = null;
  let transcoded = false;

  if (kind === "video") {
    const result = await transcodeVideo(bytes, mime);
    if (result) {
      bytes = result.bytes;
      mime = result.mime;
      transcoded = result.transcoded;
      if (result.poster) {
        // La vignette évite de charger la vidéo entière pour afficher une
        // carte dans le fil. Sans stockage objet, elle reste une data URL
        // légère (une seule image WebP de 640 px).
        try {
          const remote = await putMediaObject(
            `${requested.slice(0, 100)}-poster.webp`,
            new Uint8Array(result.poster),
            "image/webp",
          );
          posterUrl = remote
            ?? `data:image/webp;base64,${result.poster.toString("base64")}`;
        } catch {
          posterUrl = `data:image/webp;base64,${result.poster.toString("base64")}`;
        }
        const visual = await inspectImage(result.poster);
        phash = visual.phash;
        skinRatio = visual.skinRatio;
        review = visual.review;
        if (visual.blocked) {
          await recordModerationFlag({
            targetType: "media",
            targetId: requested,
            source: "image",
            severity: "critical",
            reason: "empreinte d'une vidéo déjà bloquée",
          });
          return NextResponse.json(
            { error: "ce média a été bloqué par la modération" },
            { status: 422, headers: NO_STORE },
          );
        }
      }
    }
  }

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

  /* Modération d'image : une empreinte déjà bannie est refusée avant tout
     stockage. Une heuristique ne bloque jamais — elle met en file de
     relecture, parce qu'un faux positif sur une photo de profil est une
     sanction injuste. */
  if (kind === "image") {
    const visual = await inspectImage(bytes);
    phash = visual.phash;
    skinRatio = visual.skinRatio;
    review = visual.review;
    if (visual.blocked) {
      await recordSecurityEvent({
        kind: "media.blocked",
        severity: "warning",
        subject: "envoi d'un média déjà bloqué",
        details: { kind },
      });
      await recordModerationFlag({
        targetType: "media",
        targetId: requested,
        source: "image",
        severity: "critical",
        reason: "empreinte d'une image déjà bloquée",
      });
      return NextResponse.json(
        { error: "ce média a été bloqué par la modération" },
        { status: 422, headers: NO_STORE },
      );
    }
  }

  /* La clé est réservée en base AVANT l'écriture distante. Écrire d'abord
     puis insérer permettait d'écraser le fichier d'un autre compte, celui
     dont le chemin était déjà pris, avant que la contrainte d'unicité ne
     refuse l'insertion : le premier fichier était perdu. La réservation
     rend le chemin exclusif ; l'écriture ne part que si elle est acquise. */
  const reserved = await withUser(ownerId, (query) =>
    query<{ path: string }>(
      `insert into public.media_files (path, owner_id, mime, kind, bytes, byte_size, url)
       values ($1, $2, $3, $4, ''::bytea, 0, '')
       on conflict (path) do nothing
       returning path`,
      [requested, ownerId, mime, kind],
    ),
  );
  if (reserved.length === 0) {
    return NextResponse.json(
      { error: "ce nom de fichier est déjà pris" },
      { status: 409, headers: NO_STORE },
    );
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
  let updated: { path: string }[];
  try {
    updated = await withUser(ownerId, (query) =>
      query<{ path: string }>(
        `update public.media_files
            set mime = $3, bytes = $5, byte_size = $6, url = $7,
                phash = $8, poster_url = $9, origin_mime = $10, transcoded = $11
          where path = $1 and owner_id = $2
          returning path`,
        [
          requested,
          ownerId,
          mime,
          kind,
          storedBytes,
          bytes.length,
          remoteUrl,
          phash,
          posterUrl,
          originMime,
          transcoded,
        ],
      ),
    );
  } catch (error) {
    if ((error as { code?: string }).code !== "42703") {
      await releaseReservation(ownerId, requested);
      throw error;
    }
    // Base servie sans les colonnes de la migration 073 : le média passe
    // quand même, sans empreinte de modération.
    updated = await withUser(ownerId, (query) =>
      query<{ path: string }>(
        `update public.media_files
            set mime = $3, bytes = $4, byte_size = $5, url = $6
          where path = $1 and owner_id = $2
          returning path`,
        [requested, ownerId, mime, storedBytes, bytes.length, remoteUrl],
      ),
    );
  }
  if (updated.length === 0) {
    await releaseReservation(ownerId, requested);
    return NextResponse.json(
      { error: "ce nom de fichier est déjà pris" },
      { status: 409, headers: NO_STORE },
    );
  }
    if (review) {
      await recordModerationFlag({
        targetType: "media",
        targetId: requested,
        source: "heuristic",
        severity: review.severity,
        reason: review.reason,
        details: { kind, phash },
      });
    }
    // Le dossier média naît après le stockage : le fichier existe déjà,
    // mais aucune suppressions automatique n'a lieu. Un humain décide.
    await analyzeMedia({
      targetId: requested,
      authorId: ownerId,
      kind,
      phash,
      skinRatio,
      review,
      blocked: false,
      transcoded,
      originMime,
    }).catch(() => undefined);
    return NextResponse.json(
      {
        path: requested,
        url: remoteUrl || `/api/media/${encodeURIComponent(requested)}`,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // Une erreur après réservation ne doit pas laisser le chemin bloqué.
    await releaseReservation(ownerId, requested);
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
