/**
 * Adaptateur PostgreSQL de l'authentification.
 *
 * Il reçoit un exécuteur de requêtes **privilégié** — la connexion du
 * propriétaire de la base. Ce n'est pas un raccourci : `user_credentials` et
 * `sessions` n'ont aucune politique RLS, donc une identité d'utilisateur n'y
 * voit rien. Une empreinte de mot de passe ne doit jamais être lisible, même
 * par son propriétaire, depuis une requête applicative.
 */
import type {
  AuthRepository,
  CredentialsRecord,
  NewSession,
  SessionRecord,
} from "../../ports/auth-repository";
import { AuthRepositoryError } from "../../ports/auth-repository";

export type AuthSqlQuery = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  values?: unknown[],
) => Promise<T[]>;

export interface PostgresAuthDependencies {
  query: AuthSqlQuery;
}

function pgCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "postgres";
}

/** `expires_at` arrive en `Date` côté pilote ; le port veut un `Date`. */
function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly dependencies: PostgresAuthDependencies) {}

  async findCredentialsByEmail(email: string): Promise<CredentialsRecord | null> {
    try {
      const rows = await this.dependencies.query<{
        user_id: string;
        email: string;
        password_hash: string;
      }>(
        `select c.user_id::text as user_id, u.email::text as email, c.password_hash
           from public.user_credentials c
           join auth.users u on u.id = c.user_id
          where lower(u.email) = lower($1)
          limit 1`,
        [email],
      );

      const row = rows[0];
      if (!row) return null;
      return {
        userId: String(row.user_id),
        email: String(row.email),
        passwordHash: String(row.password_hash),
      };
    } catch (error) {
      throw new AuthRepositoryError("find-credentials", pgCode(error), { cause: error });
    }
  }

  async createSession(session: NewSession): Promise<string> {
    try {
      const rows = await this.dependencies.query<{ id: string }>(
        `insert into public.sessions (user_id, token_hash, expires_at, user_agent)
         values ($1, $2, $3, $4)
         returning id::text as id`,
        [session.userId, session.tokenHash, session.expiresAt.toISOString(), session.userAgent],
      );

      const id = rows[0]?.id;
      if (!id) throw new Error("session insérée sans identifiant");
      return String(id);
    } catch (error) {
      throw new AuthRepositoryError("create-session", pgCode(error), { cause: error });
    }
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    try {
      const rows = await this.dependencies.query<{
        id: string;
        user_id: string;
        token_hash: string;
        expires_at: unknown;
      }>(
        `select id::text as id, user_id::text as user_id, token_hash, expires_at
           from public.sessions
          where token_hash = $1
          limit 1`,
        [tokenHash],
      );

      const row = rows[0];
      if (!row) return null;
      return {
        id: String(row.id),
        userId: String(row.user_id),
        tokenHash: String(row.token_hash),
        expiresAt: toDate(row.expires_at),
      };
    } catch (error) {
      throw new AuthRepositoryError("find-session", pgCode(error), { cause: error });
    }
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    try {
      await this.dependencies.query("delete from public.sessions where token_hash = $1", [
        tokenHash,
      ]);
    } catch (error) {
      throw new AuthRepositoryError("delete-session", pgCode(error), { cause: error });
    }
  }
}
