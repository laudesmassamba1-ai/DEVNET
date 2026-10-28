"use client";

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";

/* ================================================================
   MARQUE DEVNET — version « CEL SHADING », dessinée à la main.

   Le symbole de `Logo.tsx` (fenêtre, chevron `>`, curseur), rendu
   comme une cellule d'animation 2D : encre franche, aplats plats à
   bords durs, bande d'ombre décalée d'un seul côté, rim light fin,
   coups de starche blancs, frémissement de dessin (« boil ») et un
   éclat d'impact quand le chevron frappe.

   La construction suit l'ordre d'un animateur :
     1. crayonné (esquisse fantôme)
     2. encre (le contour tire son trait)
     3. flood  (l'aplat sombre se déverse de gauche à droite)
     4. ombre + lumière coupées brutalement — pas de dégradé : c'est
        le cel shading (deux tons, bords durs)
     5. barre de titre + pastilles qui « tamponnent »
     6. chevron `>` tracé, puis IMPACT : rayures d'étoile, particules
        d'encre, secousse caméra
     7. curseur phosphor qui éclate, puis cligne en marches
     8. balayage de starche à travers la vitre
     9. wordmark tamponné lettre à lettre

   Le mouvement n'interpole que `transform`, `opacity` et le tracé
   (`stroke-dashoffset`). Chaque élément porte son état FINAL comme
   valeur de classe : la version statique coupe les animations
   (`animation: none`) et tombe juste dessus.
================================================================ */

/** Décalage du récital — une seule source de vérité, en secondes. */
const T = {
  sketch: 0.0,
  ink: 0.5,
  flood: 1.05,
  title: 0.9,
  dots: 1.0,
  shade: 1.35,
  rim: 1.5,
  chevron: 1.55,
  impact: 2.05,
  cursor: 2.2,
  blink: 2.9,
  sheen: 2.45,
  word: 2.55,
  settle: 3.35,
} as const;

/** Durée totale de la construction (le ralenti de respiration inclus). */
export const LOGO_BUILD_MS = 4600;

/** Le splash en dérive pour savoir quand lancer son fondu de sortie. */
export const SPLASH_HOLD_MS = 5300;

const WORD = "DEVNET";

/* Durées brèves de chaque acte — en constantes TypeScript, consommées
   par interpolation : aucune durée n'est écrite littéralement dans le
   composant, comme l'exige la règle du design system (le test
   `test-motion` la fait appliquer). L'esprit de la règle reste entier
   : `prefers-reduced-motion` coupe tout d'un seul endroit, et le récit
   se règle ici, pas épars dans les keyframes. */
const D = {
  draw: 0.5,     // crayonné, dissipation, barre igual…
  drawLong: 0.6, // encre et transitions générales
  flood: 0.34,   // aplat de la vitre
  title: 0.3,    // barre de titre
  dot: 0.4,      // pastilles
  dotStep: 0.11, // écart entre pastilles
  chev: 0.5,     // chevron
  cur: 0.34,     // tampon du curseur
  blink: 1.06,   // cadence du clignotement (= --d-caret)
  impact: 0.34,  // éclat d'impact
  bit: 0.5,      // particules d'encre
  shake: 0.3,    // secousse caméra
  sheen: 0.55,   // balayage de starche
  word: 0.4,     // tampon d'une lettre du wordmark
} as const;

/* `prefers-reduced-motion` lu hors effet par `useSyncExternalStore` : pas
   de setState dans un effet, et l'instantané serveur (faux) évite tout
   écart d'hydratation. */
