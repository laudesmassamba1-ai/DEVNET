/**
 * Compile `app/globals.css` exactement comme `next build` le fait.
 *
 * Le plugin PostCSS de Tailwind bascule en mode `optimize` quand
 * `NODE_ENV=production` : c'est ce chemin qui appelle `lightningcss` (ou son
 * shim MIT). Ce script isole cette étape pour pouvoir la vérifier sans lancer
 * un build Next complet.
 *
 * Usage : node scripts/legal/compile-css.mjs <sortie.css>
 */
import fs from "node:fs";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const output = process.argv[2];
if (!output) {
  console.error("usage: node scripts/legal/compile-css.mjs <sortie.css>");
  process.exit(2);
}

const source = fs.readFileSync("app/globals.css", "utf8");
const result = await postcss([tailwind({ optimize: true })]).process(source, {
  from: "app/globals.css",
});
fs.writeFileSync(output, result.css);
console.log(`${output} : ${result.css.length} octets`);
