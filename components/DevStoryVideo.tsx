"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/**
 * DevStoryVideo — la pub DevNet rendue par le pipeline Blender
 * (`devnet-motion`), intégrée à la page de connexion.
 *
 * Le film raconte : un dev tape, un bug apparaît, il le photographie,
 * publie sur DevNet, l'aide arrive en commentaires, il corrige.
 * Dix secondes, muet, une lecture — pas de boucle.
 *
 * La lecture est **infaillible par conception** : l'autoplay est tenté
 * à chaque occasion (montage, metadata, données prêtes) — et quoi
 * qu'il arrive, l'affiche porte une **gâchette gestuelle géante**
 * (tap n'importe où) qui lance toujours le film, car un `play()` parti
 * d'un geste n'est jamais refusé par une politique d'autoplay. C'est
 * ce qui garantit Opera (bloqueur intégré, réglages stricts) comme
 * iOS : l'échec d'autoplay n'est jamais un faux départ silencieux.
 *
 * Attributs iOS posés à la main dans le DOM : React ne sérialise pas
 * `muted` (l'autoplay iOS exige l'ATTRIBUT), et les WebViews iOS
 * anciennes veulent `webkit-playsinline`. Sous
 * `prefers-reduced-motion`, pas de lecture automatique : l'affiche
 * (pose finale du film) tient la place, le tap est la gâchette.
 */

const VIDEO_SRC = "/motion/devnet-story.mp4";
const POSTER_SRC = "/motion/devnet-story-poster.png";

type Phase = "poster" | "playing" | "ended";

export function DevStoryVideo({ className = "" }: { className?: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [reduced, setReduced] = useState(false);
  const [phase, setPhase] = useState<Phase>("poster");

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- la donnée média n'existe pas au rendu serveur
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  /** Attributs iOS : muted doit être un ATTRIBUT (React ne le
      sérialise pas) et webkit-playsinline complète playsinline pour
      les WebViews anciennes. Posés au montage, avant toute évaluation
      de la source. */
  const attach = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (!el) return;
    el.muted = true;
    el.setAttribute("muted", "");
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");
  }, []);

  const start = useCallback(() => {
    videoRef.current?.play().catch(() => {
      /* la politique a refusé l'autoplay : l'affiche et le tap restent —
         un refus n'est jamais un faux départ silencieux */
    });
  }, []);

  /* Tentatives d'autoplay : montage, metadata prête, données prêtes.
     No-op si la lecture a déjà démarré ou si le mouvement est réduit. */
  useEffect(() => {
    if (reduced) return;
    const video = videoRef.current;
    if (!video) return;
    start();
    const onReady = () => {
      if (video.paused) start();
    };
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    return () => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
    };
  }, [reduced, start]);

  function tap() {
    const video = videoRef.current;
    if (!video) return;
    if (phase === "ended") {
      video.currentTime = 0;
      setPhase("poster");
    }
    start();
  }

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={tap}
        aria-label="Lire le film : un développeur photographie un bug, publie sur DevNet en demandant de l'aide, et l'aide arrive jusqu'au fix"
        className="relative block w-full overflow-hidden rounded-(--radius-card)
          border border-line-2 bg-surface text-left"
        data-tour="devnet-story"
      >
        <video
          ref={attach}
          src={VIDEO_SRC}
          poster={POSTER_SRC}
          muted
          playsInline
          preload="auto"
          onPlay={() => setPhase("playing")}
          onEnded={() => setPhase("ended")}
          className="block w-full"
        />
        {/* La gâchette : sur l'affiche (en attente) ou à la fin
            (rejouer) — un tap n'importe où lance toujours le film. */}
        {phase !== "playing" ? (
          <span
            aria-hidden
            className="absolute inset-0 flex items-end justify-center
              bg-gradient-to-t from-void/70 via-transparent to-void/20 pb-3"
          >
            <span className="mo-press mr-3 flex size-16 -translate-y-1 items-center justify-center
              rounded-full bg-signal text-void shadow-(--shadow-sh-2)">
              <Icon name={phase === "ended" ? "refresh" : "play"} size={24} strokeWidth={2.2} />
            </span>
            <span className="flex -translate-y-1 items-center rounded-(--radius-chip)
              bg-void/70 px-3 py-1 font-mono text-12 font-bold text-chalk">
              {phase === "ended"
                ? "rejouer — c'est ça, DevNet"
                : "ton bug, ta preuve, ton réseau"}
            </span>
          </span>
        ) : null}
      </button>
    </div>
  );
}
