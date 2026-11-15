"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { User } from "@/lib/types";
import { challengesFor, type Challenge, type ChallengeCounters } from "@/lib/challenges";
import { dayKey, todayKey } from "@/lib/gamification";

/**
 * Les défis du jour du profil courant.
 *
 * Le moteur (`lib/challenges.ts`) est pur : on lui passe la date et
 * **des compteurs** ; il rend trois défis affichables. Ici on alimente
 * ces compteurs depuis les vraies tables — posts, messages, forks,
 * notations, snippets — datés de **ce jour local** (règle de
 * `lib/progress.ts` : le jour se rend dans le fuseau du lecteur).
 *
 * La charge échoue en un état vide, jamais en exception : l'écran de
 * progression doit toujours peindre quelque chose, même hors ligne.
 */
/**
 * Combien de lignes de `table` appartiennent à cette personne **aujourd'hui**.
 *
 * `column` porte le propriétaire, `date` le moment. La date est un
 * paramètre parce que les tables ne la nomment pas toutes pareil :
 * `project_forks` date ses lignes avec `forked_at`, pas `created_at`.
 * L'oublier faisait répondre PostgREST `400`
 * (`column project_forks.created_at does not exist`) et le compteur des
 * forks restait à zéro pour toujours — sans qu'aucun écran ne le dise.
 *
 * `extra` porte les filtres qui distinguent deux compteurs sur la même
 * table : un post **avec** du code (`has_code`) n'est pas un post. Ces
 * filtres étaient auparavant posés sur une requête jamais attendue : les
 * deux compteurs lisaient donc la même chose, et « montrer du code »
 * s'accomplissait en publiant n'importe quoi.
 *
 * Le jour se rend dans le fuseau du lecteur, donc on relit les
 * horodatages du jour plutôt que de filtrer côté base (quelques dizaines
 * de lignes au plus).
 */
async function countToday(
  table: string,
  column: string,
  value: string,
  opts: { date?: string; extra?: Record<string, unknown> } = {},
): Promise<number> {
  const date = opts.date ?? "created_at";
  try {
    let q = api
      .from(table)
      .select(date)
      .eq(column, value)
      .order(date, { ascending: false })
      .limit(200);
    for (const [c, v] of Object.entries(opts.extra ?? {})) q = q.eq(c, v as never);
    const { data } = await q;
    const today = todayKey();
    const rows = (data ?? []) as unknown as Record<string, string | null>[];
    return rows.filter((r) => r[date] && dayKey(r[date] as string) === today).length;
  } catch {
    return 0;
  }
}

export function useChallenges(profile: User | null) {
  const [challenges, setChallenges] = useState<Challenge[]>([]);

  useEffect(() => {
    if (!profile) return;
    let alive = true;
    const today = todayKey();

    void (async () => {
      const [post, postCode, group, groupCode, forks, ratings, snippets] =
        await Promise.all([
          countToday("posts", "author_id", profile.id),
          countToday("posts", "author_id", profile.id, { extra: { has_code: true } }),
          countToday("group_messages", "author_id", profile.id),
          countToday("group_messages", "author_id", profile.id, { extra: { is_code: true } }),
          // `project_forks` date avec `forked_at` : la colonne par défaut
          // rendait un 400 sur une table pourtant présente.
          countToday("project_forks", "forked_by", profile.id, { date: "forked_at" }),
          countToday("project_ratings", "voter_id", profile.id),
          countToday("snippets", "author_id", profile.id),
        ]);

      const counters: ChallengeCounters = {
        post,
        post_code: postCode,
        group_message: group,
        group_code: groupCode,
        project: forks, // un commit suffit, le fork est déjà à part
        fork: forks,
        review: 0, // géré depuis les corrections acceptées, voir ProgressPanel
        rating: ratings,
        snippet: snippets,
      };

      if (alive) setChallenges(challengesFor(today, counters));
    })();

    return () => {
      alive = false;
    };
  }, [profile]);

  return challenges;
}
