"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

/**
 * DevIntro — le générique d'ouverture de DevNet, en stop motion.
 *
 * Joué PLEIN ÉCRAN juste avant la page de connexion : la prise dure
 * seize secondes et demie, puis le voile se dissout et la page
 * apparaît. Pas de bouton « rejouer » — le générique n'est pas un
 * jouet, c'est un générique. Un « passer » discret reste disponible :
 * une intro non-passable est un piège d'accessibilité.
 *
 * La mise en scène : le téléphone est posé sur un bureau (tasse,
 * carnet, lampe), sous une lumière de plateau. La « caméra » bouge en
 * stop motion — zoom au moment de publier, recadrage sec sur le
 * cliché, retour large pour la signature — chaque mouvement passe par
 * `steps()` : deux à trois images par geste, tournage image par
 * image. Les cartes portent une ombre pleine décalée : papier découpé.
 *
 * Joué **une fois par session** (`devnet:intro`) : un générique qu'on
 * revoit à chaque déconnexion n'est plus un générique. Sous mouvement
 * réduit, il ne joue pas du tout — la page apparaît directement.
 */

const CAPTIONS = [
  { at: 500, text: "23 h 41 — le code ne compile pas." },
  { at: 3400, text: "Publier. Le post est en tête du fil, tout de suite." },
  { at: 5500, text: "Le cliché : la preuve, image par image." },
  { at: 8300, text: "Trois réponses en quatre minutes. Le réseau travaille." },
  { at: 11400, text: "Le cœur se remplit, image par image." },
  { at: 14200, text: "Résolu. Image par image." },
  { at: 15400, text: "DevNet — le réseau des développeurs africains." },
] as const;

/** Durée totale de la prise, puis le voile se dissout. */
export const INTRO_MS = 16700;

