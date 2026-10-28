"use client";

import { useEffect } from "react";
import { useSession } from "@/hooks/useSession";
import { applyTheme } from "@/lib/theme";

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

  useEffect(() => {
    if (profile?.theme) applyTheme(profile.theme);
  }, [profile?.theme]);

  // Le changement de thème depuis les Paramètres ne passe pas par une
  // relecture du profil : cet écouteur l'applique sans rechargement.
  useEffect(() => {
    const onTheme = (event: Event) => {
      applyTheme((event as CustomEvent<string>).detail);
    };
    window.addEventListener("devnet:theme", onTheme);
    return () => window.removeEventListener("devnet:theme", onTheme);
  }, []);

  return null;
}
