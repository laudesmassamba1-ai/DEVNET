"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loading } from "@/components/Avatar";
import { Icon, type IconName } from "@/components/Icon";
import { buildPostActivitySeries, type ActivityRecord, type ActivityWeek } from "@/lib/admin-activity";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/lib/supabase/client";

type Metric = { value: number | null; error: string | null };
type Overview = {
  profiles: Metric;
  posts: Metric;
  projects: Metric;
  activity: ActivityWeek[];
  activityError: string | null;
  activitySampled: boolean;
  checkedAt: Date;
};

const WEEK_COUNT = 8;
const MAX_ACTIVITY_ROWS = 1000;

function unavailable(error: string): Metric {
  return { value: null, error };
}

async function loadOverview(): Promise<Overview> {
  const [profiles, posts, projects] = await Promise.all([
    supabase.from("users").select("id", { count: "exact", head: true }),
    supabase.from("posts").select("id", { count: "exact", head: true }),
    supabase.from("projects").select("id", { count: "exact", head: true }),
  ]);
  const rangeStart = new Date();
  const daysSinceMonday = (rangeStart.getUTCDay() + 6) % 7;
  rangeStart.setUTCDate(rangeStart.getUTCDate() - daysSinceMonday - (WEEK_COUNT - 1) * 7);
  rangeStart.setUTCHours(0, 0, 0, 0);

  const activity = await supabase
    .from("posts")
    .select("created_at", { count: "exact" })
    .gte("created_at", rangeStart.toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_ACTIVITY_ROWS);

  return {
    profiles: profiles.error
      ? unavailable("Nombre de profils indisponible.")
      : { value: profiles.count, error: null },
    posts: posts.error
      ? unavailable("Nombre de publications indisponible.")
      : { value: posts.count, error: null },
    projects: projects.error
      ? unavailable("Nombre de projets indisponible.")
      : { value: projects.count, error: null },
    activity: activity.data
      ? buildPostActivitySeries(activity.data as ActivityRecord[])
      : [],
    activityError: activity.error ? "La série des publications est indisponible." : null,
    activitySampled: (activity.count ?? 0) > MAX_ACTIVITY_ROWS,
    checkedAt: new Date(),
  };
}

function MetricBlock({
  label,
  metric,
}: {
  label: string;
  metric: Metric;
}) {
  return (
    <div className="min-w-0 border-l border-line-2 pl-3 first:border-l-0 first:pl-0">
      <dt className="text-[12px] text-chalk-4">{label}</dt>
      <dd className="mt-1 font-mono text-[22px] font-semibold tabular-nums text-chalk">
        {metric.value === null ? "—" : metric.value.toLocaleString("fr-FR")}
      </dd>
      {metric.error && <p className="mt-1 text-[11px] text-warn">{metric.error}</p>}
    </div>
  );
}

