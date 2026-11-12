"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { User } from "@/lib/types";
import { loadProofsForUser } from "@/lib/reputation";
import type { AchievementCounters } from "@/lib/achievements";

const EMPTY: AchievementCounters = {
  posts: 0, commits: 0, forks: 0, forksReceived: 0, reviews: 0,
  ratings: 0, snippets: 0, projects: 0, likes: 0, streakBest: 0,
  languages: 0, challengesDone: 0,
};

/**
 * Les compteurs des succès, lus depuis la base.
 *
 * Chaque compteur vient de sa vraie table : commits depuis les preuves
 * `commit`, forks de `project_forks`, forks reçus des forks qui
 * pointent vers ses projets, notes de `project_ratings`. Aucun d'eux
 * n'est deviné à partir d'un autre — recompter un compteur à partir
 * d'un compteur revenait à doubler la même preuve.
 *
 * La lecture est résiliente : une table absente (migration pas encore
 * appliquée) met ce compteur à zéro, pas l'écran en panne.
 */
export function useAchievementCounters(profile: User | null, likes: number, streakBest: number): AchievementCounters {
  const [counters, setCounters] = useState<AchievementCounters>(EMPTY);

  useEffect(() => {
    let alive = true;
    if (!profile) return;

    void (async () => {
      const proofs = await loadProofsForUser(profile.id);
      const count = (kind: string) => proofs.filter((p) => p.kind === kind).length;

      const [posts, forks, forksReceived, ratings, projects] = await Promise.all([
        countTable("posts", "author_id", profile.id),
        countTable("project_forks", "forked_by", profile.id),
        countForksReceived(profile.id),
        countTable("project_ratings", "voter_id", profile.id),
        countProjectsOwnedBy(profile.id),
      ]);

      if (!alive) return;
      setCounters({
        posts,
        commits: count("commit"),
        forks,
        forksReceived,
        reviews: count("review"),
        ratings,
        snippets: count("snippet"),
        projects,
        likes,
        streakBest,
        languages: (profile.langages ?? []).length,
        challengesDone: 0, // alimenté par l'écran, qui a déjà la séquence
      });
    })();

    return () => { alive = false; };
  }, [profile, likes, streakBest]);

  return counters;
}

/**
 * Compte les lignes d'une table pour une personne.
 *
 * La colonne lue est celle sur laquelle on filtre, pas `id` : une table à
 * clé composée n'en a pas, et PostgREST répond alors 400
 * (`column project_ratings.id does not exist`) — la notation par les pairs
 * ne comptait donc jamais. Lire la colonne filtrée marche partout, y
 * compris sur `project_ratings` dont la clé est (projet, votant).
 */
async function countTable(table: string, col: string, value: string): Promise<number> {
  try {
    const { count, error } = await api
      .from(table)
      .select(col, { count: "exact", head: true })
      .eq(col, value);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function countForksReceived(userId: string): Promise<number> {
  try {
    // Les projets que la personne possède.
    const { data: projects } = await api.from("projects").select("id").eq("created_by", userId);
    const ids = ((projects as { id: string }[]) ?? []).map((p) => p.id);
    if (!ids.length) return 0;
    const { count, error } = await api
      .from("project_forks")
      .select("id", { count: "exact", head: true })
      .in("source_id", ids);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function countProjectsOwnedBy(userId: string): Promise<number> {
  try {
    const { count, error } = await api
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("created_by", userId);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
