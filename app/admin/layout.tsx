import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOrCreateServerClient } from "@/lib/supabase/server";

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

  return children;
}
