import { NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Analytique — les chiffres que le module « Analytique » n'affichait pas.
 *
 * Il montrait trois comptes (profils, publications, projets) et une série
 * de publications sur huit semaines. Ce ne sont pas des analytics : il
 * manquait la croissance, l'engagement, la rétention et la fraîcheur.
 *
 * Trois principes, parce qu'un tableau de bord est l'endroit le plus
 * facile pour mentir sans le vouloir :
 *
 *  1. **Chaque chiffre est daté.** Un total sans fenêtre ne dit rien :
 *     « 43 comptes » est vrai et inutile si les 43 sont arrivés le même
 *     jour. La réponse porte donc la fenêtre et la date de calcul.
 *  2. **Une série ne s'invente pas.** Les jours sans événement sont
 *     renvoyés à zéro par `generate_series`, pas omis : une courbe qui
 *     saute les jours creux exagère les pics.
 *  3. **Ce qui n'est pas mesurable est dit.** La rétention réelle exige
 *     des cohortes sur plusieurs semaines ; avec un import d'un seul
 *     jour, on ne peut mesurer qu'une activité récente. Le champ
 *     `caveats` le déclare au lieu de laisser croire à une courbe.
 */

const DAYS = 14;

type Daily = { jour: string; count: number };

export async function GET(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  try {
    const data = await withUser(admin.userId, async (query) => {
      const [totals] = await query<{
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
      }>(`
        select
          (select count(*)::int from public.users) as users,
          (select count(*)::int from public.posts) as posts,
          (select count(*)::int from public.comments) as comments,
          (select count(*)::int from public.stories where expires_at > now()) as stories_live,
          (select count(*)::int from public.projects) as projects,
          (select count(*)::int from public.follows) as follows,
          (select count(*)::int from public.direct_messages) as direct_messages,
          (select count(*)::int from public.story_views) as story_views,
          (select count(*)::int from public.sessions where expires_at > now()) as sessions_active,
          (select count(distinct user_id)::int from public.sessions
            where created_at > now() - interval '7 days') as users_7d,
          (select count(*)::int from public.posts
            where created_at > now() - interval '7 days') as posts_7d,
          (select count(distinct user_id)::int from public.sessions
            where created_at > now() - interval '30 days') as users_30d
      `);

      // Série des inscriptions : `generate_series` garantit un point par
      // jour, y compris les jours à zéro. Sans lui, une courbe à deux
      // points passerait pour une tendance.
      const signups = await query<Daily>(`
        with days as (
          select generate_series(
            (current_date - ($1::int - 1)),
            current_date,
            interval '1 day'
          )::date as jour
        )
        select to_char(d.jour, 'YYYY-MM-DD') as jour,
               count(u.id)::int as count
          from days d
          left join public.users u
            on u.created_at::date = d.jour
         group by d.jour
         order by d.jour
      `, [DAYS]);

      const posts = await query<Daily>(`
        with days as (
          select generate_series(
            (current_date - ($1::int - 1)),
            current_date,
            interval '1 day'
          )::date as jour
        )
        select to_char(d.jour, 'YYYY-MM-DD') as jour,
               count(p.id)::int as count
          from days d
          left join public.posts p
            on p.created_at::date = d.jour
         group by d.jour
         order by d.jour
      `, [DAYS]);

      // Les jours où des comptes ont été créés, pour repérer un import en
      // masse : 40 comptes sur une journée n'est pas une croissance.
      const cohorts = await query<{ jour: string; count: number }>(`
        select to_char(created_at::date, 'YYYY-MM-DD') as jour, count(*)::int as count
          from public.users
         group by created_at::date
         order by created_at::date desc
         limit 10
      `);

      const topAuthors = await query<{ pseudo: string; posts: number }>(`
        select u.pseudo, count(p.id)::int as posts
          from public.users u
          join public.posts p on p.author_id = u.id
         group by u.pseudo
         order by count(p.id) desc
         limit 5
      `);

      /*
       * Rétention D1/D7, par cohorte d'inscription.
       *
       * L'activité est l'union de trois gestes réels — ouvrir une session,
       * publier, commenter — et non la seule connexion. Un compte qui revient
       * publier sans se reconnecter (session longue) compte quand même : le
       * mesurer par les sessions seules sous-estimerait la rétention.
       */
      const retention = await query<{
        cohort: string;
        size: number;
        d1: number;
        d7: number;
      }>(`
        with new_users as (
          select id, created_at::date as day
            from public.users
           where created_at::date > current_date - 15
        ),
        activity as (
          select user_id, created_at::date as day from public.sessions
          union
          select author_id, created_at::date from public.posts where author_id is not null
          union
          select author_id, created_at::date from public.comments where author_id is not null
        )
        select to_char(n.day, 'YYYY-MM-DD') as cohort,
               count(*)::int as size,
               count(*) filter (
                 where exists (select 1 from activity a where a.user_id = n.id and a.day = n.day + 1)
               )::int as d1,
               count(*) filter (
                 where exists (select 1 from activity a where a.user_id = n.id and a.day = n.day + 7)
               )::int as d7
          from new_users n
         group by n.day
         order by n.day desc
      `);

      const [freshness] = await query<{
        newest_user: string | null;
        newest_post: string | null;
        newest_session: string | null;
      }>(`
        select
          (select max(created_at)::text from public.users) as newest_user,
          (select max(created_at)::text from public.posts) as newest_post,
          (select max(created_at)::text from public.sessions) as newest_session
      `);

      return { totals, signups, posts: posts, cohorts, topAuthors, freshness, retention };
    });

    /*
     * Les réserves sont calculées, pas rédigées d'avance : elles ne
     * s'affichent que si la donnée les justifie. Une réserve permanente
     * deviendrait du décor.
     */
    const caveats: string[] = [];
    const biggestCohort = data.cohorts[0];
    if (biggestCohort && data.totals.users > 0) {
      const share = Math.round((biggestCohort.count / data.totals.users) * 100);
      if (share >= 50) {
        caveats.push(
          `${share} % des comptes (${biggestCohort.count}) ont été créés le ${biggestCohort.jour}. ` +
            "C'est un import, pas une croissance : la courbe des inscriptions ne mesure pas l'acquisition.",
        );
      }
    }
    if (data.totals.posts < 10) {
      caveats.push(
        `Seulement ${data.totals.posts} publication(s) en base : les ratios d'engagement ` +
          "portent sur un échantillon trop petit pour conclure quoi que ce soit.",
      );
    }
    if (data.totals.users_7d === 0) {
      caveats.push(
        "Aucune session ouverte sur les sept derniers jours : la rétention n'est pas mesurable.",
      );
    }

    return NextResponse.json(
      {
        window: { days: DAYS, computedAt: new Date().toISOString() },
        totals: data.totals,
        series: { signups: data.signups, posts: data.posts },
        cohorts: data.cohorts,
        retention: data.retention,
        topAuthors: data.topAuthors,
        freshness: data.freshness,
        caveats,
      },
      { headers: ADMIN_NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { error: "analytique indisponible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}
