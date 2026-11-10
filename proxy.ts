import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseUrl } from "@/lib/backend";

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function denyAdminRequest() {
  return new NextResponse(null, {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/**
 * Le backend ne répond pas ou la configuration manque : ce n'est pas une
 * page absente, c'est une panne. Renvoyer 404 ici faisait croire que
 * `/admin` n'existait pas, alors que la route est bien là.
 */
function adminUnavailable(reason: string) {
  return new NextResponse(
    `Administration indisponible.\n\n${reason}\n\nVérifie la configuration Supabase et que le backend est démarré, puis recharge cette page.`,
    {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "5",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}

/**
 * Sans session, on conduit à la connexion plutôt qu'à un 404 : le compte
 * admin existe peut-être, il n'est simplement pas ouvert. Le 404 reste la
 * réponse pour un compte **connecté** qui n'a pas le rôle, afin de ne pas
 * exposer l'existence de la console à un membre ordinaire.
 */
function signInForAdmin(request: NextRequest) {
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  login.searchParams.set("next", "/admin");
  return NextResponse.redirect(login);
}

export async function proxy(request: NextRequest) {
  const url = getSupabaseUrl();
  if (!url || !anonKey) {
    console.error("Admin access check failed: Supabase configuration unavailable");
    return adminUnavailable("La configuration Supabase est absente.");
  }

  let response = NextResponse.next({ request });
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) {
    console.error("Admin access check failed: session lookup", {
      code: authError.code ?? "unknown",
    });
    return adminUnavailable("La session n'a pas pu être vérifiée.");
  }
  if (!auth.user) return signInForAdmin(request);

  const { data: profile, error: profileError } = await client
    .from("users")
    .select("is_admin")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Admin access check failed: role lookup", {
      code: profileError.code ?? "unknown",
    });
    return adminUnavailable("Le rôle du compte n'a pas pu être lu.");
  }
  if (profile?.is_admin !== true) return denyAdminRequest();

  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
