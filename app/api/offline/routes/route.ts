/**
 * Routes dynamiques récentes, pour le préchauffage hors-ligne.
 *
 * On ne peut pas précacher « toutes les pages » : leur nombre dépend du
 * contenu et de qui a le droit de le voir. On borne donc le travail aux
 * quelques pages les plus récentes que la session peut réellement ouvrir.
 * Le service worker garde leur HTML, et le routeur leur payload RSC.
 *
 * Cette route ne rend que des chemins, jamais de contenu : la RLS décide
 * quelles lignes existent, et les pages elles-mêmes referont leurs lectures.
 */
import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const LIMIT = 4;

type Row = { path?: string; id?: string; pseudo?: string };

export async function GET(): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json({ paths: [] }, { status: 401, headers: NO_STORE });
  }

  try {
    const paths = await withUser(userId, async (query) => {
      const [posts, profiles, groups, projects] = await Promise.all([
        query<Row>(
          `select '/post/' || id::text as path
             from public.posts
            order by created_at desc
            limit $1`,
          [LIMIT],
        ),
        query<Row>(
          `select '/u/' || pseudo as path
             from public.users
            where id <> $1 and pseudo is not null
            order by followers desc nulls last, created_at desc
            limit $2`,
          [userId, LIMIT],
        ),
        query<Row>(
          `select '/groups/' || id::text as path
             from public.groups
            order by created_at desc
            limit $1`,
          [LIMIT],
        ),
        query<Row>(
          `select '/projects/' || id::text as path
             from public.projects
            order by created_at desc
            limit $1`,
          [LIMIT],
        ),
      ]);

      return [...posts, ...profiles, ...groups, ...projects]
        .map((row) => row.path)
        .filter((path): path is string => typeof path === "string" && path.startsWith("/"))
        .slice(0, 16);
    });

    return NextResponse.json({ paths }, { headers: NO_STORE });
  } catch {
    // Le préchauffage est un confort : une lecture ratée ne doit pas
    // empêcher l'application de démarrer.
    return NextResponse.json({ paths: [] }, { headers: NO_STORE });
  }
}
