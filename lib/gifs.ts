/**
 * GIF d'une publication.
 *
 * Le GIF n'est **pas** un fichier hébergé ici : c'est un lien vers un
 * fournisseur public (Tenor, ou Giphy en secours). Trois conséquences,
 * et elles expliquent la forme de ce module :
 *
 * 1. la clé d'API ne doit jamais atteindre le navigateur — d'où une
 *    route serveur qui relaie la recherche, et ce module qui ne
 *    contient que des fonctions pures, utilisables des deux côtés ;
 * 2. une URL venue d'un tiers est une entrée non fiable : on n'accepte
 *    que `https://` sur les domaines du fournisseur, sinon un
 *    `javascript:` posé en base s'exécuterait au rendu ;
 * 3. un fournisseur peut changer de forme de réponse : le mappage est
 *    isolé et testé (`scripts/test-gifs.ts`), pas éparpillé dans l'UI.
 */

export type Gif = {
  id: string;
  /** Le GIF pleine taille (mp4 ou gif selon le fournisseur). */
  url: string;
  /** Une vignette plus légère, pour la grille de choix. */
  preview: string;
  /** Description : sert d'`alt`, jamais de HTML. */
  alt: string;
  width: number;
  height: number;
};

export type GifProvider = "tenor" | "giphy";

/** Longueur maximale d'une recherche : au-delà, c'est une attaque, pas un mot. */
export const GIF_QUERY_MAX = 80;

/**
 * Domaines autorisés. On compare le **suffixe** du nom d'hôte pour
 * accepter `media1.tenor.com` sans accepter `tenor.com.evil.example`.
 */
const ALLOWED_HOSTS = ["tenor.com", "giphy.com"];

export function isAllowedGifUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    return ALLOWED_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

/**
 * Nettoie une recherche. Les caractères de contrôle sont retirés : ils
 * n'ont pas de sens dans une requête et servent parfois à couper une
 * URL ou un en-tête. Une recherche vide est permise : elle demande les
 * GIF du moment.
 */
export function parseGifQuery(raw: string | null | undefined): {
  query: string;
  error?: string;
} {
  const clean = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length > GIF_QUERY_MAX) {
    return { query: "", error: `Recherche trop longue (${GIF_QUERY_MAX} caractères maximum)` };
  }
  return { query: clean };
}

function int(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 300) : "";
}

/** Réponse Tenor v2 → liste de GIF sûrs. Les entrées incomplètes sont écartées. */
export function mapTenor(payload: unknown): Gif[] {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((item) => {
    const entry = item as {
      id?: unknown;
      content_description?: unknown;
      media_formats?: Record<string, { url?: unknown; dims?: unknown }>;
    };
    const formats = entry?.media_formats;
    const full = formats?.gif ?? formats?.mediumgif ?? formats?.tinygif;
    const preview = formats?.tinygif ?? formats?.nanogif ?? full;
    if (!isAllowedGifUrl(full?.url) || !isAllowedGifUrl(preview?.url)) return [];
    const dims = Array.isArray(full?.dims) ? full.dims : [];
    return [
      {
        id: text(entry.id) || text(full.url).slice(-24),
        url: full.url,
        preview: preview.url,
        alt: text(entry.content_description) || "GIF",
        width: int(dims[0], 0),
        height: int(dims[1], 0),
      },
    ];
  });
}

/** Réponse Giphy v1 → même forme. `images` varie selon l'endpoint. */
export function mapGiphy(payload: unknown): Gif[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const entry = item as {
      id?: unknown;
      title?: unknown;
      images?: Record<string, { url?: unknown; width?: unknown; height?: unknown }>;
    };
    const images = entry?.images;
    const full = images?.fixed_height ?? images?.downsized_medium ?? images?.original;
    const preview = images?.fixed_height_small ?? images?.downsized_small ?? full;
    if (!isAllowedGifUrl(full?.url) || !isAllowedGifUrl(preview?.url)) return [];
    return [
      {
        id: text(entry.id) || text(full.url).slice(-24),
        url: full.url,
        preview: preview.url,
        alt: text(entry.title) || "GIF",
        width: int(full.width, 0),
        height: int(full.height, 0),
      },
    ];
  });
}

/** URL Tenor : la clé reste côté serveur, jamais dans la réponse. */
export function tenorSearchUrl(query: string, key: string): string {
  const params = new URLSearchParams({
    key,
    limit: "24",
    media_filter: "tinygif,gif",
    contentfilter: "high",
    locale: "fr_FR",
  });
  if (query) params.set("q", query);
  const endpoint = query ? "search" : "featured";
  return `https://tenor.googleapis.com/v2/${endpoint}?${params.toString()}`;
}

/** URL Giphy, même contrat. */
export function giphySearchUrl(query: string, key: string): string {
  const params = new URLSearchParams({
    api_key: key,
    limit: "24",
    rating: "pg-13",
    lang: "fr",
  });
  if (query) params.set("q", query);
  const endpoint = query ? "search" : "trending";
  return `https://api.giphy.com/v1/gifs/${endpoint}?${params.toString()}`;
}

export type GifSearchResult =
  | { ok: true; provider: GifProvider; results: Gif[] }
  | { ok: false; error: string; configured: boolean };

/**
 * Recherche côté client. Ne lève jamais : l'UI doit pouvoir dire
 * « indisponible » sans écran blanc quand le réseau tombe.
 */
export async function searchGifs(
  query: string,
  signal?: AbortSignal,
): Promise<GifSearchResult> {
  try {
    const response = await fetch(`/api/gifs/search?q=${encodeURIComponent(query)}`, {
      signal,
      headers: { accept: "application/json" },
    });
    const body = (await response.json().catch(() => null)) as
      | { provider?: GifProvider; results?: Gif[]; error?: string; configured?: boolean }
      | null;
    if (body?.configured === false) {
      return { ok: false, error: body.error ?? "gifs_not_configured", configured: false };
    }
    if (!response.ok) {
      return {
        ok: false,
        error: body?.error ?? `Erreur ${response.status}`,
        configured: true,
      };
    }
    return {
      ok: true,
      provider: body?.provider ?? "tenor",
      results: Array.isArray(body?.results) ? body.results : [],
    };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return { ok: false, error: "Recherche annulée", configured: true };
    }
    return { ok: false, error: "Réseau indisponible", configured: true };
  }
}
