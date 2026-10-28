import { supabase } from "@/lib/supabase/client";
import type { UserLite } from "@/lib/types";

/**
 * La présence — qui travaille sur quel fichier, dans quel projet.
 *
 * Une session est une ligne de `project_sessions` : (projet, personne) en
 * clé, le fichier ouvert en valeur. La clé a été corrigée par la migration
 * 019 — la 004 la faisait porter sur le chemin du fichier, si bien que deux
 * membres sur le même fichier se disputaient une seule ligne.
 *
 * Ce module ne connaît que la règle du **temps** : une session est vivante
 * tant qu'elle a été vue récemment. C'est la seule autorité sur cette
 * règle, et elle vit ici plutôt que dans l'écran pour que la démonstration
 * et la production vieillissent de la même façon.
 */

/**
 * Délai après lequel une session n'est plus considérée comme vivante.
 *
 * Trois battements manqués (`PRESENCE_BEAT_MS` × 3) : assez long pour
 * qu'une latence ou un onglet en arrière-plan ne fasse pas disparaître
 * quelqu'un qui est là, assez court pour qu'une présence fantôme ne
 * survit pas à un départ.
 */
export const PRESENCE_TTL_MS = 90_000;

/** Cadence du battement. Le tiers du délai d'expiration, comme il se doit. */
export const PRESENCE_BEAT_MS = 30_000;

const PRESENCE_COLUMNS =
  "project_id, user_id, file_path, cursor, color, seen_at, " +
  "user:users(id, prenom, pseudo, avatar_color, account_type, verified, filiere, niveau)";

/** Une personne présente dans un projet, et le fichier où elle se trouve. */
export interface PresenceEntry {
  user_id: string;
  file_path: string;
  color: string;
  seen_at: string;
  user: UserLite | null;
}

/**
 * La session est-elle encore vivante ?
 *
 * `seen_at` absent ou illisible compte comme **mort** : une ligne qu'on ne
 * peut pas dater ne prouve pas qu'il y a quelqu'un. L'erreur inverse — la
 * croire vivante par défaut — afficherait une présence que rien ne
 * soutient.
 */
export function isLive(
  session: { seen_at?: string | null },
  now: number = Date.now(),
): boolean {
  const at = Date.parse(String(session.seen_at ?? ""));
  return Number.isFinite(at) && now - at <= PRESENCE_TTL_MS;
}

/**
 * Les présences vivantes d'un projet, la mienne exclue.
 *
 * Le filtre par le temps est fait **ici** et non dans la requête, pour une
 * raison précise : lorsque quelqu'un ferme son onglet, aucun événement
 * n'est émis — il n'y a rien à observer. Une liste filtrée uniquement par
 * la base garderait donc un fantôme jusqu'à la requête suivante. La
 * fonction reçoit `now`, ce qui la rend vérifiable sans horloge.
 */
export async function fetchPresence(
  projectId: string,
  me: string,
  now: number = Date.now(),
): Promise<PresenceEntry[]> {
  const { data } = await supabase
    .from("project_sessions")
    .select(PRESENCE_COLUMNS)
    .eq("project_id", projectId)
    .order("seen_at", { ascending: false });

  return ((data as PresenceEntry[] | null) ?? []).filter(
    (session) => session.user_id !== me && isLive(session, now),
  );
}

/**
 * Annonce où je travaille, et rafraîchit l'horodatage.
 *
 * **Lecture puis écriture, jamais `upsert`.** La clé de la table est
 * composite, et la convention du projet est déjà arrêtée pour ce cas :
 * `toggleMessageReaction` et `linkProject` lisent avant d'écrire, parce
 * qu'un `onConflict` mal nommé sur plusieurs colonnes ne lève rien — il
 * écrit ailleurs. Un `upsert` dont la clé serait mal nommée créerait ici
 * une seconde présence pour la même personne, en silence.
 */
export async function heartbeatSession(options: {
  projectId: string;
  userId: string;
  filePath: string;
  color?: string;
}): Promise<{ error: string | null }> {
  const { projectId, userId, filePath } = options;

  const { data: existing } = await supabase
    .from("project_sessions")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  const patch = {
    file_path: filePath,
    color: options.color ?? "",
    seen_at: new Date().toISOString(),
  };

  const { error } = existing
    ? await supabase
        .from("project_sessions")
        .update(patch)
        .eq("project_id", projectId)
        .eq("user_id", userId)
    : await supabase
        .from("project_sessions")
        .insert({ project_id: projectId, user_id: userId, ...patch });

  return { error: error?.message ?? null };
}
