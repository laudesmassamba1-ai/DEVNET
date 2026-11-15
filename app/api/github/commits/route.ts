/**
 * L'historique d'une branche GitHub.
 *
 * `GET /api/github/commits?owner=&repo=&ref=&per_page=` — la page de
 * détail l'affiche tel quel. On ne transporte que ce que la liste
 * montre : le sha, la première ligne du message, l'auteur et la date.
 */

import type { GithubCommitSummary } from "@/lib/types";
import {
  errorResponse,
  ghJson,
  githubErrorCode,
  jsonResponse,
  param,
  parseOwnerRepo,
  requireToken,
} from "@/lib/github/api";

const DEFAULT_PER_PAGE = 30;

export async function GET(request: Request) {
  const auth = await requireToken(request);
  if ("response" in auth) return auth.response;

  const ref = parseOwnerRepo(param(request, "owner"), param(request, "repo"));
  if (!ref) return errorResponse("not-found", 400);

  const perPage = clamp(param(request, "per_page"), DEFAULT_PER_PAGE, 1, 100);
  const branch = param(request, "ref");
  const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const query = new URLSearchParams({ per_page: String(perPage) });
  if (branch) query.set("sha", branch);

  const res = await ghJson<RawCommit[]>(auth.token, `${base}/commits?${query}`);
  if (!res.ok) return errorResponse(githubErrorCode(res.status));
  if (!Array.isArray(res.data)) return errorResponse("api");

  const commits = res.data
    .map(toSummary)
    .filter((c): c is GithubCommitSummary => c !== null);

  return jsonResponse({ commits });
}

interface RawCommit {
  sha?: string;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string } | null;
  };
  author?: { login?: string } | null;
}

function toSummary(raw: RawCommit): GithubCommitSummary | null {
  if (!raw.sha) return null;
  return {
    sha: raw.sha,
    message: raw.commit?.message ?? "",
    author_name: raw.commit?.author?.name ?? null,
    author_login: raw.author?.login ?? null,
    date: raw.commit?.author?.date ?? null,
  };
}

function clamp(value: string | null, fallback: number, min: number, max: number): number {
  const n = value ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
