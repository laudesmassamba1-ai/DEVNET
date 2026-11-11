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
  tokenHash: string;
  expiresAt: Date;
}

export interface NewAccount {
  email: string;
  passwordHash: string;
  /** Lu par le trigger handle_new_user. */
  metadata: { pseudo?: string; prenom?: string };
}

export interface AuthRepository {
  findCredentialsByEmail(email: string): Promise<CredentialsRecord | null>;
  /** Renvoie l'identifiant de la session créée. */
  createSession(session: NewSession): Promise<string>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
  createAccount(account: NewAccount): Promise<string | null>;
}

export class AuthRepositoryError extends Error {
  constructor(
    readonly operation:
      | "find-credentials"
      | "create-session"
      | "find-session"
      | "delete-session"
      | "create-account",
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super("Authentification indisponible. Réessaie dans un instant.", options);
    this.name = "AuthRepositoryError";
  }
}
