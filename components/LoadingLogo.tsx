"use client";

import type { CSSProperties } from "react";

/* ================================================================
   LOGO DE CHARGEMENT — la construction en boucle.

   Le même symbole et la même grammaire que l'écran de lancement : la
   vitre se déverse, la barre de titre et ses pastilles se posent, le
   chevron se trace et frappe, le curseur cligne — puis tout se
   décroche d'un coup et le cycle recommence, **jusqu'à la fin du
   chargement**. Autant le dire : aucun « Connexion en cours » ne
   s'affiche. Le logo est le message ; le `aria-label` porte la
   sémantique pour les lecteurs d'écran.

   Deux échelles, une seule composante :
   - `size="sm"` : le mini-logo des boutons occupés (remplace le
     spinner à bordure tournante, qui n'exprimait ni la marque ni le
     cel shading) ;
   - `size="md"` : le loader des écrans entiers (`loading.tsx`, panneaux).

   Le cycle dure 1,9 s — plus vif qu'une révolution d'attente
   (`--d-orbit`, 1,1 s), parce que c'est la construction entière qui
   boucle : à 2,2 s elle se lisait comme de la patience ; à 1,9 s on
   suit le trait. Chaque cycle lit comme une « exécution » du
   programme : flood → barre → pastilles → chevron + frappe → curseur
   → décrochage en marches. Les keyframes se referment sur leur état
   initial, donc la boucle n'a aucun à-coup.

   Comme dans `AnimatedLogo`, chaque élément porte son état FINAL
   comme valeur de classe : quand `prefers-reduced-motion` coupe les
   animations, le logo tombe sur sa cellule posée plutôt que sur du
   vide. Les keyframes, elles, partent du vide (0 % = caché).
   ================================================================ */

type LoadingLogoSize = "sm" | "md";

/** Période complète du cycle, en secondes. */
const CYCLE = 1.9;

/** Temps du cycle, en pourcentage de la période (0 → 100). */
const K = {
  floodEnd: 26,      // la vitre est pleine
  title: 10,         // barre de titre tirée
  dots: 14,          // pastilles posées (delta de 6 % entre elles)
  shade: 30,         // ombres dures posées d'un coup
  chv: 34,           // le chevron commence à se tracer
  chvEnd: 54,        // chevron complet → frappe
  impact: 54,        // le « boah » de la frappe
  cursorIn: 62,      // le curseur éclate, cligne trois fois
  hold: 82,          // la cellule est posée, on la laisse respirer
  out: 90,           // décrochage d'un coup
} as const;

/** Retard entre deux pastilles, en secondes. */
const DOT_STEP = +((CYCLE * 6) / 100).toFixed(2);

