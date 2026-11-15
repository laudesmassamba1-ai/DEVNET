/**
 * Fil servi depuis PostgreSQL direct.
 *
 * Le navigateur appelle cette route ; c'est le processus Next.js qui ouvre la
 * connexion — `pg` ne part jamais dans le bundle client. L'identité est encore
 * lue dans la session Supabase (pont temporaire, à retirer quand
 * l'authentification passera sur PostgreSQL).
 *
 * Sans session, la RLS ne rend aucune ligne : la réponse est une page vide,
 * pas une erreur. Une panne de base est, elle, signalée par 503 avec un
 * message générique — le détail reste dans les journaux serveur.
 */
import { NextRequest, NextResponse } from "next/server";
import { FeedRepositoryError, readFeedQuery } from "@/modules/feed";
import { currentUserId } from "@/lib/api/server";
import { getServerFeedRepository } from "@/platform/server-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = readFeedQuery(request.nextUrl.searchParams);

  try {
    const page = await getServerFeedRepository().fetchPage({
      ...query,
      readerId: await currentUserId(),
    });
    return NextResponse.json(page, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof FeedRepositoryError) {
      console.error("[feed] lecture impossible", error.code);
      return NextResponse.json({ error: "fil indisponible" }, { status: 503, headers: NO_STORE });
    }
    console.error(
      "[feed] erreur inattendue",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ error: "fil indisponible" }, { status: 500, headers: NO_STORE });
  }
}
