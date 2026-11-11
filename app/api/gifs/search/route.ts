/**
 * Recherche de GIF — relais serveur.
 *
 * La clé du fournisseur (Tenor, ou Giphy en secours) ne quitte jamais
 * le serveur : le navigateur interroge cette route, qui interroge le
 * fournisseur. Sans clé configurée, la route répond 503 avec un code
 * stable (`gifs_not_configured`) — l'interface peut alors l'expliquer
 * au lieu d'afficher une grille vide.
 *
 * Chaque réponse est filtrée : seuls les liens `https://` des domaines
 * du fournisseur sont retenus (`lib/gifs.ts`). Une URL refusée par le
 * filtre n'atteint donc jamais la base, et encore moins le DOM.
 */
import { NextResponse } from "next/server";
import {
  giphySearchUrl,
  mapGiphy,
  mapTenor,
  parseGifQuery,
  tenorSearchUrl,
} from "@/lib/gifs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Le fournisseur doit répondre vite : au-delà, l'utilisateur a déjà renoncé. */
const TIMEOUT_MS = 4500;
const CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

function fail(error: string, status: number, configured = true): NextResponse {
  return NextResponse.json(
    { error, configured },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Installation sans clé : ce n'est pas une panne du serveur.
 *
 * Répondre 503 ferait afficher une erreur réseau dans la console à
 * chaque ouverture du sélecteur, pour une situation qui est un choix
 * de configuration. On répond 200 avec `configured: false`, et l'UI
 * dit quoi faire.
 */
function notConfigured(): NextResponse {
  return NextResponse.json(
    { error: "gifs_not_configured", configured: false, results: [] },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const { query, error } = parseGifQuery(new URL(request.url).searchParams.get("q"));
  if (error) return fail(error, 400);

  const tenorKey = process.env.TENOR_API_KEY?.trim() ?? "";
  const giphyKey = process.env.GIPHY_API_KEY?.trim() ?? "";
  if (!tenorKey && !giphyKey) return notConfigured();

  const usingTenor = tenorKey !== "";
  const target = usingTenor
    ? tenorSearchUrl(query, tenorKey)
    : giphySearchUrl(query, giphyKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      signal: controller.signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return fail(`fournisseur indisponible (${response.status})`, 502);
    }
    const payload: unknown = await response.json().catch(() => null);
    const results = usingTenor ? mapTenor(payload) : mapGiphy(payload);
    return NextResponse.json(
      { provider: usingTenor ? "tenor" : "giphy", results },
      { headers: { "Cache-Control": CACHE } },
    );
  } catch {
    return fail("fournisseur injoignable", 502);
  } finally {
    clearTimeout(timer);
  }
}
