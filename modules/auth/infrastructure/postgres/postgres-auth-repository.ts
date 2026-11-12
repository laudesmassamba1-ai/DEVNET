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
  CreatedAccount,
  CredentialsRecord,
  ExternalIdentityRecord,
  ExternalProvider,
  NewAccount,
  NewExternalAccount,
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

  async findCredentialsByUserId(userId: string): Promise<CredentialsRecord | null> {
    try {
      const rows = await this.dependencies.query<{
        user_id: string;
        email: string;
        password_hash: string;
      }>(
        `select c.user_id::text as user_id, u.email::text as email, c.password_hash
           from public.user_credentials c
           join auth.users u on u.id = c.user_id
          where c.user_id = $1
          limit 1`,
        [userId],
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

  async createAccount(account: NewAccount): Promise<CreatedAccount> {
    try {
      const rows = await this.dependencies.query<{ user_id: string; email: string }>(
        `with created as (
           insert into auth.users (email, raw_user_meta_data)
           values ($1, $2::jsonb)
           returning id, email
         ), credentials as (
           insert into public.user_credentials (user_id, password_hash)
           select id, $3 from created
         )
         select id::text as user_id, email::text as email from created`,
        [account.email, JSON.stringify(account.metadata), account.passwordHash],
      );

      const row = rows[0];
      if (!row) throw new Error("compte créé sans identifiant");
      return { userId: String(row.user_id), email: String(row.email) };
    } catch (error) {
      throw new AuthRepositoryError("create-account", pgCode(error), { cause: error });
    }
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    try {
      await this.dependencies.query(
        `insert into public.user_credentials (user_id, password_hash, updated_at)
         values ($1, $2, now())
         on conflict (user_id) do update
            set password_hash = excluded.password_hash,
                updated_at = now()`,
        [userId, passwordHash],
      );
    } catch (error) {
      throw new AuthRepositoryError("update-password", pgCode(error), { cause: error });
    }
  }

  async findAccountByEmail(email: string): Promise<CreatedAccount | null> {
    try {
      const rows = await this.dependencies.query<{ user_id: string; email: string }>(
        `select id::text as user_id, email::text as email
           from auth.users
          where lower(email) = lower($1)
            and email <> ''
          limit 1`,
        [email],
      );

      const row = rows[0];
      if (!row) return null;
      return { userId: String(row.user_id), email: String(row.email) };
    } catch (error) {
      throw new AuthRepositoryError("find-account", pgCode(error), { cause: error });
    }
  }

  async findExternalIdentity(
    provider: ExternalProvider,
    subject: string,
  ): Promise<ExternalIdentityRecord | null> {
    try {
      const rows = await this.dependencies.query<{
        provider: string;
        subject: string;
        user_id: string;
        email: string;
      }>(
        `select i.provider,
                i.subject,
                i.user_id::text as user_id,
                u.email::text as email
           from public.user_identities i
           join auth.users u on u.id = i.user_id
          where i.provider = $1
            and i.subject = $2
          limit 1`,
        [provider, subject],
      );

      const row = rows[0];
      if (!row) return null;
      return {
        provider: row.provider as ExternalProvider,
        subject: String(row.subject),
        userId: String(row.user_id),
        email: String(row.email),
      };
    } catch (error) {
      throw new AuthRepositoryError("find-identity", pgCode(error), { cause: error });
    }
  }

  async createExternalAccount(account: NewExternalAccount): Promise<CreatedAccount> {
    try {
      const rows = await this.dependencies.query<{ user_id: string; email: string }>(
        `with created as (
           insert into auth.users (email, raw_user_meta_data)
           values ($3, $4::jsonb)
           returning id, email
         ), identity as (
           insert into public.user_identities (provider, subject, user_id, email)
           select $1, $2, id, email from created
         )
         select id::text as user_id, email::text as email from created`,
        [
          account.provider,
          account.subject,
          account.email,
          JSON.stringify(account.metadata),
        ],
      );

      const row = rows[0];
      if (!row) throw new Error("compte externe créé sans identifiant");
      return { userId: String(row.user_id), email: String(row.email) };
    } catch (error) {
      throw new AuthRepositoryError("create-external-account", pgCode(error), {
        cause: error,
      });
    }
  }

  async linkExternalIdentity(identity: ExternalIdentityRecord): Promise<CreatedAccount> {
    try {
      const rows = await this.dependencies.query<{ user_id: string; email: string }>(
        `with linked as (
           insert into public.user_identities (provider, subject, user_id, email)
           values ($1, $2, $3, $4)
           on conflict (provider, subject) do update
             set email = excluded.email,
                 updated_at = now()
           returning user_id
         )
         select l.user_id::text as user_id, u.email::text as email
           from linked l
           join auth.users u on u.id = l.user_id`,
        [identity.provider, identity.subject, identity.userId, identity.email],
      );

      const row = rows[0];
      if (!row) throw new Error("identité liée sans compte");
      return { userId: String(row.user_id), email: String(row.email) };
    } catch (error) {
      throw new AuthRepositoryError("link-identity", pgCode(error), { cause: error });
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
        email: string;
        metadata: unknown;
        token_hash: string;
        expires_at: unknown;
      }>(
        `select s.id::text as id,
                s.user_id::text as user_id,
                coalesce(u.email, '')::text as email,
                coalesce(u.raw_user_meta_data, '{}'::jsonb) as metadata,
                s.token_hash,
                s.expires_at
           from public.sessions s
           join auth.users u on u.id = s.user_id
          where s.token_hash = $1
          limit 1`,
        [tokenHash],
      );

      const row = rows[0];
      if (!row) return null;
      return {
        id: String(row.id),
        userId: String(row.user_id),
        email: String(row.email),
        metadata:
          row.metadata && typeof row.metadata === "object"
            ? (row.metadata as Record<string, unknown>)
            : {},
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
