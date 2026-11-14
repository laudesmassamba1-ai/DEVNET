"use client";

import { useEffect, useState } from "react";

/**
 * DevBugStory — le scénario « pub » de DevNet, en cel shading.
 *
 * Un développeur code. Un bug apparaît. Il le photographie. Il ouvre
 * DevNet, publie en demandant de l'aide. L'aide arrive en commentaires.
 * Il corrige et fête le fix. DevNet est ce qui manque entre l'écran
 * et le dépôt.
 *
 * Trois décisions de fabrication :
 *
 * 1. **Cel shading.** Aucun dégradé : chaque volume porte un aplat et
 *    une ombre en forme franche — la lumière est une décision dessinée,
 *    pas une interpolation. Les couleurs sont toutes des jetons du
 *    design system : le personnage est habillé par la marque.
 * 2. **Une seule prise, rejouable.** Quatorze secondes, pas une boucle :
 *    une pub qui tourne en rond fatigue. Le rejouer remonte le composant
 *    par `key` — le même mécanisme que le logo.
 * 3. **60 fps par construction.** Tout ne touche que transform et
 *    opacity — le GPU compose, rien ne reflow. Chaque pose de repos est
 *    la pose finale de son élément : sous `prefers-reduced-motion`, la
 *    scène tombe sur son affiche (le dénouement) sans une ligne de JS.
 *
 * Les sous-titres sont pilotés par un état React (un seul pilote de
 * temps, nettoyé au démontage) ; le mouvement reste en CSS pur.
 */

/* Les horaires des sous-titres suivent la chorégraphie CSS (les délais
   vivent dans `globals.css`) — synchronisés à la main, comme un doublage. */
const CAPTIONS = [
  { at: 300, text: "23 h 41 — le code compile. Encore." },
  { at: 2700, text: "Non. Le bug est là." },
  { at: 4000, text: "Photo du bug. Preuve à l'appui." },
  { at: 5900, text: "Publié sur DevNet — « Help, l'IDE dit non »" },
  { at: 8200, text: "Les réponses arrivent…" },
  { at: 11700, text: "Corrigé. Merci le réseau." },
  { at: 13100, text: "DevNet — le réseau des développeurs africains" },
] as const;

