/**
 * Les lectures GitHub, côté navigateur.
 *
 * Chaque fonction appelle une route `/api/github/*` et rend soit une
 * donnée, soit un code d'erreur fermé. On ne jette pas : un dépôt privé,
 * un jeton expiré ou une panne réseau finissent tous par un message à
 * l'écran, jamais par une promesse rejetée qui viderait la page.
 */

import type {
  GithubBranchSummary,
  GithubCommitSummary,
  GithubFileContent,
  GithubRepoDetail,
  GithubTreeEntry,
} from "@/lib/types";

export type GithubReadError =
  | "unconfigured"
  | "no-token"
  | "no-scope"
  | "not-found"
  | "api";

/** Le remède de chaque échec : se reconnecter, ou réessayer. */
export const GITHUB_ERROR_TEXT: Record<GithubReadError, string> = {
  unconfigured: "GitHub n'est pas configuré sur cette instance.",
  "no-token": "Connectez GitHub depuis votre profil pour voir vos dépôts.",
  "no-scope": "Le jeton GitHub n'a pas les droits nécessaires — reconnectez-vous.",
  "not-found": "Introuvable : le dépôt est privé, ou n'existe plus.",
  api: "GitHub n'a pas répondu comme prévu. Réessayez.",
};

export interface ReadResult<T> {
  data: T | null;
  error: GithubReadError | null;
}

async function read<T>(url: string): Promise<ReadResult<T>> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as
      | (T & { error?: string })
      | { error?: string }
      | null;

    if (!res.ok) {
      const code = (body as { error?: string } | null)?.error;
      return { data: null, error: (code as GithubReadError) ?? "api" };
    }

    return { data: (body as T) ?? null, error: null };
  } catch {
    return { data: null, error: "api" };
  }
}

const pair = (owner: string, repo: string) =>
  `owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`;

export function fetchRepoDetail(owner: string, repo: string): Promise<ReadResult<GithubRepoDetail>> {
  return read<GithubRepoDetail>(`/api/github/repo?${pair(owner, repo)}`);
}

export function fetchRepoTree(
  owner: string,
  repo: string,
  ref: string,
): Promise<ReadResult<{ entries: GithubTreeEntry[]; truncated: boolean }>> {
  const q = ref ? `&ref=${encodeURIComponent(ref)}` : "";
  return read(`/api/github/tree?${pair(owner, repo)}${q}`);
}

export function fetchRepoFile(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<ReadResult<GithubFileContent>> {
  const q = ref ? `&ref=${encodeURIComponent(ref)}` : "";
  return read(`/api/github/file?${pair(owner, repo)}&path=${encodeURIComponent(path)}${q}`);
}

export function fetchRepoCommits(
  owner: string,
  repo: string,
  ref: string,
  perPage = 30,
): Promise<ReadResult<{ commits: GithubCommitSummary[] }>> {
  const q = ref ? `&ref=${encodeURIComponent(ref)}` : "";
  return read(`/api/github/commits?${pair(owner, repo)}&per_page=${perPage}${q}`);
}

export function fetchRepoBranches(
  owner: string,
  repo: string,
): Promise<ReadResult<{ branches: GithubBranchSummary[] }>> {
  return read(`/api/github/branches?${pair(owner, repo)}`);
}