export function DevIntro({ className = "" }: { className?: string }) {
  const [caption, setCaption] = useState("");

  useEffect(() => {
    const timers = CAPTIONS.map(({ at, text }) =>
      setTimeout(() => setCaption(text), at),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <figure className={`devscene ${className}`}>
      {/* ── Le plateau : mur de fond, bureau, accessoires ──
          Le décor est une illustration : son faux texte (« BUG_042.jpg »,
          « #debogage », « Publié · +10 pts ») n'est pas du contenu. Il est
          donc masqué aux technologies d'assistance — c'est le
          `<figcaption>` qui porte le récit, et lui reste lisible
          (contraste vérifié par `tests/e2e/a11y-themes.spec.ts`). */}
      <div className="dsm-stage" aria-hidden="true">
        <div className="dsm-wall" aria-hidden />
        <div className="dsm-desk" aria-hidden>
          <span className="dsm-mug" aria-hidden />
          <span className="dsm-pad" aria-hidden />
          <span className="dsm-lamp" aria-hidden>
            <span className="dsm-lamp-arm" />
            <span className="dsm-lamp-head" />
          </span>
        </div>

        {/* ── La caméra : elle zoome et recadre en stop motion ── */}
        <div className="dsm-cam">
          <div className="dsm-phone">
            {/* barre de statut de l'app : l'horloge avance en steps */}
            <div className="dsm-status">
              <span className="dsm-clock">23:41</span>
              <span className="dsm-demo-pill">démo</span>
            </div>
            {/* barre de titre de l'app */}
            <div className="dsm-topbar">
              <span className="font-display text-12 font-bold tracking-tight">
                DevNet<span className="dsm-signal-text">.</span>
              </span>
              <span className="dsm-bell">
                <Icon name="notifications" size={9} />
                <span className="dsm-bell-badge dsm-pop-late">3</span>
              </span>
            </div>

            {/* ── Le fil ── */}
            <div className="dsm-feed">
              {/* la gouttière du vrai fil : fichier + cadran */}
              <div className="dsm-card dsm-card-new">
                <div className="dsm-row">
                  <span className="dsm-avatar dsm-avatar-me">K</span>
                  <span className="dsm-name">
                    Koffi <span className="dsm-pseudo">@koffi</span>
                    <span className="dsm-verified"><Icon name="verified" size={9} /></span>
                  </span>
                  <span className="dsm-meta tnum">23:42</span>
                </div>
                <p className="dsm-text">
                  Help : mon IDE dit « &lt;div&gt; mal fermé ». Vous le voyez ?
                  <span className="dsm-tags">#debogage #frontend</span>
                </p>
                <div className="dsm-code">
                  <span className="dsm-code-label">
                    <Icon name="file" size={9} /> HTML
                  </span>
                  <span className="dsm-code-line" />
                  <span className="dsm-code-line dsm-code-line-s" />
                  <span className="dsm-code-cursor" />
                </div>
                <div className="dsm-actions">
                  <span className="dsm-like">
                    <Icon name="like" size={9} />
                    <span className="dsm-heart-filled"><Icon name="like" size={9} /></span>
                  </span>
                  <span className="dsm-count tnum dsm-count-pop">3</span>
                  <span className="dsm-replies tnum">+3 réponses</span>
                  <span className="dsm-chip-ok"><Icon name="check" size={9} /> résolu</span>
                </div>
              </div>

              {/* le post d'avant, éclairé par la lampe */}
              <div className="dsm-card dsm-card-old">
                <div className="dsm-row">
                  <span className="dsm-avatar">A</span>
                  <span className="dsm-name">
                    Aminata <span className="dsm-pseudo">@aminata_dev</span>
                  </span>
                </div>
                <p className="dsm-text dsm-text-old">
                  Astuce Data : normalisez avant de découper en train/test.
                </p>
              </div>

              {/* ── Les commentaires : papiers posés un à un ── */}
              <div className="dsm-comment dsm-comment-1">
                <span className="dsm-avatar dsm-av-lime">T</span>
                <span className="dsm-bubble-text">ligne 42, ferme ton &lt;/div&gt;</span>
              </div>
              <div className="dsm-comment dsm-comment-2">
                <span className="dsm-avatar dsm-av-pink">C</span>
                <span className="dsm-bubble-text">montre le bloc entier 👀</span>
              </div>
              <div className="dsm-comment dsm-comment-3">
                <span className="dsm-avatar dsm-av-violet">Z</span>
                <span className="dsm-bubble-text">essayé, ça compile ✔</span>
              </div>
            </div>

            {/* ── La feuille de composition (temps 1) ── */}
            {/*
              * `aria-hidden` : c'est du décor de démonstration, pas du
              * contenu. Sans lui, axe mesure le texte pendant que la feuille
              * glisse hors cadre et signale un contraste insuffisant — un
              * vrai défaut de lisibilité à cet instant, mais sur un élément
              * que personne n'est censé lire. Le reste du décor du composant
              * est déjà marqué de la même façon.
              */}
            <div className="dsm-composer" aria-hidden>
              <p className="dsm-typeline">
                Help : mon IDE dit « &lt;div&gt; mal fermé ».
              </p>
              <span className="dsm-publish">Publier</span>
            </div>

            {/* ── Le viseur (temps 3) : photographier le bug ── */}
            <div className="dsm-viewfinder">
              <span className="dsm-vf-corner dsm-vf-tl" aria-hidden />
              <span className="dsm-vf-corner dsm-vf-br" aria-hidden />
              <div className="dsm-vf-code">
                <span className="dsm-code-line" />
                <span className="dsm-code-line dsm-code-line-s" />
              </div>
              <span className="dsm-vf-label">BUG_042.jpg</span>
              <span className="dsm-vf-flash" aria-hidden />
            </div>

            {/* ── Le tampon « résolu » claque au temps 5 ── */}
            <div className="dsm-stamp-wrap" aria-hidden>
              <span className="dsm-stamp"><Icon name="check" size={9} /> résolu</span>
            </div>

            {/* ── Le toast (temps 2) ── */}
            <span className="dsm-toast">Publié · +10 pts</span>

            {/* le reflet de la lampe : la scène vit */}
            <span className="dsm-glow" aria-hidden />
          </div>
        </div>
      </div>

      <figcaption
        role="status"
        className="mt-2 min-h-6 text-center font-mono text-12 tracking-normal text-chalk-3"
      >
        {caption}
      </figcaption>
    </figure>
  );
}

/**
 * Le voile plein écran : la prise tourne, puis `onDone` rend la page.
 * Le « passer » est une porte de sortie honnête, pas un bouton de
 * décoration : présent dès la première seconde, à la cible 44 px.
 */
export function DevIntroVeil({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, INTRO_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="dsm-intro" role="status" aria-label="Générique d'ouverture DevNet">
      <DevIntro />
      <button
        type="button"
        onClick={onDone}
        className="mo-press absolute right-4 bottom-4 z-10 flex min-h-(--h-tap) items-center gap-1.5
          rounded-(--radius-input) px-3 font-mono text-12 font-bold text-chalk-3
          transition-colors hover:text-chalk"
      >
        passer <span aria-hidden>›</span>
      </button>
    </div>
  );
}
