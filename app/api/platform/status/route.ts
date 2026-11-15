import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import { withUser } from "@/platform/infrastructure/postgres/with-user";
import { readPlatformSettings } from "@/lib/platform-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * État d'exploitation, lu par l'application à l'ouverture.
 *
 * Répond à deux questions que le client ne peut pas trancher seul :
 * l'application est-elle fermée, et le compte courant peut-il passer
 * outre ? Le rôle est lu en base sous l'identité de la session, jamais
 * dans un en-tête.
 *
 * Pas de session : la réponse est celle d'un visiteur — s'il y a
 * maintenance, il est concerné. C'est le cas qui compte, parce que la
 * page de connexion doit aussi se fermer.
 */
export async function GET(): Promise<NextResponse> {
  const headers = { "Cache-Control": "no-store" } as const;

  let userId: string | null = null;
  try {
    userId = await currentUserId();
  } catch {
    userId = null;
  }

  try {
    const { settings, isAdmin } = await withUser(
      userId ?? "00000000-0000-0000-0000-000000000000",
      async (query) => {
        const settings = await readPlatformSettings(query);
        let isAdmin = false;
        if (userId) {
          const rows = await query<{ is_admin: boolean }>(
            "select is_admin from public.users where id = $1 limit 1",
            [userId],
          );
          isAdmin = rows[0]?.is_admin === true;
        }
        return { settings, isAdmin };
      },
    );

    return NextResponse.json(
      {
        maintenance: settings.maintenance,
        message: settings.maintenance_message,
        signupsEnabled: settings.signups_enabled,
        // Un administrateur n'est jamais bloqué : il doit pouvoir rouvrir.
        blocked: settings.maintenance && !isAdmin,
      },
      { headers },
    );
  } catch {
    // Base muette : on ne ferme pas l'application sur une supposition.
    return NextResponse.json(
      { maintenance: false, message: "", signupsEnabled: true, blocked: false },
      { headers },
    );
  }
}
