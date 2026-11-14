"use client";

import { useEffect, useState } from "react";
import { levelFor } from "@/lib/gamification";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

/**
 * Célébration de palier franchi.
 *
 * Un palier ne se franchit pas pendant qu'on regarde une page : il se
 * franchit entre deux visites, quand le score — toujours dérivé des
 * événements réels, jamais stocké — dépasse le seuil suivant. La
 * comparaison se fait donc contre le dernier palier **vu** :
 *
 * - première visite → on mémorise, on ne célèbre pas (arriver n'est pas
 *   une réussite) ;
 * - palier supérieur au dernier vu → la feuille s'ouvre une fois, puis
 *   le palier devient la nouvelle référence.
 *
 * La célébration est **dérivée** au rendu (`palier actuel > palier vu`),
 * pas posée par un effet : l'effet ne fait que synchroniser le stockage
 * local — système externe — avec l'état du rendu. Le moment est prévu
 * par la norme : « plaisir, rare, mérité ». Rare, donc jamais une
 * boucle — chaque animation est one-shot, la feuille se ferme au bouton
 * comme à `Échap` (garanti par `Sheet`).
 */

/** Le palier vu est mémorisé localement : rien de sensible, juste un niveau. */
const LEVEL_SEEN_KEY = "devnet:level-seen";

/* Les glyphes du métier. Les couleurs sont des jetons — jamais un hex. */
const CONFETTI = [
  { text: "</>", ink: "var(--color-signal)" },
  { text: "{ }", ink: "var(--color-phosphor)" },
  { text: ";", ink: "var(--color-chalk-3)" },
  { text: "01", ink: "var(--color-warn)" },
  { text: "&&", ink: "var(--color-info)" },
  { text: "=>", ink: "var(--color-signal-soft)" },
  { text: "#", ink: "var(--color-chalk-4)" },
  { text: "git", ink: "var(--color-phosphor)" },
  { text: "||", ink: "var(--color-signal)" },
  { text: "$", ink: "var(--color-chalk-3)" },
  { text: "!=", ink: "var(--color-warn)" },
  { text: "[]", ink: "var(--color-info)" },
] as const;

function readSeenLevel(): number | null {
  try {
    const raw = localStorage.getItem(LEVEL_SEEN_KEY);
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeSeenLevel(level: number) {
  try {
    localStorage.setItem(LEVEL_SEEN_KEY, String(level));
  } catch {
    // Stockage bloqué : la célébration rejouerait à la prochaine visite.
    // Acceptable — c'est une joie, pas une donnée.
  }
}

export function LevelCelebration({ xp }: { xp?: number }) {
  /* Le palier vu est lu une fois au montage : c'est une donnée locale,
     pas une prop à suivre. `xp` arrive plus tard, avec les données. */
  const [seen] = useState<number | null>(() =>
    typeof window === "undefined" ? null : readSeenLevel(),
  );
  /** Fermée pour cette visite — le palier reste la référence mémorisée. */
  const [dismissed, setDismissed] = useState(false);

  const level = typeof xp === "number" ? levelFor(xp).level : null;
  const state = typeof xp === "number" ? levelFor(xp) : null;
  const celebration =
    level !== null && state !== null && seen !== null && level > seen
      ? { level, title: state.title, motto: state.motto }
      : null;

  /* L'effet ne fait que poser la base de comparaison (première visite)
     ou recaler un score descendu — jamais célébrer. */
  useEffect(() => {
    if (level === null) return;
    const stored = readSeenLevel();
    if (stored === null || level < stored) writeSeenLevel(level);
  }, [level]);

  function close() {
    if (level !== null) writeSeenLevel(level);
    setDismissed(true);
  }

  if (!celebration || dismissed) return null;

  return (
    <Sheet open onClose={close} title="Palier franchi">
      <div className="relative overflow-hidden">
        {/* La pluie de glyphes : les caractères du métier tombent une
            fois, puis la feuille reste seule — le plaisir est rare et
            mérité, jamais une boucle. */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {CONFETTI.map((glyph, i) => (
            <span
              key={i}
              className="confetti-glyph"
              style={{
                left: `${(i * 37 + 8) % 96}%`,
                color: glyph.ink,
                animationDelay: `${(i % 6) * 90}ms`,
                "--confetti-spin": `${(i % 2 ? 1 : -1) * (90 + (i % 5) * 70)}deg`,
              } as React.CSSProperties}
            >
              {glyph.text}
            </span>
          ))}
        </div>

        <div className="flex flex-col items-center gap-4 px-2 pb-2 text-center">
        {/* Le cachet éclate une fois (`mo-burst`, one-shot) : c'est le
            seul « plaisir » du contrat d'expérience, dépensé ici. */}
        <div
          className="mo-burst flex size-16 items-center justify-center rounded-full"
          style={{
            background: "var(--story-ring-gradient)",
            boxShadow: "var(--shadow-sh-2)",
          }}
        >
          <Icon name="trophy" size={24} strokeWidth={2} className="text-void" />
        </div>

        <p className="label-micro text-chalk-4">Palier {celebration.level}</p>
        <p className="font-display text-display-l font-bold leading-none tracking-tight text-chalk">
          {celebration.title}
        </p>
        <p className="px-4 text-13 leading-(--lh-body) text-chalk-3">
          {celebration.motto}
        </p>
        <button
          type="button"
          onClick={close}
          className="mo-press mt-2 flex min-h-(--h-tap) w-full items-center justify-center
            rounded-(--radius-input) bg-signal px-4 text-sm font-bold text-void
            transition-opacity duration-(--d-fast) hover:opacity-90"
        >
          Continuer
        </button>
        </div>
      </div>
    </Sheet>
  );
}
