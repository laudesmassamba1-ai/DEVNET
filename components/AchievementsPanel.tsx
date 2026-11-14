"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import {
  achievementScore, achievementsFor, nextAchievement, tierLabel,
  type AchievementCounters,
} from "@/lib/achievements";

/**
 * Les succès d'un profil.
 *
 * L'écran suit une règle de lisibilité : les succès **or** d'abord — la
 * maîtrise —, puis les autres, ordonnés par avancement. Un seul « à
 * venir » est mis en avant : dix barres de progression concurrentes ne
 * motivent plus rien, un seul prochain palier si.
 *
 * Le moteur fait le calcul ; ce composant reçoit juste des compteurs
 * agrégés (commits, forks, reviews, ratings…), identiques à ceux que
 * `showOf` de l'historique produit ailleurs.
 */
export function AchievementsPanel({ counters }: { counters: AchievementCounters }) {
  const list = useMemo(() => achievementsFor(counters), [counters]);
  const score = useMemo(() => achievementScore(list), [list]);
  const gold = list.filter((a) => a.tier === "or");
  const rest = [...list.filter((a) => a.tier !== "or")].sort((a, b) => b.progress - a.progress);
  const next = nextAchievement(list);
  const earnedCount = list.filter((a) => a.tierLevel > 0).length;
  const [selectedId, setSelectedId] = useState<string | null>(gold[0]?.id ?? rest[0]?.id ?? null);
  const selected = list.find((a) => a.id === selectedId) ?? null;

  return (
    <section className="rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="label flex items-center gap-1.5 text-chalk-3">
            <Icon name="trophy" size={12} strokeWidth={1.8} />
            Succès
          </h3>
          <p className="mt-1 text-12 leading-snug text-chalk-4">
            Clique sur un succès pour voir comment on l&apos;obtient.
          </p>
        </div>
        <span className="tnum shrink-0 text-right font-mono text-12 leading-tight text-signal">
          {score} pts
          <span className="mt-0.5 block text-12 text-chalk-4">
            {earnedCount}/{list.length} commencés
          </span>
        </span>
      </div>

      {gold.length > 0 && (
        <ul className="mb-3 space-y-2">
          {gold.map((a) => (
            <AchievementRow key={a.id} a={a} selected={selectedId === a.id} onSelect={() => setSelectedId((prev) => prev === a.id ? null : a.id)} />
          ))}
        </ul>
      )}

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rest.map((a) => (
          <AchievementRow key={a.id} a={a} selected={selectedId === a.id} onSelect={() => setSelectedId((prev) => prev === a.id ? null : a.id)} />
        ))}
      </ul>

      {selected && (
        <div
          aria-live="polite"
          className="mt-3 rounded-(--radius-card) border border-line-2 bg-surface-2 p-3 text-12 leading-snug text-chalk-3"
        >
          <div className="mb-1.5 flex items-center gap-1.5">
            <Icon name={selected.icon} size={12} strokeWidth={2} className="text-signal" />
            <span className="font-bold text-chalk">{selected.label}</span>
            {selected.tier && (
              <span className="label-micro ml-auto text-signal">
                {tierLabel(selected.tier)}
              </span>
            )}
          </div>

          <p>{achievementStory(selected)}</p>

          {/* La règle, écrite noir sur blanc : ce qu'il faut faire, et où
              l'on en est. C'est ce qu'on vient chercher en cliquant. */}
          <p className="mt-1.5 text-chalk-4">
            <span className="font-semibold text-chalk-3">Objectif :</span>{" "}
            {selected.hint.toLowerCase()} —{" "}
            <span className="tnum">
              {selected.tier === "or"
                ? "palier maximum atteint"
                : `prochain palier à ${selected.nextTarget}`}
            </span>
            .
          </p>

          <ul className="mt-2 flex flex-wrap gap-1.5">
            {(["bronze", "argent", "or"] as const).map((tier, i) => {
              const reached = selected.tiersEarned.includes(tier);
              return (
                <li
                  key={tier}
                  className={`rounded-(--radius-chip) border px-1.5 py-0.5 font-mono
                    text-12 uppercase tracking-[0.08em]
                    ${reached
                      ? "border-signal/60 bg-signal/12 text-signal"
                      : "border-line-2 text-chalk-4"}`}
                >
                  {tierLabel(tier)} · {selected.tiers[i]}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {next && (
        <p className="mt-3 border-t border-line-2 pt-2.5 text-12 leading-snug text-chalk-3">
          <span className="font-bold text-signal">Prochain :</span>{" "}
          {next.label} — {Math.round(next.progress * 100)} % vers le palier suivant.
        </p>
      )}
    </section>
  );
}

function achievementStory(a: ReturnType<typeof achievementsFor>[number]) {
  const base = {
    "a-artisan": "Tu l'as obtenu en poussant des commits réguliers sur tes projets et en laissant une trace exploitable dans le code.",
    "a-efficiency": "Tu l'as obtenu en forkant des projets pour t'en servir de base ou de point de départ pour ta propre idée.",
    "a-heritage": "Tu l'as obtenu quand d'autres développeurs ont forké tes projets, ce qui signifie que ton code a été réutilisé et étendu.",
    "a-review": "Tu l'as obtenu en relisant et en corrigeant le travail des autres, en laissant des retours utiles et précis.",
    "a-jury": "Tu l'as obtenu en notant honnêtement les projets de la communauté et en donnant un avis de qualité.",
    "a-outils": "Tu l'as obtenu en publiant des extraits de code réutilisables et utiles pour les autres.",
    "a-construction": "Tu l'as obtenu en lançant et en faisant vivre un ou plusieurs projets de bout en bout.",
    "a-magnet": "Tu l'as obtenu grâce aux likes reçus sur tes contributions, qui prouvent que ton travail est remarqué.",
    "a-endurance": "Tu l'as obtenu en maintenant une série d'activité longue et régulière, sans perdre le rythme.",
    "a-polyglotte": "Tu l'as obtenu en codant dans plusieurs langages, ce qui montre une base technique plus large.",
    "a-regulier": "Tu l'as obtenu en terminant plusieurs défis quotidiens de façon régulière, petit à petit.",
  } as const;

  const message = base[a.id as keyof typeof base] ?? `Tu peux l'obtenir en ${a.hint.toLowerCase()}.`;
  if (a.tier) return `${message} Le niveau atteint montre que tu l'as validé de façon répétée.`;
  return `Tu peux le débloquer en ${a.hint.toLowerCase()} — le score augmente au fur et à mesure de ta progression.`;
}

function AchievementRow({
  a,
  selected,
  onSelect,
}: {
  a: ReturnType<typeof achievementsFor>[number];
  selected: boolean;
  onSelect: () => void;
}) {
  const tone =
    a.tier === "or" ? "text-signal" : a.tier === "argent" ? "text-chalk" : "text-chalk-2";
  const pct = Math.round(a.progress * 100);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-(--radius-chip) border px-3 py-2 text-left ${
        a.tier === "or" ? "border-signal bg-signal/8" : "border-line-2 bg-surface-2"
      } ${selected ? "ring-1 ring-signal/60" : ""}`}
    >
      <div className="flex items-center gap-2">
        <Icon
          name={a.icon}
          size={14}
          strokeWidth={2}
          className={a.tier === "or" ? "text-signal" : "text-chalk-3"}
        />
        <span className={`text-sm font-bold ${tone}`}>{a.label}</span>
        {a.tier && (
          <span className="font-mono text-12 uppercase tracking-wider text-signal/70">
            {a.tier}
          </span>
        )}
        <span className="tnum ml-auto font-mono text-12 text-chalk-4">
          {pct}%
        </span>
      </div>
      {pct < 100 && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
          <div className="mo-grow h-full bg-signal/60" style={{ width: `${pct}%` }} />
        </div>
      )}
    </button>
  );
}
