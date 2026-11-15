/**
 * Les dépôts GitHub du compte connecté.
 *
 * Même borne que les autres routes GitHub : le route lit **un seul**
 * cookie (`devnet_gh`), déchiffre le jeton, appelle `api.github.com`, et
 * renvoie une liste. Il ne lit aucune table DevNet, n'écrit rien, et ne
 * connaît l'utilisateur que par le jeton — c'est l'exception bornée à la
 * règle « pas de route handler » (MEMO §9) : appeler GitHub avec le
 * `client_secret`/le jeton exige un serveur, un navigateur ne peut pas.
 *
 * ## Pourquoi trier par poussée récente
 *
 * `sort=updated` et non `sort=created` : le dépôt qu'on veut rattacher
 * est presque toujours celui sur lequel on vient de travailler, pas celui
 * qu'on a créé le plus récemment. La liste met donc « ce sur quoi on
 * travaille » en tête, et non « ce qui est neuf ».
 *
 * ## Les affiliations
 *
 * `owner,collaborator,organization_member` : le rattachement n'a pas de
 * sens pour un dépôt qu'on ne peut pas lire, mais on veut voir ceux de
 * son organisation autant que les siens. GitHub ne renvoie de toute façon
 * que ce que le jeton a le droit de lire.
 */

import { NextRequest, NextResponse } from "next/server";
import { decryptValue, hasVaultKey } from "@/lib/github/crypto";
import { githubErrorCode } from "@/lib/github/api";
import { TOKEN_COOKIE } from "@/lib/github/oauth";
import type { GithubRepo } from "@/lib/types";

const GH_BASE = "https://api.github.com";
const ACCEPT = "application/vnd.github+json";
const PER_PAGE = 100;

/**
 * Efface le cookie de jeton GitHub.
 *
 * Le cookie est posé pour `/api/github` seulement : on le supprime au même
 * chemin, sinon le navigateur conserverait l'ancien. Sans cela, un jeton
 * révoqué resterait envoyé à chaque appel et l'écran proposerait
 * « Réessayer » indéfiniment au lieu de reconnecter.
 */
function clearTokenCookie(response: NextResponse): void {
  response.cookies.set(TOKEN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/github",
    maxAge: 0,
  });
}

export async function GET(request: NextRequest) {
  if (!hasVaultKey()) {
    return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  }

  const envelope = request.cookies.get(TOKEN_COOKIE)?.value;
  if (!envelope) {
    return NextResponse.json({ error: "no-token" }, { status: 401 });
  }

  const token = await decryptValue(process.env.GITHUB_CRYPT_KEY ?? "", envelope);
  if (!token) {
    return NextResponse.json({ error: "no-token" }, { status: 401 });
  }

  const url =
    `${GH_BASE}/user/repos?per_page=${PER_PAGE}&sort=updated` +
    `&affiliation=owner,collaborator,organization_member`;

  const res = await fetch(url, {
    headers: { accept: ACCEPT, authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    // Un 403 peut être une limite de débit (le jeton est valide, il faut
    // réessayer plus tard) ou un scope manquant (il faut se reconnecter) :
    // `x-ratelimit-remaining: 0` les distingue. Un 401 signifie que le
    // jeton rangé n'est plus accepté — on efface alors le cookie pour que
    // l'écran propose de se reconnecter plutôt qu'un « Réessayer » sans fin.
    const limited =
      res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0";
    const code = limited ? "api" : githubErrorCode(res.status);
    const response = NextResponse.json({ error: code }, { status: 502 });
    if (code === "no-token") clearTokenCookie(response);
    return response;
  }

  const data = (await res.json().catch(() => null)) as RawRepo[] | null;
  if (!Array.isArray(data)) {
    return NextResponse.json({ error: "api" }, { status: 502 });
  }

  const repos: GithubRepo[] = data
    .map(toRepo)
    .filter((repo): repo is GithubRepo => repo !== null);

  return NextResponse.json(
    { repos },
    { headers: { "cache-control": "no-store" } },
  );
}

interface RawRepo {
  id?: number;
  full_name?: string;
  name?: string;
  private?: boolean;
  default_branch?: string;
  html_url?: string;
  description?: string | null;
  language?: string | null;
  pushed_at?: string | null;
  owner?: { login?: string };
}

/**
 * Réduit un dépôt GitHub à ce que l'écran montre.
 *
 * Un dépôt sans `full_name`/`owner` est écarté plutôt que rendu avec des
 * trous : on préfère une liste plus courte à une ligne qu'on ne peut pas
 * rattacher.
 */
function toRepo(raw: RawRepo): GithubRepo | null {
  const full = raw.full_name;
  const owner = raw.owner?.login;
  const name = raw.name;
  if (!full || !owner || !name || typeof raw.id !== "number") return null;

  return {
    id: raw.id,
    full_name: full,
    owner,
    name,
    private: Boolean(raw.private),
    default_branch: raw.default_branch || "main",
    html_url: raw.html_url ?? `https://github.com/${full}`,
    description: raw.description ?? null,
    language: raw.language ?? null,
    pushed_at: raw.pushed_at ?? null,
  };
}
