/**
 * Tests du modèle de l'éditeur de statut (historique, bornes, retour à la ligne).
 * Lancement : npm run test:status-editor
 */
import assert from "node:assert/strict";
import {
  addStickerLayer,
  addStrokeLayer,
  addTextLayer,
  appendStrokePoint,
  canRedo,
  canUndo,
  clampPct,
  commit,
  createHistory,
  emptySnapshot,
  hasContent,
  live,
  moveLayer,
  redo,
  removeLayer,
  textOf,
  undo,
  updateLayer,
  wrapLines,
  type Snapshot,
} from "../lib/status-editor-model";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

/** Largeur fixe : chaque caractère vaut 10 unités. */
const measure = (value: string) => value.length * 10;

const withFilter = (filter: number): Snapshot => ({ ...emptySnapshot(), filter });

test("clampPct borne entre 4 et 96", () => {
  assert.equal(clampPct(-20), 4);
  assert.equal(clampPct(120), 96);
  assert.equal(clampPct(50), 50);
});

test("undo et redo sur une suite de commits", () => {
  let h = createHistory(withFilter(0));
  h = commit(h, withFilter(1));
  h = commit(h, withFilter(2));
  assert.equal(h.present.filter, 2);
  assert.ok(canUndo(h));
  h = undo(h);
  assert.equal(h.present.filter, 1);
  h = undo(h);
  assert.equal(h.present.filter, 0);
  assert.equal(canUndo(h), false);
  h = redo(h);
  assert.equal(h.present.filter, 1);
  assert.ok(canRedo(h));
});

test("un nouveau commit efface le futur", () => {
  let h = createHistory(withFilter(0));
  h = commit(h, withFilter(1));
  h = undo(h);
  h = commit(h, withFilter(5));
  assert.equal(canRedo(h), false);
  assert.equal(h.present.filter, 5);
});

test("live ne crée pas d'étape pendant un geste", () => {
  let h = createHistory(withFilter(0));
  h = live(h, withFilter(1));
  h = live(h, withFilter(2));
  assert.equal(h.past.length, 0);
  h = commit(h, withFilter(2));
  assert.equal(h.past.length, 1);
  h = undo(h);
  assert.equal(h.present.filter, 0);
});

test("undo sans passé et redo sans futur ne changent rien", () => {
  const h = createHistory(withFilter(3));
  assert.equal(undo(h), h);
  assert.equal(redo(h), h);
});

test("l'historique est borné à 100 étapes", () => {
  let h = createHistory(withFilter(0));
  for (let i = 1; i <= 150; i += 1) h = commit(h, withFilter(i));
  assert.equal(h.past.length, 100);
  assert.equal(h.present.filter, 150);
});

test("addTextLayer borne la position et place le calque en fin de liste", () => {
  const first = addStrokeLayer([], [10, 10], 0, 0);
  const text = addTextLayer(first.layers, 200, -5);
  const layer = text.layers[text.layers.length - 1];
  assert.equal(layer.kind, "text");
  assert.equal(layer.x, 96);
  assert.equal(layer.y, 4);
});

test("les identifiants de calque sont uniques", () => {
  const a = addStickerLayer([], "😂");
  const b = addStickerLayer(a.layers, "🔥");
  assert.notEqual(a.id, b.id);
});

test("appendStrokePoint n'ajoute un point qu'au bon tracé", () => {
  const a = addStrokeLayer([], [1, 1], 0, 1);
  const b = addStrokeLayer(a.layers, [2, 2], 0, 1);
  const next = appendStrokePoint(b.layers, a.id, [3, 3]);
  const [first, second] = next as { points: [number, number][] }[];
  assert.equal(first.points.length, 2);
  assert.equal(second.points.length, 1);
});

test("moveLayer ne déplace pas un tracé", () => {
  const s = addStrokeLayer([], [5, 5], 0, 0);
  assert.deepEqual(moveLayer(s.layers, s.id, 60, 60), s.layers);
});

test("moveLayer borne un sticker", () => {
  const s = addStickerLayer([], "✨", 50, 50);
  const moved = moveLayer(s.layers, s.id, 0, 100);
  assert.equal(moved[0].kind === "sticker" && moved[0].x, 4);
  assert.equal(moved[0].kind === "sticker" && moved[0].y, 96);
});

test("updateLayer ne change que le calque visé", () => {
  const a = addTextLayer([]);
  const b = addTextLayer(a.layers);
  const next = updateLayer(b.layers, a.id, { text: "salut" });
  assert.equal(next[0].kind === "text" && next[0].text, "salut");
  assert.equal(next[1].kind === "text" && next[1].text, "");
});

test("removeLayer retire le calque par identifiant", () => {
  const a = addStickerLayer([], "🎉");
  assert.deepEqual(removeLayer(a.layers, a.id), []);
});

test("textOf et hasContent ignorent les textes vides", () => {
  const a = addTextLayer([]);
  const blank = a.layers;
  assert.equal(textOf(blank), "");
  assert.equal(hasContent(blank), false);
  const filled = updateLayer(blank, a.id, { text: "  bonjour " });
  assert.equal(textOf(filled), "bonjour");
  assert.equal(hasContent(filled), true);
  const sticker = addStickerLayer([], "💯");
  assert.equal(hasContent(sticker.layers), true);
});

test("wrapLines garde un texte court sur une ligne", () => {
  assert.deepEqual(wrapLines("bonjour", 100, measure), ["bonjour"]);
});

test("wrapLines coupe aux mots et respecte les sauts de ligne", () => {
  assert.deepEqual(wrapLines("un deux trois\nquatre", 100, measure), ["un deux", "trois", "quatre"]);
});

test("wrapLines garde les lignes vides", () => {
  assert.deepEqual(wrapLines("a\n\nb", 100, measure), ["a", "", "b"]);
});

test("wrapLines découpe un mot trop long par caractères", () => {
  const lines = wrapLines("abcdefghij", 30, measure);
  assert.deepEqual(lines, ["abc", "def", "ghi", "j"]);
  for (const line of lines) assert.ok(measure(line) <= 30);
});

test("wrapLines ne perd aucun caractère", () => {
  const text = "un mot extraordinairement long puis fin";
  const lines = wrapLines(text, 60, measure);
  // Les coupures peuvent tomber au milieu d'un mot : on compare sans espaces.
  assert.equal(lines.join("").replace(/\s+/g, ""), text.replace(/\s+/g, ""));
  for (const line of lines) assert.ok(measure(line) <= 60, `ligne trop large : ${line}`);
});

console.log(`\n${passed} tests OK`);
