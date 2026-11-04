/**
 * Le coffre du jeton GitHub.
 *
 * ## Ce que c'est, ce que ce n'est pas
 *
 * Un jeton d'accès GitHub qui vaut d'être volé vaut d'être rangé
 * ailleurs que dans une table que l'application peut lire — c'est
 * la décision de la migration 004 (`token_ref` pointe vers un
 * coffre, le jeton n'est jamais dans la ligne). Supabase Vault
 * est ce coffre dans un déploiement réel, mais il n'existe pas en
 * local, et la démo ne pourrait alors rien prouver.
 *
 * Le coffre **local** est un cookie `httpOnly` : le jeton ne
 * traverse jamais le JavaScript du navigateur, n'est jamais dans
 * le localStorage, et n'est dans aucune table. Il y est rangé
 * **chiffré** (AES-GCM) sous une clé dérivée de `GITHUB_CRYPT_KEY`
 * — une fuite du cookie ne donne que l'enveloppe, et une fuite
 * de l'application seule ne donne que la clé.
 *
 * AES-GCM, pas « XOR + base64 » : l'authentification du chiffre
 * est ce qui rend un cookie trafiqué **détectable** plutôt que
 * silencieusement déchiffrable en charabia.
 *
 * ## Ce que cette module ne fait pas
 *
 * Il ne gère pas la rotation de clé. Changer `GITHUB_CRYPT_KEY`
 * invalide tous les cookies existants : les utilisateurs se
 * reconnectent. C'est le comportement d'un coffre, pas un bug.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const ENVELOPE_VERSION = "v2.";
const HKDF_INFO = enc.encode("devnet/github-cookie/aes-gcm/v2");
const LEGACY_DECRYPTION_DEFAULT_UNTIL = "2026-12-04T00:00:00.000Z";

/**
 * Dérive une clé dédiée à cette version et à cet usage. Le sel public
 * est enregistré dans l'enveloppe; HKDF évite d'utiliser directement
 * une empreinte simple du secret comme clé de chiffrement.
 */
async function deriveKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(salt).buffer,
      info: HKDF_INFO,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Déchiffre le format historique v1, limité à la période de migration. */
async function decryptLegacyValue(
  secret: string,
  envelope: string,
): Promise<string | null> {
  const cutoffValue =
    (typeof process === "undefined" ? "" : process.env.GITHUB_CRYPT_LEGACY_UNTIL) ||
    LEGACY_DECRYPTION_DEFAULT_UNTIL;
  const cutoff = Date.parse(cutoffValue);
  if (!Number.isFinite(cutoff) || Date.now() >= cutoff) return null;

  const blob = fromBase64Url(envelope);
  if (blob.length < 12 + 16) return null;

  const digest = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  const key = await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: blob.slice(0, 12) },
    key,
    blob.slice(12),
  );
  return dec.decode(plain);
}

/** La phrase secrète est-elle présente et d'une longueur utile ? */
export function hasVaultKey(): boolean {
  if (typeof process === "undefined") return false;
  const key = process.env.GITHUB_CRYPT_KEY ?? "";
  return key.length >= 32;
}

/**
 * Chiffre une valeur dans une enveloppe autonome.
 *
 * La forme est `v2.base64url(sel HKDF(16) || iv(12) || texte chiffré || tag)`.
 * Le sel et le vecteur sont neufs à chaque appel.
 */
export async function encryptValue(
  secret: string,
  plaintext: string,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await deriveKey(secret, salt),
    enc.encode(plaintext),
  );

  const blob = new Uint8Array(salt.length + iv.length + cipher.byteLength);
  blob.set(salt, 0);
  blob.set(iv, salt.length);
  blob.set(new Uint8Array(cipher), salt.length + iv.length);
  return `${ENVELOPE_VERSION}${toBase64Url(blob)}`;
}

/**
 * Rouvre une enveloppe.
 *
 * Renvoie `null` — jamais ne lance — pour **toute** anomalie :
 * enveloppe mal formée, clé différente, cookie trafiqué. Un
 * coffre qui crie sur une entrée corrompue est un coffre qu'on
 * peut sonder ; un coffre qui dit « non » est un coffre sûr.
 */
export async function decryptValue(
  secret: string,
  envelope: string,
): Promise<string | null> {
  try {
    if (!envelope.startsWith(ENVELOPE_VERSION)) {
      if (envelope.includes(".")) return null;
      return await decryptLegacyValue(secret, envelope);
    }

    const blob = fromBase64Url(envelope.slice(ENVELOPE_VERSION.length));
    if (blob.length < 16 + 12 + 16) return null;

    const salt = blob.slice(0, 16);
    const iv = blob.slice(16, 28);
    const cipher = blob.slice(28);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await deriveKey(secret, salt),
      cipher,
    );
    return dec.decode(plain);
  } catch {
    return null;
  }
}

/* ── base64url sans dépendance ─────────────────────────────── */

function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("Invalid base64url envelope");
  }
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
