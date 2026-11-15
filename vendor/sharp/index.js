"use strict";

/**
 * Adaptateur `sharp` → `@napi-rs/image`, pour l'optimiseur d'images de Next.js.
 *
 * Next appelle `sharp` avec un enchaînement court et stable (voir
 * `next/dist/server/image-optimizer.js`) :
 *
 *   sharp(buffer, opts).timeout(...).rotate().resize(...).webp({ quality })
 *     .toBuffer()
 *
 * On reproduit cette chaîne, plus `metadata()` et `toBuffer({resolveWithObject})`
 * pour rester utilisable par du code de test. Tout ce qui n'est pas implémenté
 * lève une erreur nommée : mieux vaut une panne visible qu'une image fausse.
 *
 * Le raisonnement de licence est dans `README.md`.
 */

const { Transformer, ResizeFit } = require("@napi-rs/image");

const NOT_IMPLEMENTED = (name) => {
  const error = new Error(
    `sharp (adaptateur DevNet) : "${name}" n'est pas implémenté. ` +
      "Voir vendor/sharp/README.md — l'appelant doit être adapté, pas contourné.",
  );
  error.code = "DEVNET_SHARP_UNSUPPORTED";
  return error;
};

/** `withoutEnlargement` : ne jamais agrandir, comme `sharp`. */
function targetSize(width, height, maxWidth, maxHeight) {
  if (!maxWidth) return { width, height };
  if (!maxHeight) {
    const scale = Math.min(1, maxWidth / width);
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }
  return { width: maxWidth, height: maxHeight };
}

class Pipeline {
  constructor(input, options) {
    this.input = input;
    this.limitInputPixels = (options && options.limitInputPixels) || 268_402_689;
    this.operations = [];
    this.timeoutMs = null;
    this.encoder = null;
    this.encoderOptions = {};
  }

  /* ── Réglages ignorés, mais attendus ─────────────────────────────── */

  timeout(options) {
    const seconds = options && typeof options === "object" ? options.seconds : options;
    if (typeof seconds === "number" && seconds > 0) this.timeoutMs = seconds * 1000;
    return this;
  }

  sequentialRead() {
    return this;
  }

  sequentialReadOff() {
    return this;
  }

  failOn() {
    return this;
  }

  keepMetadata() {
    return this;
  }

  withMetadata() {
    return this;
  }

  /* ── Opérations réelles ──────────────────────────────────────────── */

  rotate(angle) {
    this.operations.push({ kind: "rotate", angle });
    return this;
  }

  resize(width, height, options) {
    this.operations.push({
      kind: "resize",
      width: typeof width === "object" ? width.width : width,
      height: typeof width === "object" ? width.height : height,
      fit: (typeof width === "object" ? width.fit : options && options.fit) || "cover",
      withoutEnlargement:
        (typeof width === "object" ? width.withoutEnlargement : options && options.withoutEnlargement) ||
        false,
    });
    return this;
  }

  grayscale() {
    this.operations.push({ kind: "grayscale" });
    return this;
  }

  avif(options) {
    this.encoder = "avif";
    this.encoderOptions = options || {};
    return this;
  }

  webp(options) {
    this.encoder = "webp";
    this.encoderOptions = options || {};
    return this;
  }

  png(options) {
    this.encoder = "png";
    this.encoderOptions = options || {};
    return this;
  }

  jpeg(options) {
    this.encoder = "jpeg";
    this.encoderOptions = options || {};
    return this;
  }

  heif(options) {
    return this.avif(options);
  }

  /* ── Lecture ─────────────────────────────────────────────────────── */

