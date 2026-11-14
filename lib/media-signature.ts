/**
 * Signature binaire d'un média.
 *
 * Le `Content-Type` envoyé par le navigateur est une déclaration, pas une
 * preuve : `curl -F file=@payload.html;type=image/png` passe n'importe quel
 * contrôle qui s'y fie. Cette fonction lit les premiers octets et rend le
 * type **réellement** reconnu, ou `null`.
 *
 * Elle ne remplace pas un décodeur : `sharp` (images) et `ffprobe` (vidéos)
 * restent la seconde barrière, celle qui refuse un fichier tronqué ou
 * corrompu. La signature ferme le cas le plus courant — un contenu actif
 * présenté comme une image — et ne dépend d'aucune bibliothèque.
 *
 * Module volontairement pur : il est partagé par les routes serveur et les
 * tests de contrat, sans `node:fs` ni dépendance native.
 */

export type MediaKind = "image" | "video";

export interface SniffedMedia {
  kind: MediaKind;
  /** Type MIME canonique déduit des octets, jamais celui du client. */
  mime: string;
}

const ascii = (bytes: Uint8Array, start: number, length: number): string => {
  let out = "";
  for (let index = start; index < start + length && index < bytes.length; index += 1) {
    out += String.fromCharCode(bytes[index]);
  }
  return out;
};

const startsWithAscii = (bytes: Uint8Array, value: string): boolean =>
  bytes.length >= value.length && ascii(bytes, 0, value.length) === value;

/** Marques ISO-BMFF (MP4, QuickTime, AVIF) qui portent un codec vidéo ou image. */
const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "avc1",
  "avc3",
  "hev1",
  "hvc1",
  "vp09",
  "dash",
  "mmp4",
  "M4V ",
  "M4VH",
  "M4VP",
]);
const IMAGE_BRANDS = new Set(["avif", "avis"]);

/**
 * Reconnaît un média à partir de ses premiers octets.
 *
 * Les 64 premiers octets suffisent pour toutes les signatures retenues :
 * aucun format accepté n'a de marque plus loin dans le fichier.
 */
export function sniffMedia(bytes: Uint8Array): SniffedMedia | null {
  if (bytes.length < 12) return null;

  // JPEG : SOI puis marqueur APP0/APP1.
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { kind: "image", mime: "image/jpeg" };
  }

  // PNG : signature 8 octets complète (le \r\n et le \x1a évitent les faux
  // positifs des transferts texte qui mangent les sauts de ligne).
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { kind: "image", mime: "image/png" };
  }

  // GIF87a / GIF89a.
  if (startsWithAscii(bytes, "GIF87a") || startsWithAscii(bytes, "GIF89a")) {
    return { kind: "image", mime: "image/gif" };
  }

  // WebP : conteneur RIFF dont le type est WEBP (offset 8).
  if (startsWithAscii(bytes, "RIFF") && ascii(bytes, 8, 4) === "WEBP") {
    return { kind: "image", mime: "image/webp" };
  }

  // Matroska/WebM : signature EBML. Une piste audio seule passerait ici,
  // ffprobe la refuse ensuite pour une story ; pour une publication le
  // rendu `<video>` affiche un lecteur sans image, jamais de HTML actif.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { kind: "video", mime: "video/webm" };
  }

  // ISO-BMFF : taille (4 octets) puis `ftyp`, puis la marque majeure.
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (IMAGE_BRANDS.has(brand)) {
      return { kind: "image", mime: "image/avif" };
    }
    if (MP4_BRANDS.has(brand)) return { kind: "video", mime: "video/mp4" };
    if (brand === "qt  ") return { kind: "video", mime: "video/quicktime" };
  }

  return null;
}

/**
 * Le type déclaré appartient-il à la famille réellement détectée ?
 *
 * On compare la famille (`image/` ou `video/`) et, pour les images, le type
 * exact : un PNG annoncé `image/jpeg` n'est pas accepté, parce que le rendu
 * et le cache dépendent du type stocké.
 */
export function matchesDeclaredType(sniffed: SniffedMedia, declared: string): boolean {
  const clean = declared.toLowerCase().split(";")[0].trim();
  if (!clean.startsWith(`${sniffed.kind}/`)) return false;
  if (sniffed.kind === "video") return true;
  return clean === sniffed.mime || (sniffed.mime === "image/jpeg" && clean === "image/jpg");
}
