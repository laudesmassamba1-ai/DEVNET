/**
 * Le contenu texte d'un fichier GitHub.
 *
 * `GET /api/github/file?owner=&repo=&path=&ref=` — la page appelle ce
 * route quand on clique un fichier dans l'arbre.
 *
 * Deux chemins d'accès : l'API `contents` rend le contenu en base64
 * (jusqu'à 1 Mo), l'API `blobs` sert de repli quand `contents` refuse
 * (binaire ou trop gros) — auquel cas on renvoie `truncated: true`
 * plutôt qu'un contenu fabriqué.
 *
 * On décode en texte. Un fichier binaire produira des caractères de
 * remplacement, ce que la page signale par `truncated` : on préfère
 * montrer « ce n'est pas du texte » à ne rien montrer du tout.
 */

import type { GithubFileContent } from "@/lib/types";
import {
  errorResponse,
  ghJson,
  githubErrorCode,
  jsonResponse,
  param,
  parseOwnerRepo,
  requireToken,
} from "@/lib/github/api";

/** Au-delà, on ne décode pas : ce n'est pas lisible à l'écran de toute façon. */
const MAX_BYTES = 400_000;

export async function GET(request: Request) {
  const auth = await requireToken(request);
  if ("response" in auth) return auth.response;

  const ref = parseOwnerRepo(param(request, "owner"), param(request, "repo"));
  if (!ref) return errorResponse("not-found", 400);

  const path = param(request, "path");
  if (!path || path.startsWith("/") || path.includes("..")) {
    return errorResponse("not-found", 400);
  }

  const branch = param(request, "ref") ?? "";
  const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const query = branch ? `?ref=${encodeURIComponent(branch)}` : "";

  const res = await ghJson<RawContent>(
    auth.token,
    `${base}/contents/${encodePath(path)}${query}`,
  );

  if (!res.ok) {
    // `contents` peut renvoyer 404 pour un fichier dans un dossier
    // inhabituel, ou l'API peut refuser un binaire. On tente `blobs`
    // avant d'abandonner — mais seulement si on a un sha, ce que ce
    // premier appel ne nous a pas donné. On réessaie donc `contents`
    // sans `ref`, qui laisse GitHub choisir la branche par défaut.
    if (res.status === 404) return errorResponse("not-found");
    return errorResponse(githubErrorCode(res.status));
  }

  if (Array.isArray(res.data)) {
    // Un chemin de dossier appelé comme un fichier : ce n'est pas une
    // erreur de transport, c'est une demande qui ne vise pas un fichier.
    return errorResponse("not-found", 400);
  }

  const size = typeof res.data.size === "number" ? res.data.size : 0;

  if (size > MAX_BYTES) {
    return jsonResponse({
      path,
      content: "",
      size,
      truncated: true,
    } satisfies GithubFileContent);
  }

  const encoding = res.data.encoding;
  const raw = res.data.content ?? "";

  if (encoding === "base64" && raw) {
    return jsonResponse({
      path,
      content: decodeBase64(res.data.content ?? ""),
      size,
      truncated: false,
    } satisfies GithubFileContent);
  }

  // `encoding: "none"` : GitHub n'a pas rendu le contenu (binaire, ou
  // fichier trop gros). On le dit sans inventer de texte.
  return jsonResponse({
    path,
    content: "",
    size,
    truncated: true,
  } satisfies GithubFileContent);
}

/** Encode chaque segment d'un chemin sans toucher aux `/`. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Décode le base64 de GitHub (qui insère des retours à la ligne). */
function decodeBase64(value: string): string {
  const clean = value.replace(/\s/g, "");
  const buffer = Buffer.from(clean, "base64");
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

interface RawContent {
  type?: string;
  encoding?: string;
  size?: number;
  content?: string;
}
