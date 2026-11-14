/**
 * Tests de `paintScene` sur un faux contexte 2D qui journalise les appels.
 * Lancement : npm run test:status-editor
 */
import assert from "node:assert/strict";
import { paintScene, type PaintScene } from "../lib/status-render";
import { STAGE_H, STAGE_W, addStrokeLayer, addTextLayer, addStickerLayer } from "../lib/status-editor-model";

type Call = { name: string; args: unknown[] };

function fakeContext() {
  const calls: Call[] = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
    return undefined;
  };
  const context = {
    calls,
    filter: "none",
    fillStyle: "",
    strokeStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    globalAlpha: 1,
    shadowColor: "",
    shadowBlur: 0,
    save: record("save"),
    restore: record("restore"),
    drawImage: record("drawImage"),
    fillRect: record("fillRect"),
    fillText: record("fillText"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    arc: record("arc"),
    fill: record("fill"),
    stroke: record("stroke"),
    createLinearGradient: (...args: unknown[]) => {
      calls.push({ name: "createLinearGradient", args });
      return { addColorStop: (...stop: unknown[]) => calls.push({ name: "addColorStop", args: stop }) };
    },
    measureText: (text: string) => ({ width: text.length * 10 }),
  };
  return context;
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

function scene(overrides: Partial<PaintScene> = {}): PaintScene {
  return {
    image: null,
    palette: ["#111111", "#222222"],
    filterCss: "none",
    zoom: 0,
    layers: [],
    colorOf: (index) => `ink-${index}`,
    pillColor: "#000000",
    ...overrides,
  };
}

test("sans photo : dégradé de fond puis rectangle plein du format 1080×1920", () => {
  const context = fakeContext();
  paintScene(context as unknown as CanvasRenderingContext2D, scene());
  const names = context.calls.map((call) => call.name);
  assert.equal(names[0], "createLinearGradient");
  const fill = context.calls.find((call) => call.name === "fillRect");
  assert.deepEqual(fill?.args, [0, 0, STAGE_W, STAGE_H]);
});

test("avec photo : le filtre est posé puis remis à 'none' autour du dessin", () => {
  const context = fakeContext();
  const image = { naturalWidth: 540, naturalHeight: 960 };
  paintScene(
    context as unknown as CanvasRenderingContext2D,
    scene({ image: image as unknown as CanvasImageSource, filterCss: "grayscale(1)" }),
  );
  const draw = context.calls.find((call) => call.name === "drawImage");
  assert.ok(draw, "drawImage appelé");
  // Couverture : 540×960 → échelle 2, donc 1080×1920 exactement, centré.
  assert.deepEqual(draw?.args.slice(1), [0, 0, 1080, 1920]);
  assert.equal(context.filter, "none");
});

test("un zoom agrandit la photo et la garde centrée", () => {
  const context = fakeContext();
  const image = { naturalWidth: 540, naturalHeight: 960 };
  paintScene(context as unknown as CanvasRenderingContext2D, scene({ image: image as unknown as CanvasImageSource, zoom: 1 }));
  const draw = context.calls.find((call) => call.name === "drawImage");
  const [x, y, w, h] = draw?.args.slice(1) as number[];
  assert.equal(w, 1350);
  assert.equal(h, 2400);
  assert.equal(x, (1080 - 1350) / 2);
  assert.equal(y, (1920 - 2400) / 2);
});

test("un tracé d'un seul point devient une pastille pleine", () => {
  const context = fakeContext();
  const { layers } = addStrokeLayer([], [50, 50], 0, 1);
  paintScene(context as unknown as CanvasRenderingContext2D, scene({ layers }));
  assert.equal(context.calls.filter((call) => call.name === "arc").length, 1);
  assert.equal(context.calls.filter((call) => call.name === "fill").length, 1);
  assert.equal(context.calls.filter((call) => call.name === "stroke").length, 0);
});

test("l'ordre des calques est respecté : tracé, sticker, puis texte", () => {
  const context = fakeContext();
  let layers = addStrokeLayer([], [10, 10], 0, 1).layers;
  layers = addStickerLayer(layers, "🌿", 50, 50).layers;
  layers = addTextLayer(layers, 50, 80).layers;
  layers = layers.map((layer) => (layer.kind === "text" ? { ...layer, text: "Bonjour" } : layer));
  paintScene(context as unknown as CanvasRenderingContext2D, scene({ layers }));
  const texts = context.calls.filter((call) => call.name === "fillText").map((call) => call.args[0]);
  assert.deepEqual(texts, ["🌿", "Bonjour"]);
});

test("une couleur d'encre passe par colorOf, pas par une valeur en dur", () => {
  const context = fakeContext();
  const { layers } = addStrokeLayer([], [10, 10], 2, 1);
  paintScene(context as unknown as CanvasRenderingContext2D, scene({ layers }));
  assert.equal(context.fillStyle, "ink-2");
});

console.log(`\n${passed} tests OK (paintScene)`);
