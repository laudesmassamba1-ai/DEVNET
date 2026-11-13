"use client";

import { useEffect, useRef } from "react";
import { useSession } from "@/hooks/useSession";
import { applyTheme, normalizeTheme } from "@/lib/theme";

/**
 * Applique le thème de l'utilisateur à `document.documentElement`.
 *
 * Le thème est une donnée du profil : il faut le lire là où le profil est
 * résolu (`useSession`), pas seulement dans l'écran Paramètres. Monté dans
 * le layout, ce composant suit la session et met `<html data-theme>` à jour
 * à la connexion comme au changement de thème.
 *
 * Tant que le profil n'est pas chargé, on ne touche à rien : le script du
 * layout a déjà posé le thème mémorisé, et appliquer la valeur par défaut
 * créerait le clignotement qu'on cherche justement à éviter.
 */
export function ThemeApplier() {
  const { profile } = useSession();

  /**
   * Choix explicite en attente de confirmation par le profil.
   *
   * Un profil lent peut se résoudre **après** l'aperçu des Paramètres et
   * réappliquer son ancien thème : l'utilisateur voit alors son choix
   * annulé sous ses yeux. Tant que le profil n'a pas rejoint la valeur
   * demandée, l'aperçu reste prioritaire ; dès qu'il la rejoint, on rend
   * la main aux données.
   */
  const explicitTheme = useRef<string | null>(null);

  useEffect(() => {
    if (!profile?.theme) return;
    const stored = normalizeTheme(profile.theme);
    if (explicitTheme.current !== null) {
      if (stored === explicitTheme.current) explicitTheme.current = null;
      return;
    }
    applyTheme(stored);
  }, [profile?.theme]);

  // Le changement de thème depuis les Paramètres ne passe pas par une
  // relecture du profil : cet écouteur l'applique sans rechargement.
  useEffect(() => {
    const onTheme = (event: Event) => {
      const theme = normalizeTheme((event as CustomEvent<string>).detail);
      explicitTheme.current = theme;
      applyTheme(theme);
    };
    window.addEventListener("devnet:theme", onTheme);
    return () => window.removeEventListener("devnet:theme", onTheme);
  }, []);

  return null;
}
