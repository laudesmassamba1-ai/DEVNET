/**
 * Client Supabase serveur — lit la session depuis les cookies HTTP.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseUrl } from "@/lib/backend";
import { AUTH_COOKIE_NAME } from "./auth-cookie";

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Crée un client serveur lié à la requête courante.
 * Un nouveau client est créé à chaque appel afin d'éviter tout partage
 * entre requêtes.
 */
export async function getOrCreateServerClient() {
  const url = getSupabaseUrl();
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();

  const client = createServerClient(url, anonKey, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options) {
        try {
          cookieStore.set(name, value, options);
        } catch {
          // Ignoré si la réponse est déjà envoyée.
        }
      },
      remove(name: string, options) {
        try {
          cookieStore.set(name, "", { ...options, maxAge: 0 });
        } catch {
          // Ignoré si la réponse est déjà envoyée.
        }
      },
    },
  });

  return client;
}