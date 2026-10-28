import { supabase } from "@/lib/supabase/client";
import type { StoryWithAuthor } from "@/lib/types";

/**
 * Les stories — « ce que le réseau a publié dans les dernières 24 h ».
 *
 * ## Une story est une **ligne**, pas un post
 *
 * Le projet a longtemps affiché un rail construit à partir des
 * publications récentes : une story était alors « la contribution de
 * quelqu'un ». C'était honnête, mais ce n'était pas une story — la table
 * `stories` (migration 018) est le vrai objet : un texte court, une
 * échéance, et rien d'autre.
 *
 * ## L'échéance est en base, pas calculée ici
 *
 * `expires_at` a une valeur par défaut (`now() + 24 h`) et une politique
 * de lecture `expires_at > now()`. On ne filtre donc **pas** côté client :
 * une story périmée est invisible pour la base elle-même, dans les deux
 * modes. Recalculer l'échéance ici créerait une seconde vérité, et la
 * première divergence se verrait le lendemain — au pire moment.
 *
 * ## Le média viendra plus tard
 *
 * `media_url` existe et vaut `''` partout pour l'instant. Une story sans
 * média se lit quand même : c'est le cas que l'écran doit savoir rendre
 * sans planter, donc on ne pose pas une contrainte « média obligatoire »
 * qu'on ne pourrait pas honorer.
 */

/**
 * Colonnes d'auteur d'une story. La jointure est obligatoire : la story
 * ne recopie pas le nom de son auteur — elle le lit, comme tout le reste
 * du produit.
 */
const AUTHOR_COLUMNS =
  "id, prenom, pseudo, avatar_color, account_type, verified, filiere, niveau";

/** Une story dure 24 h — la même valeur que le défaut SQL de la 018. */
export const STORY_HOURS = 24;

/** Longueur maximale d'une légende, en cohérence avec l'écran. */
export const STORY_MAX = 500;

/**
 * Les stories vivantes, de la plus récente à la plus ancienne.
 *
 * L'ordre est celui du **rail** : la personne qui vient de publier est en
 * tête. Le tri à l'intérieur d'une série (pour le lecteur) est refait par
 * l'appelant, parce qu'il a besoin de l'ordre inverse — on remet donc
 * chaque préoccupation à l'endroit où elle se lit.
 *
 * Le filtre d'expiration n'est pas répété ici : la politique de lecture
 * `stories_read` (`expires_at > now()`) le fait, en base comme en
 * démonstration (`READ_RULES.stories`). Le rejouer côté client serait un
 * filtre mort dans un cas et faux dans l'autre.
 */
export async function fetchLiveStories(): Promise<StoryWithAuthor[]> {
  const { data, error } = await supabase
    .from("stories")
    .select(`*, author:users(${AUTHOR_COLUMNS})`)
    .order("created_at", { ascending: false });

  if (error) return [];
  return (data as StoryWithAuthor[]) ?? [];
}

/**
 * Publie une story.
 *
 * Une story **vide** est refusée : c'est le seul moyen d'honorer la
 * promesse « une story est quelque chose que quelqu'un a écrit ». Le
 * défaut SQL de `caption` est `''`, donc la base laisserait passer une
 * ligne sans texte — mais l'écran ne la propose pas, et une story qui ne
 * dit rien ne mérite pas d'être publiée.
 *
 * `expires_at` n'est pas envoyé : la base le pose. L'envoyer ici ferait
 * dépendre la durée de vie d'une décision du client, donc d'une horloge
 * qu'on ne contrôle pas.
 */
export async function publishStory(
  authorId: string,
  caption: string,
): Promise<{ error: string | null }> {
  const clean = caption.trim();
  if (!clean) return { error: "Une story sans texte ne dit rien" };
  if (clean.length > STORY_MAX) return { error: `${STORY_MAX} caractères maximum` };

  const { error } = await supabase
    .from("stories")
    .insert({ author_id: authorId, caption: clean });

  return { error: error?.message ?? null };
}

/** Retire une story — la sienne, la RLS n'autorisant rien d'autre. */
export async function deleteStory(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("stories").delete().eq("id", id);
  return { error: error?.message ?? null };
}
