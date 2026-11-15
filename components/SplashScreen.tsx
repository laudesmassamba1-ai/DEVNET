"use client";

import { useState, useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { AnimatedLogo, SPLASH_HOLD_MS } from "@/components/AnimatedLogo";

/* ================================================================
   ÉCRAN DE LANCEMENT

   Au chargement de l'app, la page est vide : un fond charbon chaud
   pointillé (trame d'impression), une flaque de lumière tamisée, et
   le logo qui se construit étape par étape — crayonné, encre, aplat,
   cel shading, chevron, impact, curseur, starche, wordmark.

   Quand la construction est posée, l'écran se dissout et révèle la
   page réelle. Le défilement de la page du dessous est bloqué pendant
   la scène, pour qu'on ne voie jamais le contenu se préparer.

   **La scène n'est jouée qu'une fois par ouverture de session.** Un
   rechargement au milieu d'un travail est un retour, pas une
   ouverture : rejouer tout le récit à chaque F5 interdirait de
   rafraîchir sans être puni. La marque de passage vit dans
   `sessionStorage` (elle survit au rechargement, meurt à la fermeture
   de l'onglet — donc la prochaine ouverture rejoue), et `rearmSplash`
   la retire à chaque **connexion réussie** : la session s'ouvre
   vraiment, la scène s'arme pour le premier chargement qui suit.

   Les fins de page se lisent dans `useLayoutEffect`, pas `useEffect` :
   un visiteur déjà passé ne doit pas voir le voile se poser puis se
   lever — il est retiré **avant le premier paint**, pour la même raison
   qu'un flash de blanc est inacceptable.

   `prefers-reduced-motion` : l'utilisateur voit la cellule finale
   posée quelques instants, puis la même dissolution — la construction,
   la secousse et le frémissement sont coupés par `AnimatedLogo`.
================================================================ */

const SEEN_KEY = "devnet.splash.seen";

export function SplashScreen() {
  const [gone, setGone] = useState(false);
  const [fading, setFading] = useState(false);
  const pathname = usePathname();

  useLayoutEffect(() => {
    // La scène de marque est réservée à la page d'accueil. Sur un écran
    // applicatif (fil, connexion, profil), elle ajoutait plusieurs secondes
    // avant le premier contenu utile.
    // Déjà passé dans cet onglet : l'écran n'existe pas — on ne pose
    // même pas le verrou sur le défilement.
    if (pathname !== "/" || sessionStorage.getItem(SEEN_KEY)) {
      // Le setState ici est le but : il court dans `useLayoutEffect`,
      // donc **avant le premier paint** du commit d'hydratation — un
      // visiteur déjà passé ne voit jamais le voile, pas même une
      // frame. La règle visée (`set-state-in-effect`) chasse les rendus
      // en cascade ; ici il n'y en a qu'un, et il est pré-paint.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGone(true);
      return;
    }

    // Dés cet instant, la scène est comptée comme vue. Le poser ici,
    // à l'ouverture, et non à la sortie, garantit qu'aucun crash
    // intermédiaire ne repasserait la scène sur un rechargement.
    sessionStorage.setItem(SEEN_KEY, "1");

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    /* Rythme demandé : la scène lâche plus tôt — la construction est
       lue, on ne force pas l'attente au-delà du récit. */
    const hold = mq.matches ? 900 : SPLASH_HOLD_MS - 700;

    document.documentElement.style.overflow = "hidden";
    const t1 = setTimeout(() => setFading(true), hold);
    const t2 = setTimeout(() => {
      setGone(true);
      document.documentElement.style.overflow = "";
    }, hold + 620);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      document.documentElement.style.overflow = "";
    };
  }, [pathname]);

  if (gone) return null;

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center"
      style={{
        /* Charbon chaud, puis la flaque de scène derrière le logo :
           la lumière vient du centre, comme une table de dessinateur.

           La teinte vient du thème (`--color-signal` mélangé au fond) :
           l'ouverture reste chaude en « Encre », devient un halo
           turquoise en « Savane » — sans littéral qui jurerait. */
        background:
          "radial-gradient(60rem 42rem at 50% 46%," +
          " color-mix(in srgb, var(--color-signal) 16%, var(--color-page)) 0%," +
          " var(--color-page) 55%, var(--color-page) 100%)",
        backgroundSize: "18px 18px",
        opacity: fading ? 0 : 1,
        transition: "opacity var(--d-enter) ease",
        pointerEvents: "all",
      }}
      aria-hidden="true"
      role="presentation"
    >
      {/* Trame d'impression par-dessus le dégradé : deux fonds CSS ne
          se cumulent pas dans une seule propriété, la trame est une
          pseudo-couche intérieure. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(color-mix(in srgb, var(--color-signal) 7%, transparent) 1px, transparent 1.4px)",
          backgroundSize: "18px 18px",
        }}
      />

      {/*
        L'SVG du logo porte sa taille en `vmin` par CSS (l'attribut
        `width` ne comprend pas les unités du viewport) ; le `min()`
        le plafonne sur grand écran, et le wordmark suit la même loi
        de proportion : 14 % de la taille du logo, dans les deux cas.
      */}
      <AnimatedLogo
        size={300}
        svgClassName="splash-svg"
        wordmarkSize="min(8.12vmin, 42px)"
        wordmark
        tone="light"
      />

      <style>{`
        .splash-svg { width: min(58vmin, 300px); height: min(58vmin, 300px); }

        /* Petits écrans en hauteur (téléphone en paysage) : le gabarit
           rétrécit le logo et resserre la marche vers le wordmark, pour
           que l'ensemble tienne sans être écrasé par l'entête. */
        @media (max-height: 640px) {
          .splash-svg { width: min(46vmin, 240px); height: min(46vmin, 240px); }
          .al-root .al-wordmark { margin-top: .6rem; }
        }
      `}</style>
    </div>
  );
}

/**
 * Ré-armer la scène de lancement.
 *
 * Appelé quand une **session s'ouvre** — connexion par mot de passe,
 * inscription, lien de confirmation : l'utilisateur vient d'entrer,
 * le prochain chargement complet rejoue l'ouverture. Posé après le
 * succès (jamais dans un `finally`), pour qu'un échec de connexion
 * n'arme pas la scène d'une ouverture qui n'a pas eu lieu.
 */
export function rearmSplash(): void {
  try {
    sessionStorage.removeItem(SEEN_KEY);
  } catch {
    // Sans sessionStorage, la scène rejoue à chaque chargement : le
    // défaut historique, et le seul qui soit tolérable en repli.
  }
}
