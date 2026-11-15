/**
 * Le socle commun des routes de lecture GitHub.
 *
 * Chaque route `/api/github/*` fait le même geste : lire **un seul**
 * cookie (`devnet_gh`), le déchiffrer, appeler `api.github.com`, et
 * renvoyer une forme réduite. Ce module tient ce geste en un endroit —
 * pas par goût de l'abstraction, mais pour que la règle « le cookie est
 * la seule entrée, GitHub la seule sortie » ne se réécrive pas de
 * travers d'une route à l'autre.
 *
 * Comme `app/api/github/repos/route.ts`, ces routes ne lisent aucune
 * table DevNet et n'écrivent rien. C'est l'exception bornée à la règle
 * « pas de route handler » (MEMO §9) : appeler GitHub avec le jeton exige
 * un serveur, un navigateur ne peut pas.
 */

import { decryptValue, hasVaultKey } from "@/lib/github/crypto";
import { TOKEN_COOKIE } from "@/lib/github/oauth";

/** Les codes d'erreur que l'écran sait traduire. */
export type GithubRouteError =
  | "unconfigured"
  | "no-token"
  | "no-scope"
  | "not-found"
  | "api";

/** Le jeton décrypté du cookie, ou `null`. */
export async function githubToken(request: Request): Promise<string | null> {
  if (!hasVaultKey()) return null;
  const raw = readCookie(request.headers.get("cookie"), TOKEN_COOKIE);
  if (!raw) return null;
  return decryptValue(process.env.GITHUB_CRYPT_KEY ?? "", raw);
}

/** Le jeton, ou une réponse d'erreur prête à renvoyer. */
export async function requireToken(
  request: Request,
): Promise<{ token: string } | { response: Response }> {
  if (!hasVaultKey()) {
    return { response: errorResponse("unconfigured", 503) };
  }
  const token = await githubToken(request);
  if (!token) {
    return { response: errorResponse("no-token", 401) };
  }
  return { token };
}

/** Un appel JSON à `api.github.com` portant le jeton. */
export async function ghJson<T>(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const res = await fetch(`https://api.github.com${path}`, {
    method: init?.method ?? "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) return { ok: false, status: res.status };

  const data = (await res.json().catch(() => null)) as T | null;
  if (data === null) return { ok: false, status: 502 };
  return { ok: true, data };
}

/** Traduit un statut HTTP GitHub en code d'erreur d'écran. */
export function githubErrorCode(status: number): GithubRouteError {
  if (status === 404) return "not-found";
  if (status === 401) return "no-token";
  if (status === 403) return "no-scope";
  return "api";
}

/** Une réponse d'erreur JSON, sans fuite dans le corps. */
export function errorResponse(code: GithubRouteError, status = 502): Response {
  return Response.json({ error: code }, { status });
}

/** Une réponse JSON sans cache. */
export function jsonResponse(body: unknown): Response {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

/** Lit un paramètre de requête, nettoyé. */
export function param(request: Request, key: string): string | null {
  const value = new URL(request.url).searchParams.get(key);
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * `propriétaire/dépôt` validé.
 *
 * On refuse tout ce qui n'est pas un couple de segments GitHub : sans
 * cette garde, un chemin pourrait se glisser dans l'URL d'API.
 */
const SEGMENT = /^[A-Za-z0-9._-]+$/;

export function parseOwnerRepo(
  owner: string | null,
  repo: string | null,
): { owner: string; repo: string } | null {
  if (!owner || !repo) return null;
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null;
  return { owner, repo };
}

/** Décode un cookie `nom=valeur` d'un en-tête `cookie`. */
function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}
