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
import {
  encodeStoryMedia,
  getServerStoriesRepository,
  mediaKind,
} from "@/platform/server-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const DATA_URL = /^data:((?:image|video)\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;
/** URL publique du stockage objet : https uniquement, jamais de data URL. */
const MEDIA_URL = /^https:\/\/[^\s"'<>]{1,600}$/;

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
    if (!MEDIA_URL.test(mediaUrl)) {
      return NextResponse.json(
        { error: "adresse de média invalide" },
        { status: 400, headers: NO_STORE },
      );
    }
    try {
      const created = await getServerStoriesRepository().createStory(authorId, {
        caption,
        mediaUrl,
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
