"use client";

import { useEffect, useRef, useState } from "react";

/**
 * DevStoryVideo — la pub DevNet rendue par le pipeline Blender
 * (`devnet-motion`), intégrée à la page de connexion.
 *
 * Le film raconte : un dev tape, un bug apparaît, il le photographie,
 * publie sur DevNet, l'aide arrive en commentaires, il corrige.
 * Dix secondes, muet, une lecture — pas de boucle : une pub qui tourne
 * en rond fatigue, et le bouton « rejouer » est là pour la reprise.
 *
 * Deux garde-fous du contrat d'expérience :
 * - `muted` + `playsInline` : la vidéo n'exécute rien, ne sonne jamais
 *   sans geste, et se lit sur iOS même sans geste ;
 * - `prefers-reduced-motion` : pas de lecture automatique — l'affiche
 *   (pose finale du film) tient la place, un clic lance la lecture.
 */

const VIDEO_SRC = "/motion/devnet-story.mp4";
const POSTER_SRC = "/motion/devnet-story-poster.png";

export function DevStoryVideo({ className = "" }: { className?: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [reduced, setReduced] = useState(false);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- la donnée média n'existe pas au rendu serveur
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  function play() {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    setEnded(false);
    void video.play();
  }

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <video
        ref={videoRef}
        src={VIDEO_SRC}
        poster={POSTER_SRC}
        muted
        playsInline
        autoPlay={!reduced}
        preload="metadata"
        onEnded={() => setEnded(true)}
        className="w-full rounded-(--radius-card) border border-line-2 bg-surface"
        aria-label="Un développeur photographie un bug, publie sur DevNet en demandant de l'aide, et l'aide arrive en commentaires jusqu'au fix."
      />
      <button
        type="button"
        onClick={play}
        className={`mo-press flex min-h-(--h-tap) items-center gap-2 rounded-(--radius-input)
          border border-line-2 px-4 font-mono text-12 font-bold text-chalk-2
          transition-colors hover:border-signal hover:text-signal
          ${reduced && !ended ? "" : ""}`}
      >
        <span aria-hidden>❯</span>
        {reduced ? "lire le film" : "rejouer"}
      </button>
      {/* Sous mouvement réduit, la lecture n'est jamais lancée par le
          navigateur : le poster tient, le clic est la seule gâchette.
          (Le poster est la pose finale du film — le dénouement.) */}
      {reduced ? (
        <span className="sr-only">
          Le film est en pause ; appuie sur « lire le film » pour le lancer.
        </span>
      ) : null}
      {ended ? (
        <span className="font-mono text-12 text-chalk-4">
          C&apos;est ça, DevNet — ton bug, ta preuve, ton réseau.
        </span>
      ) : (
        <span className="sr-only">Fin du film.</span>
      )}
    </div>
  );
}
