"use client";

import { useEffect, useState } from "react";

/**
 * DevScene — la pub DevNet, illustration animée style Google.
 *
 * Le style est une **identité fixe** : comme le logo, l'illustration ne
 * suit pas les thèmes (un persos d'illustration ne devient pas encre
 * quand l'app passe en sombre) — d'où les couleurs posées ici, dans la
 * liste d'exemption marque de la norme.
 *
 * La scène : Dev, tablette en main, entouré des tuiles du réseau qui
 * flottent. Le récit joue en une prise de douze secondes — il tape, le
 * badge rouge du bug surgit, l'aide arrive en bulles, le badge devient
 * vert, il bondit, les confettis pleuvent. Rejouable par `key`.
 *
 * Tout ne touche que transform et opacity (60 fps par le GPU), et les
 * poses de repos sont les poses finales : sous mouvement réduit,
 * l'affiche du dénouement.
 */

const CAPTIONS = [
  { at: 400, text: "23 h 41 — le code compile. Encore." },
  { at: 2800, text: "Non. Le bug est là." },
  { at: 4300, text: "Photo du bug. Preuve à l'appui." },
  { at: 6200, text: "Publié sur DevNet — « Help, l'IDE dit non »" },
  { at: 8300, text: "Les réponses arrivent…" },
  { at: 10300, text: "Corrigé. Merci le réseau." },
] as const;