export function DevBugStory({ className = "" }: { className?: string }) {
  const [caption, setCaption] = useState("");

  useEffect(() => {
    const timers = CAPTIONS.map(({ at, text }) =>
      setTimeout(() => setCaption(text), at),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <figure className={`devscene ${className}`}>
      <svg
        viewBox="0 0 640 400"
        className="block h-auto w-full"
        role="img"
        aria-label="Un développeur photographie un bug, publie sur DevNet en demandant de l'aide, et trois développeurs répondent en commentaires jusqu'au fix."
      >
        {/* ── Le canvas : pièce sombre, lune ── */}
        <rect x="0" y="0" width="640" height="400" fill="var(--color-void)" />
        <circle cx="560" cy="60" r="26" fill="var(--color-warn)" opacity="0.5" />
        <circle cx="560" cy="60" r="26" fill="var(--color-void)" opacity="0.55" transform="translate(9,-4)" />

        {/* ── Le bureau ── */}
        <rect x="70" y="252" width="500" height="16" rx="4" fill="var(--color-surface-3)" />
        <rect x="70" y="252" width="500" height="6" rx="3" fill="var(--color-line-3)" />
        <rect x="92" y="268" width="12" height="96" fill="var(--color-line-2)" />
        <rect x="92" y="268" width="5" height="96" fill="var(--color-line)" />
        <rect x="536" y="268" width="12" height="96" fill="var(--color-line-2)" />
        <rect x="536" y="268" width="5" height="96" fill="var(--color-line)" />

        {/* ── Le personnage — cel shading : aplat + ombre franche ── */}
        <g className="ds-hop">
          <g className="ds-recoil">
            {/* corps : tee-shirt signal, ombre côté droit */}
            <rect x="150" y="150" width="72" height="102" rx="18" fill="var(--color-signal)" />
            <path
              d="M 186 150 h 18 a 18 18 0 0 1 18 18 v 66 a 18 18 0 0 1 -18 18 h -18 z"
              fill="var(--color-signal-d)"
            />
            {/* tête : peau, ombre franche à droite */}
            <circle cx="186" cy="118" r="30" fill="var(--color-warn)" />
            <path d="M 190 88 a 30 30 0 0 1 26 30 a 30 30 0 0 1 -26 30 z" fill="var(--color-void)" opacity="0.14" />
            {/* la casquette du dev */}
            <path d="M 154 112 a 32 32 0 0 1 62 -6 l 2 10 h -64 z" fill="var(--color-line-3)" />
            <rect x="152" y="108" width="30" height="7" rx="3.5" fill="var(--color-line-3)" />
            {/* visage : yeux et sourire (fixes — la fin de l'histoire) */}
            <circle cx="176" cy="122" r="3.4" fill="var(--color-void)" />
            <circle cx="198" cy="122" r="3.4" fill="var(--color-void)" />
            <path d="M 178 136 q 8 6 16 0" stroke="var(--color-void)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
            {/* l'oreillette */}
            <rect x="206" y="118" width="7" height="14" rx="3" fill="var(--color-chalk-3)" />
          </g>
        </g>

        {/* le « ! » du bug — éclate au-dessus de la tête, s'efface au fix */}
        <text
          className="ds-exclaim"
          x="146" y="86"
          fontFamily="var(--font-display)"
          fontSize="34" fontWeight="700"
          fill="var(--color-danger)"
          textAnchor="middle"
          opacity="0"
        >
          !
        </text>

        {/* ── L'ordinateur portable ── */}
        <g className="ds-bug-shake">
          <rect x="252" y="146" width="146" height="100" rx="8" fill="var(--color-line-2)" />
          <rect x="252" y="146" width="20" height="100" rx="8" fill="var(--color-line)" opacity="0.4" />
          <rect x="258" y="152" width="134" height="88" rx="4" fill="var(--color-code-bg)" />
          <rect x="252" y="246" width="156" height="12" rx="4" fill="var(--color-line-3)" />

          {/* écran 1 : le code — tient jusqu'à DevNet, puis s'efface */}
          <g className="ds-code">
            <rect x="266" y="162" width="46" height="5" rx="2.5" fill="var(--color-code-keyword)" />
            <rect x="266" y="172" width="78" height="5" rx="2.5" fill="var(--color-code-string)" />
            <rect x="274" y="182" width="60" height="5" rx="2.5" fill="var(--color-code-function)" />
            <rect x="274" y="192" width="34" height="5" rx="2.5" fill="var(--color-code-comment)" />
            <rect x="266" y="202" width="88" height="5" rx="2.5" fill="var(--color-code-string)" />
            <rect x="282" y="212" width="52" height="5" rx="2.5" fill="var(--color-code-punct)" />
            <rect className="ds-caret" x="338" y="212" width="7" height="6" fill="var(--color-chalk)" />
          </g>

          {/* écran 2 : DevNet — l'app prend l'écran et n'en sort plus */}
          <g className="ds-app" opacity="0">
            <text x="266" y="167" fontFamily="var(--font-display)" fontSize="10" fontWeight="700" fill="var(--color-chalk)">
              DevNet<tspan fill="var(--color-signal)">.</tspan>
            </text>

            {/* phase 1 : le composeur — s'efface à la publication */}
            <g className="ds-composer" opacity="0">
              <rect x="264" y="174" width="122" height="36" rx="6" fill="var(--color-surface-2)" />
              <text className="ds-typeline ds-typeline-1" x="270" y="186" fontFamily="var(--font-mono)" fontSize="6.5" fill="var(--color-chalk-2)">Help : mon IDE dit</text>
              <text className="ds-typeline ds-typeline-2" x="270" y="195" fontFamily="var(--font-mono)" fontSize="6.5" fill="var(--color-chalk-2)">« &lt;div&gt; mal fermé »…</text>
              <text className="ds-typeline ds-typeline-3" x="270" y="204" fontFamily="var(--font-mono)" fontSize="6.5" fill="var(--color-signal-soft)">quelqu&apos;un voit le bug ?</text>
              {/* la pilule Publier — s'enfonce au clic */}
              <rect className="ds-publish" x="338" y="215" width="48" height="16" rx="8" fill="var(--color-signal)" />
              <text className="ds-publish" x="362" y="226" fontFamily="var(--font-mono)" fontSize="7" fontWeight="700" fill="var(--color-void)" textAnchor="middle">Publier</text>
            </g>

            {/* phase 2 : le fil — le post, l'aide qui arrive, le fix */}
            <g className="ds-feed" opacity="0">
              {/* la carte du post */}
              <rect x="264" y="174" width="122" height="26" rx="6" fill="var(--color-surface-2)" />
              <circle cx="272" cy="181" r="3.5" fill="var(--color-av-orange-bg)" />
              <rect x="279" y="178" width="42" height="4" rx="2" fill="var(--color-chalk-2)" />
              <rect x="270" y="188" width="90" height="4" rx="2" fill="var(--color-signal-soft)" />
              <rect x="270" y="194" width="64" height="4" rx="2" fill="var(--color-chalk-4)" />

              {/* l'aide : trois bulles posées en cascade */}
              <g className="ds-bubble ds-bubble-1" opacity="0">
                <circle cx="271" cy="212" r="6" fill="var(--color-av-lime-bg)" />
                <rect x="281" y="206" width="86" height="12" rx="5" fill="var(--color-surface-2)" />
                <rect x="286" y="210" width="56" height="4" rx="2" fill="var(--color-phosphor)" />
              </g>
              <g className="ds-bubble ds-bubble-2" opacity="0">
                <circle cx="271" cy="228" r="6" fill="var(--color-av-pink-bg)" />
                <rect x="281" y="222" width="100" height="12" rx="5" fill="var(--color-surface-2)" />
                <rect x="286" y="226" width="70" height="4" rx="2" fill="var(--color-chalk-3)" />
              </g>
              <g className="ds-bubble ds-bubble-3" opacity="0">
                <circle cx="271" cy="244" r="6" fill="var(--color-av-violet-bg)" />
                <rect x="281" y="238" width="92" height="12" rx="5" fill="var(--color-surface-2)" />
                <rect x="286" y="242" width="64" height="4" rx="2" fill="var(--color-code-string)" />
              </g>

              {/* le badge des réponses */}
              <g className="ds-badge" opacity="0">
                <circle cx="342" cy="168" r="9" fill="var(--color-signal)" />
                <text x="342" y="171" fontFamily="var(--font-mono)" fontSize="8" fontWeight="700" fill="var(--color-void)" textAnchor="middle">3</text>
              </g>

              {/* le fix : la coche verte */}
              <g className="ds-fix" opacity="0">
                <circle cx="386" cy="196" r="9" fill="var(--color-phosphor)" />
                <path d="M 381 196 l 3.5 4 l 7 -8" stroke="var(--color-void)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
              </g>
            </g>
          </g>
        </g>

        {/* ── Le bras clavier : la main rebondit sur les touches ── */}
        <g className="ds-type" style={{ transformOrigin: "192px 170px" }}>
          <rect x="188" y="162" width="90" height="15" rx="7.5" fill="var(--color-warn)" transform="rotate(46 192 170)" />
          <rect x="188" y="162" width="90" height="6" rx="3" fill="var(--color-void)" opacity="0.18" transform="rotate(46 192 170)" />
        </g>

        {/* ── Le bras téléphone : baissé le long du corps (pose de repos),
            il se lève pour le cliché — l'arc complet tient dans un seul
            keyframe, et le téléphone levé montre le bug photographié. ── */}
        <g className="ds-phone" style={{ transformOrigin: "206px 168px" }}>
          <rect x="199" y="162" width="15" height="60" rx="7.5" fill="var(--color-warn)" />
          <rect x="199" y="162" width="7" height="60" rx="3.5" fill="var(--color-void)" opacity="0.18" />
          {/* le téléphone en main, à hauteur de hanche */}
          <rect x="192" y="216" width="28" height="46" rx="6" fill="var(--color-chalk-2)" />
          <rect x="192" y="216" width="11" height="46" rx="6" fill="var(--color-chalk-3)" />
          {/* l'écran du téléphone : le bug photographié — dessiné dans le
              bas du téléphone, il se lit à l'endroit une fois levé */}
          <rect x="196" y="236" width="20" height="7" fill="var(--color-void)" />
          <rect x="199" y="239" width="14" height="5" fill="var(--color-danger)" />
          <rect x="199" y="246" width="9" height="4" fill="var(--color-chalk-3)" />
          {/* le flash */}
          <circle className="ds-flash" cx="206" cy="222" r="12" fill="var(--color-chalk)" opacity="0" />
        </g>

        {/* les glyphes de code jaillissent du fix */}
        <text className="ds-jail ds-jail-1" x="300" y="150" fontFamily="var(--font-mono)" fontSize="11" fill="var(--color-signal)" opacity="0">&lt;/&gt;</text>
        <text className="ds-jail ds-jail-2" x="366" y="156" fontFamily="var(--font-mono)" fontSize="10" fill="var(--color-phosphor)" opacity="0">{"{}"}</text>
        <text className="ds-jail ds-jail-3" x="330" y="144" fontFamily="var(--font-mono)" fontSize="10" fill="var(--color-warn)" opacity="0">;</text>

        {/* la tasse du dev (aplat + ombre franche) */}
        <rect x="446" y="230" width="26" height="22" rx="4" fill="var(--color-chalk-2)" />
        <rect x="446" y="230" width="10" height="22" rx="4" fill="var(--color-chalk-3)" />
        <path d="M 472 236 h 8 a 5 5 0 0 1 0 10 h -8" fill="none" stroke="var(--color-chalk-3)" strokeWidth="3" />
        {/* le carnet */}
        <rect x="412" y="238" width="22" height="14" rx="3" fill="var(--color-surface-3)" />
        <rect x="412" y="238" width="22" height="4" rx="2" fill="var(--color-line-3)" />

        {/* le sol */}
        <rect x="0" y="362" width="640" height="38" fill="var(--color-surface)" />
        <rect x="0" y="362" width="640" height="4" fill="var(--color-line)" />
      </svg>

      {/* Sous-titre : le pilote de temps change le texte, la boîte ne
          bouge jamais — aucun déplacement, aucun reflow. */}
      <figcaption
        role="status"
        className="mt-2 min-h-6 text-center font-mono text-12 tracking-normal text-chalk-3"
      >
        {caption}
      </figcaption>
    </figure>
  );
}

/** Le stage rejoue la prise : la `key` remonte toute la chorégraphie. */
export function DevBugStoryStage({ className = "" }: { className?: string }) {
  const [run, setRun] = useState(0);

  return (
    <div className="flex flex-col items-center gap-2">
      <DevBugStory key={run} className={className} />
      <button
        type="button"
        onClick={() => setRun((r) => r + 1)}
        className="mo-press mx-auto flex min-h-(--h-tap) items-center gap-2 rounded-(--radius-input)
          border border-line-2 px-4 font-mono text-12 font-bold text-chalk-2
          transition-colors hover:border-signal hover:text-signal"
      >
        <span aria-hidden>❯</span> rejouer
      </button>
    </div>
  );
}
