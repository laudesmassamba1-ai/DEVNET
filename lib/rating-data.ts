/**
 * La couche de données de la notation par les pairs.
 *
 * `lib/rating.ts` calcule, ce fichier **collecte** : lire les votes
 * d'un projet, poser un vote, tenir la moyenne de la plateforme qui
 * sert de prior bayésien. Le même partage que `progress.ts` :

 * aucune décision ici, le moteur décide.
 *
 * Les deux tables (migration 025) :
 *   · `project_ratings` — une étoile par (projet, votant) ;
 *   · `project_forks`   — pour le compte de forks reçus.
 */

import { api } from "@/lib/api/client";
import { rateProject, type RatingResult, type RatingVote } from "./rating";

/** Un vote en base : il porte l'identité de l'électeur et son langage. */
interface RatingRow {
  project_id: string;
  voter_id: string;
  stars: number;
  voter_lang: string;
  created_at: string;
}

/** Lit toutes les étoiles d'un projet, prêtes pour `rateProject`. */
export async function fetchVotes(projectId: string): Promise<RatingVote[]> {
  try {
    const { data, error } = await api
      .from("project_ratings")
      .select("project_id, voter_id, stars, voter_lang, created_at")
      .eq("project_id", projectId);

    if (error || !data) return [];

    return (data as RatingRow[]).map((r) => ({
      stars: Number(r.stars),
      voterId: r.voter_id,
      voterLang: r.voter_lang || undefined,
      created_at: r.created_at,
    }));
  } catch {
    // Table pas encore créée (migration non appliquée) : pas de votes,
    // l'écran affiche « pas encore noté » — jamais une panne.
    return [];
  }
}

/**
 * Le score complet d'un projet, en un appel d'écran.
 *
 * `globalMean` est calculé **dynamiquement** : la moyenne de tous les
 * votes de la plateforme. Le lire à chaque ouverture coûte une requête
 * de plus ; c'est le prix d'un prior honnête — un prior figé en dur
 * finirait par contradire la foule qui note.
 */
export async function fetchRating(projectId: string): Promise<RatingResult> {
  const all = await fetchAllVotes();
  const platform = all.reduce((a, v) => a + v.stars, 0) / Math.max(all.length, 1);
  const mine = all
    .filter((v) => v.project_id === projectId)
    .map(({ stars, voterId, voterLang, created_at }) => ({ stars, voterId, voterLang, created_at }));
  return rateProject(mine, platform);
}

/** Tous les votes de la plateforme (plafonné, la démo en compte peu). */
export async function fetchAllVotes(): Promise<(RatingVote & { project_id: string })[]> {
  try {
    const { data, error } = await api
      .from("project_ratings")
      .select("project_id, voter_id, stars, voter_lang, created_at")
      .limit(2000);
    if (error || !data) return [];
    return (data as RatingRow[]).map((r) => ({
      stars: Number(r.stars),
      voterId: r.voter_id,
      voterLang: r.voter_lang || undefined,
      created_at: r.created_at,
      project_id: r.project_id,
    }));
  } catch {
    return [];
  }
}

/** Mon vote sur ce projet, pour savoir si l'écran affiche le vote ou le bouton. */
export async function fetchMyVote(projectId: string, voterId: string): Promise<number | null> {
  try {
    const { data } = await api
      .from("project_ratings")
      .select("stars")
      .eq("project_id", projectId)
      .eq("voter_id", voterId)
      .maybeSingle();
    return (data as { stars: number } | null)?.stars ?? null;
  } catch {
    return null;
  }
}

export interface CastResult {
  ok: boolean;
  /** « deja » : la personne a déjà noté — la base refuse le double vote. */
  reason: "ok" | "deja" | "invalide" | "erreur";
}

/**
 * Pose (ou remplace) la note d'un votant sur un projet.
 *
 * Le remplacement est un **upsert**, pas une seconde ligne : la clé
 * (projet, votant) refuse le doublon, et changer d'avis est légitime —
 * se remplacer en secret ne l'est pas. La colonne `voter_lang` rend le
 * votant : c'est elle qui alimente la prime de diversité du moteur.
 */
export async function castRating(options: {
  projectId: string;
  voterId: string;
  voterLang: string;
  stars: number;
}): Promise<CastResult> {
  const { projectId, voterId, voterLang, stars } = options;

  if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
    return { ok: false, reason: "invalide" };
  }

  try {
    const { error } = await api
      .from("project_ratings")
      .upsert(
        {
          project_id: projectId,
          voter_id: voterId,
          stars: Math.round(stars),
          voter_lang: voterLang ?? "",
        },
        { onConflict: "project_id,voter_id" },
      );

    if (error) {
      // La base refuse le doublon qui n'aurait pas passer par l'upsert
      // (ancien client, table non migrée…).
      const deja = /duplicate|unique|pkey/i.test(error.message);
      return { ok: false, reason: deja ? "deja" : "erreur" };
    }
    return { ok: true, reason: "ok" };
  } catch {
    return { ok: false, reason: "erreur" };
  }
}

/** Le nombre de forks reçus d'un projet — la réputation d'héritage. */
export async function fetchForkCount(sourceId: string): Promise<number> {
  try {
    const { count, error } = await api
      .from("project_forks")
      .select("id", { count: "exact", head: true })
      .eq("source_id", sourceId);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
