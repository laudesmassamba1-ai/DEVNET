/**
 * Modération des images : empreinte perceptuelle, liste de blocage, heuristique.
 *
 * ## Ce qu'une empreinte perceptuelle règle
 *
 * Une image interdite revient : recadrée, réencodée, renommée, avec quelques
 * pixels changés. Un hachage cryptographique ne la reconnaît pas — c'est son
 * travail, et c'est exactement ce qui la rend inutile ici. `dHash` (difference
 * hash, 64 bits) compare la structure : deux versions de la même image sont à
 * une distance de Hamming faible.
 *
 * ## Ce qu'elle ne prétend pas faire
 *
 * Détecter automatiquement une nudité. Un classifieur local fiable n'existe
 * pas sans modèle embarqué, et un faux positif sur une photo de profil est
 * une sanction injuste. On combine donc :
 *
 *  - **blocage** sur une empreinte déjà bannie (décision humaine) ;
 *  - **signalement** sur une heuristique de peau, qui ne bloque rien et va
 *    dans la file de relecture ;
 *  - **rien d'autre** : le reste est humain.
 *
 * Cette hiérarchie est le cœur du module. Une heuristique qui bloque serait
 * une machine qui juge sans preuve.
 */
import { Transformer, ResizeFit } from "@napi-rs/image";
import { imageMetadata, rawPixels } from "@/lib/media/image";
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";

/** Distance de Hamming tolérée entre deux versions d'une même image. */
const BLOCK_DISTANCE = 6;
const BLOCK_CACHE_MS = 30_000;

let blockedCache: { at: number; hashes: string[] } | null = null;

/**
 * Empreinte 64 bits, rendue en 16 caractères hexadécimaux.
 *
 * Le principe est celui de `sharp` : niveaux de gris, 9 × 8 pixels, puis un
 * bit par comparaison entre deux voisins horizontaux (dHash). La luminance
 * est calculée par le décodeur (`grayscale`), pas à la main : sur une image
 * avec transparence il rend deux canaux (luminance + alpha), d'où le pas
 * calculé plutôt que supposé.
 */
export async function perceptualHash(bytes: Buffer): Promise<string | null> {
  try {
    const data = await new Transformer(bytes)
      .rotate()
      .grayscale()
      .resize({ width: 9, height: 8, fit: ResizeFit.Fill })
      .rawPixels();
    const stride = data.length / 72;
    if (data.length < 72 || !Number.isInteger(stride)) return null;
    const zero = BigInt(0);
    const one = BigInt(1);
    let hash = zero;
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const left = data[(y * 9 + x) * stride];
        const right = data[(y * 9 + x + 1) * stride];
        hash = (hash << one) | (left < right ? one : zero);
      }
    }
    return hash.toString(16).padStart(16, "0");
  } catch {
    return null;
  }
}

function bits(hex: string): bigint | null {
  if (!/^[0-9a-f]{16}$/i.test(hex)) return null;
  return BigInt(`0x${hex}`);
}

/** Distance de Hamming entre deux empreintes hexadécimales. */
export function hammingDistance(a: string, b: string): number | null {
  const left = bits(a);
  const right = bits(b);
  if (left === null || right === null) return null;
  let diff = left ^ right;
  let count = 0;
  const one = BigInt(1);
  while (diff) {
    count += Number(diff & one);
    diff >>= one;
  }
  return count;
}

async function blockedHashes(): Promise<string[]> {
  if (blockedCache && Date.now() - blockedCache.at < BLOCK_CACHE_MS) {
    return blockedCache.hashes;
  }
  try {
    const result = await getPostgresPool().query<{ phash: string }>(
      "select phash from public.moderation_blocked_media order by created_at desc limit 1000",
    );
    const hashes = result.rows.map((row) => row.phash);
    blockedCache = { at: Date.now(), hashes };
    return hashes;
  } catch {
    return [];
  }
}

/** Vrai si l'empreinte correspond à un média déjà banni. */
export async function isBlockedImage(phash: string): Promise<boolean> {
  for (const known of await blockedHashes()) {
    const distance = hammingDistance(phash, known);
    if (distance !== null && distance <= BLOCK_DISTANCE) return true;
  }
  return false;
}

export type ImageInspection = {
  phash: string | null;
  width: number | null;
  height: number | null;
  /** Part de pixels dans la plage de tons chair, 0..1. */
  skinRatio: number | null;
  blocked: boolean;
  /** `null` quand rien ne mérite un signalement. */
  review: { severity: "warning" | "critical"; reason: string } | null;
};

/**
 * Analyse une image avant stockage.
 *
 * Ne lève jamais : une image illisible est refusée ailleurs (`decodableImage`
 * dans la route média) ; ici, l'absence de verdict n'empêche pas l'envoi.
 */
export async function inspectImage(bytes: Buffer): Promise<ImageInspection> {
  const base: ImageInspection = {
    phash: null,
    width: null,
    height: null,
    skinRatio: null,
    blocked: false,
    review: null,
  };
  try {
    const metadata = await imageMetadata(bytes, { limitInputPixels: 50_000_000 });
    const phash = await perceptualHash(bytes);
    const skinRatio = await skinRatioOf(bytes);
    const blocked = phash ? await isBlockedImage(phash) : false;

    let review: ImageInspection["review"] = null;
    if (skinRatio !== null && skinRatio > 0.68) {
      review = {
        severity: "warning",
        reason:
          "Heuristique : proportion de tons chair élevée. À relire — ce n'est pas une preuve.",
      };
    }
    return {
      ...base,
      phash,
      width: metadata.width,
      height: metadata.height,
      skinRatio,
      blocked,
      review,
    };
  } catch {
    return base;
  }
}

/**
 * Proportion de pixels « chair ».
 *
 * Formule volontairement simple (règles RGB classiques) et **conservatrice** :
 * elle sert à trier une file, pas à condamner. Les tons très sombres, très
 * clairs et les images en niveaux de gris ne sont pas comptés.
 */
async function skinRatioOf(bytes: Buffer): Promise<number | null> {
  try {
    const { data, channels } = await rawPixels(bytes, {
      width: 64,
      height: 64,
      fit: "inside",
      limitInputPixels: 50_000_000,
    });
    if (channels < 3) return null;
    const pixels = Math.floor(data.length / channels);
    if (pixels === 0) return null;
    let skin = 0;
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (
        r > 95 && g > 40 && b > 20
        && max - min > 15
        && Math.abs(r - g) > 15
        && r > g && r > b
      ) {
        skin += 1;
      }
    }
    return skin / pixels;
  } catch {
    return null;
  }
}

/** Bannit une empreinte. Appelé par l'administration après décision humaine. */
export async function blockImageHash(
  phash: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await getPostgresPool().query(
    `insert into public.moderation_blocked_media (phash, reason, added_by)
     values ($1, $2, $3)
     on conflict (phash) do update set reason = excluded.reason`,
    [phash, reason.slice(0, 300), actorId],
  );
  blockedCache = null;
}

/** Retire une empreinte de la liste de blocage. */
export async function unblockImageHash(phash: string): Promise<void> {
  await getPostgresPool().query(
    "delete from public.moderation_blocked_media where phash = $1",
    [phash],
  );
  blockedCache = null;
}

export async function listBlockedImages(): Promise<
  { id: string; phash: string; reason: string; created_at: string }[]
> {
  const result = await getPostgresPool().query<{
    id: string;
    phash: string;
    reason: string;
    created_at: string;
  }>(
    `select id, phash, reason, created_at
       from public.moderation_blocked_media
      order by created_at desc
      limit 200`,
  );
  return result.rows;
}
