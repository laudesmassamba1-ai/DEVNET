/**
 * Octets du média d'un statut.
 *
 * Même règle que la story : vivante pour tout le monde, ou visible par son
 * auteur. Le cache est **interdit** : `max-age=86400` laissait le navigateur
 * resservir un média après l'expiration de la story, donc après que le
 * serveur ait cessé de l'autoriser. Une réponse autorisée une fois ne doit
 * pas devenir une copie permanente.
 */
import { NextResponse } from "next/server";
import { StoriesRepositoryError } from "@/modules/stories";
import { currentUserId } from "@/lib/api/server";
import { getServerStoriesRepository } from "@/platform/server-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  try {
    const media = await getServerStoriesRepository().fetchStoryMedia(await currentUserId(), id);
    if (!media) {
      return NextResponse.json({ error: "média introuvable" }, { status: 404 });
    }
    const mime = /^(image|video)\/[a-z0-9.+-]+$/i.test(media.mime)
      ? media.mime
      : "application/octet-stream";
    return new Response(new Uint8Array(media.bytes), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(media.bytes.length),
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    if (error instanceof StoriesRepositoryError) {
      console.error("[stories] média illisible", error.code);
    }
    return NextResponse.json({ error: "média indisponible" }, { status: 503 });
  }
}
