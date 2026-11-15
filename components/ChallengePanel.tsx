"use client";

import { Icon } from "@/components/Icon";
import { challengeXp } from "@/lib/challenges";
import type { Challenge } from "@/lib/challenges";

/**
 * Les défis du jour, affichés.
 *
 * Trois cartes, une par défi — c'est le format du panneau de quêtes
 * (`ProgressPanel`), et il le garde : un écran qui aurait son propre
 * style de compteur serait le seul à ne pas ressembler à DevNet. La
 * marque d'accompli est un check plein, la progression une barre — les
 * mêmes lignes que les badges, pour la même promesse visuelle.
 *
 * Ce panneau vit sur l'onglet **Progrès** du profil, à côté des succès et
 * de la collection. Dans le fil, il n'apparaît pas : l'alerte du jour
 * reste accessible dans le centre de notifications, sans interrompre la
 * lecture.
 *
 * `mo-grow` anime la barre à l'entrée : c'est une jauge, et la classe
 * documentée dans `globals.css` dit « réservée aux jauges et aux traits
 * de progression ».
 */
export function ChallengePanel({ challenges }: { challenges: Challenge[] }) {
  if (!challenges.length) return null;

  const gain = challengeXp(challenges);

  return (
    <section className="rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
      <h3 className="label mb-3 flex items-center justify-between text-chalk-3">
        <span className="flex items-center gap-1.5">
          <Icon name="target" size={12} strokeWidth={1.8} />
          Défis du jour
        </span>
        {gain > 0 && (
          <span className="tnum font-mono text-12 text-signal">+{gain} XP</span>
        )}
      </h3>

      <ul className="space-y-2">
        {challenges.map((c) => {
          const pct = c.target > 0 ? Math.round((c.progress / c.target) * 100) : 0;
          return (
            <li
              key={c.id}
              className={`rounded-(--radius-chip) border px-3 py-2.5 ${
                c.done
                  ? "border-signal bg-signal/8"
                  : "border-line-2 bg-surface-2"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-(--radius-chip) border ${
                    c.done
                      ? "border-signal bg-signal text-void"
                      : "border-line-2 text-chalk-3"
                  }`}
                >
                  <Icon name={c.done ? "check" : c.icon} size={12} strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={`text-13 font-bold ${c.done ? "text-signal" : "text-chalk"}`}>
                      {c.label}
                    </span>
                    {c.difficulty > 1 && (
                      <span className="font-mono text-12 uppercase tracking-wider text-signal/70">
                        ×{c.difficulty}
                      </span>
                    )}
                    <span className="tnum ml-auto font-mono text-12 text-chalk-4">
                      {c.progress}/{c.target} · {c.xp} XP
                    </span>
                  </span>
                  <span className="mt-0.5 block text-12 leading-snug text-chalk-3">
                    {c.hint}
                  </span>
                </span>
              </div>
              {!c.done && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="mo-grow h-full bg-signal/70"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
