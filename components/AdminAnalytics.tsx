"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Analytique — `/admin/analytics`.
 *
 * Le module affichait trois comptes (profils, publications, projets) et
 * une série de publications. Ce ne sont pas des analytics : il manquait
 * la croissance, l'engagement, la rétention et la fraîcheur.
 *
 * Cet écran ne cherche pas à faire joli. Il cherche à ne pas mentir :
 *
 *  - **Chaque chiffre porte sa fenêtre.** Un total sans période ne dit
 *    rien, donc la date de calcul est affichée et les séries couvrent une
 *    fenêtre nommée.
 *  - **Les réserves sont visibles, pas enterrées.** Si 100 % des comptes
 *    viennent d'un import, c'est écrit en haut, pas dans une note de bas
 *    de page. Un tableau de bord qui laisse croire à une croissance est
 *    pire qu'un tableau de bord vide.
 *  - **Une barre à zéro reste une barre.** Les jours sans événement sont
 *    dessinés à zéro, jamais sautés : une courbe qui saute les creux
 *    exagère les pics.
 */

type Daily = { jour: string; count: number };

type Analytics = {
  window: { days: number; computedAt: string };
  totals: {
    users: number;
    posts: number;
    comments: number;
    stories_live: number;
    projects: number;
    follows: number;
    direct_messages: number;
    story_views: number;
    sessions_active: number;
    users_7d: number;
    posts_7d: number;
    users_30d: number;
  };
  series: { signups: Daily[]; posts: Daily[] };
  cohorts: Daily[];
  retention: { cohort: string; size: number; d1: number; d7: number }[];
  topAuthors: { pseudo: string; posts: number }[];
  freshness: {
    newest_user: string | null;
    newest_post: string | null;
    newest_session: string | null;
  };
  caveats: string[];
};

function formatDate(value: string | null): string {
  if (!value) return "jamais";
  return new Date(value).toLocaleString("fr-FR");
}

/** Une barre par jour, hauteur proportionnelle, zéro dessiné comme zéro. */
function Sparkline({ points, label }: { points: Daily[]; label: string }) {
  const max = Math.max(1, ...points.map((point) => point.count));
  return (
    <figure>
      <figcaption className="font-mono text-12 text-chalk-4">{label}</figcaption>
      <div className="mt-1.5 flex h-16 items-end gap-1" role="img" aria-label={label}>
        {points.map((point) => (
          <div
            key={point.jour}
            title={`${point.jour} : ${point.count}`}
            className="flex-1 rounded-t-xs bg-signal/70"
            style={{ height: `${Math.max(2, (point.count / max) * 100)}%` }}
          />
        ))}
      </div>
      <p className="mt-1 flex justify-between font-mono text-12 text-chalk-4 tnum">
        <span>{points[0]?.jour ?? ""}</span>
        <span>max {max}</span>
        <span>{points[points.length - 1]?.jour ?? ""}</span>
      </p>
    </figure>
  );
}

