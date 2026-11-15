/**
 * Gestes de story — validation avant la base.
 *
 * Ce qui est vérifié : un corps de requête ne devient jamais une requête SQL
 * par accident. Identifiant, longueur de réponse, bornes des coordonnées,
 * valeurs non finies, arrondi. Aucun serveur n'est nécessaire.
 */
import assert from "node:assert/strict";
import { readStoryAction, STORY_REPLY_MAX } from "../modules/stories";

const STORY = "11111111-1111-4111-8111-111111111111";

function valid(raw: unknown) {
  const read = readStoryAction(raw);
  assert.equal(read.ok, true, `attendu valide : ${JSON.stringify(raw)}`);
  if (!read.ok) throw new Error("inatteignable");
  return read.value;
}

function refused(raw: unknown, why: string) {
  const read = readStoryAction(raw);
  assert.equal(read.ok, false, `attendu refusé (${why}) : ${JSON.stringify(raw)}`);
}

// Forme générale.
refused(null, "null");
refused("like", "chaîne");
refused([], "tableau");
refused({}, "sans action");
refused({ action: "like" }, "sans story");
refused({ action: "like", storyId: "nope" }, "story invalide");
refused({ action: "inconnue", storyId: STORY }, "action inconnue");

// Like et vue.
assert.deepEqual(valid({ action: "like", storyId: STORY }), { action: "like", storyId: STORY });
assert.deepEqual(valid({ action: "view", storyId: ` ${STORY} ` }), {
  action: "view",
  storyId: STORY,
});

// Réponse : vide refusée, trop longue refusée, espaces rognés.
refused({ action: "reply", storyId: STORY, body: "   " }, "réponse vide");
refused({ action: "reply", storyId: STORY, body: "a".repeat(STORY_REPLY_MAX + 1) }, "trop long");
refused({ action: "reply", storyId: STORY }, "réponse absente");
const reply = valid({ action: "reply", storyId: STORY, body: "  Bravo  " });
assert.equal(reply.action, "reply");
if (reply.action === "reply") assert.equal(reply.body, "Bravo");

// Sticker : identifiant, bornes, valeurs non finies, arrondi.
refused({ action: "sticker", storyId: STORY, stickerId: "Feu!", x: 0.5, y: 0.5 }, "id invalide");
refused({ action: "sticker", storyId: STORY, stickerId: "feu" }, "sans position");
refused({ action: "sticker", storyId: STORY, stickerId: "feu", x: 1.5, y: 0.5 }, "x hors bornes");
refused({ action: "sticker", storyId: STORY, stickerId: "feu", x: 0.5, y: -0.1 }, "y hors bornes");
refused(
  { action: "sticker", storyId: STORY, stickerId: "feu", x: 0.5, y: 0.5, scale: 4 },
  "échelle hors bornes",
);
refused(
  { action: "sticker", storyId: STORY, stickerId: "feu", x: 0.5, y: 0.5, rotation: 200 },
  "rotation hors bornes",
);
refused(
  { action: "sticker", storyId: STORY, stickerId: "feu", x: Number.NaN, y: 0.5 },
  "NaN",
);

const placed = valid({
  action: "sticker",
  storyId: STORY,
  stickerId: "shipit",
  x: 0.123456,
  y: 0.987654,
});
assert.equal(placed.action, "sticker");
if (placed.action === "sticker") {
  assert.equal(placed.x, 0.123, "x arrondi au millième");
  assert.equal(placed.y, 0.988, "y arrondi au millième");
  assert.equal(placed.scale, 1, "échelle par défaut");
  assert.equal(placed.rotation, 0, "rotation par défaut");
}

console.log("Gestes de story : validation vérifiée.");
