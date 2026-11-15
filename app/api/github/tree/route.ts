/**
 * L'arbre des fichiers d'un dépôt GitHub.
 *
 * `GET /api/github/tree?owner=&repo=&ref=` — renvoie la liste **plate**
 * des entrées (fichiers et répertoires) via `git/trees/{ref}?recursive=1`.
 * La page filtre à l'écran ; une liste plate évite une requête par
 * dossier, ce qui rendrait l'exploration lente pour un dépôt profond.
 *
 * L'arbre récursif de GitHub peut être coupé (`truncated`) sur un très
 * gros dépôt. On le signale par un champ `truncated`, plutôt que de
 * laisser croire que la liste est complète.
 */

import type { GithubTreeEntry } from "@/lib/types";
import {
  errorResponse,
  ghJson,
  githubErrorCode,
  jsonResponse,
  param,
  parseOwnerRepo,
  requireToken,
} from "@/lib/github/api";

/** Assez pour montrer un dépôt réel, assez peu pour ne pas le charger en mémoire. */
const MAX_ENTRIES = 3000;

export async function GET(request: Request) {
  const auth = await requireToken(request);
  if ("response" in auth) return auth.response;

  const ref = parseOwnerRepo(param(request, "owner"), param(request, "repo"));
  if (!ref) return errorResponse("not-found", 400);

  let treeish = param(request, "ref");
  if (!treeish) {
    const repo = await ghJson<{ default_branch?: string }>(
      auth.token,
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`,
    );
    if (!repo.ok) return errorResponse(githubErrorCode(repo.status));
    treeish = repo.data.default_branch || "main";
  }

  const res = await ghJson<RawTree>(
    auth.token,
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(
      ref.repo,
    )}/git/trees/${encodeURIComponent(treeish)}?recursive=1`,
  );
  if (!res.ok) return errorResponse(githubErrorCode(res.status));

  const entries: GithubTreeEntry[] = (res.data.tree ?? [])
    .filter(
      (e): e is RawTreeEntry & { path: string; type: "blob" | "tree" } =>
        typeof e.path === "string" && (e.type === "blob" || e.type === "tree"),
    )
    .slice(0, MAX_ENTRIES)
    .map((e) => ({
      path: e.path,
      type: e.type,
      size: typeof e.size === "number" ? e.size : null,
    }));

  return jsonResponse({ entries, truncated: Boolean(res.data.truncated) });
}

interface RawTreeEntry {
  path?: string;
  type?: string;
  size?: number;
}

interface RawTree {
  truncated?: boolean;
  tree?: RawTreeEntry[];
}
