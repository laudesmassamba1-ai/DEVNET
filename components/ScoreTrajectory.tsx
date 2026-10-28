"use client";

import { Icon } from "./Icon";
import { GuideLegend, ScoreCurve, MEDIAN_DASH, MEDIAN_TONE, MEAN_DASH, MEAN_TONE } from "./ScoreCurve";
import { TrendNote } from "./TrendNote";
import { frNumber } from "@/lib/utils";
import type { HistoryStats } from "@/lib/scoring";

/**
 * La **trajectoire des dépôts** d'une personne.
 *
 * ## Ce que cette carte répond, et qu'une moyenne ne répond pas
 *
 * « Score moyen : 720 » dit où en est quelqu'un ; ça ne dit pas s'il écrit
 * mieux qu'avant. Les dépôts sont donc lus **dans l'ordre de leur dernière
 * activité** — le score d'un dépôt décrit l'état de sa dernière révision,
 * donc cet ordre est celui du travail — et la vignette, la moyenne, la
 * médiane et le verdict se lisent sur cette série.
 *
 * ## Pourquoi un verdict, et pas seulement un écart
 *
 * Un écart entre un premier et un dernier dépôt ne prouve rien : entre deux
 * projets, le sujet change, le langage change, l'urgence change. La question
 * honnête n'est donc pas « y a-t-il une différence ? » mais « cette
 * différence dépasse-t-elle ce que la dispersion des projets explique déjà ? »
 * — c'est exactement ce que calcule `historyStats`, et c'est pourquoi le
 * verdict peut être « stable » alors que l'écart n'est pas nul.
 *
 * ## Ce que la carte refuse de faire
 *
 * Elle ne s'affiche **que sur les dépôts analysables** (score > 0), comme la
 * moyenne : un dépôt vide n'est pas une chute, c'est une absence de mesure.
 * Et elle ne s'affiche pas du tout en dessous de deux dépôts — un point n'a
 * pas de trajectoire, et une vignette d'un point serait un dessin qui ne dit
 * rien.
 */
export function ScoreTrajectory({
  series,
  stats,
  title = "trajectoire des dépôts",
}: {
  /** Les scores, du dépôt le plus anciennement actif au plus récent. */
  series: readonly number[];
  /** La lecture de cette série — moyenne, médiane, dispersion, verdict. */
  stats: HistoryStats;
  title?: string;
}) {
  if (series.length < 2) return null;

  const smooth = stats.noise < 0.5;
  const drift = `${stats.delta > 0 ? "+" : ""}${stats.delta}`;
  const rate = `${stats.delta > 0 ? "+" : "−"}${frNumber(Math.abs(stats.slope))}`;
  const movement = `${drift} point(s) entre ton premier et ton dernier dépôt`;

  const explanation =
    stats.trend === "stable"
      ? smooth
        ? `${movement} : c'est trop peu pour dire que le travail change.`
        : `${movement} — et l'écart entre tes dépôts (±${frNumber(stats.noise, 0)} point(s)) suffit à l'expliquer, donc rien ne prouve que le travail change.`
      : smooth
        ? `${movement}, soit ${rate} point(s) par dépôt, sans écart d'un dépôt à l'autre.`
        : `${movement}, soit ${rate} point(s) par dépôt — plus que l'écart entre tes dépôts (±${frNumber(stats.noise, 0)} point(s)).`;

  return (
    <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2 p-4">
      <h3 className="label mb-3 flex items-center justify-between gap-2 text-chalk-3">
        <span className="flex items-center gap-1.5">
          <Icon name="chart" size={12} strokeWidth={1.8} />
          {title}
        </span>
        <span className="tnum shrink-0 text-chalk-4">
          {series.length} dépôt{series.length > 1 ? "s" : ""}
        </span>
      </h3>

      <ScoreCurve
        scores={series}
        label={`Notes de ${series.length} dépôts, de ${stats.min} à ${stats.max}, médiane ${Math.round(stats.median)}`}
        height={26}
        className="h-[52px] w-full text-signal"
      />

      {/* L'axe n'est pas évident : la courbe se lit dans l'ordre de la
          dernière activité, pas dans l'ordre où les projets ont été créés.
          Sans cette phrase, la vignette se lirait comme une chronologie. */}
      <div className="mt-1 flex items-baseline justify-between font-mono text-[10px] text-chalk-4">
        <span className="tnum">{stats.min}</span>
        <span>du dépôt le plus ancien au plus récent</span>
        <span className="tnum">{stats.max}</span>
      </div>

      <div className="mt-2 space-y-1.5 border-t border-line-2/20 pt-2">
        <GuideLegend label="moyenne" value={stats.mean} tone={MEAN_TONE} dash={MEAN_DASH} />
        <GuideLegend label="médiane" value={stats.median} tone={MEDIAN_TONE} dash={MEDIAN_DASH} />
      </div>

      <TrendNote trend={stats.trend} className="mt-2">
        {explanation}
      </TrendNote>
    </section>
  );
}
