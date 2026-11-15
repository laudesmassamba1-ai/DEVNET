export {
  createAuthService,
  hashSessionToken,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
} from "./application/auth-service";
export type {
  AuthService,
  AuthServiceDependencies,
  ChangePasswordResult,
  ExternalSignInResult,
  ResolvedSession,
  SignInResult,
  SignUpResult,
} from "./application/auth-service";
export {
  ABSENT_CREDENTIAL_HASH,
  hashPassword,
  verifyPassword,
} from "./application/password";
export {
  createOAuthState,
  isOAuthProvider,
  OAUTH_PROVIDERS,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
  oauthAuthorizeUrl,
  oauthRedirectUri,
  openOAuthState,
  safeNextPath,
  sealOAuthState,
} from "./application/oauth";
export type {
  OAuthProfile,
  OAuthProvider,
  OAuthState,
} from "./application/oauth";
export { AuthRepositoryError } from "./ports/auth-repository";
export type {
  AuthRepository,
  CreatedAccount,
  CredentialsRecord,
  ExternalIdentityRecord,
  ExternalProvider,
  NewAccount,
  NewExternalAccount,
  NewSession,
  SessionRecord,
} from "./ports/auth-repository";
