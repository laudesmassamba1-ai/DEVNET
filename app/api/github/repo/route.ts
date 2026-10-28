/**
 * Les métadonnées d'un dépôt GitHub.
 *
 * `GET /api/github/repo?owner=&repo=` — la page `/github/[owner]/[repo]`
 * l'appelle pour son en-tête. Le route lit le cookie `devnet_gh`, appelle
 * `api.github.com`, et renvoie une forme réduite (`GithubRepoDetail`).
 *
 * Rien de DevNet n'est lu ni écrit ici : c'est la même borne que
 * `app/api/github/repos/route.ts`.
 */

import type { GithubRepoDetail } from "@/lib/types";
import {
  errorResponse,
  ghJson,
  githubErrorCode,
  jsonResponse,
  param,
  parseOwnerRepo,
  requireToken,
} from "@/lib/github/api";

export async function GET(request: Request) {
  const auth = await requireToken(request);
  if ("response" in auth) return auth.response;

  const ref = parseOwnerRepo(param(request, "owner"), param(request, "repo"));
  if (!ref) return errorResponse("not-found", 400);

  const res = await ghJson<RawRepo>(
    auth.token,
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`,
  );
  if (!res.ok) return errorResponse(githubErrorCode(res.status));

  return jsonResponse(toDetail(res.data));
}

interface RawRepo {
  id?: number;
  full_name?: string;
  name?: string;
  owner?: { login?: string };
  private?: boolean;
  default_branch?: string;
  html_url?: string;
  description?: string | null;
  language?: string | null;
  pushed_at?: string | null;
  updated_at?: string | null;
  homepage?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  size?: number;
  license?: { name?: string } | null;
}

/**
 * Réduit l'objet GitHub à ce que la page montre.
 *
 * Un dépôt sans `full_name`/`owner`/`name` ne peut pas être relié à une
 * URL de page : on le laisse remonter quand même, avec des valeurs de
 * repli, parce qu'ici on affiche **un** dépôt dont on connaît déjà le
 * couple. `id` n'est pas utilisé par la page de détail mais garde la
 * cohérence avec `GithubRepo`.
 */
function toDetail(raw: RawRepo): GithubRepoDetail {
  const owner = raw.owner?.login ?? "";
  const name = raw.name ?? "";
  const full = raw.full_name ?? (owner && name ? `${owner}/${name}` : name);

  return {
    id: raw.id ?? 0,
    full_name: full,
    owner,
    name,
    private: Boolean(raw.private),
    default_branch: raw.default_branch || "main",
    html_url: raw.html_url ?? `https://github.com/${full}`,
    description: raw.description ?? null,
    language: raw.language ?? null,
    pushed_at: raw.pushed_at ?? null,
    homepage: raw.homepage ?? null,
    stargazers_count: raw.stargazers_count ?? 0,
    forks_count: raw.forks_count ?? 0,
    open_issues_count: raw.open_issues_count ?? 0,
    size: raw.size ?? 0,
    updated_at: raw.updated_at ?? null,
    license: raw.license?.name ?? null,
  };
}
