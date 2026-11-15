import { getStore, save, newId } from "./store";
import { demoFrom, demoChannel, demoRemoveChannel } from "./query";
import { loadSessionId, saveSessionId } from "./session";
import { DEMO_ME } from "./data";
import type { User } from "@/lib/types";

/**
 * Client de démonstration : mêmes points d'entrée que `supabase-js`
 * (`from`, `auth`, `channel`, `removeChannel`), mais tout est local.
 */

type DemoUser = User & { password?: string };

type Listener = (event: string, session: unknown) => void;
const authListeners = new Set<Listener>();

function notifyAuth(event: string, session: unknown): void {
  for (const l of authListeners) l(event, session);
}

/** Le compte de démo est pré-inscrit : la démo ne demande pas de s'enregistrer. */
function ensureDemoAccount(): void {
  const store = getStore();
  if (store.users.some((u) => u.id === DEMO_ME.id)) return;

  store.users.push({
    ...DEMO_ME,
    password: "demo",
    followers: 0,
    following: 0,
    created_at: new Date().toISOString(),
  } as unknown as Record<string, unknown>);
  save(store);
}

export const demoClient = {
  from: demoFrom,
  channel: demoChannel,
  removeChannel: demoRemoveChannel,

  auth: {
    /** Session simulée : on relit le profil depuis le store local. */
    async getSession() {
      ensureDemoAccount();
      const id = loadSessionId();
      if (!id) return { data: { session: null }, error: null };

      const user = getStore().users.find((u) => u.id === id);
      if (!user) {
        saveSessionId(null);
        return { data: { session: null }, error: null };
      }
      return { data: { session: { user } }, error: null };
    },

    /**
     * Connexion de démonstration.
     *
     * Deux règles, dans cet ordre :
     *
     *  1. **Une adresse inconnue est refusée.** Avant, tout email non
     *     trouvé ouvrait la session sur le compte de démo : on entrait
     *     avec l'adresse de quelqu'un d'autre et on atterrissait sur le
     *     profil de Koffi, sans un mot. Un compte créé par
     *     l'administration n'aurait alors jamais été rejoignable — et
     *     l'erreur ressemblait à une réussite.
     *  2. **Le mot de passe n'est comparé que s'il y en a un.** Les
     *     comptes de démonstration n'en portent pas (`password` absent) :
     *     ils s'ouvrent avec n'importe quoi, c'est le confort de la démo.
     *     Les comptes créés depuis `/admin`, eux, portent le mot de passe
     *     saisi à la création — et là, il compte vraiment.
     */
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      ensureDemoAccount();
      const store = getStore();

      const found = store.users.find(
        (u) => String(u.email).toLowerCase() === email.trim().toLowerCase(),
      );

      if (!found) {
        return {
          data: { user: null },
          error: { message: "Invalid login credentials" },
        };
      }

      const stored = (found as unknown as DemoUser).password;
      if (typeof stored === "string" && stored !== password) {
        return {
          data: { user: null },
          error: { message: "Invalid login credentials" },
        };
      }

      const user = found as unknown as DemoUser;
      saveSessionId(String(user.id));
      notifyAuth("SIGNED_IN", { user });

      return { data: { user, session: { user } }, error: null };
    },

    /** Inscription locale : crée la ligne dans `users` et ouvre la session. */
    async signUp({
      email,
      options,
    }: {
      email: string;
      password: string;
      options?: { data?: Partial<User> };
    }) {
      ensureDemoAccount();
      const store = getStore();

      if (store.users.some((u) => String(u.email).toLowerCase() === email.trim().toLowerCase())) {
        return { data: { user: null }, error: { message: "User already registered" } };
      }

      const meta = options?.data ?? {};
      const user = {
        ...meta,
        id: newId("u"),
        email,
        followers: 0,
        following: 0,
        created_at: new Date().toISOString(),
      };

      store.users.push(user as unknown as Record<string, unknown>);
      save(store);
      notifyAuth("SIGNED_IN", { user });

      return { data: { user, session: { user } }, error: null };
    },

    async signOut() {
      saveSessionId(null);
      notifyAuth("SIGNED_OUT", null);
      return { error: null };
    },

    /**
     * Réinitialisation simulée. Le backend local n'envoie pas d'email ;
     * on répond comme si le lien était parti, pour que l'écran ne mente pas
     * sur son propre état (il dit « lien envoyé » sans prétendre qu'un
     * contrôle réel a eu lieu).
     */
    async resetPasswordForEmail(_email: string, _options?: { redirectTo?: string }) {
      return { data: {}, error: null };
    },

    /** Change le mot de passe du compte local. */
    async updateUser({ password }: { password?: string; data?: Partial<User> }) {
      const id = loadSessionId();
      if (!id) return { data: { user: null }, error: { message: "Not authenticated" } };

      const store = getStore();
      const user = store.users.find((u) => u.id === id);
      if (!user) return { data: { user: null }, error: { message: "Not authenticated" } };

      if (password) user.password = password;
      save(store);
      notifyAuth("USER_UPDATED", { user });
      return { data: { user }, error: null };
    },

    /** Confirmation d'email / lien de récupération simulé : ouvre la session. */
    async exchangeCodeForSession(_code: string) {
      ensureDemoAccount();
      saveSessionId(String(DEMO_ME.id));
      notifyAuth("SIGNED_IN", { user: DEMO_ME });
      return { data: { user: DEMO_ME, session: { user: DEMO_ME } }, error: null };
    },

    /** Vérification OTP simulée (confirmation d'email ou récupération). */
    async verifyOtp(_params: { token_hash?: string; type?: string; email?: string }) {
      ensureDemoAccount();
      saveSessionId(String(DEMO_ME.id));
      notifyAuth("SIGNED_IN", { user: DEMO_ME });
      return { data: { user: DEMO_ME, session: { user: DEMO_ME } }, error: null };
    },

    /** Renvoi d'email simulé. */
    async resend(_params: { type: string; email: string; options?: { emailRedirectTo?: string } }) {
      return { data: {}, error: null };
    },

    /** Utilisateur courant, relu depuis le store local. */
    async getUser() {
      const id = loadSessionId();
      if (!id) return { data: { user: null }, error: null };
      const user = getStore().users.find((u) => u.id === id);
      return { data: { user: user ?? null }, error: null };
    },

    onAuthStateChange(cb: Listener) {
      authListeners.add(cb);
      return {
        data: { subscription: { unsubscribe: () => authListeners.delete(cb) } },
      };
    },
  },
};