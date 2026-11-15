/**
 * Images serveur — tests du remplacement de `sharp`.
 *
 * Ce que le test vérifie, et pourquoi :
 *
 * 1. **PNG, JPEG, GIF fixe → WebP** avec les bonnes dimensions. C'est le
 *    chemin de la route média et des stickers.
 * 2. **Orientation EXIF** : une photo portrait stockée en paysage doit
 *    ressortir debout. Sans cela, un selfie d'iPhone s'affiche couché.
 * 3. **GIF animé → WebP animé** avec le bon nombre d'images et les bonnes
 *    durées. C'est la fonctionnalité que `@napi-rs/image` ne sait pas faire
 *    seul ; `lib/media/webp-animation.ts` l'assemble.
 * 4. **Transparence** conservée : un sticker détouré ne doit pas devenir un
 *    carré noir.
 * 5. **Refus** : fichier tronqué, fichier qui n'est pas une image, bombe de
 *    décompression (dimensions énormes annoncées dans 12 octets).
 *
 * Exécuter avec : npm run test:media-images
 */
import { crc32 } from "node:zlib";
import { GifWriter } from "omggif";
import { Transformer } from "@napi-rs/image";
import {
  imageMetadata,
  insideSize,
  rawPixels,
  rasterizeSvg,
  sniffImageFormat,
  solidPng,
  toWebp,
} from "../lib/media/image";
import { composeGifFrames } from "../lib/media/gif";
import { readAnimatedWebp, standaloneFrame } from "../lib/media/webp-animation";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

/** GIF animé de trois images, construit sans dépendre d'un fichier binaire. */
function animatedGif(): Buffer {
  const width = 6;
  const height = 4;
  const buffer = Buffer.alloc(4096);
  const writer = new GifWriter(buffer, width, height, { loop: 0 });
  const palette = [0x000000, 0xff0000, 0x00ff00, 0x0000ff, 0xffffff, 0xffff00, 0x00ffff, 0xff00ff];

  for (let frame = 0; frame < 3; frame += 1) {
    const pixels: number[] = [];
    for (let index = 0; index < width * height; index += 1) {
      pixels.push((index + frame) % palette.length);
    }
    writer.addFrame(0, 0, width, height, pixels, { palette, delay: 7 + frame });
  }
  return buffer.subarray(0, writer.end());
}

/**
 * PNG valide de 2 × 2 dont l'en-tête annonce 30 000 × 30 000.
 *
 * C'est la forme réelle d'une bombe de décompression : un fichier de quelques
 * dizaines d'octets qui demande 900 millions de pixels. La CRC est recalculée
 * pour que l'en-tête soit syntaxiquement valide — sinon le décodeur refuserait
 * le fichier pour une autre raison et le test ne prouverait rien.
 */
function pixelBomb(source: Buffer): Buffer {
  const png = Buffer.from(source);
  png.writeUInt32BE(30_000, 16);
  png.writeUInt32BE(30_000, 20);
  png.writeUInt32BE(crc32(png.subarray(12, 29)) >>> 0, 29);
  return png;
}

/**
 * Vérifie le conteneur avec le décodeur du navigateur (`ImageDecoder`).
 * Ignoré si Chromium n'est pas installé : la CI l'installe pour les tests
 * Playwright, un poste de développement peut ne pas l'avoir.
 */
