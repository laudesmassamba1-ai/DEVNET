/**
 * Test de la préférence « Verre liquide » : seule la valeur exacte "true"
 * active le thème. Tout le reste (absent, vide, corrompu) = désactivé,
 * donc le rendu plat d'origine.
 */
import assert from "node:assert/strict";
import { LIQUID_GLASS_KEY, normalizeLiquidGlass } from "../lib/ui-preferences";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

check("clé de stockage stable", () => {
  assert.equal(LIQUID_GLASS_KEY, "devnet:liquid-glass");
});

check("'true' active", () => {
  assert.equal(normalizeLiquidGlass("true"), true);
});

check("absent = désactivé", () => {
  assert.equal(normalizeLiquidGlass(null), false);
  assert.equal(normalizeLiquidGlass(undefined), false);
});

check("'false', vide et valeurs inconnues = désactivé", () => {
  assert.equal(normalizeLiquidGlass("false"), false);
  assert.equal(normalizeLiquidGlass(""), false);
  assert.equal(normalizeLiquidGlass("TRUE"), false);
  assert.equal(normalizeLiquidGlass("1"), false);
});

console.log(`\n${passed} tests passés`);
