/**
 * Cookie de session PostgreSQL.
 *
 * Nom distinct du cookie Supabase (`sb-devnet-auth-token`) : les deux
 * systèmes peuvent coexister pendant la bascule sans s'écraser.
 */
export const SESSION_COOKIE_NAME = "devnet-session";

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}