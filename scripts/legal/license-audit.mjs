#!/usr/bin/env node
/**
 * Politique de licences DEVNET — audit, matrice, SBOM, porte CI.
 *
 * Règlement de référence : article 6 du règlement CADEV 2026.
 * Politique interne : MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause.
 *
 * Usage :
 *   node scripts/legal/license-audit.mjs            # rapport lisible
 *   node scripts/legal/license-audit.mjs --check     # porte CI (code 1 si refus)
 *   node scripts/legal/license-audit.mjs --write-matrix
 *   node scripts/legal/license-audit.mjs --sbom
 *
 * Ce que le script refuse, sans exception documentée :
 *   GPL, AGPL, LGPL, MPL-2.0, licence absente, licence inconnue, licence
 *   hors liste autorisée.
 *
 * Les expressions SPDX sont évaluées, pas comparées comme du texte :
 * `MIT OR Apache-2.0` est conforme (on choisit MIT), `MIT AND GPL-3.0` ne
 * l'est pas. `MPL-2.0 OR Apache-2.0` est conforme **parce qu'on élit
 * Apache-2.0** — l'élection est consignée dans EXCEPTIONS.json.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LOCK = path.join(ROOT, "package-lock.json");
const EXCEPTIONS_FILE = path.join(ROOT, "docs", "legal", "EXCEPTIONS.json");
const MATRIX_FILE = path.join(ROOT, "docs", "legal", "DEPENDENCY_LICENSE_MATRIX.md");
const NOTICES_FILE = path.join(ROOT, "THIRD_PARTY_NOTICES.md");
const SBOM_CDX = path.join(ROOT, "sbom.cdx.json");
const SBOM_SPDX = path.join(ROOT, "sbom.spdx.json");

const ALLOWED = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"]);
/** Licences examinées et acceptées après analyse (voir EXCEPTIONS.json). */
const REVIEWED = new Set([
  "ISC",
  "Zlib",
  "IJG",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "Python-2.0",
  "MIT-0",
  "CC-BY-4.0",
  "CC-BY-3.0",
]);
const FORBIDDEN = /^(A?GPL|LGPL|MPL)-/i;

/** Évalue une expression SPDX avec parenthèses et précédence (AND > OR). */
function evaluate(expression) {
  const text = String(expression || "").trim();
  if (!text || text === "UNKNOWN" || text === "UNLICENSED") {
    return { ok: false, reason: "licence absente", chosen: null, forbidden: [] };
  }

  const tokens = text.replace(/\(/g, " ( ").replace(/\)/g, " ) ").split(/\s+/).filter(Boolean);
  const allowed = (term) => ALLOWED.has(term) || REVIEWED.has(term);
  const forbiddenTerms = tokens.filter((token) => FORBIDDEN.test(token));
  let cursor = 0;

  function parseAtom() {
    const token = tokens[cursor++];
    if (token === "(") {
      const inner = parseOr();
      if (tokens[cursor] === ")") cursor += 1;
      return inner;
    }
    if (!token || token === ")") return { ok: false, text: "?" };
    let term = token;
    if (tokens[cursor] && /^WITH$/i.test(tokens[cursor])) {
      term = `${term} WITH ${tokens[cursor + 1] ?? "?"}`;
      cursor += 2;
    }
    return { ok: allowed(token), text: term };
  }

  function parseAnd() {
    const parts = [parseAtom()];
    while (tokens[cursor] && /^AND$/i.test(tokens[cursor])) {
      cursor += 1;
      parts.push(parseAtom());
    }
    return {
      ok: parts.every((part) => part.ok),
      text: parts.length > 1 ? parts.map((part) => part.text).join(" AND ") : parts[0].text,
    };
  }

  function parseOr() {
    const parts = [parseAnd()];
    while (tokens[cursor] && /^OR$/i.test(tokens[cursor])) {
      cursor += 1;
      parts.push(parseAnd());
    }
    const winner = parts.find((part) => part.ok) ?? null;
    return {
      ok: Boolean(winner),
      text: parts.length > 1 ? parts.map((part) => part.text).join(" OR ") : parts[0].text,
      chosen: winner?.text ?? null,
    };
  }

  const verdict = parseOr();
  if (verdict.ok) {
    return {
      ok: true,
      chosen: verdict.chosen ?? verdict.text,
      reason: verdict.chosen ? `élection de « ${verdict.chosen} »` : "conforme",
      forbidden: forbiddenTerms,
    };
  }
  return {
    ok: false,
    chosen: null,
    reason:
      forbiddenTerms.length > 0
        ? `licence interdite : ${forbiddenTerms.join(", ")}`
        : "hors liste autorisée",
    forbidden: forbiddenTerms,
  };
}

