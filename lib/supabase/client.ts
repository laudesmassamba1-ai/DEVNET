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
import {
  getBackend,
  getSupabaseUrl,
  isDemoAllowed,
  isDemoMode,
} from "@/lib/backend";
import { beginPending, endPending } from "@/lib/pending";
import { AUTH_COOKIE_NAME } from "./auth-cookie";

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
    // Nom fixe : sans lui, le nom du cookie dépend de l'hôte et le serveur
    // ne retrouve plus la session (voir `auth-cookie.ts`).
    cookieOptions: { name: AUTH_COOKIE_NAME },
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
   * Client utilisé par toute l'application dans le navigateur.
   *
   * C'est un proxy qui route chaque appel vers Supabase ou vers le backend
   * local de démonstration, selon l'état de la sonde. Les pages n'ont donc
   * aucune idée du mode dans lequel elles tournent : une démo hors-ligne et
   * la production partagent exactement le même code.
   *
   * Côté serveur, les route handlers créent leur client avec
   * `getOrCreateServerClient()` (voir `app/api/admin/accounts/route.ts`) :
   * un client par requête, jamais partagé.
   */
  export const supabase = new Proxy(
    {} as ReturnType<typeof createBrowserClient>,
    {
      get(_target, prop) {
        const live = getLiveClient();
        const active = (
          isDemoMode() || !live ? demoClient : live
        ) as unknown as Record<string, unknown>;
        const value = active[prop as string];
        return typeof value === "function" ? value.bind(active) : value;
      },
    },
  ) as ReturnType<typeof createBrowserClient>;

  /** Vrai si les données affichées proviennent du backend local de démonstration. */
  export function usingDemoData(): boolean {
    return isDemoMode() || (isDemoAllowed() && getBackend().url === null);
  }