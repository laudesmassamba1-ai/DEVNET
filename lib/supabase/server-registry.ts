/**
 * Registre du client serveur Supabase.
 *
 * ## Pourquoi un fichier séparé, sans import de `next/headers` ?
 *
 * `next/headers` ne peut être importé que par des **Server Components**
 * de l'App Router. Si un module l'importe et est à son tour importé par un
 * composant client, l'hydratation échoue avec :
 * `You're importing a module that depends on "next/headers". This API is
 * only available in Server Components in the App Router, but you are
 * using it in the Pages Router.`
 *
 * Le proxy `supabase` (dans `lib/supabase/client.ts`) est importé par des
 * composants client, donc **aucun** de ses imports ne peut toucher
 * `next/headers`. Ce registre est le tampon : il ne fait que stocker et
 * lire une instance, sans aucune dépendance serveur.
 *
 * Le client est résolu une fois par `SupabaseSessionProvider` (monté dans
 * le layout racine), qui importe `next/headers` via `lib/supabase/server.ts`
 * — un module qui n'est jamais importé côté client.
 */
let serverClient: unknown = null;

export function setServerClient(client: unknown): void {
  serverClient = client;
}

/** Renvoie le client serveur déjà résolu, ou null. */
export function getServerClient(): unknown {
  return serverClient;
}