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
import type {
  AuthRepository,
  CreatedAccount,
  ExternalProvider,
} from "../ports/auth-repository";
import { AuthRepositoryError } from "../ports/auth-repository";
import { ABSENT_CREDENTIAL_HASH, hashPassword, verifyPassword } from "./password";

/** Trente jours : la durée d'un « rester connecté » ordinaire. */
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Longueur minimale acceptée partout : routes, service, écrans. */
export const MIN_PASSWORD_LENGTH = 6;

export interface AuthServiceDependencies {
  repository: AuthRepository;
  now?: () => Date;
  sessionTtlMs?: number;
}

export type SignInResult =
  | {
      ok: true;
      userId: string;
      email: string;
      sessionId: string;
      token: string;
      expiresAt: Date;
    }
  | { ok: false; reason: "invalid-credentials" };

export type SignUpResult =
  | {
      ok: true;
      userId: string;
      email: string;
      sessionId: string;
      token: string;
      expiresAt: Date;
    }
  | { ok: false; reason: "email-taken" }
  | { ok: false; reason: "weak-password" };

export interface ResolvedSession {
  userId: string;
  sessionId: string;
  email: string;
  metadata: Record<string, unknown>;
  expiresAt: Date;
}

export type ExternalSignInResult =
  | {
      ok: true;
      userId: string;
      email: string;
      sessionId: string;
      token: string;
      expiresAt: Date;
      accountCreated: boolean;
    }
  | { ok: false; reason: "invalid-identity" | "email-unverified" };

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: "invalid-session" | "invalid-credentials" | "weak-password" };

export interface AuthService {
  signIn(input: {
    email: string;
    password: string;
    userAgent?: string | null;
  }): Promise<SignInResult>;
  signUp(input: {
    email: string;
    password: string;
    metadata?: Record<string, unknown>;
    userAgent?: string | null;
  }): Promise<SignUpResult>;
  signInWithExternalIdentity(input: {
    provider: ExternalProvider;
    subject: string;
    email: string;
    emailVerified: boolean;
    metadata?: Record<string, unknown>;
    userAgent?: string | null;
  }): Promise<ExternalSignInResult>;
  resolveSession(
    token: string | null | undefined,
  ): Promise<ResolvedSession | null>;
  signOut(token: string | null | undefined): Promise<void>;
  changePassword(input: {
    token: string | null | undefined;
    currentPassword?: string | null;
    newPassword: string;
  }): Promise<ChangePasswordResult>;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isDuplicateKey(error: unknown): boolean {
  return error instanceof AuthRepositoryError && error.code === "23505";
}

export function createAuthService(dependencies: AuthServiceDependencies): AuthService {
  const { repository } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const ttl = dependencies.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;

  async function openSession(
    account: { userId: string; email: string },
    userAgent?: string | null,
  ): Promise<{
    userId: string;
    email: string;
    sessionId: string;
    token: string;
    expiresAt: Date;
  }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now().getTime() + ttl);
    const sessionId = await repository.createSession({
      userId: account.userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      userAgent: userAgent ?? null,
    });

    return {
      userId: account.userId,
      email: account.email,
      sessionId,
      token,
      expiresAt,
    };
  }

  async function resolveSession(
    token: string | null | undefined,
  ): Promise<ResolvedSession | null> {
    if (!token) return null;

    const tokenHash = hashSessionToken(token);
    const session = await repository.findSessionByTokenHash(tokenHash);
    if (!session) return null;

    if (session.expiresAt.getTime() <= now().getTime()) {
      await repository.deleteSessionByTokenHash(tokenHash);
      return null;
    }

    return {
      userId: session.userId,
      sessionId: session.id,
      email: session.email,
      metadata: session.metadata,
      expiresAt: session.expiresAt,
    };
  }

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

      const session = await openSession(credentials, input.userAgent);
      return { ok: true, ...session };
    },

    async signUp(input) {
      if (input.password.length < MIN_PASSWORD_LENGTH) {
        return { ok: false, reason: "weak-password" };
      }

      const email = normalizeEmail(input.email);
      let account: CreatedAccount;
      try {
        account = await repository.createAccount({
          email,
          passwordHash: await hashPassword(input.password),
          metadata: input.metadata ?? {},
        });
      } catch (error) {
        if (isDuplicateKey(error)) return { ok: false, reason: "email-taken" };
        throw error;
      }

      const session = await openSession(account, input.userAgent);
      return { ok: true, ...session };
    },

    async signInWithExternalIdentity(input) {
      const provider = input.provider;
      const subject = input.subject.trim();
      const email = normalizeEmail(input.email ?? "");

      if (!subject || !email) {
        return { ok: false, reason: "invalid-identity" };
      }
      if (!input.emailVerified) {
        return { ok: false, reason: "email-unverified" };
      }

      const existing = await repository.findExternalIdentity(provider, subject);
      if (existing) {
        const session = await openSession(existing, input.userAgent);
        return { ok: true, ...session, accountCreated: false };
      }

      const metadata = {
        ...(input.metadata ?? {}),
        oauth_provider: provider,
        oauth_subject: subject,
      };

      let account = await repository.findAccountByEmail(email);
      let accountCreated = false;

      if (account) {
        account = await repository.linkExternalIdentity({
          provider,
          subject,
          userId: account.userId,
          email,
        });
      } else {
        try {
          account = await repository.createExternalAccount({
            provider,
            subject,
            email,
            metadata,
          });
          accountCreated = true;
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;

          // Deux callbacks simultanés : l'un a créé le compte ou lié
          // l'identité pendant que l'autre lisait. On relit le résultat
          // gagnant au lieu d'ouvrir une session sur une ligne inventée.
          const raced = await repository.findExternalIdentity(provider, subject);
          if (raced) {
            account = raced;
          } else {
            const byEmail = await repository.findAccountByEmail(email);
            if (!byEmail) throw error;
            account = await repository.linkExternalIdentity({
              provider,
              subject,
              userId: byEmail.userId,
              email,
            });
          }
        }
      }

      const session = await openSession(account, input.userAgent);
      return { ok: true, ...session, accountCreated };
    },

    resolveSession,

    async signOut(token) {
      if (!token) return;
      await repository.deleteSessionByTokenHash(hashSessionToken(token));
    },

    async changePassword(input) {
      if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
        return { ok: false, reason: "weak-password" };
      }

      const session = await resolveSession(input.token);
      if (!session) return { ok: false, reason: "invalid-session" };

      const credentials = await repository.findCredentialsByUserId(session.userId);

      // Un compte créé par Google/GitHub n'a pas encore d'empreinte :
      // la session prouve l'identité, on peut donc poser un premier mot
      // de passe. S'il en existe déjà un, la vérification reste obligatoire.
      if (input.currentPassword) {
        if (!credentials) return { ok: false, reason: "invalid-credentials" };
        const matches = await verifyPassword(
          input.currentPassword,
          credentials.passwordHash,
        );
        if (!matches) return { ok: false, reason: "invalid-credentials" };
      }

      await repository.updatePassword(
        session.userId,
        await hashPassword(input.newPassword),
      );
      return { ok: true };
    },
  };
}