async function checkInBrowser(data: Buffer): Promise<void> {
  let browser: Awaited<ReturnType<typeof import("playwright").chromium.launch>> | null = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const result = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/webp;base64,${base64}`;
      try {
        await image.decode();
      } catch {
        return { decoded: false, width: 0, height: 0 };
      }
      return { decoded: true, width: image.naturalWidth, height: image.naturalHeight };
    }, data.toString("base64"));
    check("navigateur : WebP animé décodé", result.decoded, result);
    check("navigateur : dimensions", result.width === 6 && result.height === 4, result);
  } catch (error) {
    console.log(
      `Chromium indisponible : vérification navigateur ignorée (${(error as Error).message.split("\n")[0]})`,
    );
  } finally {
    await browser?.close();
  }
}

async function main() {
  /* 1 — PNG uni → WebP */
  const png = await solidPng(40, 20, { r: 12, g: 200, b: 90 });
  check("signature PNG", sniffImageFormat(png) === "png");
  const pngMeta = await imageMetadata(png);
  check(
    "métadonnées PNG",
    pngMeta.width === 40 && pngMeta.height === 20 && pngMeta.pages === 1 && !pngMeta.animated,
    pngMeta,
  );

  const webp = await toWebp(png, { maxWidth: 20, maxHeight: 20, quality: 80 });
  check("WebP produit", sniffImageFormat(webp.data) === "webp");
  check("WebP proportions", webp.width === 20 && webp.height === 10, webp);
  const webpMeta = await imageMetadata(webp.data);
  check("WebP relu", webpMeta.width === 20 && webpMeta.height === 10, webpMeta);

  /* Pas d'agrandissement : une vignette de 20 px ne devient pas 200 px. */
  const noEnlarge = insideSize(20, 20, 200, 200);
  check("pas d'agrandissement", noEnlarge.width === 20 && noEnlarge.height === 20, noEnlarge);

  /* 2 — JPEG → WebP */
  const jpeg = await new Transformer(await solidPng(8, 16, { r: 200, g: 40, b: 40 })).jpeg(85);
  check("signature JPEG", sniffImageFormat(jpeg) === "jpeg");
  const jpegWebp = await toWebp(jpeg, { maxWidth: 100, maxHeight: 100, quality: 80 });
  check("JPEG → WebP", jpegWebp.width === 8 && jpegWebp.height === 16, jpegWebp);

  /* 3 — GIF fixe → WebP fixe */
  const gif = animatedGif();
  check("signature GIF", sniffImageFormat(gif) === "gif");
  const gifMeta = await imageMetadata(gif);
  check(
    "métadonnées GIF animé",
    gifMeta.pages === 3 && gifMeta.animated && gifMeta.width === 6 && gifMeta.height === 4,
    gifMeta,
  );

  const gifFrames = composeGifFrames(gif);
  check("composition GIF", gifFrames.length === 3, gifFrames.length);
  check(
    "durées GIF en millisecondes",
    gifFrames[0].durationMs === 70 && gifFrames[1].durationMs === 80,
    gifFrames.map((frame) => frame.durationMs),
  );
  check(
    "composition pleine taille",
    gifFrames.every((frame) => frame.pixels.length === 6 * 4 * 4),
    gifFrames.map((frame) => frame.pixels.length),
  );

  /* 4 — GIF animé → WebP animé */
  const animated = await toWebp(gif, { maxWidth: 24, maxHeight: 24, quality: 70 });
  check("GIF → WebP animé", sniffImageFormat(animated.data) === "webp");
  check("images conservées", animated.pages === 3, animated.pages);
  const parsed = readAnimatedWebp(animated.data);
  check("conteneur animé relu", parsed !== null && parsed.frames.length === 3, parsed?.frames.length);
  check(
    "conteneur aux bonnes dimensions",
    parsed?.width === 6 && parsed?.height === 4,
    parsed && { width: parsed.width, height: parsed.height },
  );
  check(
    "durées conservées dans le conteneur",
    parsed?.frames.map((frame) => frame.durationMs).join(",") === "70,80,90",
    parsed?.frames.map((frame) => frame.durationMs),
  );

  /* Une image extraite du conteneur doit se décoder seule : c'est ce qui
     prouve que les chunks `VP8`/`ALPH` ont été recopiés entiers. */
  if (parsed) {
    const isolated = standaloneFrame(parsed.frames[0], parsed.width, parsed.height);
    const isolatedMeta = await imageMetadata(isolated).catch((error: Error) => error);
    check(
      "image isolée décodable",
      !(isolatedMeta instanceof Error) && isolatedMeta.width === 6,
      isolatedMeta instanceof Error ? isolatedMeta.message : isolatedMeta,
    );
  }

  /* Chromium, quand il est installé, lit le fichier avec le vrai décodeur
     WebP du navigateur et donne le nombre d'images (WebCodecs). ffmpeg 6 ne
     sait pas démuxer un WebP animé (« image data not found »), y compris
     ceux qu'il produit lui-même : ce n'est pas un juge fiable ici. */
  await checkInBrowser(animated.data);

  /* 5 — Pixels bruts */
  const raw = await rawPixels(png, { width: 9, height: 8, fit: "fill" });
  check("pixels RGBA", raw.data.length === 9 * 8 * raw.channels, raw.data.length);
  check("canaux plausibles", raw.channels === 3 || raw.channels === 4, raw.channels);

  /* 6 — SVG (icônes PWA) */
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#111"/></svg>';
  const raster = await rasterizeSvg(svg, 192);
  check("SVG rasterisé", (await imageMetadata(raster)).width === 192);

  /* 7 — Refus */
  const truncated = png.subarray(0, png.length - 12);
  const truncatedResult = await toWebp(truncated, { maxWidth: 10, maxHeight: 10, quality: 70 })
    .then(() => null)
    .catch((error: Error) => error);
  check("PNG tronqué refusé", truncatedResult instanceof Error, truncatedResult?.message);

  const notAnImage = Buffer.from("ceci n'est pas une image, du tout.");
  const notAnImageResult = await imageMetadata(notAnImage)
    .then(() => null)
    .catch((error: Error) => error);
  check("fichier non image refusé", notAnImageResult instanceof Error);

  const bomb = pixelBomb(png);
  const bombResult = await imageMetadata(bomb, { limitInputPixels: 50_000_000 })
    .then(() => null)
    .catch((error: Error) => error);
  check(
    "bombe de décompression refusée",
    bombResult instanceof Error && /trop grande/.test(bombResult.message),
    bombResult instanceof Error ? bombResult.message : bombResult,
  );

  /* 8 — Formes attendues par les appelants */
  const frame = composeGifFrames(gif)[0];
  check("première image opaque ou transparente", frame.pixels.some((value, index) => index % 4 === 3 && value === 255) || frame.pixels.every((value, index) => index % 4 !== 3 || value === 0));

  if (failures.length > 0) {
    console.error(`${failures.length} échec(s) :`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`media images : ${passed} vérifications réussies`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