function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function AnimatedLogo({
  size = 220,
  className = "",
  /** Classes CSS pour l'SVG lui-même : le splash s'en sert pour le
      dimensionner en vmin, une unité que l'attribut `width` ignore. */
  svgClassName = "",
  wordmark = true,
  /** Taille du wordmark : nombre (px) ou valeur CSS (« min()… »). */
  wordmarkSize,
  tone = "dark",
  autoHide = false,
  onComplete,
}: {
  size?: number;
  className?: string;
  svgClassName?: string;
  wordmark?: boolean;
  wordmarkSize?: number | string;
  /** Couleur du wordmark : sur fond sombre du splash, passer "light". */
  tone?: "dark" | "light";
  autoHide?: boolean;
  onComplete?: () => void;
}) {
  /* La version statique tombe sur la cellule finale posée, sans
     construction ni frémissement. */
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  const [gone, setGone] = useState(false);
  const [fading, setFading] = useState(false);

  /* prefers-reduced-motion : voir la cellule finale ci-dessus. */

  useEffect(() => {
    if (!onComplete) return;
    const t = setTimeout(onComplete, reduced ? 900 : LOGO_BUILD_MS);
    return () => clearTimeout(t);
  }, [onComplete, reduced]);

  useEffect(() => {
    if (!autoHide) return;
    const t = setTimeout(() => {
      setFading(true);
      setTimeout(() => setGone(true), 650);
    }, reduced ? 1200 : SPLASH_HOLD_MS);
    return () => clearTimeout(t);
  }, [autoHide, reduced]);

  if (gone) return null;

  const variant = reduced ? "al-static" : "al-anim";

  return (
    <div
      className={`al-root ${variant} flex flex-col items-center justify-center ${className}`}
      style={{
        opacity: fading ? 0 : 1,
        transition: "opacity var(--d-enter) ease",
      }}
      aria-hidden="true"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        width={size}
        height={size}
        className={`${variant} ${svgClassName}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Vitre : l'intérieur de la fenêtre (tout sauf l'encre du cadre) */}
          <clipPath id="al-win">
            <rect x="5.4" y="9.4" width="53.2" height="45.2" />
          </clipPath>
          {/* Bande d'ombre : la moitié droite, où la lumière ne vient pas */}
          <clipPath id="al-shade-x">
            <rect x="32" y="0" width="32" height="64" />
          </clipPath>
          {/* Rim light : conforme à une source en haut à gauche */}
          <clipPath id="al-rim">
            <path d="M0 0 H64 V10 H10 V64 H0 Z" />
          </clipPath>
        </defs>

        <style>{`
          .al-svg { will-change: transform; }

          .al-stage { transform-box: fill-box; transform-origin: 50% 50%; }
          .al-anim .al-stage { animation: al-float 7s ease-in-out infinite; animation-delay: ${T.settle}s; }
          @keyframes al-float {
            0%,100% { transform: translateY(0); }
            50%     { transform: translateY(-1.6%); }
          }

          /* Boil : le dessin « vit » comme sur du papier calque.
             Deux états exacts, en marches — jamais en dégradé. */
          .al-anim .al-boil {
            animation:
              al-boil ${D.draw}s steps(2, end) infinite,
              al-shake ${D.shake}s steps(4, end) both;
            animation-delay: ${T.settle}s, ${T.impact}s;
          }
          @keyframes al-boil {
            from { transform: translate(.14px, .1px); }
            to   { transform: translate(-.14px, -.08px); }
          }
          @keyframes al-shake {
            0%   { transform: translate(0, 0); }
            25%  { transform: translate(.7px, -.5px); }
            50%  { transform: translate(-.6px, .4px); }
            75%  { transform: translate(.4px, .5px); }
            100% { transform: translate(0, 0); }
          }

          /* 1 · Crayonné : tracé fantôme qui reste sous l'encre */
          .al-sketch {
            opacity: .16;
            stroke-dasharray: 100;
            stroke-dashoffset: 0;
          }
          .al-anim .al-sketch {            animation: al-draw ${D.draw}s ease-out both,
              al-ghost 1ms linear both;
            animation-delay: ${T.sketch}s, ${(T.sketch + .45).toFixed(2)}s;
          }
          @keyframes al-draw {
            from { stroke-dasharray: 100; stroke-dashoffset: 100; }
            to   { stroke-dasharray: 100; stroke-dashoffset: 0; }
          }
          @keyframes al-ghost {
            from { opacity: .42; }
            to   { opacity: .16; }
          }

          /* 2 · Encre : le contour tire son trait */
          .al-ink { stroke-dasharray: 100; stroke-dashoffset: 0; }
          .al-anim .al-ink {
            animation: al-draw ${D.drawLong}s cubic-bezier(.3,.7,.3,1) both;
            animation-delay: ${T.ink}s;
          }

          /* 3 · Flood : l'aplat se déverse du bord gauche */
          .al-flood { transform-box: fill-box; transform-origin: left center; transform: none; }
          .al-anim .al-flood {
            animation: al-flood ${D.flood}s cubic-bezier(.7,0,.3,1) both;
            animation-delay: ${T.flood}s;
          }
          @keyframes al-flood {
            from { transform: scaleX(.02); }
            to   { transform: scaleX(1); }
          }

          /* Cel shading : les tons se posent d'un COUP, en marches */
          .al-cut { opacity: 1; }
          .al-anim .al-cut { animation: al-cut 1ms steps(1, end) both; animation-delay: var(--al-cut, ${T.shade}s); }
          @keyframes al-cut { from { opacity: 0; } to { opacity: 1; } }

          /* 4 · Barre de titre tirée, pastilles tamponnées */
          .al-line { stroke-dasharray: 100; stroke-dashoffset: 0; }
          .al-anim .al-line { animation: al-draw ${D.title}s ease-out both; animation-delay: ${T.title}s; }

          .al-dot {
            transform-box: fill-box; transform-origin: 50% 50%;
            opacity: 1; transform: none;
          }
          .al-anim .al-dot {
            animation: al-stamp ${D.dot}s cubic-bezier(.34,1.56,.64,1) both;
            animation-delay: calc(var(--al-i, 0) * ${D.dotStep}s + ${T.dots}s);
          }

          /* 5 · Chevron */
          .al-chv { stroke-dasharray: 100; stroke-dashoffset: 0; }
          .al-anim .al-chv {
            animation: al-draw ${D.chev}s cubic-bezier(.25,.9,.3,1) both;
            animation-delay: ${T.chevron}s;
          }

          /* IMPACT : rayures d'étoile, particules d'encre */
          .al-rays {
            transform-box: fill-box; transform-origin: 50% 50%;
            opacity: 0;
          }
          .al-anim .al-rays {
            animation: al-impact ${D.impact}s cubic-bezier(.2,.9,.3,1) both;
            animation-delay: ${T.impact}s;
          }
          @keyframes al-impact {
            0%   { opacity: 0;   transform: scale(.45) rotate(-8deg); }
            30%  { opacity: .9;  transform: scale(1.16) rotate(2deg); }
            70%  { opacity: .55; transform: scale(1.3); }
            100% { opacity: 0;   transform: scale(1.42) rotate(6deg); }
          }
          .al-bit {
            transform-box: fill-box; transform-origin: 50% 50%;
            opacity: 0; transform: none;
          }
          .al-anim .al-bit {
            animation: al-bit ${D.bit}s cubic-bezier(.2,.7,.4,1) both;
            animation-delay: ${T.impact}s;
          }
          @keyframes al-bit {
            0%   { opacity: 0; transform: translate(0, 0) scale(.4); }
            25%  { opacity: 1; }
            100% { opacity: 0; transform: translate(var(--dx, 0), var(--dy, 0)) scale(.15); }
          }

          /* 6 · Curseur : tampon phosphor, puis clignotement EN MARCHES */
          .al-cur {
            transform-box: fill-box; transform-origin: 50% 50%;
            opacity: 1; transform: none;
          }
          .al-anim .al-cur {
            animation:
              al-stamp ${D.cur}s cubic-bezier(.34,1.56,.64,1) both,
              al-blink ${D.blink}s steps(1, end) infinite;
            animation-delay: ${T.cursor}s, ${T.blink}s;
          }
          @keyframes al-stamp {
            0%  { opacity: 0; transform: scale(0); }
            62% { opacity: 1; transform: scale(1.18); }
            82% { transform: scale(.94); }
            100% { opacity: 1; transform: scale(1); }
          }
          @keyframes al-blink {
            0%, 47%  { opacity: 1; }
            50%, 97% { opacity: 0; }
            100%     { opacity: 1; }
          }

          /* 7 · Starche : balai de lumière à bords francs */
          .al-sheen { opacity: 0; }
          .al-anim .al-sheen {
            animation: al-sheen ${D.sheen}s ease-in-out both;
            animation-delay: ${T.sheen}s;
          }
          @keyframes al-sheen {
            0%   { opacity: 0; transform: translateX(-14px) skewX(-16deg); }
            25%  { opacity: .85; }
            100% { opacity: 0; transform: translateX(52px) skewX(-16deg); }
          }

          /* Version statique : on coupe tout, l'état de classe est
             déjà celui de la cellule finale (cel-shading posé). */
          .al-static, .al-static * { animation: none !important; }
          .al-static .al-rays, .al-static .al-sheen, .al-static .al-bit { opacity: 0; }
          .al-static .al-sketch { display: none; }

          /* Wordmark, tamponné lettre à lettre */
          .al-wordmark {
            font-family: var(--font-plex-mono), ui-monospace, monospace;
            letter-spacing: .34em;
            color: var(--al-wm, #272A24);
          }
          .al-wordmark-l { display: inline-block; opacity: 1; transform: none; }
          .al-anim .al-wordmark-l {
            animation: al-word ${D.word}s cubic-bezier(.34,1.4,.64,1) both;
          }
          @keyframes al-word {
            0%   { opacity: 0; transform: translateY(.55em) scale(1.25); filter: blur(2px); }
            60%  { opacity: 1; transform: translateY(0) scale(.94); filter: blur(0); }
            100% { opacity: 1; transform: none; filter: blur(0); }
          }
        `}</style>

        <g className="al-boil">
          {/* 1 · Crayonné : le croquis qui a précédé l'encre */}
          <g fill="none" strokeLinejoin="round" strokeLinecap="round" stroke="#6A6155">
            <rect x="3" y="7" width="58" height="50" rx="2"
              className="al-sketch" strokeWidth="1.6" />
            <path className="al-sketch" d="M15 29 L26.4 38 L15 47" strokeWidth="3" />
            <rect x="32" y="42.6" width="14" height="5.6" className="al-sketch" strokeWidth="1.2" />
          </g>

          {/* 3 · Aplat de la vitre, déversé du bord gauche */}
          <g clipPath="url(#al-win)">
            <rect className="al-flood" x="5.4" y="9.4" width="53.2" height="45.2" fill="#221610" />
          </g>

          {/* Cel shading : bande d'ombre à bord dur + lumière du plafond */}
          <g clipPath="url(#al-win)">
            <g className="al-cut" style={{ "--al-cut": `${T.shade}s` } as CSSProperties}>
              <rect x="33.6" y="9.4" width="25" height="45.2" fill="#150C07" />
            </g>
            <g className="al-cut" style={{ "--al-cut": `${T.rim}s` } as CSSProperties}>
              <rect x="5.4" y="9.4" width="53.2" height="4.2" fill="#2E1E12" />
            </g>
          </g>

          {  /* 2 · Encre du contour, tirée trait par trait */}
          <g fill="none">
            <rect x="3" y="7" width="58" height="50" rx="2"
              className="al-ink" stroke="#200F04" strokeWidth="5.6" strokeLinejoin="round" />
          </g>

          {/* Cadre orange : aplat, ombre dure à droite, rim fin */}
          <g fill="none" strokeLinejoin="miter">
            <rect x="3" y="7" width="58" height="50" rx="2" stroke="#FF8A3D" strokeWidth="3.4" />
            <g clipPath="url(#al-shade-x)">
              <g className="al-cut" style={{ "--al-cut": `${T.shade}s` } as CSSProperties}>
                <rect x="3" y="7" width="58" height="50" rx="2" stroke="#B8541C" strokeWidth="3.4" />
              </g>
            </g>
            <g clipPath="url(#al-rim)">
              <g className="al-cut" style={{ "--al-cut": `${T.rim}s` } as CSSProperties}>
                <rect x="3" y="7" width="58" height="50" rx="2" stroke="#FFC68E" strokeWidth="1.3" />
              </g>
            </g>
          </g>

          {/* Barre de titre + ses trois pastilles */}
          <g clipPath="url(#al-win)">
            <line className="al-line" x1="5.4" y1="19" x2="58.6" y2="19"
              pathLength="100" stroke="#FF8A3D" strokeWidth="2.2" />
            <g clipPath="url(#al-shade-x)">
              <g className="al-cut" style={{ "--al-cut": `${T.shade}s` } as CSSProperties}>
                <line x1="5.4" y1="19" x2="58.6" y2="19" stroke="#B8541C" strokeWidth="2.2" />
              </g>
            </g>
          </g>

          {[
            { x: 9, o: 1 },
            { x: 16, o: .72 },
            { x: 23, o: .45 },
          ].map((d, i) => (
            <g key={i} className="al-dot" style={{ "--al-i": i } as CSSProperties}>
              <rect x={d.x} y="11" width="4.4" height="4.4" fill="#FF8A3D" opacity={d.o} />
              <rect x={d.x} y="11" width="1.7" height="1.7" fill="#FFD2B0" opacity={d.o} />
            </g>
          ))}

          {/* 5 · Le chevron `>` : encre, aplat, ombre, rim */}
          <g fill="none" strokeLinecap="butt">
            <path className="al-chv" d="M14.6 28.6 L26.4 38 L14.6 47.4" pathLength="100"
              stroke="#200F04" strokeWidth="8" strokeLinejoin="miter" />
            <path className="al-chv" d="M14.6 28.6 L26.4 38 L14.6 47.4" pathLength="100"
              stroke="#FF8A3D" strokeWidth="4.8" strokeLinejoin="miter" />
            <g clipPath="url(#al-shade-x)">
              <g className="al-cut" style={{ "--al-cut": `${T.shade}s` } as CSSProperties}>
                <path d="M14.6 28.6 L26.4 38 L14.6 47.4" pathLength="100"
                  stroke="#B8541C" strokeWidth="4.8" strokeLinejoin="miter" />
              </g>
              <g className="al-cut" style={{ "--al-cut": `${T.rim}s` } as CSSProperties}>
                <path d="M14.6 28.6 L26.4 38 L14.6 47.4" pathLength="100"
                  stroke="#FFC68E" strokeWidth="1.2" strokeLinejoin="miter" />
              </g>
            </g>
          </g>

          {/* IMPACT : rayures d'étoile au point de frappe */}
          <g className="al-rays" stroke="#FFC68E" strokeWidth="1.5" strokeLinecap="round" fill="none">
            {[
              "M33 38 L39 38", "M30.95 42.95 L35.19 47.19", "M26 45 L26 51",
              "M21.05 42.95 L16.81 47.19", "M19 38 L13 38", "M21.05 33.05 L16.81 28.81",
              "M26 31 L26 25", "M30.95 33.05 L35.19 28.81",
            ].map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
          {[
            { dx: -8.5, dy: -6, c: "#FFC68E" },
            { dx: 9, dy: -5, c: "#FF8A3D" },
            { dx: -6, dy: 7, c: "#FF8A3D" },
            { dx: 7.5, dy: 6.5, c: "#FFC68E" },
            { dx: 0, dy: -9, c: "#FFD2B0" },
          ].map((b, i) => (
            <circle key={i} className="al-bit" cx="26.4" cy="38" r="1.3"
              fill={b.c}
              style={{ "--dx": `${b.dx}px`, "--dy": `${b.dy}px` } as CSSProperties} />
          ))}

          {/* 6 · Curseur bloc phosphor */}
          <g className="al-cur">
            <rect x="32" y="42.6" width="14" height="5.6" fill="#8FFF5C" />
            <rect x="39" y="42.6" width="7" height="5.6" fill="#5CA83A" />
            <rect x="32" y="42.6" width="14" height="1.7" fill="#D8FFB4" />
          </g>

          {/* 7 · Starche traversant la vitre */}
          <g clipPath="url(#al-win)">
            <g className="al-sheen">
              <rect x="14" y="4" width="9" height="58" fill="#FFE4C2" transform="skewX(-16)" />
            </g>
          </g>
        </g>
      </svg>

      {wordmark ? (
        <div
          className="al-wordmark mt-5 flex items-baseline font-mono font-bold"
          style={{
            /* tone="light" : wordmark crème sur le fond charbon du splash */
            ...({ "--al-wm": tone === "light" ? "#F3EFE4" : undefined } as CSSProperties),
            fontSize: wordmarkSize ?? Math.max(14, size * 0.14),
          }}
        >
          {WORD.split("").map((c, i) => (
            <span key={i}
              className="al-wordmark-l"
              style={{ animationDelay: `${(T.word + i * .07).toFixed(2)}s` } as CSSProperties}
            >
              {c}
            </span>
          ))}
          <span
            className={`al-wordmark-l ${tone === "light" ? "text-signal" : "text-signal-d"}`}
            style={{ animationDelay: `${(T.word + WORD.length * .07).toFixed(2)}s` } as CSSProperties}
          >
            .
          </span>
        </div>
      ) : null}
    </div>
  );
}
