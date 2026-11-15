/**
 * Protocole OAuth de connexion — sans réseau, sans base.
 *
 * L'état est signé (HMAC-SHA-256), pas chiffré : il ne contient aucun
 * secret, seulement le fournisseur, la page de retour, l'instant
 * d'émission et un nonce. Le cookie `httpOnly` porte le même jeton ;
 * le callback exige l'égalité des deux, donc un `state` forgé ne suffit
 * pas à ouvrir une session.
 *
 * Le profil normalisé ne retient que ce qui identifie durablement :
 * le sujet du fournisseur (`sub` Google, `id` GitHub) et une adresse
 * **vérifiée**. Un email non vérifié ne lie jamais un compte existant.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OAUTH_PROVIDERS = ["google", "github"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const OAUTH_STATE_COOKIE = "devnet_oauth_state";
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthState {
  provider: OAuthProvider;
  next: string;
  issuedAt: number;
  nonce: string;
}

export interface OAuthProfile {
  provider: OAuthProvider;
  subject: string;
  email: string;
  emailVerified: boolean;
  metadata: Record<string, unknown>;
}

export function isOAuthProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Une page de retour reste dans l'application.
 *
 * `//` et les barres inverses sont refusés : les navigateurs les lisent
 * comme une origine ou un protocole, ce qui transformerait `?next=` en
 * redirection ouverte.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/feed";
  if (value.includes("\\") || /[\s<>]/.test(value)) return "/feed";
  return value;
}

export function oauthRedirectUri(origin: string, provider: OAuthProvider): string {
  return `${origin.replace(/\/+$/, "")}/api/auth/oauth/${provider}/callback`;
}

/** Construit l'état signé remis au fournisseur et au cookie. */
export function sealOAuthState(
  secret: string,
  state: OAuthState,
): string {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function createOAuthState(
  provider: OAuthProvider,
  next: string,
  now = Date.now(),
): OAuthState {
  return {
    provider,
    next: safeNextPath(next),
    issuedAt: now,
    nonce: randomBytes(16).toString("base64url"),
  };
}

/**
 * Rouvre un état. Toute anomalie est un refus silencieux : signature,
 * format, âge, horloge incohérente, fournisseur attendu.
 */
export function openOAuthState(
  secret: string,
  token: string | null | undefined,
  expectedProvider: OAuthProvider,
  now = Date.now(),
): OAuthState | null {
  if (!token) return null;
  if (!secret || secret.length < 32) return null;

  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;

  const payload = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = Buffer.from(
    createHmac("sha256", secret).update(payload).digest("base64url"),
    "base64url",
  );

  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const value = parsed as Partial<OAuthState>;
  if (
    value.provider !== expectedProvider ||
    typeof value.next !== "string" ||
    typeof value.issuedAt !== "number" ||
    typeof value.nonce !== "string" ||
    value.nonce.length < 16
  ) {
    return null;
  }
  if (value.next !== safeNextPath(value.next)) return null;
  if (!Number.isFinite(value.issuedAt)) return null;
  if (value.issuedAt > now + 60_000) return null;
  if (now - value.issuedAt > OAUTH_STATE_TTL_MS) return null;

  return {
    provider: expectedProvider,
    next: value.next,
    issuedAt: value.issuedAt,
    nonce: value.nonce,
  };
}

export function oauthAuthorizeUrl(input: {
  provider: OAuthProvider;
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  if (input.provider === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", input.state);
    url.searchParams.set("prompt", "select_account");
    url.searchParams.set("access_type", "online");
    return url.toString();
  }

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", "read:user user:email");
  return url.toString();
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validEmail(value: string | null): value is string {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function firstWord(value: string): string {
  return value.split(/\s+/)[0] ?? value;
}

/**
 * Profil Google : `userinfo` OIDC. `email_verified` doit être vrai.
 * Le sujet est `sub`, jamais l'email.
 */
export function parseGoogleProfile(value: unknown): OAuthProfile | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const subject = nonEmptyString(raw.sub);
  const email = nonEmptyString(raw.email)?.toLowerCase() ?? null;
  const verified = raw.email_verified === true || raw.email_verified === "true";

  if (!subject || !validEmail(email) || !verified) return null;

  const name = nonEmptyString(raw.name);
  const given = nonEmptyString(raw.given_name);
  const picture = nonEmptyString(raw.picture);

  return {
    provider: "google",
    subject,
    email,
    emailVerified: true,
    metadata: {
      ...(name ? { full_name: name } : {}),
      ...(given ? { prenom: given } : name ? { prenom: firstWord(name) } : {}),
      ...(picture ? { avatar_url: picture } : {}),
    },
  };
}

interface GitHubUser {
  id?: unknown;
  login?: unknown;
  name?: unknown;
  email?: unknown;
}

interface GitHubEmail {
  email?: unknown;
  primary?: unknown;
  verified?: unknown;
}

/**
 * Profil GitHub : `/user` + `/user/emails`. L'email public de `/user`
 * peut être absent ou non vérifié ; on ne retient que la liste vérifiée.
 */
export function parseGitHubProfile(
  user: unknown,
  emails: unknown,
): OAuthProfile | null {
  if (typeof user !== "object" || user === null) return null;
  const raw = user as GitHubUser;
  const subject =
    typeof raw.id === "number" || typeof raw.id === "string"
      ? String(raw.id)
      : null;
  const login = nonEmptyString(raw.login);
  if (!subject || !login) return null;

  const list = Array.isArray(emails) ? (emails as GitHubEmail[]) : [];
  const verified = list.filter((item) => {
    return (
      item.verified === true &&
      typeof item.email === "string" &&
      validEmail(item.email)
    );
  });
  const selected =
    verified.find((item) => item.primary === true) ?? verified[0] ?? null;
  const email =
    selected && typeof selected.email === "string"
      ? selected.email.trim().toLowerCase()
      : null;

  if (!email) return null;

  const name = nonEmptyString(raw.name);
  return {
    provider: "github",
    subject,
    email,
    emailVerified: true,
    metadata: {
      full_name: name ?? login,
      prenom: name ? firstWord(name) : login,
      pseudo: login,
    },
  };
}