  async metadata() {
    const metadata = await new Transformer(this.input).metadata();
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      orientation: metadata.orientation,
      size: this.input.byteLength,
    };
  }

  async toBuffer(options) {
    if (this.input.byteLength / 4 > this.limitInputPixels) {
      throw new Error("sharp (adaptateur DevNet) : image trop grande en pixels");
    }

    let transformer = new Transformer(this.input);
    let width = null;
    let height = null;

    for (const operation of this.operations) {
      if (operation.kind === "rotate") {
        // `rotate()` sans angle applique l'orientation EXIF ; un angle
        // explicite n'est pas utilisé par Next, on refuse plutôt que de
        // laisser croire qu'il est appliqué.
        if (operation.angle !== undefined && operation.angle !== null && operation.angle !== 0) {
          throw NOT_IMPLEMENTED("rotate(angle)");
        }
        transformer = transformer.rotate();
        continue;
      }
      if (operation.kind === "grayscale") {
        transformer = transformer.grayscale();
        continue;
      }
      if (operation.kind !== "resize") throw NOT_IMPLEMENTED(operation.kind);

      const source = await new Transformer(this.input).metadata();
      const sourceWidth = width ?? source.width;
      const sourceHeight = height ?? source.height;
      let target = targetSize(
        sourceWidth,
        sourceHeight,
        operation.width,
        operation.height,
      );
      if (operation.withoutEnlargement) {
        const scale = Math.min(1, operation.width / sourceWidth);
        target = {
          width: Math.max(1, Math.round(sourceWidth * scale)),
          height: Math.max(1, Math.round(sourceHeight * scale)),
        };
      }
      if (operation.fit === "inside" || operation.fit === "contain") {
        const scale = Math.min(
          operation.width / sourceWidth,
          (operation.height ?? operation.width) / sourceHeight,
          operation.withoutEnlargement ? 1 : Infinity,
        );
        target = {
          width: Math.max(1, Math.round(sourceWidth * scale)),
          height: Math.max(1, Math.round(sourceHeight * scale)),
        };
      }
      width = target.width;
      height = target.height;
      transformer = transformer.resize({
        width: target.width,
        height: target.height,
        fit: operation.fit === "fill" ? ResizeFit.Fill : ResizeFit.Cover,
      });
    }

    const encode = async () => {
      if (this.encoder === "avif") return transformer.avif({ quality: this.encoderOptions.quality });
      if (this.encoder === "webp") return transformer.webp(this.encoderOptions.quality);
      if (this.encoder === "jpeg") return transformer.jpeg(this.encoderOptions.quality);
      if (this.encoder === "png") return transformer.png();
      throw NOT_IMPLEMENTED("toBuffer sans encodeur");
    };

    const bounded = this.timeoutMs
      ? Promise.race([
          encode(),
          new Promise((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error("sharp (adaptateur DevNet) : délai d'optimisation dépassé")),
              this.timeoutMs,
            );
            // Ne pas garder le processus en vie pour un minuteur.
            if (typeof timer.unref === "function") timer.unref();
          }),
        ])
      : encode();

    const data = await bounded;
    if (options && options.resolveWithObject) {
      return { data, info: { width, height, size: data.length } };
    }
    return data;
  }
}

/* ── API de module ────────────────────────────────────────────────────── */

let concurrency = 1;
let cacheEnabled = true;

function sharp(input, options) {
  return new Pipeline(input, options);
}

sharp.cache = function cache(enabled) {
  if (typeof enabled === "boolean") cacheEnabled = enabled;
  return cacheEnabled;
};

sharp.concurrency = function concurrencySetting(value) {
  if (typeof value === "number") concurrency = value;
  return concurrency;
};

sharp.simd = function simd() {
  return false;
};

sharp.block = function block() {
  // Réglage propre à libvips : sans effet ici.
};

sharp.unblock = function unblock() {};

sharp.versions = { vips: null, devnet: true };

/** Formats annoncés par l'adaptateur, pour les appelants qui interrogent. */
sharp.format = {
  jpeg: { input: { buffer: true }, output: { buffer: true } },
  png: { input: { buffer: true }, output: { buffer: true } },
  webp: { input: { buffer: true }, output: { buffer: true } },
  avif: { input: { buffer: true }, output: { buffer: true } },
  gif: { input: { buffer: true }, output: { buffer: false } },
};

module.exports = sharp;
module.exports.default = sharp;
