"use client";

import { useMemo, useState } from "react";
import { ContributionMap } from "./ContributionMap";
import { Icon, asIconName } from "./Icon";
import { Avatar, Loading } from "./Avatar";
import { LEVELS, type ProgressStats } from "@/lib/gamification";
import type { LeaderEntry } from "@/lib/progress";
import { perksForXp } from "@/lib/perks";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { badgeFor } from "@/lib/verification";
import { timeAgo } from "@/lib/utils";

/**
 * Panneau de progression — score, palier, série, quêtes, badges.
 *
 * Ordre de lecture choisi : ce qui est *acquis* d'abord (palier, score,
 * série), ce qui est *à faire* ensuite (quêtes), ce qui est *mémoire*
 * ensuite (carte d'activité, badges, journal). L'utilisateur descend la
 * page dans l'ordre où il se pose les questions.
 */

export function ProgressPanel({
  stats,
  loading,
  leaderboard,
}: {
  stats: ProgressStats | null;
  loading: boolean;
  leaderboard: LeaderEntry[];
}) {
  if (loading || !stats) return <Loading label="Calcul de la progression" />;

  return (
    <div className="mo-slide space-y-3">
      <LevelCard stats={stats} />
      <PerksCard stats={stats} />
      <StreakCard stats={stats} />
      <ContributionMap activeDays={stats.activeDays} />
      <BadgeCard stats={stats} />
      <LeaderboardCard rows={leaderboard} />
      <JournalCard stats={stats} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Palier                                                              */
/* ------------------------------------------------------------------ */

function LevelCard({ stats }: { stats: ProgressStats }) {
  const { level } = stats;
  const pct = Math.round(level.progress * 100);

  return (
    <section className="relative overflow-hidden rounded-(--radius-card) border
      border-level/35 bg-surface-2 p-4 text-chalk shadow-sh-2">
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="prompt-label mb-2 text-chalk-4">
            palier {level.level} / {LEVELS.length}
          </div>
          <h2 className="font-display text-[1.6rem] font-bold leading-none
            tracking-[-0.02em]">
            {level.title}
          </h2>
        </div>

        <div className="shrink-0 text-right">
          <div className="tnum font-display text-[2.1rem] font-bold leading-none text-level"
          >
            {stats.xp}
          </div>
          <div className="label-micro mt-1 text-chalk/70">points</div>
        </div>
      </div>

      {/* Barre de progression vers le palier suivant.
          La clay est filled, le reste est une trame — l'inverse d'un
          badge, où c'est le fond qui porte la couleur. */}
      <div className="relative mt-4">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="label-micro text-chalk/70">
            {level.next ? `Vers ${level.next.title}` : "Palier maximum"}
          </span>
          <span className="tnum label-micro text-chalk/70">
            {level.next ? `${level.toNext} pts restants` : `${pct}%`}
          </span>
        </div>
        <div className="h-[10px] w-full border border-line-2/30 bg-void/10">
          <div
            className="mo-grow h-full bg-gradient-to-r from-level to-ok transition-[width] duration-500"
            style={{
              width: `${pct}%`,
              backgroundSize: "200% 100%",
              animation: "bannerShift 3s ease-in-out infinite",
            }}
          />
        </div>
      </div>

      <dl className="relative mt-4 grid grid-cols-4 gap-2 border-t border-line-2/15 pt-3">
        {[
          ["Posts", stats.posts],
          ["Code", stats.codePosts],
          ["Groupes", stats.groupMessages],
          ["Likes", stats.likes],
        ].map(([label, value]) => (
          <div key={label as string}>
            <dd className="tnum font-display text-[1.15rem] font-bold leading-none">
              {value as number}
            </dd>
            <dt className="label-micro mt-1 text-chalk/60">{label as string}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Série                                                               */
/* ------------------------------------------------------------------ */

function StreakCard({ stats }: { stats: ProgressStats }) {
  const { streak } = stats;
  const freezesLeft = streak.freezes - streak.freezesUsed;

  return (
    <section className="rounded-(--radius-card) border border-line-3 bg-surface p-4 depth-card">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`flex size-[42px] items-center justify-center border
            ${streak.current > 0 ? "border-signal bg-signal/12 text-signal" : "border-line-2 text-chalk-4"}`}>
            <Icon name="flame" size={20} strokeWidth={1.8}
              fill={streak.current > 0 ? "currentColor" : "none"} />
          </span>
          <div>
            <div className="tnum font-display text-[1.35rem] font-bold leading-none">
              {streak.current} jour{streak.current > 1 ? "s" : ""}
            </div>
            <div className="label-micro mt-1 text-chalk-3">Série en cours</div>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="text-right">
            <div className="tnum font-display text-[1.05rem] font-bold leading-none">
              {streak.best}
            </div>
            <div className="label-micro mt-1 text-chalk-3">Record</div>
          </div>
          <div className="text-right">
            <div className="tnum font-display text-[1.05rem] font-bold leading-none
              text-signal">
              {freezesLeft}
            </div>
            <div className="label-micro mt-1 text-chalk-3">Gels</div>
          </div>
        </div>
      </header>

      <p className="mb-3 text-sm leading-[1.55] text-chalk-2 outline">
        {streak.activeToday ? (
          <><strong className="text-chalk">Série sécurisée.</strong> Reviens demain
            pour la prolonger.</>
        ) : streak.atRisk ? (
          <><strong className="text-danger">Série en sursis.</strong> Une seule
            action aujourd&apos;hui la relance.</>
        ) : streak.freezes > 0 ? (
          <>Série rompue. {streak.freezes} gel{streak.freezes > 1 ? "s" : ""}
            en réserve.</>
        ) : (
          <>Série rompue.</>
        )}
      </p>

      <div className="flex gap-[3px]">
        {lastDays(stats.activeDays).map((d) => (
          <span
            key={d.day}
            title={d.label}
            className={`h-[22px] flex-1 border ${
              d.active
                ? "border-signal bg-signal"
                : d.frozen
                  ? "border-signal/50 bg-signal/20"
                  : "border-line bg-surface-2"
            }`}
          />
        ))}
      </div>
    </section>
  );
}

/** Les sept derniers jours, du plus ancien au plus récent. */
function lastDays(activeDays: string[]): { day: string; active: boolean; frozen: boolean; label: string }[] {
  const set = new Set(activeDays);
  const today = new Date();
  const out: { day: string; active: boolean; frozen: boolean; label: string }[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
    const active = set.has(key);
    out.push({
      day: key,
      active,
      frozen: !active && i < 6 && set.has(keyOfOffset(d, -1)),
      label: d.toLocaleDateString("fr", { weekday: "short", day: "numeric" }),
    });
  }
  return out;
}

function keyOfOffset(d: Date, n: number): string {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return `${c.getFullYear()}-${`${c.getMonth() + 1}`.padStart(2, "0")}-${`${c.getDate()}`.padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

function BadgeCard({ stats }: { stats: ProgressStats }) {
  const { badges } = stats;
  const earned = badges.filter((b) => b.earned);
  const [selectedId, setSelectedId] = useState<string | null>(badges[0]?.id ?? null);
  const selected = badges.find((b) => b.id === selectedId) ?? null;

  return (
    <section className="rounded-(--radius-card) border border-line-3 bg-surface p-4 depth-card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="prompt-label text-chalk-2">Collection</h3>
          <p className="mt-1 text-[11px] leading-snug text-chalk-4">
            Clique sur une pièce pour voir comment on l&apos;obtient.
          </p>
        </div>
        <span className="tnum shrink-0 font-mono text-[11px] leading-tight text-chalk-3">
          {earned.length} / {badges.length}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {badges.map((b) => (
          <button
            key={b.id}
            type="button"
            aria-pressed={selectedId === b.id}
            onClick={() => setSelectedId((prev) => (prev === b.id ? null : b.id))}
            title={b.earned ? `${b.label} — ${b.hint}` : `${b.hint} (${b.progress}/${b.target})`}
            className={`flex flex-col items-center gap-1.5 border-(--bw-thin) px-1.5 py-2.5 text-center
              ${b.earned ? "border-line-3 bg-surface-2" : "border-line bg-surface-2/40"}
              ${selectedId === b.id ? "ring-1 ring-signal/60" : ""}`}
          >
            <span className={`flex size-[34px] items-center justify-center border
              ${b.earned ? "earn-box border-transparent" : "border-line-2 text-chalk-4"}`}>
              <Icon name={b.icon} size={16} strokeWidth={b.earned ? 2.2 : 1.9} />
            </span>
            <span className={`label-micro leading-[1.25] ${b.earned ? "text-chalk" : "text-chalk-4"}`}>
              {b.label}
            </span>
            {!b.earned && b.progress > 0 && (
              <span className="h-[3px] w-full overflow-hidden rounded-full bg-line">
                <span
                  className="block h-full rounded-full bg-signal"
                  style={{ width: `${Math.round((b.progress / b.target) * 100)}%` }}
                />
              </span>
            )}
          </button>
        ))}
      </div>

      {selected && (
        <div
          aria-live="polite"
          className="mt-3 rounded-(--radius-card) border border-line-2 bg-surface-2 p-3 text-[11.5px] leading-snug text-chalk-3"
        >
          <div className="mb-1.5 flex items-center gap-1.5">
            <Icon name={selected.icon} size={12} strokeWidth={2}
              className={selected.earned ? "text-signal" : "text-chalk-4"} />
            <span className="font-bold text-chalk">{selected.label}</span>
            <span className={`label-micro ml-auto ${selected.earned ? "text-ok" : "text-chalk-4"}`}>
              {selected.earned ? "obtenu" : `${selected.progress}/${selected.target}`}
            </span>
          </div>

          <p>{badgeStory(selected)}</p>

          {/* La règle d'obtention, en clair : c'est la question qu'on se
              pose devant une pièce qu'on n'a pas encore. */}
          <p className="mt-1.5 text-chalk-4">
            <span className="font-semibold text-chalk-3">Objectif :</span>{" "}
            {selected.hint.toLowerCase()}.
          </p>
        </div>
      )}
    </section>
  );
}

function badgeStory(b: { id: string; earned: boolean; hint: string; progress: number; target: number; label: string }) {
  const base = {
    "first-post": "Tu l'as obtenu en publiant ton premier post, ce qui marque le début de ton activité visible dans le fil.",
    "code-singer": "Tu l'as obtenu en publiant plusieurs posts avec du code, ce qui démontre que tu partages aussi ta pratique.",
    "streak-3": "Tu l'as obtenu en restant actif pendant trois jours d'affilée, sans perdre le rythme.",
    "streak-7": "Tu l'as obtenu en faisant preuve de régularité sur une semaine complète d'activité.",
    "streak-30": "Tu l'as obtenu avec une série longue, ce qui montre une présence soutenue dans la communauté.",
    "helper": "Tu l'as obtenu en répondant à des personnes dans les groupes et en aidant la discussion avancer.",
    "magnetic": "Tu l'as obtenu en recevant beaucoup de likes, c'est-à-dire en créant des contributions qui intéressent les autres.",
    "nocturnal": "Tu l'as obtenu en contribuant de nuit, quand la plupart des gens sont à l'arrêt.",
    "polyglot": "Tu l'as obtenu en déclarant plusieurs langages, ce qui montre une base technique plus large.",
    "identity": "Tu l'as obtenu en remplissant ta bio, ce qui rend ton profil plus lisible et plus crédible.",
    "architect": "Tu l'as obtenu en atteignant un palier élevé de progression, signe que ton niveau de contribution est solide.",
  } as const;

  const message = base[b.id as keyof typeof base] ?? `Tu peux l'obtenir en ${b.hint.toLowerCase()}.`;
  if (b.earned) return `${message} C'est la preuve que tu as bien franchi le seuil.`;
  return `${message} Tu en es à ${b.progress}/${b.target}, et le badge se débloque dès que tu franchis la cible.`;
}

/* ------------------------------------------------------------------ */
/* Classement                                                          */
/* ------------------------------------------------------------------ */

function LeaderboardCard({ rows }: { rows: LeaderEntry[] }) {
  return (
    <section className="rounded-(--radius-card) border border-line-3 bg-surface p-4 depth-card">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="prompt-label text-chalk-2">Top de la semaine</h3>
        <span className="label-micro text-chalk-3">7 derniers jours</span>
      </header>

      {rows.length === 0 ? (
        <p className="py-2 text-sm text-chalk-3">
          Personne n&apos;a publié cette semaine.
        </p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id}
              className={`flex items-center gap-3 border-b border-line py-2 last:border-0
                ${r.me ? "-mx-2 bg-signal/8 px-2" : ""}`}>
              <span className={`label-micro w-[16px] ${r.rank <= 3 ? "text-signal" : "text-chalk-4"}`}>
                {r.rank}
              </span>

              <Avatar
                name={r.prenom}
                color={r.avatarColor}
                className="size-[26px] border-(--bw-thin) text-[11px]"
              />

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate text-[13px] font-bold">
                  {r.me ? "Toi" : r.prenom}
                  {r.verified && (
                    <VerifiedBadge
                      tier={badgeFor({ verified: r.verified, is_admin: r.isAdmin }, r.totalXp)}
                      size="sm"
                    />
                  )}
                </span>
                <span className="label-micro block truncate text-chalk-4">@{r.pseudo}</span>
              </span>

              {r.rank === 1 && (
                <Icon name="trophy" size={12} strokeWidth={2} className="text-signal" />
              )}

              <span className="tnum label-micro shrink-0 text-chalk-3">{r.xp} pts</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Journal                                                             */
/* ------------------------------------------------------------------ */

function JournalCard({ stats }: { stats: ProgressStats }) {
  const recent = useMemo(() => [...stats.events].reverse().slice(0, 12), [stats.events]);

  if (recent.length === 0) {
    return (
      <section className="rounded-(--radius-card) border border-line-3 bg-surface p-4 depth-card">
        <h3 className="label mb-2 text-chalk">Journal</h3>
        <p className="text-sm text-chalk-3">
          Ton journal est vide.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-(--radius-card) border border-line-3 bg-surface p-4 depth-card">
      <header className="mb-2.5 flex items-baseline justify-between">
        <h3 className="prompt-label text-chalk-2">Journal</h3>
        <span className="label-micro text-chalk-3">{stats.events.length} actions</span>
      </header>

      <ul>
        {recent.map((e, i) => (
          <li key={`${e.at}-${i}`}
            className="flex items-center gap-2.5 border-b border-line py-2 last:border-0">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{e.label}</span>
              <span className="label-micro text-chalk-4">{timeAgo(e.at)}</span>
            </span>
            <span className="tnum label-micro shrink-0 text-signal">+{e.points}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Privilèges                                                        */
/* ------------------------------------------------------------------ */

function PerksCard({ stats }: { stats: ProgressStats }) {
  const { level, unlocked, next } = perksForXp(stats.xp);
  return (
    <section className="relative overflow-hidden rounded-(--radius-card) border border-signal/30 bg-surface-2 p-4 shadow-sh-2">
      <div className="relative mb-2 flex items-center justify-between">
        <h3 className="label text-chalk">Privilèges débloqués</h3>
        <span className="rounded-full border border-signal/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-signal">
          palier {level}
        </span>
      </div>
      <div className="relative grid gap-2 sm:grid-cols-2">
        {unlocked.map((p) => (
          <div key={p.id} className="flex items-start gap-2.5 rounded-(--radius-panel) border border-line-3 bg-surface p-2.5">
            <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-signal/40 bg-signal/10 text-signal">
              <Icon name={asIconName(p.icon, "package")} size={14} />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-chalk">{p.title}</div>
              <div className="text-[11.5px] text-chalk-3">{p.description}</div>
            </div>
          </div>
        ))}
      </div>
      {next && (
        <div className="relative mt-2 flex items-center gap-2 rounded-(--radius-panel) border border-line-3 bg-surface p-2.5 opacity-80">
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-line-3 bg-surface-3 text-chalk-3">
            <Icon name={asIconName(next.icon, "target")} size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-chalk">À venir · {next.title} (palier {next.level})</div>
            <div className="text-[11.5px] text-chalk-3">{next.description}</div>
          </div>
        </div>
      )}
    </section>
  );
}
