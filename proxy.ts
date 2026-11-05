import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseUrl } from "@/lib/backend";
import { serverCannotCheckAdmin } from "@/lib/admin-access";
import { AUTH_COOKIE_NAME } from "@/lib/supabase/auth-cookie";

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

export async function proxy(request: NextRequest) {
  // Démonstration ou backend absent : aucune session serveur ne peut
  // exister, donc aucun rôle serveur à vérifier. Refuser ici rendrait
  // `/admin` inaccessible même à un compte administrateur ; on laisse
  // `AdminGate` décider sur le profil client, et l'en-tête `noindex` reste
  // posé pour ne pas exposer la route.
  if (serverCannotCheckAdmin()) {
    const response = NextResponse.next({ request });
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  const url = getSupabaseUrl();
  if (!url || !anonKey) {
    console.error("Admin access check failed: Supabase configuration unavailable");
    return denyAdminRequest();
  }

  let response = NextResponse.next({ request });
  const client = createServerClient(url, anonKey, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
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
    return denyAdminRequest();
  }
  if (!auth.user) return denyAdminRequest();

  const { data: profile, error: profileError } = await client
    .from("users")
    .select("is_admin")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Admin access check failed: role lookup", {
      code: profileError.code ?? "unknown",
    });
    return denyAdminRequest();
  }
  if (profile?.is_admin !== true) return denyAdminRequest();

  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
