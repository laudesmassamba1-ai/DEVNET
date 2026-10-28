/**
 * Les dépôts **publics** d'un utilisateur GitHub — route de profil public.
 *
 * ## Pourquoi une route distincte de `/api/github/repos`
 *
 * `/api/github/repos` lit le cookie `devnet_gh` : c'est la liste du compte
 * **connecté**, jeton à l'appui, avec ses dépôts privés si le scope les
 * autorise. Cette route n'a **aucun cookie, aucun jeton, aucun
 * `client_secret`** : elle appelle `api.github.com/users/<login>/repos`
 * en clair. Comme l'appel est anonyme, GitHub ne renvoie de toute façon
 * que les dépôts publics — les privés n'existent pas pour un appelant non
 * authentifié.
 *
 * Ce n'est pas laissé au hasard : `private` est **filtré une seconde fois
 * côté serveur** (`repos.filter((r) => !r.private)`). Si un jour on
 * ajoutait un jeton pour relever la limite de débit, la route ne
 * deviendrait pas une fuite — elle resterait publique.
 *
 * ## Limite de débit
 *
 * 60 appels/heure et IP sans authentification. C'est le prix du « jamais
 * de privé » : plutôt qu'un jeton serveur qui donnerait accès à plus que
 * ce qu'on affiche, on accepte l'échec silencieux. L'écran montre alors
 * « dépôts indisponibles » au lieu d'un vide qui mentirait.
 */

import { NextRequest, NextResponse } from "next/server";
import type { PublicGithubRepo } from "@/lib/types";

const GH_BASE = "https://api.github.com";
const ACCEPT = "application/vnd.github+json";
const PER_PAGE = 30;

/** Un login GitHub : lettres, chiffres et tirets, 39 caractères au plus. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ login: string }> },
) {
  const { login } = await params;

  if (!LOGIN.test(login)) {
    return NextResponse.json({ error: "bad-login" }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(
      `${GH_BASE}/users/${encodeURIComponent(login)}/repos` +
        `?type=owner&sort=updated&per_page=${PER_PAGE}`,
      {
        headers: { accept: ACCEPT },
        // Quarante secondes de cache **serveur**, et pas une de plus.
        //
        // C'est un arbitrage de latence, pas de confidentialité : l'appel
        // est anonyme, donc il ne voit que des dépôts publics — les
        // privés n'existent pas pour un appelant sans jeton. Mais une
        // seconde lecture du même profil ne doit pas reposer une dixième
        // de seconde sur le réseau : c'est la liste qui se charge à
        // l'ouverture de l'onglet, au moment où le lecteur attend déjà
        // les projets DevNet.
        //
        // Quarante secondes, c'est assez pour que deux visites
        // consécutives se partagent le trajet, et trop peu pour que la
        // page raconte un état périmé.
        next: { revalidate: 40 },
      },
    );
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }

  if (!res.ok) {
    // 403 = limite de débit épuisée, 404 = compte inexistant.
    const status = res.status === 404 ? 404 : 429;
    return NextResponse.json(
      { error: res.status === 404 ? "no-account" : "rate-limited" },
      { status },
    );
  }

  const payload: unknown = await res.json();
  const rows = Array.isArray(payload) ? (payload as Record<string, unknown>[]) : [];

  const repos: PublicGithubRepo[] = rows
    // La seconde porte : même si GitHub renvoyait autre chose que des
    // dépôts publics, la réponse ne sort pas d'ici.
    .filter((row) => row.private !== true)
    .map((row) => ({
      id: Number(row.id),
      full_name: String(row.full_name ?? ""),
      name: String(row.name ?? ""),
      html_url: String(row.html_url ?? ""),
      description: typeof row.description === "string" ? row.description : null,
      language: typeof row.language === "string" ? row.language : null,
      stargazers_count: Number(row.stargazers_count ?? 0),
      fork: row.fork === true,
      pushed_at: typeof row.pushed_at === "string" ? row.pushed_at : null,
    }));

  return NextResponse.json({ repos });
}
