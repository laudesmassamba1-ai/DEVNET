/**
 * Qui a vu une story — l'auteur seulement.
 *
 * La confidentialité ne tient pas au bouton qui ouvre cette liste : elle
 * tient à la politique de lecture de `story_views`, qui ne rend les lignes
 * qu'à l'auteur de la story. Un appel direct à cette route par quelqu'un
 * d'autre rend donc une liste vide, jamais celle d'autrui.
 */
import { NextResponse } from "next/server";
import { StoriesRepositoryError } from "@/modules/stories";
import { currentUserId } from "@/lib/api/server";
import { getServerStoriesRepository } from "@/platform/server-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const readerId = await currentUserId();
  if (!readerId) {
    return NextResponse.json({ error: "session requise" }, { status: 401, headers: NO_STORE });
  }

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "story inconnue" }, { status: 400, headers: NO_STORE });
  }

  try {
    const viewers = await getServerStoriesRepository().listViewers(readerId, id);
    return NextResponse.json({ viewers }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof StoriesRepositoryError) {
      console.error("[stories] vues illisibles", error.code);
    }
    return NextResponse.json(
      { error: "vues indisponibles" },
      { status: 503, headers: NO_STORE },
    );
  }
}