export function LoadingLogo({
  size = "md",
  className = "",
  ariaLabel = "Chargement",
}: {
  size?: LoadingLogoSize;
  className?: string;
  /** Sémantique sans affichage : un loader n'écrit pas « Chargement… »,
      il le dit aux lecteurs d'écran. */
  ariaLabel?: string;
}) {
  const px = size === "sm" ? 22 : 60;

  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      role="status"
      aria-label={ariaLabel}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        width={px}
        height={px}
        className="ll-svg"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <style>{`
          /* ── Boucle ${CYCLE}s ────────────────────────────────────── */

          /* La vitre se déverse et se décroche. Bord-gauche → droite,
             comme sur l'écran de lancement ; scaleX(0) la fait
             disparaître sans passer par l'opacité. */
          .ll-flood {
            transform-box: fill-box;
            transform-origin: left center;
            /* État final : posé (prefers-reduced-motion l'affiche). */
            transform: scaleX(1);
            animation: ll-flood ${CYCLE}s cubic-bezier(.7,0,.3,1) infinite;
          }
          @keyframes ll-flood {
            0% { transform: scaleX(0); }
            ${K.floodEnd}%, ${K.hold}% { transform: scaleX(1); }
            ${K.out}%, 100% { transform: scaleX(0); }
          }

          /* Les tons durs se posent d'un COUP en marches et partent
             avec le décrochage. */
          .ll-cut { opacity: 1; }
          .ll-svg .ll-cut {
            animation: ll-cut ${CYCLE}s steps(1, end) infinite;
          }
          @keyframes ll-cut {
            0%, ${K.shade - 1}% { opacity: 0; }
            ${K.shade}%, ${K.hold}% { opacity: 1; }
            ${K.out}%, 100% { opacity: 0; }
          }

          /* Barre de titre tirée. */
          .ll-line {
            stroke-dasharray: 100;
            stroke-dashoffset: 0;
          }
          .ll-svg .ll-line { animation: ll-trace-line ${CYCLE}s infinite; }
          @keyframes ll-trace-line {
            0% { stroke-dashoffset: 100; }
            ${K.title}%, ${K.hold}% { stroke-dashoffset: 0; }
            ${K.out}%, 100% { stroke-dashoffset: 100; }
          }

          /* Pastilles tamponnées, deltas constants entre cycles. */
          .ll-dot {
            transform-box: fill-box;
            transform-origin: 50% 50%;
            transform: scale(1);
            /* Tampon nerveux : dépassement court et franc, à la
               tonalité d'un compteur qui claque plutôt que d'un bouton
               qui s'enfonce. */
            animation: ll-dot ${CYCLE}s cubic-bezier(.2,1.4,.5,1) infinite;
            animation-delay: calc(var(--i, 0) * ${DOT_STEP}s);
          }
          @keyframes ll-dot {
            0% { opacity: 0; transform: scale(0); }
            ${K.dots}% { opacity: 1; transform: scale(1.18); }
            ${K.dots + 4}% { transform: scale(.94); }
            ${K.dots + 6}%, ${K.hold}% { opacity: 1; transform: scale(1); }
            ${K.out}%, 100% { opacity: 0; transform: scale(.2); }
          }

          /* Le chevron tire son trait — un keyframe propre, pas celui
             de la barre de titre : les deux ne vivent pas au même
             instant du cycle. */
          .ll-chv {
            stroke-dasharray: 100;
            stroke-dashoffset: 0;
          }
          .ll-svg .ll-chv { animation: ll-trace-chv ${CYCLE}s infinite; }
          @keyframes ll-trace-chv {
            0% { stroke-dashoffset: 100; }
            ${K.chv}% { stroke-dashoffset: 100; }
            ${K.chvEnd}%, ${K.hold}% { stroke-dashoffset: 0; }
            ${K.out}%, 100% { stroke-dashoffset: 100; }
          }

          /* La frappe : le groupe entier respire d'un cran, une fois
             par cycle. Une secousse complète, à chaque cycle, serait
             une punition visuelle pour un chargement. */
          .ll-impact {
            transform-box: fill-box;
            transform-origin: 50% 50%;
            transform: scale(1);
            animation: ll-impact ${CYCLE}s var(--ease-pop, cubic-bezier(.34,1.56,.64,1)) infinite;
          }
          @keyframes ll-impact {
            0%, ${K.impact - 2}% { transform: scale(1); }
            ${K.impact + 3}% { transform: scale(1.045); }
            ${K.impact + 7}%, 100% { transform: scale(1); }
          }

          /* Les rayures d'étoile ne vivent qu'un clin d'œil. */
          .ll-rays {
            transform-box: fill-box;
            transform-origin: 50% 50%;
            opacity: 0;
            animation: ll-rays ${CYCLE}s infinite;
          }
          @keyframes ll-rays {
            0%, ${K.impact - 1}% { opacity: 0; transform: scale(.5) rotate(-8deg); }
            ${K.impact + 4}% { opacity: .9; transform: scale(1.15); }
            ${K.impact + 14}%, 100% { opacity: 0; transform: scale(1.35) rotate(6deg); }
          }

          /* Le curseur : le tampon est porté par le groupe (scale +
             opacity), le clignotement par l'enfant — deux animations
             distinctes, sinon la seconde écraserait l'opacité de la
             première et le tampon disparaîtrait. */
          .ll-cur {
            transform-box: fill-box;
            transform-origin: 50% 50%;
            opacity: 1;
            transform: scale(1);
            animation: ll-cur ${CYCLE}s cubic-bezier(.34,1.56,.64,1) infinite;
          }
          @keyframes ll-cur {
            0%, ${K.cursorIn - 2}% { opacity: 0; transform: scale(0); }
            ${K.cursorIn + 3}% { opacity: 1; transform: scale(1.18); }
            ${K.cursorIn + 6}% { transform: scale(.94); }
            ${K.cursorIn + 8}%, ${K.hold}% { opacity: 1; transform: scale(1); }
            ${K.out}%, 100% { opacity: 0; transform: scale(.2); }
          }
          .ll-blinker {
            /* Trois clignotements exactement par cycle : ${(CYCLE / 3).toFixed(2)}s. */
            animation: ll-blink ${(CYCLE / 3).toFixed(2)}s steps(1, end) infinite;
          }
          @keyframes ll-blink {
            0%, 46% { opacity: 1; }
            50%, 96% { opacity: .25; }
            100% { opacity: 1; }
          }

          /* prefers-reduced-motion : la règle globale de globals.css
             coupe déjà les animations (durées 0,01 ms, une seule
             itération) ; les valeurs de classe ci-dessus font tomber
             chaque pièce sur la cellule posée. Les rayures d'impact,
             qui n'existent pas à l'état posé, ont opacity: 0 en
             valeur de classe donc disparaissent naturellement. */
        `}</style>

        <defs>
          <clipPath id="ll-win">
            <rect x="5.4" y="9.4" width="53.2" height="45.2" />
          </clipPath>
          <clipPath id="ll-shade">
            <rect x="32" y="0" width="32" height="64" />
          </clipPath>
        </defs>

        {/* Le flood : la vitre, déversée du bord gauche */}
        <g clipPath="url(#ll-win)">
          <rect className="ll-flood" x="5.4" y="9.4" width="53.2" height="45.2" fill="var(--color-page-end)" />
        </g>

        {/* Ombres dures posées après le flood */}
        <g clipPath="url(#ll-win)">
          <g className="ll-cut">
            <rect x="33.6" y="9.4" width="25" height="45.2" fill="var(--color-page)" />
            <rect x="5.4" y="9.4" width="53.2" height="4.2" fill="#2E1E12" />
          </g>
        </g>

        {/* Barre de titre tirée */}
        <g clipPath="url(#ll-win)">
          <line className="ll-line" x1="5.4" y1="19" x2="58.6" y2="19"
            pathLength="100" stroke="var(--color-signal)" strokeWidth="2.2" />
        </g>

        {/* Pastilles tamponnées */}
        {[
          { x: 9, o: 1 },
          { x: 16, o: .72 },
          { x: 23, o: .45 },
        ].map((d, i) => (
          <g key={i} className="ll-dot" style={{ "--i": i } as CSSProperties}>
            <rect x={d.x} y="11" width="4.4" height="4.4" fill="var(--color-signal)" opacity={d.o} />
            <rect x={d.x} y="11" width="1.7" height="1.7" fill="#FFD2B0" opacity={d.o} />
          </g>
        ))}

        {/* Cadre : encre, aplat orange, face droite à l'ombre */}
        <g fill="none" strokeLinejoin="miter">
          <rect x="3" y="7" width="58" height="50" rx="7" stroke="var(--color-void)" strokeWidth="5.2" />
          <rect x="3" y="7" width="58" height="50" rx="7" stroke="var(--color-signal)" strokeWidth="3.2" />
          <g clipPath="url(#ll-shade)">
            <g className="ll-cut">
              <rect x="3" y="7" width="58" height="50" rx="7" stroke="var(--color-signal-d)" strokeWidth="3.2" />
            </g>
          </g>
        </g>

        {/* Le chevron, tracé puis frappé (le « boah » porte le groupe) */}
        <g className="ll-impact" fill="none" strokeLinecap="butt" strokeLinejoin="miter">
          <path className="ll-chv" d="M14.6 28.6 L26.4 38 L14.6 47.4" pathLength="100"
            stroke="var(--color-void)" strokeWidth="7.4" />
          <path className="ll-chv" d="M14.6 28.6 L26.4 38 L14.6 47.4" pathLength="100"
            stroke="var(--color-signal)" strokeWidth="4.6" />
          <g clipPath="url(#ll-shade)">
            <g className="ll-cut">
              <path d="M14.6 28.6 L26.4 38 L14.6 47.4" pathLength="100"
                stroke="var(--color-signal-d)" strokeWidth="4.6" />
            </g>
          </g>
        </g>

        {/* Les rayures d'étoile au moment de la frappe */}
        <g className="ll-rays" stroke="#FFC68E" strokeWidth="1.5" strokeLinecap="round" fill="none">
          {[
            "M33 38 L39 38", "M30.95 42.95 L35.19 47.19", "M26 45 L26 51",
            "M21.05 42.95 L16.81 47.19", "M19 38 L13 38", "M21.05 33.05 L16.81 28.81",
            "M26 31 L26 25", "M30.95 33.05 L35.19 28.81",
          ].map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>

        {/* Curseur phosphor : tampon au dehors, clignotement au dedans */}
        <g className="ll-cur">
          <g className="ll-blinker">
            <rect x="32" y="42.6" width="14" height="5.6" fill="var(--color-phosphor)" />
            <rect x="39" y="42.6" width="7" height="5.6" fill="var(--color-phosphor-d)" />
            <rect x="32" y="42.6" width="14" height="1.7" fill="var(--color-chalk)" />
          </g>
        </g>
      </svg>
    </span>
  );
}