function ActivityChart({
  weeks,
  sampled,
}: {
  weeks: ActivityWeek[];
  sampled: boolean;
}) {
  const maxCount = Math.max(1, ...weeks.map((week) => week.count));
  const chartTop = 18;
  const chartBottom = 154;
  const chartHeight = chartBottom - chartTop;
  const columnWidth = 720 / Math.max(weeks.length, 1);

  return (
    <div>
      <svg
        className="admin-activity-chart w-full overflow-visible"
        viewBox="0 0 720 194"
        role="img"
        aria-label={`Publications par semaine sur ${weeks.length} semaines`}
      >
        {[0, 1, 2, 3].map((line) => {
          const y = chartTop + (chartHeight / 3) * line;
          return (
            <line
              key={line}
              x1="0"
              x2="720"
              y1={y}
              y2={y}
              stroke="var(--color-line-2)"
              strokeDasharray={line === 3 ? undefined : "2 6"}
              strokeWidth="1"
            />
          );
        })}
        {weeks.map((week, index) => {
          const barHeight = (week.count / maxCount) * chartHeight;
          const x = index * columnWidth + columnWidth * 0.3;
          const width = columnWidth * 0.4;
          return (
            <g key={week.start}>
              <title>{`${week.label} : ${week.count} publication${week.count === 1 ? "" : "s"}`}</title>
              <rect
                className="admin-activity-chart__bar"
                x={x}
                y={chartBottom - Math.max(barHeight, week.count ? 3 : 0)}
                width={width}
                height={Math.max(barHeight, week.count ? 3 : 0)}
                rx="2"
                fill="var(--color-signal)"
                style={{ animationDelay: `${index * 18}ms` }}
              />
              <text
                x={index * columnWidth + columnWidth / 2}
                y="178"
                textAnchor="middle"
                fill="var(--color-chalk-4)"
                fontSize="11"
              >
                {week.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-2 text-[11px] text-chalk-4">
        <span className="size-2 rounded-sm bg-signal" aria-hidden="true" />
        Publications créées
        {sampled && <span>· échantillon limité aux 1 000 plus récentes</span>}
      </div>
    </div>
  );
}

export function AdminOverview() {
  const { profile } = useSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await loadOverview());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Le tableau de bord est indisponible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profile?.is_admin) return;
    let active = true;
    loadOverview()
      .then((result) => {
        if (!active) return;
        setOverview(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Le tableau de bord est indisponible.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [profile?.is_admin]);

  if (!profile?.is_admin) return null;
  const shortcuts = [
    ["Comptes", "/admin", "profile"],
    ["Radar", "/admin/radar", "target"],
    ["Paramètres", "/admin/settings", "settings"],
  ] as const satisfies readonly [string, string, IconName][];

  return (
    <section className="border-b border-line-2" aria-labelledby="admin-overview-title">
      <div className="flex flex-wrap items-end justify-between gap-3 px-(--gutter) py-5">
        <div>
          <p className="font-mono text-[11px] text-chalk-4">TABLEAU DE BORD</p>
          <h2
            id="admin-overview-title"
            className="mt-1 font-display text-[22px] font-semibold tracking-[-0.03em] text-chalk"
          >
            Activité du réseau
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex min-h-[var(--h-tap)] items-center gap-2 rounded-[var(--radius-input)]
            border border-line-2 px-3 text-[12px] text-chalk-3 hover:bg-surface-2
            disabled:opacity-60"
        >
          <Icon name="chart" size={14} />
          {loading ? "Actualisation…" : "Actualiser"}
        </button>
      </div>

      {error && (
        <div role="alert" className="mx-(--gutter) mb-4 border-l-2 border-danger px-3 py-2">
          <p className="text-[13px] text-danger">{error}</p>
          <button type="button" className="mt-2 text-[12px] font-semibold text-signal" onClick={() => void refresh()}>
            Réessayer
          </button>
        </div>
      )}

      {loading && !overview ? (
        <div className="px-(--gutter) pb-5"><Loading label="Lecture des indicateurs" /></div>
      ) : overview ? (
        <>
          <dl className="grid grid-cols-3 gap-3 px-(--gutter) pb-5">
            <MetricBlock label="Profils" metric={overview.profiles} />
            <MetricBlock label="Publications" metric={overview.posts} />
            <MetricBlock label="Projets" metric={overview.projects} />
          </dl>

          <div className="mx-(--gutter) border-t border-line-2 pt-4 pb-5">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-[15px] font-semibold text-chalk">
                Publications par semaine
              </h3>
              <span className="font-mono text-[10px] text-chalk-4">
                8 semaines · vérifié {overview.checkedAt.toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            {overview.activityError ? (
              <p role="status" className="py-8 text-[13px] text-chalk-3">{overview.activityError}</p>
            ) : (
              <>
                <ActivityChart weeks={overview.activity} sampled={overview.activitySampled} />
                <table className="sr-only">
                  <caption>Nombre de publications par semaine</caption>
                  <thead><tr><th scope="col">Semaine</th><th scope="col">Publications</th></tr></thead>
                  <tbody>
                    {overview.activity.map((week) => (
                      <tr key={week.start}><th scope="row">{week.label}</th><td>{week.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </>
      ) : null}

      <nav aria-label="Raccourcis admin" className="flex flex-wrap gap-2 px-(--gutter) pb-5">
        {shortcuts.map(([label, href, icon]) => (
          <Link
            key={href}
            href={href}
            className="inline-flex min-h-[var(--h-tap)] items-center gap-2 border border-line-2
              px-3 text-[12px] text-chalk-3 transition-colors hover:border-signal hover:text-signal"
          >
            <Icon name={icon} size={14} />
            {label}
          </Link>
        ))}
      </nav>
    </section>
  );
}
