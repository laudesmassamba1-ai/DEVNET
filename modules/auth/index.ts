export {
  createAuthService,
  hashSessionToken,
  normalizeEmail,
} from "./application/auth-service";
export type { AuthService, AuthServiceDependencies, SignInResult } from "./application/auth-service";
export {
  ABSENT_CREDENTIAL_HASH,
  hashPassword,
  verifyPassword,
} from "./application/password";
export { AuthRepositoryError } from "./ports/auth-repository";
export type {
  AuthRepository,
  CredentialsRecord,
  NewSession,
  SessionRecord,
} from "./ports/auth-repository";
