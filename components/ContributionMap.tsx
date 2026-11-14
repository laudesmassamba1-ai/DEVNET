"use client";

import { useMemo, useState } from "react";
import { dayDiff, heatmap, todayKey, type HeatCell } from "@/lib/gamification";

/**
 * Carte d'activité — la grille de contributions.
 *
 * Même lecture que celle de GitHub, mais on change deux choses :
 *
 * - les jours sont **du lundi au dimanche** (le calendrier devnet est
 *   scolaire, donc semaine=lundi), là où GitHub démarre le dimanche ;
 * - l'intensité est un dégradé d'olive, pas de vert : la règle du design
 *   system est que l'olive est le seul accent, et une grille de 105 cases
 *   vertes serait le deuxième accent de l'application.
 *
 * ## Pourquoi les mois sont positionnés en absolu
 *
 * La version précédente plaçait les libellés de mois dans une rangée
 * `flex` — un enfant par colonne, chacun large de 11 px. Deux problèmes
 * en découlaient : l'étiquette `absolute` débordait de sa case (elle est
 * insécable), et la moindre différence d'un pixel entre la rangée du haut
 * et la grille se cumulait jusqu'à faire glisser un « sept. » sur la
 * première case de la semaine. Le résultat était exactement ce qu'on
 * voyait : **des bulles de jours et des textes superposés**.
 *
 * Ici, chaque libellé est posé à `gauche = colonne × (11 + 3)` dans une
 * rangée de largeur connue, et **borné** à la largeur de sa période : il
 * ne peut donc ni dériver, ni empiéter sur le libellé voisin. La grille,
 * elle, reste un `flex` de colonnes de 11 px — la source de vérité de la
 * géométrie, que l'en-tête ne fait que recopier.
 */

const CELL = 11; // côté d'une case
const GAP = 3; // gouttière entre deux cases
const STEP = CELL + GAP; // pas d'une colonne
const WEEKDAY_COL = 9; // largeur de la colonne des initiales
const WEEKDAY_MARGIN = 6; // marge entre les initiales et la grille
/** Décalage de l'en-tête : sa grille commence après les noms de jours. */
const HEADER_OFFSET = WEEKDAY_COL + WEEKDAY_MARGIN + GAP;

const LEVEL_CLASS = [
  "bg-surface-3 border-line",
  "bg-signal/25 border-signal/30",
  "bg-signal/45 border-signal/45",
  "bg-signal/70 border-signal/70",
  "bg-signal border-signal",
] as const;

const WEEKDAY = ["L", "M", "M", "J", "V", "S", "D"];

const MONTHS = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];

function monthLabel(day: string): string {
  const [, m] = day.split("-").map(Number);
  return MONTHS[m - 1];
}

