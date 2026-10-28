/**
 * Les branches d'un dépôt GitHub.
 *
 * `GET /api/github/branches?owner=&repo=` — la page de détail les liste
 * et permet de choisir la référence affichée (branche ou tag).
 */

import type { GithubBranchSummary } from "@/lib/types";
import {
  errorResponse,
  ghJson,
  githubErrorCode,
  jsonResponse,
  param,
  parseOwnerRepo,
  requireToken,
} from "@/lib/github/api";

const PER_PAGE = 100;

export async function GET(request: Request) {
  const auth = await requireToken(request);
  if ("response" in auth) return auth.response;

  const ref = parseOwnerRepo(param(request, "owner"), param(request, "repo"));
  if (!ref) return errorResponse("not-found", 400);

  const res = await ghJson<RawBranch[]>(
    auth.token,
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(
      ref.repo,
    )}/branches?per_page=${PER_PAGE}`,
  );
  if (!res.ok) return errorResponse(githubErrorCode(res.status));
  if (!Array.isArray(res.data)) return errorResponse("api");

  const branches = res.data
    .map(toSummary)
    .filter((b): b is GithubBranchSummary => b !== null);

  return jsonResponse({ branches });
}

interface RawBranch {
  name?: string;
  commit?: { sha?: string };
  protected?: boolean;
}

function toSummary(raw: RawBranch): GithubBranchSummary | null {
  if (!raw.name) return null;
  return {
    name: raw.name,
    sha: raw.commit?.sha ?? "",
    protected: Boolean(raw.protected),
  };
}