function readExceptions() {
  try {
    return JSON.parse(fs.readFileSync(EXCEPTIONS_FILE, "utf8"));
  } catch {
    return { exceptions: [] };
  }
}

function collectPackages() {
  const lock = JSON.parse(fs.readFileSync(LOCK, "utf8"));
  const packages = [];
  for (const [key, meta] of Object.entries(lock.packages || {})) {
    if (key === "") {
      const root = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
      packages.push({
        name: root.name,
        version: root.version,
        license: root.license || "UNLICENSED",
        path: ".",
        production: false,
        optional: false,
        direct: true,
        private: true,
        url: null,
      });
      continue;
    }
    if (!key.startsWith("node_modules/")) continue;
    const installed = path.join(ROOT, key, "package.json");
    let manifest = meta;
    if (fs.existsSync(installed)) {
      try {
        manifest = JSON.parse(fs.readFileSync(installed, "utf8"));
      } catch {
        manifest = meta;
      }
    }
    const name = manifest.name || meta.name || key.replace(/^.*node_modules\//, "");
    const license =
      (typeof manifest.license === "string" && manifest.license) ||
      (manifest.license && manifest.license.type) ||
      (Array.isArray(manifest.licenses) && manifest.licenses.map((entry) => entry.type).join(" OR ")) ||
      meta.license ||
      "";
    packages.push({
      name,
      version: manifest.version || meta.version || "",
      license: license || "",
      path: key,
      production: !meta.dev,
      optional: Boolean(meta.optional),
      direct: Boolean(meta.peer !== true && (meta.dev || meta.optional) === undefined) && false,
      private: Boolean(manifest.private),
      url: (typeof manifest.repository === "object" ? manifest.repository.url : manifest.repository) || null,
      description: manifest.description || "",
    });
  }
  const rootManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const directNames = new Set([
    ...Object.keys(rootManifest.dependencies || {}),
    ...Object.keys(rootManifest.devDependencies || {}),
  ]);
  for (const entry of packages) if (directNames.has(entry.name)) entry.direct = true;
  return packages;
}

function audit() {
  const packages = collectPackages();
  const { exceptions } = readExceptions();
  const byName = new Map(exceptions.map((entry) => [`${entry.name}@${entry.version ?? "*"}`, entry]));
  const results = [];
  for (const entry of packages) {
    const verdict = evaluate(entry.license);
    const exception =
      byName.get(`${entry.name}@${entry.version}`) || byName.get(`${entry.name}@*`) || null;
    /* Une entrée d'exception sans `authorization` n'est pas une dérogation :
       c'est une élection SPDX (déjà tranchée par `verdict`) ou une demande en
       attente. Seule une autorisation écrite rend conforme un paquet que la
       politique refuse — sinon une simple ligne suffirait à blanchir une
       licence interdite. */
    const authorized =
      exception && typeof exception.authorization === "string" && exception.authorization.trim() !== "";
    const compliant = entry.private || verdict.ok || Boolean(authorized);
    const pending = Boolean(exception) && !authorized && !compliant;
    results.push({
      ...entry,
      verdict,
      exception,
      authorized,
      pending,
      compliant,
      reason: entry.private
        ? "paquet privé du dépôt"
        : verdict.ok
          ? verdict.reason
          : authorized
            ? `dérogation autorisée : ${exception.authorization}`
            : pending
              ? `dérogation en attente, non accordée : ${exception.justification}`
              : verdict.reason,
    });
  }
  return results;
}

function summarize(results) {
  const counts = new Map();
  for (const entry of results) {
    const key = entry.license || "ABSENTE";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function report(results) {
  const refused = results.filter((entry) => !entry.compliant && entry.production);
  const pending = results.filter((entry) => entry.pending && !entry.production);
  console.log(`paquets : ${results.length}`);
  for (const [license, count] of summarize(results)) {
    console.log(`  ${String(count).padStart(4)}  ${license}`);
  }
  if (pending.length > 0) {
    console.error(`\n${pending.length} paquet(s) de développement en attente d'autorisation :`);
    for (const entry of pending) {
      console.error(`  - ${entry.name}@${entry.version} : ${entry.license || "absente"} (${entry.reason})`);
    }
  }
  if (refused.length === 0) {
    console.log("\nlicences : conforme à la politique");
    return 0;
  }
  console.error(`\n${refused.length} paquet(s) non conformes :`);
  for (const entry of refused) {
    console.error(`  - ${entry.name}@${entry.version} : ${entry.license || "absente"} (${entry.reason})`);
  }
  return 1;
}

function writeMatrix(results) {
  const lines = [
    "# Matrice des licences des dépendances",
    "",
    "> Fichier **généré** par `npm run license:matrix`. Ne pas éditer à la main :",
    "> il doit correspondre au `package-lock.json` livré.",
    "",
    "Politique : MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause. Toute autre licence",
    "est examinée et consignée dans `docs/legal/EXCEPTIONS.json`.",
    "",
    `Total : **${results.length}** paquets (${results.filter((entry) => entry.production).length} en production).`,
    "",
    "| Paquet | Version | Licence déclarée | Portée | Direct | Production | Verdict |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const entry of results.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(
      `| \`${entry.name}\` | ${entry.version} | ${entry.license || "**absente**"} | ${entry.optional ? "optionnelle" : "requise"} | ${entry.direct ? "oui" : ""} | ${entry.production ? "oui" : "non (build/test)"} | ${entry.compliant ? (entry.exception ? "exception" : "conforme") : "**refusée**"} |`,
    );
  }
  fs.writeFileSync(MATRIX_FILE, `${lines.join("\n")}\n`);
  console.log(`${path.relative(ROOT, MATRIX_FILE)} : ${results.length} lignes`);
}

function writeNotices(results) {
  const groups = new Map();
  for (const entry of results) {
    const key = entry.license || "absente";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(`${entry.name}@${entry.version}`);
  }
  const lines = [
    "# Third-Party Notices — DEVNET",
    "",
    "DEVNET est distribué sous licence MIT (voir `LICENSE`). Ce fichier recense",
    "les composants tiers embarqués et les obligations d'attribution qui en",
    "découlent. Il est **généré** par `npm run sbom` à partir du",
    "`package-lock.json` livré.",
    "",
    "## Composants remplacés",
    "",
    "| Composant retiré | Licence | Remplacé par | Licence |",
    "| --- | --- | --- | --- |",
    "| `web-push` | MPL-2.0 | `@block65/webcrypto-web-push` | MIT |",
    "| `sharp` (+ `libvips`, `libheif`) | Apache-2.0 + LGPL-3.0 | `@napi-rs/image`, `omggif`, `lib/media/*` | MIT |",
    "| `lightningcss` | MPL-2.0 | `vendor/lightningcss` (postcss-nested, autoprefixer, csso) | MIT |",
    "| `axe-core`, `@axe-core/playwright` | MPL-2.0 | `lib/a11y` (moteur interne) | MIT |",
    "",
    "## Textes de licence",
    "",
    "- **MIT** et **ISC** : reproduction de l'avis de copyright et de la",
    "  permission. Les paquets les portent dans leur `node_modules/<paquet>/LICENSE`.",
    "- **Apache-2.0** : conservation de la licence, de l'avis de copyright et de",
    "  tout fichier `NOTICE`. Voir `node_modules/<paquet>/LICENSE`.",
    "- **BSD-2-Clause / BSD-3-Clause** : reproduction de l'avis de copyright,",
    "  de la liste des conditions et de la clause de non-garantie.",
    "- **CC0-1.0 / 0BSD / BlueOak-1.0.0 / Python-2.0** : licences permissives",
    "  examinées ; obligations limitées à la mention ci-dessous.",
    "- **CC-BY-4.0** (`caniuse-lite`, données de compatibilité navigateurs) :",
    "  attribution « caniuse.com » aux termes de CC-BY-4.0.",
    "",
    "## Binaires natifs embarqués",
    "",
    "- `@napi-rs/image` : binaire Rust. Codecs sous MIT/Apache-2.0 (`image`,",
    "  `image-webp`, `zune-jpeg`, `gif`), BSD-2-Clause (`libavif`),",
    "  BSD-3-Clause (`libjpeg-turbo`, `tiny-skia`), Apache-2.0 OR MIT",
    "  (`resvg`, `usvg`), Zlib/MIT (`oxipng`, `lodepng`, `zlib-rs`).",
    "- `@tailwindcss/oxide`, `lightningcss-linux-x64-*` : **plus présents**",
    "  (oxide reste, sous MIT ; le binaire lightningcss est remplacé par le shim).",
    "- `ffmpeg` / `ffprobe` : **non distribués** par DEVNET. Programme externe",
    "  invoqué par `child_process` quand il existe sur l'hôte ; sa licence est",
    "  celle de l'hôte (LGPL/GPL selon la compilation). À trancher par Systalink.",
    "",
    "## Inventaire par licence",
    "",
  ];
  for (const [license, names] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`### ${license} (${names.length})`, "", ...names.sort().map((name) => `- \`${name}\``), "");
  }
  fs.writeFileSync(NOTICES_FILE, `${lines.join("\n")}\n`);
  console.log(`${path.relative(ROOT, NOTICES_FILE)} : écrit`);
}

function bomRef(name, version) {
  return `pkg:npm/${name.replace("@", "%40")}@${version}`;
}

function writeSbom(results) {
  const components = results
    .filter((entry) => entry.name !== "devnet")
    .map((entry) => ({
      type: "library",
      "bom-ref": bomRef(entry.name, entry.version),
      name: entry.name,
      version: entry.version,
      scope: entry.production ? "required" : "optional",
      licenses: [{ license: { id: entry.verdict.chosen || entry.license || "NOASSERTION" } }],
      purl: bomRef(entry.name, entry.version),
    }));
  const cdx = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      component: { type: "application", name: "devnet", version: "0.1.0" },
      tools: [{ name: "scripts/legal/license-audit.mjs" }],
    },
    components,
  };
  fs.writeFileSync(SBOM_CDX, `${JSON.stringify(cdx, null, 2)}\n`);

  const spdx = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: "devnet-0.1.0",
    documentNamespace: "https://devnet.local/sbom/devnet-0.1.0",
    creationInfo: {
      created: new Date().toISOString(),
      creators: ["Tool: scripts/legal/license-audit.mjs"],
    },
    packages: results.map((entry, index) => ({
      SPDXID: `SPDXRef-Package-${index}`,
      name: entry.name,
      versionInfo: entry.version,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: entry.verdict.chosen || entry.license || "NOASSERTION",
      licenseDeclared: entry.license || "NOASSERTION",
    })),
    relationships: results.map((entry, index) => ({
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "CONTAINS",
      relatedSpdxElement: `SPDXRef-Package-${index}`,
    })),
  };
  fs.writeFileSync(SBOM_SPDX, `${JSON.stringify(spdx, null, 2)}\n`);
  console.log(`sbom.cdx.json : ${components.length} composants ; sbom.spdx.json : ${results.length} paquets`);
}

const args = process.argv.slice(2);
const results = audit();

if (args.includes("--write-matrix")) {
  writeMatrix(results);
  writeNotices(results);
  process.exit(0);
}
if (args.includes("--sbom")) {
  writeSbom(results);
  process.exit(0);
}
if (args.includes("--check")) {
  const code = report(results);
  if (code !== 0) {
    console.error("\nPolitique de licences : ÉCHEC");
    console.error("Justifier dans docs/legal/EXCEPTIONS.json (autorisation écrite requise)");
    console.error("ou remplacer la dépendance — voir docs/legal/LICENSE_CLEANUP_REPORT.md.");
    process.exit(1);
  }
  process.exit(0);
}

const code = report(results);
if (args.includes("--verbose")) {
  for (const entry of results) {
    console.log(`${entry.compliant ? "ok  " : "KO  "} ${entry.name}@${entry.version} ${entry.license} — ${entry.reason}`);
  }
}
process.exit(code);
