/**
 * Client Supabase — partagé entre le serveur et le navigateur.
 *
 * ## Le problème que cela résout
 *
 * `@supabase/supabase-js` (le client navigateur) stocke la session dans
 * `localStorage`. C'est une chose qui n'existe pas côté serveur : chaque
 * route handler, chaque composant RSC, voyait `auth.uid() = null`. Toute
 * tentative d'écriture — créer un projet, poster un message, auteur un
 * post — échouait alors avec
 * `new row violates row-level security policy`, sans que l'erreur
 * apparente ait un rapport avec la session.
 *
 * `@supabase/ssr` résout cela : il lit et écrit la session dans les
 * cookies HTTP, et Next.js transmet automatiquement ces cookies entre le
 * navigateur et le serveur. Le client navigateur (`createBrowserClient`)
 * et le client serveur (`getOrCreateServerClient`) **partagent le
 * même cookie** `sb-<ref>-auth-token`, donc `auth.uid()` est le même des
 * deux côtés.
 *
 * ## Le cookie `sb-<ref>-auth-token`
 *
 * C'est le cookie que `@supabase/ssr` pose et que le client navigateur
 * lit. Il contient le JWT d'accès chiffré. Sans lui, `auth.uid()` est
 * `null`, et les politiques RLS (qui toutes appellent `auth.uid()`)
 * bloquent tout.
 */
import { createBrowserClient } from "@supabase/ssr";
import { demoClient } from "@/lib/demo/client";
import { getBackend, getSupabaseUrl, isDemoMode } from "@/lib/backend";
import { getServerClient } from "@/lib/supabase/server-registry";
import { beginPending, endPending } from "@/lib/pending";

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let clientInstance: ReturnType<typeof createBrowserClient> | null = null;
let clientUrl: string | null = null;

/**
 * Adaptateur de `fetch` du client navigateur : chaque requête REST ou
 * auth compte un tour dans `lib/pending`, et la barre d'état lit ce
 * compteur. Le chargement suit donc **le vrai temps du réseau**, pas une
 * durée inventée.
 */
function trackedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  beginPending();
  return fetch(input, init).finally(endPending);
}

function getLiveClient() {
  const currentUrl = getSupabaseUrl();
  if (!currentUrl || !anonKey) return null;

  if (clientInstance && clientUrl === currentUrl) {
    return clientInstance;
  }

  clientUrl = currentUrl;
  // `createBrowserClient` lit/écrit la session dans `document.cookie`,
  // pas dans `localStorage` : c'est la seule façon pour que la session
  // soit visible du serveur via `getOrCreateServerClient`.
  clientInstance = createBrowserClient(currentUrl, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    // Le `fetch` n'est utilisé que par les requêtes du client : compter
    // ici voit tout ce que l'application demande au backend, sans
    // toucher le `fetch` global de la page.
    global: { fetch: trackedFetch },
  });
  return clientInstance;
}

/**
 * Client utilisé par toute l'application.
 *
 * C'est un proxy qui route chaque appel vers Supabase ou vers le backend
 * local de démonstration, selon l'état de la sonde. Les pages n'ont donc
 * aucune idée du mode dans lequel elles tournent : une démo hors-ligne et
 * la production partagent exactement le même code.
 *
 * ## Contexte serveur vs client
 *
 * Côté client, le proxy utilise le client navigateur (`createBrowserClient`,
 * session dans `document.cookie`). Côté serveur, il utilise le client
 * serveur résolu par `SupabaseSessionProvider` (`getServerClient()`),
 * qui lit la session dans les cookies HTTP. Les deux lisent le même cookie
 * `sb-<ref>-auth-token`, donc `auth.uid()` est le même des deux côtés.
 */
export const supabase = new Proxy(
  {} as ReturnType<typeof createBrowserClient>,
  {
    get(_target, prop) {
      // Côté client : on utilise le client navigateur.
      if (typeof window !== "undefined") {
        const live = getLiveClient();
        const active = (live && !isDemoMode() ? live : demoClient) as unknown as Record<
          string,
          unknown
        >;
        const value = active[prop as string];
        return typeof value === "function" ? value.bind(active) : value;
      }

      // Côté serveur : on utilise le client serveur déjà résolu par
      // `SupabaseSessionProvider` (monté dans le layout racine). S'il
      // n'est pas encore résolu (premier rendu), on tombe sur le client
      // de démonstration : l'écran affiche son état de chargement, et le
      // client sera résolu au prochain rendu.
      const server = getServerClient();
      if (server && !isDemoMode()) {
        const value = (server as Record<string, unknown>)[prop as string];
        return typeof value === "function" ? value.bind(server) : value;
      }

      const active = demoClient as unknown as Record<string, unknown>;
      const value = active[prop as string];
      return typeof value === "function" ? value.bind(active) : value;
    },
  },
) as ReturnType<typeof createBrowserClient>;

/** Vrai si les données affichées proviennent du backend local de démonstration. */
export function usingDemoData(): boolean {
  return isDemoMode() || getBackend().url === null;
}