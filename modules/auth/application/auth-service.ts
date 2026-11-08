/**
 * Règles d'authentification.
 *
 * Trois décisions y sont visibles, chacune pour une raison précise :
 *
 *  · **Une seule réponse pour un compte inconnu et un mauvais mot de passe.**
 *    Distinguer les deux dirait à qui essaie quelles adresses existent.
 *  · **Le jeton remis au navigateur n'est jamais stocké.** La base ne garde
 *    que son SHA-256 : une fuite de `public.sessions` ne donne aucune
 *    session utilisable.
 *  · **Une session expirée est supprimée au moment où on la rencontre**,
 *    pas par un travail de fond qu'il faudrait planifier et surveiller.
 */
import { createHash, randomBytes } from "node:crypto";
import type { AuthRepository } from "../ports/auth-repository";
import { ABSENT_CREDENTIAL_HASH, verifyPassword } from "./password";

/** Trente jours : la durée d'un « rester connecté » ordinaire. */
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthServiceDependencies {
  repository: AuthRepository;
  now?: () => Date;
  sessionTtlMs?: number;
}

export type SignInResult =
  | { ok: true; userId: string; sessionId: string; token: string; expiresAt: Date }
  | { ok: false; reason: "invalid-credentials" };

export interface AuthService {
  signIn(input: {
    email: string;
    password: string;
    userAgent?: string | null;
  }): Promise<SignInResult>;
  resolveSession(
    token: string | null | undefined,
  ): Promise<{ userId: string; sessionId: string } | null>;
  signOut(token: string | null | undefined): Promise<void>;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createAuthService(dependencies: AuthServiceDependencies): AuthService {
  const { repository } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const ttl = dependencies.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;

  return {
    async signIn(input) {
      const credentials = await repository.findCredentialsByEmail(
        normalizeEmail(input.email),
      );

      // L'empreinte factice garde le coût identique quand le compte n'existe pas.
      const matches = await verifyPassword(
        input.password,
        credentials?.passwordHash ?? ABSENT_CREDENTIAL_HASH,
      );
      if (!credentials || !matches) {
        return { ok: false, reason: "invalid-credentials" };
      }

      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now().getTime() + ttl);
      const sessionId = await repository.createSession({
        userId: credentials.userId,
        tokenHash: hashSessionToken(token),
        expiresAt,
        userAgent: input.userAgent ?? null,
      });

      return { ok: true, userId: credentials.userId, sessionId, token, expiresAt };
    },

    async resolveSession(token) {
      if (!token) return null;

      const tokenHash = hashSessionToken(token);
      const session = await repository.findSessionByTokenHash(tokenHash);
      if (!session) return null;

      if (session.expiresAt.getTime() <= now().getTime()) {
        await repository.deleteSessionByTokenHash(tokenHash);
        return null;
      }

      return { userId: session.userId, sessionId: session.id };
    },

    async signOut(token) {
      if (!token) return;
      await repository.deleteSessionByTokenHash(hashSessionToken(token));
    },
  };
}
