/**
 * Identité serveur — une seule source, PostgreSQL.
 *
 * La session vit dans le cookie `devnet_session` (httpOnly). Le jeton est
 * haché puis comparé à `public.sessions` par le service d'authentification.
 * Aucun appel à un service externe n'a lieu ici.
 */
import { readSessionToken } from "@/modules/auth/http/session-cookie";
import { getServerAuthService } from "@/platform/auth-container";
import type { ResolvedSession } from "@/modules/auth";

export async function currentSession(): Promise<ResolvedSession | null> {
  return getServerAuthService().resolveSession(await readSessionToken());
}

export async function currentUserId(): Promise<string | null> {
  const session = await currentSession();
  return session?.userId ?? null;
}
