/** Transitions de la machine d’état du lecteur de stories. */
import {
  initialStoryPlayback,
  storyPlaybackReducer,
  type StoryPlaybackEvent,
  type StoryPlaybackState,
} from "../lib/story-playback";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

function run(events: StoryPlaybackEvent[]): StoryPlaybackState {
  return events.reduce(storyPlaybackReducer, initialStoryPlayback);
}

const loaded = run([{ type: "loaded" }]);
check("chargement → prêt", loaded.status === "ready" && !loaded.paused, loaded);

const paused = storyPlaybackReducer(loaded, { type: "pause" });
check("pause explicite", paused.status === "ready" && paused.paused, paused);

const resumed = storyPlaybackReducer(paused, { type: "resume" });
check("reprise explicite", resumed.status === "ready" && !resumed.paused, resumed);

const toggled = storyPlaybackReducer(resumed, { type: "toggle-pause" });
check("bascule", toggled.paused, toggled);

const hidden = storyPlaybackReducer(resumed, { type: "visibility", hidden: true });
check("onglet caché sans changement de phase", hidden.hidden && hidden.status === "ready", hidden);

const shown = storyPlaybackReducer(hidden, { type: "visibility", hidden: false });
check("onglet visible", !shown.hidden, shown);

const unavailable = run([{ type: "unavailable" }]);
check("panne explicite", unavailable.status === "unavailable", unavailable);

const lateLoad = storyPlaybackReducer(unavailable, { type: "loaded" });
check("une panne peut se rétablir", lateLoad.status === "ready", lateLoad);

if (failures.length > 0) {
  console.error(`${failures.length} vérification(s) en échec`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`${passed} transitions du lecteur passent.`);
}
