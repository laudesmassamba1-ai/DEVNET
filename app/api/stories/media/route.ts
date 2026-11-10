/**
 * Publier un statut média.
 *
 * Le fichier arrive en data URL, il en ressort **re-encodé** : WebP borné à
 * 1080 px pour une image ou un GIF, MP4/H.264 de 15 s au plus pour une vidéo.
 * Le corps d'origine n'est jamais stocké ni servi.
 */
import { NextRequest, NextResponse } from "next/server";
import { STORY_MAX } from "@/lib/stories";
import { currentUserId } from "@/lib/supabase/server";
import {
  encodeStoryMedia,
  getServerStoriesRepository,
  mediaKind,
} from "@/platform/server-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const DATA_URL = /^data:((?:image|video)\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;

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

  const body = raw as { caption?: unknown; dataUrl?: unknown } | null;
  const dataUrl = typeof body?.dataUrl === "string" ? body.dataUrl : "";
  const caption = typeof body?.caption === "string" ? body.caption.trim() : "";
  if (caption.length > STORY_MAX) {
    return NextResponse.json({ error: `${STORY_MAX} caractères maximum` }, { status: 400 });
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
