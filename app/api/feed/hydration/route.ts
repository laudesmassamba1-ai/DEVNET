/**
 * Hydratation du fil — likes, reposts, réactions et signets du lecteur.
 *
 * Le navigateur envoyait quatre requêtes Supabase par page de fil, une par
 * table, chacune filtrée sur l'identifiant qu'il croyait être le sien. Ici,
 * une requête, une identité : celle de la session, lue côté serveur.
 *
 * Sans session, la réponse est l'état neutre — pas une erreur : personne ne
 * peut avoir aimé quoi que ce soit sans être quelqu'un.
 */
import { NextRequest, NextResponse } from "next/server";
import { FeedHydrationError, emptyHydration, readHydrationQuery } from "@/modules/feed";
import { currentUserId } from "@/lib/supabase/server";
import { getServerFeedHydrationRepository } from "@/platform/server-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest): Promise<NextResponse> {
  const postIds = readHydrationQuery(request.nextUrl.searchParams);
  if (postIds.length === 0) {
    return NextResponse.json(emptyHydration(), { headers: NO_STORE });
  }

  try {
    const readerId = await currentUserId();
    const hydration = await getServerFeedHydrationRepository().fetchHydration(readerId, postIds);
    return NextResponse.json(hydration, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof FeedHydrationError) {
      console.error("[feed/hydration] lecture impossible", error.code);
      return NextResponse.json(
        { error: "état des publications indisponible" },
        { status: 503, headers: NO_STORE },
      );
    }
    console.error(
      "[feed/hydration] erreur inattendue",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { error: "état des publications indisponible" },
      { status: 500, headers: NO_STORE },
    );
  }
}
