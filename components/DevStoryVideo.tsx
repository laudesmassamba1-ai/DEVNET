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
 * Garde-fous du contrat d'expérience :
 * - l'attribut `muted` est posé **dans le DOM au montage** (ref) : React
 *   ne le sérialise pas (défaut connu), et iOS n'autorise l'autoplay
 *   que si l'attribut existe quand la source est évaluée — sans lui,
 *   la lecture ne démarre jamais ;
 * - `playsInline` : iOS lit en ligne, jamais en plein écran volé ;
 * - une relance explicite à `canplay` : si la politique du navigateur
 *   a écarté l'autoplay, on tente `play()` une fois — et si elle est
 *   refusée, le bouton `❯` prend la relève (l'échec est assumé, pas
 *   un faux départ) ;
 * - `prefers-reduced-motion` : pas de lecture automatique — l'affiche
 *   (pose finale du film) tient la place, le clic est la gâchette.
 */

const VIDEO_SRC = "/motion/devnet-story.mp4";
const POSTER_SRC = "/motion/devnet-story-poster.png";

export function DevStoryVideo({ className = "" }: { className?: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [reduced, setReduced] = useState(false);
  const [ended, setEnded] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- la donnée média n'existe pas au rendu serveur
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  /** Le muted passe par le ref AVANT la première évaluation de la
      source : React ne sérialise pas l'attribut (défaut connu), et iOS
      n'autorise l'autoplay que si l'ATTRIBUT existe dans le HTML — la
      propriété seule ne suffit pas. On force donc les deux. */
  const attach = (el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el) {
      el.muted = true;
      el.setAttribute("muted", "");
    }
  };

  function start() {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    setEnded(false);
    video.play().catch(() => setBlocked(true));
  }

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <video
        ref={attach}
        src={VIDEO_SRC}
        poster={POSTER_SRC}
        muted
        playsInline
        autoPlay={!reduced}
        preload="auto"
        onCanPlay={() => {
          const video = videoRef.current;
          if (!video || reduced || !video.autoplay) return;
          if (video.paused && video.currentTime === 0) {
            video.play().catch(() => setBlocked(true));
          }
        }}
        onEnded={() => setEnded(true)}
        className="w-full rounded-(--radius-card) border border-line-2 bg-surface"
        aria-label="Un développeur photographie un bug, publie sur DevNet en demandant de l'aide, et l'aide arrive en commentaires jusqu'au fix."
      />
      <button
        type="button"
        onClick={start}
        className={`mo-press flex min-h-(--h-tap) items-center gap-2 rounded-(--radius-input)
          border px-4 font-mono text-12 font-bold transition-colors
          ${blocked || reduced
            ? "border-signal text-signal"
            : "border-line-2 text-chalk-2 hover:border-signal hover:text-signal"}`}
      >
        <span aria-hidden>❯</span>
        {reduced ? "lire le film" : blocked ? "lire la vidéo" : "rejouer"}
      </button>
      {reduced ? (
        <span className="sr-only">
          Le film est en pause ; appuie sur « lire le film » pour le lancer.
        </span>
      ) : null}
      {ended ? (
        <span className="font-mono text-12 text-chalk-4">
          C&apos;est ça, DevNet — ton bug, ta preuve, ton réseau.
        </span>
      ) : null}
    </div>
  );
}
