"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { getOrCreateProfile } from "@/lib/api/profile";
import { markLastOnline } from "@/lib/offline-cache";
import type { User } from "@/lib/types";
import type { AuthSession as Session, AuthUser } from "@/lib/rest/client";

type State = {
  session: Session | null;
  profile: User | null;
  loading: boolean;
  /** La session existe mais le profil n'a pas pu être lu ni créé. */
  failed: boolean;
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

/**
 * Résout la session + le profil de l'utilisateur courant.
 *
 * Le profil est créé s'il manque (filet pour les comptes antérieurs
 * au trigger `handle_new_user`).
 *
 * Une session sans profil n'est pas une page figée : on remonte
 * `failed`, et l'écran propose de re-tenter l'échec plutôt que de
 * laisser un spinner qui ne finit jamais.
 */
export function useSession(): State & { retry: () => void; refresh: () => Promise<void> } {
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

  // Relit le profil sans clignotement : utile après une mise à jour de la
  // ligne `users` (type de compte, etc.) pour garder l'écran fidèle à la
  // base.
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

      /* Le profil est résolu : cette session en ligne a existé. Le
         marqueur autorise le mode hors-ligne réel — le service worker
         servira les dernières données réelles au prochain passage
         sans réseau (voir BackendGate). */
      if (alive && profile) markLastOnline();

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

  return { ...state, retry, refresh };
}