"use client";

import { useEffect, useRef } from "react";
import { useSession } from "@/hooks/useSession";
import { applyTheme, normalizeTheme } from "@/lib/theme";
import { motionDuration } from "@/components/Motion";

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
      applyThemeWithFade(theme);
    };
    window.addEventListener("devnet:theme", onTheme);
    return () => window.removeEventListener("devnet:theme", onTheme);
  }, []);

  return null;
}

/* Durée de repli si le jeton est introuvable (SSR, navigateur ancien).
   La même convention que `Motion.waitForExit` : lire le jeton, jamais le
   recopier — un `--d-scene` modifié en CSS suit ici sans retouche. */
const THEME_FADE_FALLBACK_MS = 200;
let themeFadeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Applique le thème avec un fondu court des couleurs.
 *
 * Sans fondu, un changement de thème est un saut sec : l'œil ne perçoit
 * ni la direction ni l'étendue du changement. On pose
 * `data-theme-fade="true"` sur `<html>` le temps du jeton `--d-scene`
 * — le CSS pose alors une transition de couleurs (jamais de
 * disposition), puis l'attribut est retiré : le reste de l'interface
 * retrouve ses propres transitions. Sous mouvement réduit, aucun
 * attribut : le basculement reste immédiat, ce qui est la demande.
 */
function applyThemeWithFade(theme: string) {
  applyTheme(theme);

  const root = document.documentElement;
  const reduced =
    root.dataset.reduceMotion === "true" ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (reduced) return;

  root.dataset.themeFade = "true";
  if (themeFadeTimer) clearTimeout(themeFadeTimer);
  themeFadeTimer = setTimeout(
    () => {
      delete root.dataset.themeFade;
      themeFadeTimer = null;
    },
    motionDuration("--d-scene", THEME_FADE_FALLBACK_MS),
  );
}
