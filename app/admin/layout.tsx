import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentUserId } from "@/lib/api/server";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Même raison que dans `proxy.ts` : la démonstration n'a pas de session
  // serveur, et la console client vérifie elle-même le rôle du compte.
  if (process.env.NEXT_PUBLIC_FORCE_DEMO === "true") return children;

  let userId: string | null = null;
  try {
    userId = await currentUserId();
  } catch (error) {
    console.error("Admin access check failed: session lookup", error);
    notFound();
  }
  if (!userId) notFound();

  try {
    const rows = await withUser(userId, (query) =>
      query<{ is_admin: boolean }>(
        "select is_admin from public.users where id = $1 limit 1",
        [userId],
      ),
    );
    if (rows[0]?.is_admin !== true) notFound();
  } catch (error) {
    console.error("Admin access check failed: role lookup", error);
    notFound();
  }

  return children;
}