export function AdminAnalytics() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/analytics", { cache: "no-store" });
      const payload = (await res.json()) as Analytics & { error?: string };
      if (!res.ok || !payload.totals) {
        setError(payload.error ?? "Lecture impossible.");
        setData(null);
        return;
      }
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Réseau indisponible.");
      setData(null);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await load();
      if (!alive) return;
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  if (error) {
    return (
      <section className="px-(--gutter) py-5">
        <p role="alert" className="max-w-prose text-13 text-danger">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mo-press mt-3 min-h-(--h-tap) rounded-(--radius-chip)
            border border-line-3 px-4 text-13 text-chalk-2"
        >
          Réessayer
        </button>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="px-(--gutter) py-5">
        <p className="text-13 text-chalk-4">Chargement…</p>
      </section>
    );
  }

  const metrics: { label: string; value: number; hint: string }[] = [
    { label: "Comptes", value: data.totals.users, hint: "total en base" },
    { label: "Actifs 7 j", value: data.totals.users_7d, hint: "sessions ouvertes" },
    { label: "Actifs 30 j", value: data.totals.users_30d, hint: "sessions ouvertes" },
    { label: "Publications", value: data.totals.posts, hint: `${data.totals.posts_7d} sur 7 j` },
    { label: "Commentaires", value: data.totals.comments, hint: "total" },
    { label: "Stories vivantes", value: data.totals.stories_live, hint: "non expirées" },
    { label: "Abonnements", value: data.totals.follows, hint: "liens de suivi" },
    { label: "Messages privés", value: data.totals.direct_messages, hint: "total" },
    { label: "Vues de story", value: data.totals.story_views, hint: "total" },
    { label: "Sessions actives", value: data.totals.sessions_active, hint: "non expirées" },
    { label: "Projets", value: data.totals.projects, hint: "total" },
  ];

  return (
    <div className="divide-y divide-line-2">
      {data.caveats.length > 0 && (
        <section className="px-(--gutter) py-5" aria-labelledby="admin-analytics-caveats">
          <h2
            id="admin-analytics-caveats"
            className="font-display text-display-m font-semibold"
          >
            Ce que ces chiffres ne disent pas
          </h2>
          <ul className="mt-3 max-w-prose space-y-2">
            {data.caveats.map((caveat) => (
              <li
                key={caveat}
                className="border-l-2 border-line-3 pl-3 text-13 leading-relaxed text-chalk-3"
              >
                {caveat}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="px-(--gutter) py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-display-m font-semibold">Volumes</h2>
          <p className="font-mono text-12 text-chalk-4">
            calculé le {formatDate(data.window.computedAt)}
          </p>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <dt className="font-mono text-12 text-chalk-4">{metric.label}</dt>
              <dd className="font-display text-display-m font-semibold tnum">
                {metric.value}
              </dd>
              <dd className="text-12 text-chalk-4">{metric.hint}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="px-(--gutter) py-5">
        <h2 className="font-display text-display-m font-semibold">
          Activité, {data.window.days} derniers jours
        </h2>
        <div className="mt-3 grid gap-5 sm:grid-cols-2">
          <Sparkline points={data.series.signups} label="Inscriptions par jour" />
          <Sparkline points={data.series.posts} label="Publications par jour" />
        </div>
      </section>

      {data.retention.length > 0 && (
        <section className="px-(--gutter) py-5" aria-labelledby="admin-analytics-retention">
          <h2 id="admin-analytics-retention" className="font-display text-display-m font-semibold">
            Rétention par cohorte
          </h2>
          <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
            Part des comptes inscrits un jour donné qui reviennent agir le
            lendemain (J+1) et sept jours après (J+7). L&apos;activité retenue
            est une session, une publication ou un commentaire — pas seulement
            une connexion.
          </p>
          <table className="mt-3 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line-2 font-mono text-12 text-chalk-4">
                <th className="py-1.5 font-normal">cohorte</th>
                <th className="py-1.5 text-right font-normal">comptes</th>
                <th className="py-1.5 text-right font-normal">J+1</th>
                <th className="py-1.5 text-right font-normal">J+7</th>
              </tr>
            </thead>
            <tbody>
              {data.retention.slice(0, 10).map((row) => {
                const pct = (value: number) =>
                  row.size > 0 ? `${Math.round((value / row.size) * 100)} %` : "—";
                return (
                  <tr key={row.cohort} className="border-b border-line-1 font-mono text-12 tnum">
                    <td className="py-1.5 text-chalk-2">{row.cohort}</td>
                    <td className="py-1.5 text-right text-chalk-3">{row.size}</td>
                    <td className="py-1.5 text-right text-chalk-2">{pct(row.d1)}</td>
                    <td className="py-1.5 text-right text-chalk-2">{pct(row.d7)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="px-(--gutter) py-5">
        <h2 className="font-display text-display-m font-semibold">Fraîcheur</h2>
        <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
          La date du dernier événement dit si la plateforme vit ou si elle
          affiche un passé. Un total élevé avec un dernier événement ancien
          est un cimetière, pas une communauté.
        </p>
        <dl className="mt-3 grid gap-2">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-13 text-chalk-3">Dernier compte créé</dt>
            <dd className="font-mono text-12 text-chalk-2">
              {formatDate(data.freshness.newest_user)}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-13 text-chalk-3">Dernière publication</dt>
            <dd className="font-mono text-12 text-chalk-2">
              {formatDate(data.freshness.newest_post)}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-13 text-chalk-3">Dernière session ouverte</dt>
            <dd className="font-mono text-12 text-chalk-2">
              {formatDate(data.freshness.newest_session)}
            </dd>
          </div>
        </dl>
      </section>

      {data.topAuthors.length > 0 && (
        <section className="px-(--gutter) py-5">
          <h2 className="font-display text-display-m font-semibold">Auteurs les plus actifs</h2>
          <ul className="mt-3 divide-y divide-line-2">
            {data.topAuthors.map((author) => (
              <li key={author.pseudo} className="flex justify-between gap-2 py-2">
                <span className="text-13 text-chalk-2">@{author.pseudo}</span>
                <span className="font-mono text-12 text-chalk-4 tnum">
                  {author.posts} publication{author.posts > 1 ? "s" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
