/**
 * Plafond de transcodages vidéo simultanés (ffmpeg).
 * Lancement : npm run test:story-transcode
 */
import assert from "node:assert/strict";
import {
  STORY_TRANSCODE_SLOTS,
  acquireTranscodeSlot,
} from "../modules/stories/infrastructure/media/story-media";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

test("les places se prennent jusqu'au plafond, puis refusent", () => {
  const releases: Array<() => void> = [];
  for (let i = 0; i < STORY_TRANSCODE_SLOTS; i += 1) {
    const release = acquireTranscodeSlot();
    assert.ok(release, `place ${i + 1} doit être accordée`);
    releases.push(release);
  }
  assert.equal(acquireTranscodeSlot(), null, "au-delà du plafond : refus");
  releases.forEach((release) => release());
});

test("une place rendue redevient disponible, et un double rendu ne compte pas deux fois", () => {
  const releases: Array<() => void> = [];
  for (let i = 0; i < STORY_TRANSCODE_SLOTS; i += 1) releases.push(acquireTranscodeSlot()!);
  releases[0]();
  releases[0]();
  const again = acquireTranscodeSlot();
  assert.ok(again, "une place rendue doit être réutilisable");
  assert.equal(acquireTranscodeSlot(), null, "le double rendu ne doit pas libérer deux places");
  again();
  releases[1]();
  for (let i = 0; i < STORY_TRANSCODE_SLOTS; i += 1) {
    const release = acquireTranscodeSlot();
    assert.ok(release);
    release();
  }
});

console.log(`\n${passed} tests OK (plafond de transcodage)`);
