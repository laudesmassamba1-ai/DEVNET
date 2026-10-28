/**
 * Client Supabase serveur — lit la session depuis les cookies HTTP.
 *
 * ## Pourquoi un client à part, et pourquoi `@supabase/ssr` ?
 *
 * `@supabase/supabase-js` (le client navigateur) stocke la session dans
 * `localStorage` : une chose qui n'existe pas côté serveur. Chaque
 * composant serveur (pages RSC, route handlers) a donc vu `auth.uid()`
 * = `null`, et toute tentative d'écriture — créer un projet, poster un
 * message, auteur un post — échouait avec
 * `new row violates row-level security policy`, sans que l'erreur
 * apparente ait un rapport avec la session.
 *
 * `@supabase/ssr` résout cela : il lit et écrit la session dans les
 * cookies HTTP, et le cookie est transmis automatiquement par Next.js
 * entre le serveur et le navigateur. Le client serveur ci-dessous est
 * donc la seule façon pour une route handler de savoir **qui** appelle.
 *
 * ## Le cookie `sb-<ref>-auth-token`
 *
 * C'est le cookie que `@supabase/ssr` pose et que le client navigateur
 * lit. Il contient le JWT d'accès chiffré. Sans lui, `auth.uid()` est
 * `null`, et les politiques RLS (qui toutes appellent `auth.uid()`)
 * bloquent tout.
 *
 * ## Import côté client interdit
 *
 * Ce fichier importe `next/headers`, qui n'est utilisable que par des
 * Server Components. Il est donc **interdit** d'importer ce fichier depuis
 * un composant client : le proxy `supabase` (dans `lib/supabase/client.ts`)
 * utilise le registre `lib/supabase/server-registry.ts` à la place, qui
 * n'a aucune dépendance serveur.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseUrl } from "@/lib/backend";
import { setServerClient, getServerClient } from "@/lib/supabase/server-registry";

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Résout le client serveur une fois par requête, et le met en cache dans
 * le registre.
 *
 * `cookies()` ne peut être appelé qu'une seule fois par requête : le
 * deuxième appel lève. On résout donc le client une seule fois, et on le
 * met en cache pour les appels suivants de `supabase.from(...)`.
 */
export async function getOrCreateServerClient() {
  const url = getSupabaseUrl();
  if (!url || !anonKey) return null;

  // Le client est liée à l'URL : si l'URL change (sonde), on recrée.
  const cached = getServerClient();
  if (cached) return cached;

  // `cookies()` est asynchrone sous Next.js 16 : il faut l'attendre
  // avant d'accéder à ses méthodes.
  const cookieStore = await cookies();

  const client = createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options) {
        try {
          cookieStore.set(name, value, options);
        } catch {
          // Dans un rendu serveur non interactif, `cookieStore.set` peut
          // lancer si la réponse est déjà envoyée. On ignore : la
          // session sera rafraîchie au prochain appel.
        }
      },
      remove(name: string, options) {
        try {
          cookieStore.set(name, "", { ...options, maxAge: 0 });
        } catch {
          // Même cas que ci-dessus.
        }
      },
    },
  });

  setServerClient(client);
  return client;
}