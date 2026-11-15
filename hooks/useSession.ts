"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "@/lib/api/client";
import { getOrCreateProfile } from "@/lib/api/profile";
import {
  clearLastOnline,
  markLastOnline,
  previousSessionUser,
  purgeOfflineCache,
  rememberSessionUser,
} from "@/lib/offline-cache";
import { invalidateCache } from "@/lib/queryCache";
import type { User } from "@/lib/types";
import type { AuthSession as Session, AuthUser } from "@/lib/rest/client";

type State = {
  session: Session | null;
  profile: User | null;
  loading: boolean;
  /** La session existe mais le profil n'a pas pu être lu ni créé. */
  failed: boolean;
};

type SessionValue = State & {
  retry: () => void;
  refresh: () => Promise<void>;
};

/** Born le temps d'attente : un backend muet ne doit pas figer l'interface. */
const SESSION_TIMEOUT_MS = 8000;

async function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Le profil résolu, borné par le même délai que la session. */
async function resolveProfile(session: Session): Promise<User | null> {
  const result = await withTimeout(
    () => getOrCreateProfile(session.user as AuthUser),
    SESSION_TIMEOUT_MS,
  );
  return result?.profile ?? null;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Résout la session une seule fois pour toute l'application.
 *
 * Avant, chaque écran montait son propre `useSession` : la coque, la page,
 * la cloche et la visite appelaient toutes `/api/auth/session` puis le
 * profil. Une navigation entre deux onglets rejouait donc deux allers-retours
 * et affichait un écran « Ouverture de la session » alors que la session
 * était déjà connue. Le fournisseur vit au-dessus des routes, la valeur
 * persiste, et les onglets se peignent avec l'état déjà résolu.
 */
function useSessionState(): SessionValue {
  const [state, setState] = useState<State>({
    session: null,
    profile: null,
    loading: true,
    failed: false,
  });
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => {
    setTick((t) => t + 1);
    setState((prev) => ({ ...prev, loading: true, failed: false }));
  }, []);

  const refresh = useCallback(async () => {
    const result = (await withTimeout(
      () => api.auth.getSession(),
      SESSION_TIMEOUT_MS,
    )) as { data: { session: Session | null } } | null;
    const session = result?.data?.session ?? null;
    if (!session) return;
    const profile = await resolveProfile(session);
    if (profile) setState((prev) => ({ ...prev, profile }));
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      const result = (await withTimeout(
        () => api.auth.getSession(),
        SESSION_TIMEOUT_MS,
      )) as { data: { session: Session | null } } | null;
      const session = result?.data?.session ?? null;

      if (!session) {
        if (alive) setState({ session: null, profile: null, loading: false, failed: false });
        return;
      }

      const profile = await resolveProfile(session);

      if (alive && profile) {
        const previous = previousSessionUser();
        if (previous && previous !== session.user.id) {
          // Changement de compte sans déconnexion préalable (OAuth, lien
          // magique, autre onglet) : le cache de l'ancien compte ne doit
          // pas survivre au nouveau.
          invalidateCache();
          clearLastOnline();
          purgeOfflineCache();
        }
        rememberSessionUser(session.user.id);
        markLastOnline();
      }
      if (alive) setState({ session, profile, loading: false, failed: !profile });
    })();

    const { data: sub } = api.auth.onAuthStateChange((_event: string, session: Session | null) => {
      if (!session) {
        setState({ session: null, profile: null, loading: false, failed: false });
        return;
      }
      void resolveProfile(session).then((profile) => {
        if (alive) setState({ session, profile, loading: false, failed: !profile });
      });
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [tick]);

  return useMemo(
    () => ({ ...state, retry, refresh }),
    [state, retry, refresh],
  );
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const value = useSessionState();
  return createElement(SessionContext.Provider, { value }, children);
}

/** Session partagée. Le fournisseur est monté dans `app/layout.tsx`. */
export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession doit être utilisé dans SessionProvider.");
  }
  return value;
}
