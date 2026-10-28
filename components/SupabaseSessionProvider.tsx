/**
 * Résout le client serveur Supabase une fois, au chargement de l'application.
 *
 * ## Pourquoi un Server Component à part ?
 *
 * Le proxy `supabase` (dans `lib/supabase/client.ts`) est **synchrone** :
 * chaque `supabase.from(...)` l'appelle directement. Mais le client serveur
 * (`createServerClient`) nécessite `cookies()`, qui est **asynchrone** sous
 * Next.js 16. On ne peut pas le créer dans le proxy sans bloquer.
 *
 * Ce composant est un **Server Component** : il importe `next/headers` via
 * `lib/supabase/server.ts`, résout le client une seule fois, et le met en
 * cache dans le registre `lib/supabase/server-registry.ts`. Les appels
 * suivants de `supabase.from(...)` lisent ce cache de façon synchrone, et
 * le proxy n'a aucune dépendance serveur.
 *
 * ## Le cookie `sb-<ref>-auth-token`
 *
 * Une fois le client résolu, `auth.uid()` n'est plus `null` côté serveur :
 * les politiques RLS (qui toutes appellent `auth.uid()`) fonctionnent, et
 * la création de projet, de message, etc. n'échoue plus avec
 * `new row violates row-level security policy`.
 */
import { getOrCreateServerClient } from "@/lib/supabase/server";

export default async function SupabaseSessionProvider() {
  await getOrCreateServerClient();
  return null;
}