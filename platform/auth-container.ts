import { createAuthService, type AuthService } from "@/modules/auth/application/auth-service";
import { PostgresAuthRepository } from "@/modules/auth/infrastructure/postgres/postgres-auth-repository";
import {
  exchangeOAuthCode,
  fetchOAuthProfile,
  readOAuthConfig,
  readOAuthStateSecret,
} from "@/modules/auth/infrastructure/oauth/oauth-client";
import type { AuthRepository } from "@/modules/auth/ports/auth-repository";
import { getPostgresPool } from "./infrastructure/postgres/pool";

export function getServerAuthRepository(): AuthRepository {
  return new PostgresAuthRepository({
    query: async (sql, values) => (await getPostgresPool().query(sql, values)).rows,
  });
}

export function getServerAuthService(): AuthService {
  return createAuthService({ repository: getServerAuthRepository() });
}

/** Réseau et configuration OAuth, composés hors des routes. */
export const serverOAuthClient = {
  config: readOAuthConfig,
  stateSecret: readOAuthStateSecret,
  exchangeCode: exchangeOAuthCode,
  fetchProfile: fetchOAuthProfile,
};
