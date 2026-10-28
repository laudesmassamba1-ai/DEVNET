/**
 * Le flux OAuth GitHub, côté protocole.
 *
 * ## Pourquoi un état scellé plutôt qu'un état en clair
 *
 * GitHub renvoie l'état tel quel au callback. Un état qui porte
 * l'identité DevNet en clair serait falsifiable : n'importe qui
 * pourrait forger une requête `?state=…` qui lie **son** compte
 * GitHub à **un autre** utilisateur DevNet. L'état est donc un
 * jeton chiffré (même enveloppe AES-GCM que le jeton d'accès) :
 * seule l'application qui l'a scellé peut le rouvrir, et un
 * état altéré ne se déchiffre tout simplement pas.
 *
 * L'état scelle trois choses : l'utilisateur DevNet, une date
 * (dix minutes, pas plus), et la page de retour. Il ne scelle
 * **pas** le code — GitHub envoie le code une seule fois, au
 * callback, et c'est lui qui prouve l'identité GitHub.
 *
 * ## La page de retour
 *
 * Elle traverse deux sauts (autorise → callback), donc elle est
 * portée par l'état et non par l'URL de GitHub. `isRelativePath`
 * est la garde contre le redirect ouvert : sans elle, un lien
 * `next=https://evil.example` ferait de DevNet un expéditeur de
 * phishing avec un jeton valide dans l'URL.
 */

import { decryptValue, encryptValue } from "@/lib/github/crypto";

/** Cookie qui porte le jeton d'accès chiffré. */
export const TOKEN_COOKIE = "devnet_gh";

/** Cookie qui porte l'état scellé — vivant dix minutes. */
export const STATE_COOKIE = "devnet_gh_state";

export const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Durée de vie du cookie de jeton. Le jeton GitHub lui-même ne
 * périm pas, mais un cookie qui ne meurt jamais transforme un
 * ordinateur partagé en session permanente. Trente jours : la
 * connexion DevNet a la même durée.
 */
export const TOKEN_MAX_AGE = 60 * 60 * 24 * 30;

/** Ce que l'état scelle. */
export interface OAuthState {
  /** L'utilisateur DevNet qui demande la connexion. */
  u: string;
  /** Page de retour après le callback. */
  next: string;
  /** Date de scellement, en millisecondes. */
  t: number;
}

/** Scelle l'état pour le voyage aller. */
export function sealState(
  secret: string,
  state: OAuthState,
): Promise<string> {
  return encryptValue(secret, JSON.stringify(state));
}

/**
 * Rouvre l'état reçu en cookie.
 *
 * Renvoie `null` pour tout ce qui n'est pas un état de cette
 * application : cookie absent, enveloppe corrompue, JSON étranger.
 * La validité **temporelle** est laissée à l'appelant
 * (`stateExpired`) pour rester vérifiable sans horloge.
 */
export async function openState(
  secret: string,
  envelope: string | undefined,
): Promise<OAuthState | null> {
  if (!envelope) return null;
  const raw = await decryptValue(secret, envelope);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as OAuthState;
    if (
      typeof parsed.u !== "string" ||
      typeof parsed.next !== "string" ||
      typeof parsed.t !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** L'état est-il trop vieux pour être honnête ? */
export function stateExpired(state: OAuthState, now = Date.now()): boolean {
  return now - state.t > STATE_TTL_MS;
}

/** Identifiant DevNet acceptable dans `?u=`. */
export function validUserId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/i.test(value);
}

/**
 * La page de retour doit rester **dans** l'application.
 *
 * `//` et `\\` sont refusés parce que les navigateurs les lisent
 * comme un protocole (`//evil.example` = `https://evil.example`),
 * et pas parce qu'ils sont laids.
 */
export function isRelativePath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  if (/[\s<>]/.test(value)) return false;
  return true;
}

/** L'URL vers laquelle GitHub renvoie l'utilisateur. */
export function authorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  // `repo` pour pousser, `read:user` pour connaître le login.
  url.searchParams.set("scope", "repo read:user");
  // Un compte GitHub existant suffit ; l'inscription à la volée
  // créerait des identités que personne ne contrôle.
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

/** Lit un cookie dans l'en-tête brut, sans dépendance. */
export function readCookie(
  header: string | null,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      const value = part.slice(eq + 1).trim();
      return value ? value : undefined;
    }
  }
  return undefined;
}

/**
 * L'URL publique de l'application, telle que le navigateur la voit.
 *
 * Next.js, derrière un reverse proxy, ne voit que l'origine locale
 * (`http://localhost:3000`). Pourtant, le flux OAuth a besoin du
 * **vrai** protocole et hôte : GitHub exige un `redirect_uri` en HTTPS,
 * et il renvoie l'utilisateur sur cette URL. Si le callback est
 * `http://localhost:3000/...`, le navigateur refuse de le charger depuis
 * la page GitHub (HTTPS) — mélange de protocoles refusé, et l'erreur
 * « Ce site ne peut pas fournir de connexion sécurisée » apparaît.
 *
 * Les headers `x-forwarded-proto` / `x-forwarded-host` sont posés par
 * cloudflared (et par tout reverse proxy standard) ; on les préfère à
 * `request.url`, qui est toujours l'origine locale.
 */
export function publicOrigin(request: Request): string {
  const headers = request.headers;
  const proto = (headers.get("x-forwarded-proto") ?? "").split(",")[0].trim();
  const host = (headers.get("x-forwarded-host") ?? "").split(",")[0].trim();

  if (host) {
    const scheme = proto || "https";
    return `${scheme}://${host}`;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}
