import { api } from "@/lib/api/client";
import { uploadMedia } from "@/lib/media";
import type { StoryWithAuthor } from "@/lib/types";
import { STORY_REPLY_MAX } from "@/modules/stories";
import type {
  PlacedSticker,
  PlaceStickerInput,
  StickerCatalogEntry,
  StoryEntry,
} from "@/modules/stories";

export type {
  PlacedSticker,
  PlaceStickerInput,
  StickerCatalogEntry,
  StoryEntry,
};

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
  "id, prenom, pseudo, avatar_color, avatar_url, account_type, verified, filiere, niveau";

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
  const { data, error } = await api
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

  const { error } = await api
    .from("stories")
    .insert({ author_id: authorId, caption: clean });

  return { error: error?.message ?? null };
}

/**
 * Au-delà de cette taille, un fichier n'entre plus dans le corps JSON d'une
 * fonction Vercel (4,5 Mo) une fois encodé en base64 (+33 %) : il part
 * d'abord sur le stockage objet, et la story ne garde que son URL.
 */
const STORY_DATA_URL_MAX = 3 * 1024 * 1024;

async function postStoryMedia(payload: {
  caption: string;
  dataUrl?: string;
  mediaUrl?: string;
}): Promise<{ id: string | null; error: string | null }> {
  try {
    const response = await fetch("/api/stories/media", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => null)) as
      | { id?: string; error?: string }
      | null;
    if (!response.ok) {
      return { id: null, error: body?.error ?? `Erreur ${response.status}` };
    }
    return { id: body?.id ?? null, error: null };
  } catch {
    return { id: null, error: "Réseau indisponible" };
  }
}

/**
 * Publie un statut média : image, GIF ou vidéo.
 *
 * Deux chemins, et un seul critère : le poids. Une petite image part en data
 * URL et se fait re-encoder côté serveur (WebP borné à 1080 px) ; une vidéo
 * ou un fichier de plus de 3 Mo monte d'abord sur le stockage objet, puis la
 * story retient son URL. Sans ce second chemin, toute vidéo dépassant trois
 * mégaoctets se heurtait à un 413 — la limite de corps de la fonction, pas
 * celle du média.
 */
export async function publishStoryMedia(
  caption: string,
  file: File,
): Promise<{ id: string | null; error: string | null }> {
  const clean = caption.trim();
  const uploadFirst = file.type.startsWith("video/") || file.size > STORY_DATA_URL_MAX;

  if (uploadFirst) {
    const uploaded = await uploadMedia(file);
    if (!uploaded.ok) return { id: null, error: uploaded.error };
    // Le repli sans R2 rend un chemin relatif (`/api/media/…`) : on le
    // résout ici, le serveur n'acceptant que des adresses absolues https.
    const url = new URL(uploaded.media.url, window.location.origin).href;
    if (!url.startsWith("https://")) {
      return { id: null, error: "Stockage des vidéos indisponible" };
    }
    return postStoryMedia({ caption: clean, mediaUrl: url });
  }

  const dataUrl = await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  });
  if (!dataUrl) return { id: null, error: "Lecture du fichier impossible" };

  return postStoryMedia({ caption: clean, dataUrl });
}

/** URL des octets du média d'un statut. */
export function storyMediaUrl(storyId: string): string {
  return `/api/stories/${encodeURIComponent(storyId)}/media`;
}

/** Retire une story — la sienne, la RLS n'autorisant rien d'autre. */
export async function deleteStory(id: string): Promise<{ error: string | null }> {
  const { error } = await api.from("stories").delete().eq("id", id);
  return { error: error?.message ?? null };
}

/* ── Interactions : likes, vues, réponses, stickers ──────────────────

   Tout passe par `/api/stories`. Le lecteur ne filtre plus sur
   l'identifiant qu'il croit être le sien : la route lit la session, et la
   RLS décide. Deux conséquences voulues : le compteur de likes n'arrive
   que chez l'auteur, et une réponse est écrite au nom de la session, pas
   au nom d'un identifiant envoyé par le client.                              */

export interface StoryFeedResponse {
  stories: StoryEntry[];
  catalog: StickerCatalogEntry[];
}

const STORIES_API = "/api/stories";

async function failure(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Erreur ${response.status}`;
  } catch {
    return `Erreur ${response.status}`;
  }
}

/**
 * Le fil des stories vivantes, l'état du lecteur et le catalogue.
 *
 * `null` signifie « indisponible » — mode démonstration sans base, ou
 * panne. Le lecteur garde alors ce qu'il affiche au lieu de croire que
 * plus rien n'existe.
 */
export async function fetchStoryFeed(): Promise<StoryFeedResponse | null> {
  try {
    const response = await fetch(STORIES_API, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as StoryFeedResponse;
  } catch {
    return null;
  }
}

export type StoryActionResult<T> = ({ ok: true } & T) | { ok: false; error: string };

async function postStory<T>(payload: Record<string, unknown>): Promise<StoryActionResult<T>> {
  try {
    const response = await fetch(STORIES_API, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return { ok: false, error: await failure(response) };
    return { ok: true, ...((await response.json()) as T) };
  } catch {
    return { ok: false, error: "Réseau indisponible" };
  }
}

/** Aime ou retire le like. Le compteur n'est renseigné que pour l'auteur. */
export function toggleStoryLike(
  storyId: string,
): Promise<StoryActionResult<{ liked: boolean; likes: number }>> {
  return postStory<{ liked: boolean; likes: number }>({ action: "like", storyId });
}

/** Marque la story comme vue — silencieux : une vue n'est pas une action. */
export async function markStorySeen(storyId: string): Promise<void> {
  await postStory<Record<string, never>>({ action: "view", storyId }).catch(() => undefined);
}

/**
 * Réponse privée à l'auteur de la story.
 *
 * Elle arrive dans la conversation privée : la route écrit le message et
 * rend l'identifiant du fil, pour qu'un futur écran puisse l'ouvrir.
 */
export function replyToStory(
  storyId: string,
  body: string,
): Promise<StoryActionResult<{ id: string; conversationId: string; messageId: string }>> {
  const clean = body.trim();
  if (!clean) return Promise.resolve({ ok: false, error: "réponse vide" });
  if (clean.length > STORY_REPLY_MAX) {
    return Promise.resolve({ ok: false, error: `${STORY_REPLY_MAX} caractères maximum` });
  }
  return postStory<{ id: string; conversationId: string; messageId: string }>({
    action: "reply",
    storyId,
    body: clean,
  });
}

/** Déplace, tourne et redimensionne un sticker posé — par son auteur seul. */
export function moveStorySticker(
  storyId: string,
  placedId: string,
  input: Omit<PlaceStickerInput, "stickerId">,
): Promise<StoryActionResult<{ sticker: PlacedSticker }>> {
  return postStory<{ sticker: PlacedSticker }>({
    action: "move-sticker",
    storyId,
    placedId,
    ...input,
  });
}

/** Retire un sticker posé. La story reste. */
export function removeStorySticker(
  storyId: string,
  placedId: string,
): Promise<StoryActionResult<Record<string, never>>> {
  return postStory<Record<string, never>>({ action: "remove-sticker", storyId, placedId });
}

/** Pose un sticker aux coordonnées normalisées (0–1). */
export function placeStorySticker(
  storyId: string,
  input: PlaceStickerInput,
): Promise<StoryActionResult<{ sticker: PlacedSticker }>> {
  return postStory<{ sticker: PlacedSticker }>({ action: "sticker", storyId, ...input });
}
