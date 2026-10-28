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

/**
 * Clé AES-GCM dérivée de la phrase secrète.
 *
 * La phrase n'est pas la clé : on la hache d'abord (SHA-256),
 * parce qu'une phrase trop courte ou mal formée donnerait une
 * clé de taille invalide — et parce qu'AES-GCM exige exactement
 * 128, 192 ou 256 bits. Le hachage normalise n'importe quelle
 * phrase en 256 bits.
 */
async function deriveKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
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
 * La forme est `base64url(iv(12 octets) || texte chiffré || tag)`.
 * Le vecteur est **neuf à chaque appel** : chiffrer deux fois le
 * même jeton donne deux enveloppes différentes, donc on ne peut
 * pas reconnaître un jeton en comparant des enveloppes.
 */
export async function encryptValue(
  secret: string,
  plaintext: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await deriveKey(secret),
    enc.encode(plaintext),
  );

  const blob = new Uint8Array(iv.length + cipher.byteLength);
  blob.set(iv, 0);
  blob.set(new Uint8Array(cipher), iv.length);
  return toBase64Url(blob);
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
    const blob = fromBase64Url(envelope);
    if (blob.length <= 12) return null;

    const iv = blob.slice(0, 12);
    const cipher = blob.slice(12);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await deriveKey(secret),
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
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
