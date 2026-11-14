/**
 * Publier un statut média.
 *
 * Deux chemins, selon la taille :
 *
 * - petite image ou GIF : une data URL entre, et sort **re-encodée** (WebP
 *   borné à 1080 px) dans `story_media` ;
 * - vidéo ou fichier lourd : le client a d'abord déposé les octets sur le
 *   stockage objet, puis envoie seulement `mediaUrl`. Une vidéo en base64
 *   dans un corps JSON dépassait la limite de 4,5 Mo de Vercel — d'où un
 *   413 systématique au-delà de trois mégaoctets de fichier.
 */
import { NextRequest, NextResponse } from "next/server";
import { STORY_MAX } from "@/lib/stories";
import { currentUserId } from "@/lib/api/server";
import { isInternalMediaPath, normalizeStoryMediaUrl } from "@/lib/story-media-url";
import { withUser } from "@/platform/infrastructure/postgres/with-user";
import {
  encodeStoryMedia,
  getServerStoriesRepository,
  mediaKind,
} from "@/platform/server-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const DATA_URL = /^data:((?:image|video)\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;

/**
 * Résout l'adresse d'un média déjà téléversé.
 *
 * Une URL externe arbitraire n'est plus acceptée : elle doit appartenir au
 * stockage configuré, à un fournisseur GIF connu, ou être un chemin interne
 * dont l'appelant est bien propriétaire. Sans ce dernier contrôle, n'importe
 * quel compte pouvait afficher sous son nom le fichier d'un autre.
 */
async function resolveMediaUrl(
  raw: string,
  authorId: string,
  origin: string,
): Promise<{ url: string } | { error: string }> {
  const normalized = normalizeStoryMediaUrl(raw, { origin });
  if (!normalized) return { error: "adresse de média non autorisée" };

  if (!isInternalMediaPath(normalized)) return { url: normalized };

  const path = normalized.slice("/api/media/".length);
  try {
    const rows = await withUser(authorId, (query) =>
      query<{ path: string }>(
        "select path from public.media_files where path = $1 and owner_id = $2 limit 1",
        [path, authorId],
      ),
    );
    if (rows.length === 0) return { error: "média introuvable" };
    return { url: new URL(normalized, origin).href };
  } catch (error) {
    console.error(
      "[stories] vérification du média impossible",
      error instanceof Error ? error.message : String(error),
    );
    return { error: "média indisponible" };
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authorId = await currentUserId();
  if (!authorId) {
    return NextResponse.json({ error: "session requise" }, { status: 401, headers: NO_STORE });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "corps illisible" }, { status: 400, headers: NO_STORE });
  }

  const body = raw as { caption?: unknown; dataUrl?: unknown; mediaUrl?: unknown } | null;
  const dataUrl = typeof body?.dataUrl === "string" ? body.dataUrl : "";
  const mediaUrl = typeof body?.mediaUrl === "string" ? body.mediaUrl.trim() : "";
  const caption = typeof body?.caption === "string" ? body.caption.trim() : "";
  if (caption.length > STORY_MAX) {
    return NextResponse.json({ error: `${STORY_MAX} caractères maximum` }, { status: 400 });
  }

  // Voie URL : les octets sont déjà sur le stockage objet, rien à
  // re-encoder ici. On refuse tout ce qui n'est pas https pour ne pas
  // transformer la story en relais vers une ressource locale ou `data:`.
  if (mediaUrl) {
    const resolved = await resolveMediaUrl(mediaUrl, authorId, request.nextUrl.origin);
    if ("error" in resolved) {
      return NextResponse.json(
        { error: resolved.error },
        { status: 400, headers: NO_STORE },
      );
    }
    try {
      const created = await getServerStoriesRepository().createStory(authorId, {
        caption,
        mediaUrl: resolved.url,
      });
      return NextResponse.json({ ok: true, id: created.id }, { headers: NO_STORE });
    } catch (error) {
      console.error(
        "[stories] média refusé",
        error instanceof Error ? error.message : String(error),
      );
      return NextResponse.json(
        { error: "statut média indisponible" },
        { status: 503, headers: NO_STORE },
      );
    }
  }

  const match = DATA_URL.exec(dataUrl);
  if (!match) {
    return NextResponse.json(
      { error: "image, GIF ou vidéo attendue" },
      { status: 400, headers: NO_STORE },
    );
  }

  const mime = match[1].toLowerCase();
  if (!mediaKind(mime)) {
    return NextResponse.json({ error: "format non accepté" }, { status: 400, headers: NO_STORE });
  }

  const bytes = Buffer.from(match[2], "base64");
  const encoded = await encodeStoryMedia({ mime, bytes });
  if (!encoded.ok) {
    return NextResponse.json({ error: encoded.error }, { status: 422, headers: NO_STORE });
  }

  try {
    const created = await getServerStoriesRepository().createStory(authorId, {
      caption,
      media: encoded.media,
    });
    return NextResponse.json({ ok: true, id: created.id }, { headers: NO_STORE });
  } catch (error) {
    console.error("[stories] média refusé", error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { error: "statut média indisponible" },
      { status: 503, headers: NO_STORE },
    );
  }
}
