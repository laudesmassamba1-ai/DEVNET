/**
 * Contrat du studio de stickers — sans base de données.
 *
 * Ce qui est vérifié ici est ce qui protège la publication : les bornes du
 * nom et du glyphe, les jetons de couleur, le refus d'un balisage, et le
 * re-encodage d'image (taille, format, métadonnées, poids final). Une image
 * acceptée doit être **une autre image** que celle envoyée.
 */
import sharp from "sharp";
import {
  decodeDataUrl,
  readStickerAction,
  STICKER_GLYPH_MAX,
  STICKER_NAME_MAX,
} from "../modules/stickers";
import {
  reencodeSticker,
  STICKER_OUTPUT_MAX_BYTES,
} from "../modules/stickers/infrastructure/image/reencode";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function read(raw: unknown) {
  return readStickerAction(raw);
}

async function main(): Promise<void> {
  // ── Texte ──
  const valid = read({
    action: "texte",
    name: "  Déploiement   du vendredi ",
    glyph: "🚀",
    fg: "void",
    bg: "signal",
    visibility: "public",
  });
  check("texte : accepté", valid.ok);
  if (valid.ok && valid.value.action === "texte") {
    check("texte : nom normalisé", valid.value.name === "Déploiement du vendredi");
    check("texte : visibilité conservée", valid.value.visibility === "public");
    check("texte : glyphe en NFC", valid.value.glyph === "🚀".normalize("NFC"));
  }

  check(
    "texte : nom vide refusé",
    !read({ action: "texte", name: "   ", glyph: "🚀", fg: "void", bg: "signal" }).ok,
  );
  check(
    "texte : nom trop long refusé",
    !read({
      action: "texte",
      name: "x".repeat(STICKER_NAME_MAX + 1),
      glyph: "🚀",
      fg: "void",
      bg: "signal",
    }).ok,
  );
  check(
    "texte : glyphe trop long refusé",
    !read({
      action: "texte",
      name: "ok",
      glyph: "🚀".repeat(STICKER_GLYPH_MAX + 1),
      fg: "void",
      bg: "signal",
    }).ok,
  );
  check(
    "texte : balisage refusé",
    !read({ action: "texte", name: "<b>x</b>", glyph: "🚀", fg: "void", bg: "signal" }).ok,
  );
  check(
    "texte : couleur hors jetons refusée",
    !read({ action: "texte", name: "ok", glyph: "🚀", fg: "#ff0000", bg: "signal" }).ok,
  );
  check(
    "visibilité par défaut : privée",
    (() => {
      const result = read({
        action: "texte",
        name: "ok",
        glyph: "🚀",
        fg: "void",
        bg: "signal",
        visibility: "partout",
      });
      return result.ok && result.value.action === "texte" && result.value.visibility === "prive";
    })(),
  );

  // ── Retrait ──
  check("retrait : identifiant accepté", read({ action: "retire", stickerId: "custom-abc" }).ok);
  check("retrait : identifiant invalide refusé", !read({ action: "retire", stickerId: "../x" }).ok);
  check("action inconnue refusée", !read({ action: "upload" }).ok);
  check("corps non-objet refusé", !read("texte").ok);

  // ── Image ──
  const png = await sharp({
    create: {
      width: 900,
      height: 700,
      channels: 4,
      background: { r: 255, g: 92, b: 53, alpha: 0.9 },
    },
  })
    .png()
    .withMetadata({ orientation: 1 })
    .toBuffer();
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

  const imageAction = read({ action: "image", name: "Carrousel", dataUrl });
  check("image : acceptée", imageAction.ok);
  check("image : SVG refusé", !read({ action: "image", name: "x", dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }).ok);
  check("image : data URL tronquée refusée", !read({ action: "image", name: "x", dataUrl: "data:image/png;base64," }).ok);

  const decoded = decodeDataUrl(dataUrl);
  check("image : décodée en octets", decoded?.bytes.length === png.length);
  check("image : type conservé", decoded?.mime === "image/png");

  const reencoded = await reencodeSticker(png);
  check("re-encodage : réussi", reencoded.ok, reencoded.ok ? "" : reencoded.error);
  if (reencoded.ok) {
    const out = reencoded.sticker;
    check("re-encodage : WebP", out.mime === "image/webp");
    check("re-encodage : borné à 512 px", Math.max(out.width, out.height) <= 512, `${out.width}×${out.height}`);
    check("re-encodage : ≤ 60 Ko", out.bytes.length <= STICKER_OUTPUT_MAX_BYTES, `${out.bytes.length} octets`);
    check("re-encodage : empreinte SHA-256", /^[0-9a-f]{64}$/.test(out.sha256));
    check("re-encodage : autre fichier que la source", out.bytes.length !== png.length);

    const metadata = await sharp(out.bytes).metadata();
    check("re-encodage : métadonnées retirées", metadata.exif === undefined && metadata.orientation === undefined);
    check("re-encodage : orientation appliquée", metadata.width === 512 && metadata.height === 398, `${metadata.width}×${metadata.height}`);
  }

  const corrupt = await reencodeSticker(Buffer.from("pas une image"));
  check("re-encodage : fichier illisible refusé", !corrupt.ok);

  if (failures > 0) {
    console.error(`\n${failures} vérification(s) en échec`);
    process.exitCode = 1;
    return;
  }
  console.log("\nToutes les vérifications passent.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
