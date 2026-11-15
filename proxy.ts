import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "devnet_session";

/**
 * Porte d'entrée de `/admin`.
 *
 * Le proxy ne vérifie ici que la **présence** du cookie de session : il
 * tourne avant le rendu et ne doit pas ouvrir une connexion PostgreSQL
 * par requête. La vérification réelle (session valide + `is_admin`) est
 * faite dans `app/admin/layout.tsx`, qui a accès à la base.
 *
 * Sans cookie, on conduit à la connexion. Avec un cookie invalide ou un
 * compte non administrateur, le layout répond 404 pour ne pas exposer
 * l'existence de la console.
 */
export async function proxy(request: NextRequest) {
  // En démonstration forcée, il n'y a pas de session serveur : la console
  // d'administration est un écran client, et le rôle est porté par le store
  // de démonstration.
  if (process.env.NEXT_PUBLIC_FORCE_DEMO === "true") {
    return NextResponse.next({ request });
  }

  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", "/admin");
    return NextResponse.redirect(login);
  }

  const response = NextResponse.next({ request });
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
