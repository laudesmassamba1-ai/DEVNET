/**
 * Tests de la validation des médias.
 *
 * Exécuter avec :  npx tsx scripts/test-media-security.ts
 *
 * Deux défauts sont couverts ici, tous les deux constatés dans le code :
 *
 *  1. `/api/media` classait un fichier d'après le `Content-Type` du
 *     navigateur, donc un HTML présenté comme `image/png` était accepté
 *     et stocké ;
 *  2. `/api/stories/media` acceptait n'importe quelle URL `https`, donc
 *     une story pouvait afficher un contenu tiers sous le nom DEVNET.
 *
 * Aucun accès réseau ni base : uniquement les fonctions pures qui portent
 * la décision.
 */
import {
  matchesDeclaredType,
  sniffMedia,
  type SniffedMedia,
} from "../lib/media-signature";
import { normalizeStoryMediaUrl } from "../lib/story-media-url";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

const bytes = (...parts: Array<number[] | string>): Uint8Array => {
  const flat: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") flat.push(...text(part));
    else flat.push(...part);
  }
  return new Uint8Array(flat);
};

const ftyp = (brand: string): Uint8Array =>
  bytes([0x00, 0x00, 0x00, 0x18], "ftyp", brand, [0x00, 0x00, 0x02, 0x00], "isom");

const ORIGIN = "https://devnet.example";

function expectSniff(name: string, input: Uint8Array, expected: SniffedMedia | null): void {
  const actual = sniffMedia(input);
  check(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    actual,
  );
}

function main(): void {
  /* ── Signatures acceptées ────────────────────────────────────── */

  expectSniff(
    "JPEG reconnu",
    bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], "JFIF", [0x00, 0x01, 0x02, 0x03]),
    { kind: "image", mime: "image/jpeg" },
  );
  expectSniff(
    "PNG reconnu",
    bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "\u0000\u0000\u0000\rIHDR"),
    { kind: "image", mime: "image/png" },
  );
  expectSniff("GIF89a reconnu", bytes("GIF89a", [0x01, 0x00, 0x01, 0x00], "payload"), {
    kind: "image",
    mime: "image/gif",
  });
  expectSniff(
    "WebP reconnu",
    bytes("RIFF", [0x24, 0x00, 0x00, 0x00], "WEBP", "VP8 "),
    { kind: "image", mime: "image/webp" },
  );
  expectSniff("AVIF reconnu", ftyp("avif"), { kind: "image", mime: "image/avif" });
  expectSniff("MP4 reconnu", ftyp("isom"), { kind: "video", mime: "video/mp4" });
  expectSniff("QuickTime reconnu", ftyp("qt  "), {
    kind: "video",
    mime: "video/quicktime",
  });
  expectSniff(
    "WebM reconnu",
    bytes([0x1a, 0x45, 0xdf, 0xa3], [0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84], "webm"),
    { kind: "video", mime: "video/webm" },
  );

  /* ── Contenus actifs refusés ─────────────────────────────────── */

  expectSniff("HTML refusé", bytes("<!doctype html><html></html>"), null);
  expectSniff("SVG refusé", bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), null);
  expectSniff("script refusé", bytes("<script>alert(1)</script>"), null);
  expectSniff("PDF refusé", bytes("%PDF-1.7\n%âãÏÓ\n"), null);
  expectSniff("octets tronqués refusés", bytes([0x89, 0x50, 0x4e]), null);
  expectSniff("conteneur inconnu refusé", ftyp("zzzz"), null);
  expectSniff("chaîne vide refusée", new Uint8Array(0), null);

  /* ── Le type déclaré ne remplace pas la signature ────────────── */

  check(
    "même famille et même type : accepté",
    matchesDeclaredType({ kind: "image", mime: "image/png" }, "image/png"),
  );
  check(
    "un PNG annoncé JPEG est refusé",
    !matchesDeclaredType({ kind: "image", mime: "image/png" }, "image/jpeg"),
  );
  check(
    "un HTML annoncé image est refusé",
    !matchesDeclaredType({ kind: "image", mime: "image/png" }, "text/html"),
  );
  check(
    "une vidéo MP4 annoncée video/webm reste acceptée (conteneur déclaré large)",
    matchesDeclaredType({ kind: "video", mime: "video/mp4" }, "video/webm"),
  );
  check(
    "un type avec paramètres est normalisé",
    matchesDeclaredType({ kind: "image", mime: "image/webp" }, "image/webp; charset=binary"),
  );

  /* ── Adresses de média de story ──────────────────────────────── */

  const cases: Array<[string, string, string | null]> = [
    ["chemin interne accepté", "/api/media/abc-123.webp", "/api/media/abc-123.webp"],
    ["même origine acceptée", `${ORIGIN}/api/media/abc-123.webp`, `${ORIGIN}/api/media/abc-123.webp`],
    ["Tenor accepté", "https://media1.tenor.com/m/abc.gif", "https://media1.tenor.com/m/abc.gif"],
    ["Giphy accepté", "https://media.giphy.com/media/abc/giphy.gif", "https://media.giphy.com/media/abc/giphy.gif"],
    ["Vercel Blob accepté", "https://x.public.blob.vercel-storage.com/a.webp", "https://x.public.blob.vercel-storage.com/a.webp"],
    ["hôte tiers refusé", "https://evil.example/x.png", null],
    ["suffixe trompeur refusé", "https://devnet.example.evil.com/x.png", null],
    ["http distant refusé", "http://evil.example/x.png", null],
    ["localhost http accepté en développement", "http://localhost:3000/api/media/x.png", "http://localhost:3000/api/media/x.png"],
    ["data URL refusée", "data:image/png;base64,AAAA", null],
    ["javascript refusé", "javascript:alert(1)", null],
    ["identifiants dans l'URL refusés", "https://user:pass@devnet.example/x.png", null],
    ["traversée de chemin refusée", "/api/media/../secret", null],
    ["chemin sans nom refusé", "/api/media/", null],
  ];

  for (const [name, input, expected] of cases) {
    // Le cas localhost est évalué avec une origine locale : c'est la
    // configuration réelle de `next dev`, où `http:` reste acceptable.
    const origin = input.startsWith("http://localhost") ? "http://localhost:3000" : ORIGIN;
    const actual = normalizeStoryMediaUrl(input, { origin });
    check(name, actual === expected, actual);
  }

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log("  ✓ Signatures et adresses de médias cohérentes\n");
}

main();
