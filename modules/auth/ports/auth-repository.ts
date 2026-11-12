/**
 * Port d'authentification.
 *
 * Le port ne parle que de résultats : une empreinte, une session, un jeton
 * déjà haché. Il ne sait ni comment le mot de passe est vérifié (c'est le
 * service), ni où les lignes vivent (c'est l'adaptateur). C'est ce qui
 * permettra de remplacer PostgreSQL par autre chose sans toucher aux règles.
 */

export interface CredentialsRecord {
  userId: string;
  email: string;
  passwordHash: string;
}

export interface NewSession {
  userId: string;
  /** SHA-256 du jeton : le jeton lui-même n'entre jamais en base. */
  tokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  email: string;
  metadata: Record<string, unknown>;
  tokenHash: string;
  expiresAt: Date;
}

export interface NewAccount {
  email: string;
  passwordHash: string;
  metadata: Record<string, unknown>;
}

export interface CreatedAccount {
  userId: string;
  email: string;
}

export type ExternalProvider = "google" | "github";

export interface ExternalIdentityRecord {
  provider: ExternalProvider;
  subject: string;
  userId: string;
  email: string;
}

export interface NewExternalAccount {
  provider: ExternalProvider;
  subject: string;
  email: string;
  metadata: Record<string, unknown>;
}

export interface AuthRepository {
  findCredentialsByEmail(email: string): Promise<CredentialsRecord | null>;
  findCredentialsByUserId(userId: string): Promise<CredentialsRecord | null>;
  createAccount(account: NewAccount): Promise<CreatedAccount>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  findAccountByEmail(email: string): Promise<CreatedAccount | null>;
  findExternalIdentity(
    provider: ExternalProvider,
    subject: string,
  ): Promise<ExternalIdentityRecord | null>;
  createExternalAccount(account: NewExternalAccount): Promise<CreatedAccount>;
  /** Renvoie le compte effectivement lié (l'identité peut déjà exister). */
  linkExternalIdentity(identity: ExternalIdentityRecord): Promise<CreatedAccount>;
  /** Renvoie l'identifiant de la session créée. */
  createSession(session: NewSession): Promise<string>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
}

export class AuthRepositoryError extends Error {
  constructor(
    readonly operation:
      | "find-credentials"
      | "create-account"
      | "update-password"
      | "find-account"
      | "find-identity"
      | "create-external-account"
      | "link-identity"
      | "create-session"
      | "find-session"
      | "delete-session",
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super("Authentification indisponible. Réessaie dans un instant.", options);
    this.name = "AuthRepositoryError";
  }
}
