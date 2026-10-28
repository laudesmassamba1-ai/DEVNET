"use client";

import { useCallback, useEffect, useState } from "react";
import { loadProgress, type Progress } from "@/lib/progress";
import type { User } from "@/lib/types";

/**
 * Charge la progression du profil courant.
 *
 * Le score est recalculé à chaque ouverture plutôt que mis en cache : le
 * calcul porte sur quelques centaines de lignes, il est instantané, et il
 * garantit que l'affichage ne peut pas être en retard sur la réalité.
 *
 * L'état de chargement est *dérivé* (`profil connu et pas encore de
 * snapshot`) et non stocké : écrire `setLoading(true)` dans l'effet
 * provoquerait un rendu en cascade à chaque ouverture de l'onglet.
 */
export function useProgress(profile: User | null) {
  const [snapshot, setSnapshot] = useState<{ id: string; value: Progress } | null>(null);

  // On garde l'id avec la valeur : un changement de compte ne doit jamais
  // afficher le score du précédent pendant le rechargement.
  const progress = snapshot && snapshot.id === profile?.id ? snapshot.value : null;
  const loading = profile !== null && progress === null;

  const load = useCallback(
    (p: User) => loadProgress(p).then((value) => setSnapshot({ id: p.id, value })),
    [],
  );

  useEffect(() => {
    if (!profile) return;
    let alive = true;
    loadProgress(profile).then((value) => {
      if (alive) setSnapshot({ id: profile.id, value });
    });
    return () => {
      alive = false;
    };
  }, [profile]);

  /** Recalcule immédiatement — utilisé après une action qui change le score. */
  const reload = useCallback(async () => {
    if (profile) await load(profile);
  }, [profile, load]);

  return { progress, loading, reload };
}
