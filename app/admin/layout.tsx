import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminGate } from "@/components/AdminGate";
import { serverCannotCheckAdmin } from "@/lib/admin-access";
import { getOrCreateServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /**
   * Quand aucune session serveur ne peut exister — pas de backend, ou
   * démonstration forcée dont la session vit dans `localStorage` — le
   * refus serveur rendrait `/admin` inaccessible même à un compte
   * administrateur. On laisse alors `AdminGate` trancher sur le profil
   * client, et on ne rend jamais la console pour un compte sans rôle.
   */
  if (serverCannotCheckAdmin()) {
    return <AdminGate>{children}</AdminGate>;
  }

  const client = await getOrCreateServerClient();
  if (!client) notFound();

  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) {
    console.error("Admin access check failed: session lookup", {
      code: authError.code ?? "unknown",
    });
    notFound();
  }
  if (!auth.user) notFound();

  const { data: profile, error: profileError } = await client
    .from("users")
    .select("is_admin")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Admin access check failed: role lookup", {
      code: profileError.code ?? "unknown",
    });
    notFound();
  }
  if (profile?.is_admin !== true) notFound();

  // Seconde barrière, y compris sur backend réel : le client confirme le
  // rôle au lieu de faire confiance au seul rendu serveur.
  return <AdminGate>{children}</AdminGate>;
}