export function ContributionMap({
  activeDays,
  weeks = 15,
}: {
  activeDays: string[];
  weeks?: number;
}) {
  const today = todayKey();
  const [hover, setHover] = useState<HeatCell | null>(null);

  const { cells, counts } = useMemo(
    () => heatmap(activeDays, today, weeks),
    [activeDays, today, weeks],
  );

  const active = counts.size;
  const longest = useMemo(() => {
    let best = 0;
    let run = 0;
    const sorted = [...activeDays].sort();
    for (let i = 0; i < sorted.length; i++) {
      // `dayDiff` compare des clés de jour en UTC : l'écart brut en
      // millisecondes se casse au passage à l'heure d'été, pas celle-ci.
      run = i > 0 && dayDiff(sorted[i], sorted[i - 1]) === 1 ? run + 1 : 1;
      if (run > best) best = run;
    }
    return best;
  }, [activeDays]);

  // Une étiquette par mois, avec la **largeur de sa période** : le libellé
  // ne peut donc pas dépasser sur le mois suivant, et l'absence de voisin
  // immédiat est garantie par construction (deux mois ne commencent jamais
  // dans deux colonnes adjacentes).
  const monthSpans = useMemo(() => {
    const spans: { col: number; span: number; label: string }[] = [];
    cells.forEach((column, i) => {
      const key = column[0].day.slice(0, 7);
      const prev = i > 0 ? cells[i - 1][0].day.slice(0, 7) : null;
      if (key !== prev) {
        spans.push({ col: i, span: 1, label: monthLabel(column[0].day) });
      } else if (spans.length > 0) {
        spans[spans.length - 1].span += 1;
      }
    });
    return spans;
  }, [cells]);

  const gridWidth = cells.length * CELL + (cells.length - 1) * GAP;

  return (
    <div className="rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="prompt-label text-chalk-2">Carte d&apos;activité</h3>
        <span className="label-micro text-chalk-3">{weeks} semaines</span>
      </header>

      <div className="mb-3 flex gap-4">
        <div>
          <div className="tnum font-display text-[1.1rem] font-bold leading-none">
            {active}
          </div>
          <div className="label-micro mt-1 text-chalk-3">Jours actifs</div>
        </div>
        <div>
          <div className="tnum font-display text-[1.1rem] font-bold leading-none">
            {longest}
          </div>
          <div className="label-micro mt-1 text-chalk-3">Plus longue série</div>
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="inline-block">
          {/* Rangée des mois : largeur connue, libellés positionnés sur la
              colonne de leur premier jour et bornés à leur période. */}
          <div
            aria-hidden="true"
            className="relative mb-1.5 h-[13px]"
            style={{ width: gridWidth, marginLeft: HEADER_OFFSET }}
          >
            {monthSpans.map((s) => (
              <span
                key={`${s.col}-${s.label}`}
                className="label-micro absolute top-0 overflow-hidden whitespace-nowrap
                  text-12 leading-[13px] text-chalk-4"
                style={{ left: s.col * STEP, maxWidth: s.span * STEP - GAP }}
              >
                {s.label}
              </span>
            ))}
          </div>

          <div className="flex gap-[3px]">
            {/* Colonne des jours de la semaine */}
            <div className="mr-[6px] flex flex-col gap-[3px]">
              {WEEKDAY.map((d, i) => (
                <span
                  key={i}
                  className="label-micro flex h-[11px] w-[9px] items-center text-chalk-4"
                >
                  {i % 2 === 0 ? d : ""}
                </span>
              ))}
            </div>

            {cells.map((column, i) => (
              <div key={i} className="flex flex-col gap-[3px]">
                {column.map((cell) => {
                  const isToday = cell.day === today;
                  return (
                    <button
                      key={cell.day}
                      type="button"
                      aria-label={`${cell.day} — ${cell.count} action${cell.count > 1 ? "s" : ""}`}
                      onMouseEnter={() => setHover(cell)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(cell)}
                      onBlur={() => setHover(null)}
                      className={`relative h-[11px] w-[11px] border transition-transform
                        duration-(--d-fast) hover:z-10 hover:scale-110 hover:border-line-3
                        ${LEVEL_CLASS[cell.level]}
                        ${cell.future ? "opacity-30" : ""}
                        ${isToday ? "ring-1 ring-signal-d/70" : ""}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="mt-2.5 flex items-center justify-between gap-2">
        <span className="label-micro h-[14px] min-w-0 flex-1 truncate text-chalk-3">
          {hover
            ? `${new Date(`${hover.day}T00:00:00`).toLocaleDateString("fr", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })} — ${hover.count} action${hover.count > 1 ? "s" : ""}`
            : "Chaque case est un jour de ta vie"}
        </span>
        <span className="flex shrink-0 items-center gap-[3px]">
          <span className="label-micro mr-1 text-chalk-4">moins</span>
          {LEVEL_CLASS.map((c, i) => (
            <span key={i} className={`h-[9px] w-[9px] border ${c}`} />
          ))}
          <span className="label-micro ml-1 text-chalk-4">plus</span>
        </span>
      </footer>
    </div>
  );
}

/**
 * Version compacte pour le profil public : une seule ligne des quatorze
 * derniers jours. Assez pour dire « cette personne est active », pas assez
 * pour transformer une fiche en tableau de bord.
 */
export function ContributionStrip({ activeDays }: { activeDays: string[] }) {
  const today = todayKey();
  // `heatmap` compte en **semaines**, pas en jours : `weeks=14` produisait
  // 98 cases étalées sur une seule ligne, alors que le bloc annonce
  // « 14 derniers jours ». On lit trois semaines puis on garde les
  // quatorze derniers jours révolus, aujourd'hui compris.
  const { cells } = useMemo(() => heatmap(activeDays, today, 3), [activeDays, today]);
  const days = useMemo(
    () => cells.flat().filter((c) => !c.future).slice(-14),
    [cells],
  );

  return (
    <div className="flex gap-[3px]">
      {days.map((c) => (
        <span
          key={c.day}
          className={`h-[9px] w-[9px] border ${LEVEL_CLASS[c.level]}`}
        />
      ))}
    </div>
  );
}
