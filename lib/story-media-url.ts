/**
 * Adresses acceptées pour le média d'une story.
 *
 * La route de publication acceptait auparavant **toute** URL `https` : une
 * story pouvait donc pointer vers un pixel de suivi, un domaine de
 * phishing ou un fichier arbitraire hébergé ailleurs. Le serveur ne
 * télécharge rien (pas de SSRF), mais le lecteur affichait ce contenu
 * comme un média DEVNET, sous notre nom.
 *
 * Trois familles sont autorisées :
 *
 *  1. un chemin interne `/api/media/<chemin>` — le repli PostgreSQL quand
 *     le stockage objet n'est pas configuré. L'appelant doit prouver qu'il
 *     possède bien ce fichier (contrôle fait dans la route) ;
 *  2. une URL du stockage objet configuré (R2 public ou Vercel Blob) ;
 *  3. une URL d'un fournisseur GIF déjà validé (`tenor.com`, `giphy.com`).
 *
 * Tout le reste est refusé : pas de `data:`, pas de `javascript:`, pas de
 * `http:` hors développement local.
 */
import { isAllowedGifUrl } from "./gifs";

/** Chemin interne d'un média stocké en base. */
const INTERNAL = /^\/api\/media\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isInternalMediaPath(raw: string): boolean {
  return INTERNAL.test(raw);
}

/** Hôtes supplémentaires autorisés par la configuration de stockage. */
export function storageHosts(): string[] {
  const hosts: string[] = [];
  const r2 = process.env.R2_PUBLIC_URL?.trim();
  if (r2) {
    try {
      hosts.push(new URL(r2).hostname);
    } catch {
      /* configuration invalide : simplement ignorée */
    }
  }
  return hosts;
}

export interface MediaUrlContext {
  /** Origine publique de l'application (`https://devnet.example`). */
  origin: string;
  /** Hôtes de stockage objet supplémentaires. */
  hosts?: string[];
}

/**
 * Vérifie une URL de média de story et rend sa forme normalisée.
 *
 * Rend `null` si l'adresse n'est pas acceptable. Le chemin interne est
 * rendu tel quel : la route le résout ensuite en URL absolue après avoir
 * vérifié la propriété du fichier.
 */
export function normalizeStoryMediaUrl(raw: string, context: MediaUrlContext): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (isInternalMediaPath(value)) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.username || url.password) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const local = LOCAL_HOSTS.has(url.hostname);
  // `http:` n'est accepté que pour le développement local : accepter du
  // clair en production ouvrirait la porte au contenu mixte et au suivi.
  if (url.protocol === "http:" && !local) return null;

  if (isAllowedGifUrl(url.href)) return url.href;

  const own = new URL(context.origin);
  const sameHost = url.hostname === own.hostname && url.port === own.port;
  if (sameHost && (url.protocol === own.protocol || local)) return url.href;

  const hosts = new Set([...(context.hosts ?? []), ...storageHosts()]);
  if (hosts.has(url.hostname)) return url.href;

  // Vercel Blob : les objets publics vivent sur un sous-domaine dédié.
  if (
    url.hostname.endsWith(".public.blob.vercel-storage.com") &&
    url.protocol === "https:"
  ) {
    return url.href;
  }

  return null;
}