export function DevScene({ className = "" }: { className?: string }) {
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
        viewBox="0 0 640 480"
        className="block h-auto w-full"
        role="img"
        aria-label="Un développeur entouré des tuiles DevNet : il tape sur sa tablette, un bug surgit, publie, l'aide arrive, il corrige et célèbre."
      >
        {/* ── Le fond : periwinkle doux, nuages, ligne de sol ── */}
        <rect x="0" y="0" width="640" height="480" rx="0" fill="var(--dsc-bg)" />
        <ellipse cx="150" cy="86" rx="52" ry="20" fill="var(--dsc-white)" opacity="0.85" />
        <ellipse cx="122" cy="76" rx="30" ry="15" fill="var(--dsc-white)" opacity="0.85" />
        <ellipse cx="176" cy="74" rx="28" ry="14" fill="var(--dsc-white)" opacity="0.85" />
        <ellipse cx="520" cy="66" rx="44" ry="17" fill="var(--dsc-white)" opacity="0.8" />
        <ellipse cx="548" cy="58" rx="24" ry="12" fill="var(--dsc-white)" opacity="0.8" />
        <line x1="90" y1="416" x2="550" y2="416" stroke="var(--dsc-paper-line)" strokeWidth="3" strokeLinecap="round" />
        {/* buissons */}
        <path d="M 132 416 a 16 16 0 0 1 32 0 z" fill="var(--dsc-bush)" />
        <path d="M 122 416 a 10 10 0 0 1 20 0 z" fill="var(--dsc-bush-d)" />
        <path d="M 496 416 a 18 18 0 0 1 36 0 z" fill="var(--dsc-bush)" />
        <path d="M 528 416 a 11 11 0 0 1 22 0 z" fill="var(--dsc-bush-d)" />

        {/* ── Les tuiles du réseau flottent autour de lui ──
            Chaque tuile = la marque : orange, glyphes blancs, badge. */}
        <g className="ds2-float" style={{ animationDelay: "0ms" }}>
          <rect x="140" y="128" width="46" height="46" rx="12" fill="var(--dsc-signal)" />
          <text x="163" y="158" fontFamily="var(--font-mono)" fontSize="15" fontWeight="700"
            fill="var(--dsc-white)" textAnchor="middle">&lt;/&gt;</text>
          <circle cx="186" cy="128" r="9" fill="var(--dsc-signal)" stroke="var(--dsc-bg)" strokeWidth="3" />
          <text x="186" y="132" fontFamily="var(--font-mono)" fontSize="10" fontWeight="700"
            fill="var(--dsc-white)" textAnchor="middle">3</text>
        </g>
        <g className="ds2-float" style={{ animationDelay: "300ms" }}>
          <rect x="470" y="108" width="46" height="46" rx="12" fill="var(--dsc-signal)" />
          <text x="493" y="138" fontFamily="var(--font-mono)" fontSize="15" fontWeight="700"
            fill="var(--dsc-white)" textAnchor="middle">{"{}"}</text>
        </g>
        <g className="ds2-float" style={{ animationDelay: "600ms" }}>
          <rect x="96" y="250" width="40" height="52" rx="6" fill="var(--dsc-white)" />
          <rect x="104" y="262" width="24" height="4" rx="2" fill="var(--dsc-paper-line)" />
          <rect x="104" y="272" width="24" height="4" rx="2" fill="var(--dsc-paper-line)" />
          <rect x="104" y="282" width="16" height="4" rx="2" fill="var(--dsc-paper-line)" />
        </g>
        <g className="ds2-float" style={{ animationDelay: "450ms" }}>
          <rect x="502" y="266" width="46" height="46" rx="12" fill="var(--dsc-signal)" />
          <text x="525" y="296" fontFamily="var(--font-mono)" fontSize="15" fontWeight="700"
            fill="var(--dsc-white)" textAnchor="middle">$</text>
        </g>
        <g className="ds2-float" style={{ animationDelay: "750ms" }}>
          <rect x="478" y="336" width="40" height="52" rx="6" fill="var(--dsc-white)" />
          <rect x="486" y="348" width="24" height="4" rx="2" fill="var(--dsc-paper-line)" />
          <rect x="486" y="358" width="24" height="4" rx="2" fill="var(--dsc-paper-line)" />
        </g>

        {/* ── Le personnage ── */}
        <g className="ds2-hop">
          {/* jambes : jean, revers, baskets */}
          <rect x="300" y="336" width="20" height="62" rx="9" fill="var(--dsc-jean)" />
          <rect x="324" y="336" width="20" height="62" rx="9" fill="var(--dsc-jean)" />
          <rect x="300" y="386" width="20" height="12" rx="5" fill="var(--dsc-jean-d)" />
          <rect x="324" y="386" width="20" height="12" rx="5" fill="var(--dsc-jean-d)" />
          <rect x="294" y="398" width="30" height="14" rx="7" fill="var(--dsc-sneaker)" />
          <rect x="322" y="398" width="30" height="14" rx="7" fill="var(--dsc-sneaker)" />
          <rect x="298" y="402" width="8" height="5" rx="2.5" fill="var(--dsc-bush)" />
          <rect x="326" y="402" width="8" height="5" rx="2.5" fill="var(--dsc-bush)" />
          {/* torse : tee-shirt vert, ombre franche à droite */}
          <rect x="284" y="246" width="76" height="98" rx="24" fill="var(--dsc-tee)" />
          <path d="M 322 246 h 14 a 24 24 0 0 1 24 24 v 50 a 24 24 0 0 1 -24 24 h -14 z" fill="var(--dsc-tee-d)" />
          {/* cou */}
          <rect x="312" y="232" width="20" height="18" rx="8" fill="var(--dsc-skin-s)" />

          {/* tête */}
          <circle cx="322" cy="204" r="35" fill="var(--dsc-skin)" />
          <path d="M 328 169 a 35 35 0 0 1 29 35 a 35 35 0 0 1 -29 35 z" fill="var(--dsc-skin-d)" opacity="0.55" />
          {/* cheveux bouclés : masses rondes qui débordent du crâne */}
          <circle cx="302" cy="184" r="17" fill="var(--dsc-hair)" />
          <circle cx="322" cy="176" r="19" fill="var(--dsc-hair)" />
          <circle cx="342" cy="184" r="16" fill="var(--dsc-hair)" />
          <circle cx="310" cy="168" r="14" fill="var(--dsc-hair)" />
          <circle cx="334" cy="168" r="13" fill="var(--dsc-hair)" />
          <circle cx="352" cy="196" r="13" fill="var(--dsc-hair)" />
          {/* oreille */}
          <circle cx="355" cy="212" r="6" fill="var(--dsc-skin)" />
          {/* visage : yeux, sourcils, sourire, oreillette */}
          <g className="ds2-eyes">
            <circle cx="308" cy="210" r="4.5" fill="var(--dsc-hair)" />
            <circle cx="334" cy="210" r="4.5" fill="var(--dsc-hair)" />
          </g>
          <rect x="299" y="196" width="13" height="4.5" rx="2" fill="var(--dsc-hair)" transform="rotate(-8 305 198)" />
          <rect x="331" y="196" width="13" height="4.5" rx="2" fill="var(--dsc-hair)" transform="rotate(8 338 198)" />
          <path d="M 312 226 Q 322 234 332 226" stroke="var(--dsc-hair)" strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="358" cy="208" r="4" fill="var(--dsc-sneaker)" />

          {/* bras droit : il tient la tablette devant lui */}
          <path d="M 292 262 Q 272 284 282 306" stroke="var(--dsc-tee)" strokeWidth="15" fill="none" strokeLinecap="round" />
          <circle cx="284" cy="306" r="9" fill="var(--dsc-skin)" />
          {/* bras gauche vers la tablette */}
          <path d="M 352 268 Q 368 292 356 312" stroke="var(--dsc-tee-d)" strokeWidth="14" fill="none" strokeLinecap="round" />
          <circle cx="354" cy="314" r="9" fill="var(--dsc-skin-s)" />

          {/* la tablette : l'écran raconte toute l'histoire */}
          <rect x="296" y="296" width="56" height="74" rx="8" fill="var(--dsc-ink)" />
          <rect x="302" y="304" width="44" height="58" rx="4" fill="var(--dsc-paper)" />
          {/* l'app DevNet sur l'écran : en-tête + fil */}
          <rect x="306" y="308" width="20" height="6" rx="3" fill="var(--dsc-signal)" />
          <text x="328" y="314" fontFamily="var(--font-display)" fontSize="7" fontWeight="700" fill="var(--dsc-ink)">DevNet</text>
          <rect x="306" y="320" width="36" height="10" rx="3" fill="var(--dsc-sneaker)" />
          <rect x="309" y="323" width="24" height="3" rx="1.5" fill="var(--dsc-hairline)" />
          {/* le badge du bug : rouge, puis vert au fix */}
          <circle className="ds2-bug" cx="346" cy="322" r="8" fill="var(--dsc-danger)" stroke="var(--dsc-paper)" strokeWidth="2.5" />
          <text className="ds2-bug" x="346" y="325.5" fontFamily="var(--font-mono)" fontSize="9" fontWeight="700" fill="var(--dsc-white)" textAnchor="middle">!</text>
          <g className="ds2-fix">
            <circle cx="346" cy="322" r="9" fill="var(--dsc-ok)" stroke="var(--dsc-paper)" strokeWidth="2.5" />
            <path d="M 342 322 l 3 3.4 l 6 -7" stroke="var(--dsc-white)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          </g>
        </g>

        {/* ── Le flash du cliché ── */}
        <circle className="ds2-flash" cx="352" cy="296" r="16" fill="var(--dsc-white)" />

        {/* ── L'aide : trois bulles montent vers lui ── */}
        <g className="ds2-rise ds2-rise-1">
          <rect x="196" y="330" width="64" height="22" rx="11" fill="var(--dsc-white)" />
          <circle cx="204" cy="341" r="7" fill="var(--dsc-av-lime)" />
          <rect x="215" y="336" width="36" height="4" rx="2" fill="var(--dsc-ok)" />
          <rect x="215" y="343" width="26" height="3" rx="1.5" fill="var(--dsc-hairline)" />
        </g>
        <g className="ds2-rise ds2-rise-2">
          <rect x="398" y="308" width="70" height="22" rx="11" fill="var(--dsc-white)" />
          <circle cx="406" cy="319" r="7" fill="var(--dsc-av-pink)" />
          <rect x="417" y="314" width="40" height="4" rx="2" fill="var(--dsc-jean)" />
          <rect x="417" y="321" width="30" height="3" rx="1.5" fill="var(--dsc-hairline)" />
        </g>
        <g className="ds2-rise ds2-rise-3">
          <rect x="392" y="352" width="64" height="22" rx="11" fill="var(--dsc-white)" />
          <circle cx="400" cy="363" r="7" fill="var(--dsc-av-violet)" />
          <rect x="411" y="358" width="36" height="4" rx="2" fill="var(--dsc-gold)" />
          <rect x="411" y="365" width="26" height="3" rx="1.5" fill="var(--dsc-hairline)" />
        </g>

        {/* ── Les confettis : glyphes et tuiles de la marque ── */}
        <text className="ds2-jail ds2-jail-1" x="238" y="180" fontFamily="var(--font-mono)" fontSize="14" fontWeight="700" fill="var(--dsc-signal)" opacity="0">&lt;/&gt;</text>
        <text className="ds2-jail ds2-jail-2" x="396" y="196" fontFamily="var(--font-mono)" fontSize="13" fontWeight="700" fill="var(--dsc-ok)" opacity="0">{"{}"}</text>
        <rect className="ds2-jail ds2-jail-3" x="252" y="150" width="14" height="14" rx="4" fill="var(--dsc-jean)" opacity="0" />
        <circle className="ds2-jail ds2-jail-4" cx="372" cy="168" r="6" fill="var(--dsc-gold)" opacity="0" />

        {/* ── La signature ── */}
        <g className="ds2-signature">
          <text x="320" y="452" fontFamily="var(--font-display)" fontSize="17" fontWeight="700"
            fill="var(--dsc-ink)" textAnchor="middle">
            DevNet<tspan fill="var(--dsc-signal)">.</tspan> ton bug, ta preuve, ton réseau.
          </text>
        </g>
      </svg>

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
export function DevSceneStage({ className = "" }: { className?: string }) {
  const [run, setRun] = useState(0);

  return (
    <div className="flex flex-col items-center gap-2">
      <DevScene key={run} className={className} />
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
