/**
 * Contrat OAuth de connexion — sans réseau, sans base.
 *
 * Exécuter avec : `npm run test:auth-oauth`.
 *
 * Vérifie ce qui peut ouvrir une session à tort : un état forgé, expiré,
 * rejoué pour un autre fournisseur, une page de retour externe, ou un
 * email non vérifié présenté comme une identité.
 */
import {
  createOAuthState,
  oauthAuthorizeUrl,
  openOAuthState,
  parseGitHubProfile,
  parseGoogleProfile,
  safeNextPath,
  sealOAuthState,
} from "../modules/auth/application/oauth";

const SECRET = "s".repeat(32);
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

function googleUser(overrides: Record<string, unknown> = {}) {
  return {
    sub: "google-subject-1",
    email: "Alice@Example.com",
    email_verified: true,
    name: "Alice Doe",
    given_name: "Alice",
    picture: "https://example.com/alice.png",
    ...overrides,
  };
}

function githubUser(overrides: Record<string, unknown> = {}) {
  return { id: 42, login: "alice-dev", name: "Alice Doe", ...overrides };
}

// ── État signé ─────────────────────────────────────────────
const state = createOAuthState("google", "/feed?onglet=projets", NOW);
const sealed = sealOAuthState(SECRET, state);
const reopened = openOAuthState(SECRET, sealed, "google", NOW + 1_000);

check("état : aller-retour", reopened?.next === "/feed?onglet=projets", reopened);
check("état : nonce conservé", reopened?.nonce === state.nonce);
check(
  "état : fournisseur différent refusé",
  openOAuthState(SECRET, sealed, "github", NOW + 1_000) === null,
);
check(
  "état : expiré refusé",
  openOAuthState(SECRET, sealed, "google", NOW + 10 * 60 * 1000 + 1) === null,
);
check(
  "état : horloge future refusée",
  openOAuthState(SECRET, sealed, "google", NOW - 61_000) === null,
);
// Le premier caractère de la signature porte six bits utiles : le changer
// altère forcément le HMAC. Remplacer le **dernier** caractère pouvait au
// contraire ne toucher que les bits de remplissage et laisser la signature
// identique — un test qui échouait au hasard.
const dot = sealed.indexOf(".");
const signature = sealed.slice(dot + 1);
const tampered = `${sealed.slice(0, dot + 1)}${
  signature[0] === "A" ? "B" : "A"
}${signature.slice(1)}`;
check(
  "état : signature altérée refusée",
  openOAuthState(SECRET, tampered, "google", NOW + 1_000) === null,
);
check(
  "état : mauvais secret refusé",
  openOAuthState("x".repeat(32), sealed, "google", NOW + 1_000) === null,
);
check(
  "état : état directement forgé refusé",
  openOAuthState(
    SECRET,
    sealOAuthState(SECRET, { ...state, next: "//evil.example" }),
    "google",
    NOW + 1_000,
  ) === null,
);

// ── Page de retour ─────────────────────────────────────────
check("next : chemin interne conservé", safeNextPath("/messages") === "/messages");
check("next : absolu refusé", safeNextPath("https://evil.example") === "/feed");
check("next : protocole relatif refusé", safeNextPath("//evil.example") === "/feed");
check("next : barre inverse refusée", safeNextPath("/\\evil") === "/feed");

// ── URL d'autorisation ─────────────────────────────────────
const googleUrl = new URL(
  oauthAuthorizeUrl({
    provider: "google",
    clientId: "google-client",
    redirectUri: "https://devnet.example.com/api/auth/oauth/google/callback",
    state: sealed,
  }),
);
check("Google : hôte", googleUrl.origin === "https://accounts.google.com", googleUrl.origin);
check("Google : scope", googleUrl.searchParams.get("scope") === "openid email profile");
check("Google : state", googleUrl.searchParams.get("state") === sealed);
check(
  "Google : callback",
  googleUrl.searchParams.get("redirect_uri") ===
    "https://devnet.example.com/api/auth/oauth/google/callback",
);

const githubUrl = new URL(
  oauthAuthorizeUrl({
    provider: "github",
    clientId: "github-client",
    redirectUri: "https://devnet.example.com/api/auth/oauth/github/callback",
    state: sealed,
  }),
);
check("GitHub : hôte", githubUrl.origin === "https://github.com", githubUrl.origin);
const githubScope = githubUrl.searchParams.get("scope") ?? "";
check("GitHub : lit l'identité", githubScope.includes("read:user"), githubScope);
check("GitHub : lit les emails", githubScope.includes("user:email"), githubScope);
check("GitHub : pas de dépôt", !githubScope.includes("repo"), githubScope);

// ── Profils normalisés ─────────────────────────────────────
const google = parseGoogleProfile(googleUser());
check("Google : sujet", google?.subject === "google-subject-1", google?.subject);
check("Google : email normalisé", google?.email === "alice@example.com", google?.email);
check("Google : prénom pour le profil", google?.metadata.prenom === "Alice", google?.metadata);
check("Google : email non vérifié refusé", parseGoogleProfile(googleUser({ email_verified: false })) === null);
check("Google : sans sujet refusé", parseGoogleProfile(googleUser({ sub: "" })) === null);
check("Google : email invalide refusé", parseGoogleProfile(googleUser({ email: "pas-un-email" })) === null);

const emails = [
  { email: "prive@example.com", primary: true, verified: false },
  { email: "public@example.com", primary: false, verified: true },
];
const github = parseGitHubProfile(githubUser(), emails);
check("GitHub : sujet stable", github?.subject === "42", github?.subject);
check("GitHub : email vérifié choisi", github?.email === "public@example.com", github?.email);
check("GitHub : pseudo conservé", github?.metadata.pseudo === "alice-dev", github?.metadata);
check("GitHub : aucun email vérifié refusé", parseGitHubProfile(githubUser(), [emails[0]]) === null);
check("GitHub : sans identifiant refusé", parseGitHubProfile(githubUser({ id: undefined }), emails) === null);

if (failures.length > 0) {
  console.error("\n✗ Connexion OAuth :");
  for (const failure of failures) console.error(`  · ${failure}`);
  console.error(`\n${passed} vérifications passées, ${failures.length} en échec.\n`);
  process.exitCode = 1;
} else {
  console.log(`✓ Connexion OAuth — ${passed} vérifications réussies.`);
}
