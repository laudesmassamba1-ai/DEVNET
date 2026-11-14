/**
 * Machine d’état du lecteur de stories.
 *
 * Le lecteur avait trois booléens/statuts indépendants (`loading`, `paused`,
 * `hidden`) et des transitions dispersées dans les effets. Cette machine les
 * rend explicites et testables sans DOM :
 *
 *   loading ──loaded──▶ ready ──pause──▶ paused
 *      │                  ▲               │
 *      └──unavailable──▶ error            └──resume──▶ ready
 *
 * `hidden` est un état d’environnement, pas une phase : un onglet caché
 * suspend l’avance automatique sans changer la phase de lecture.
 */
export type StoryPlaybackStatus = "loading" | "ready" | "unavailable";

export interface StoryPlaybackState {
  status: StoryPlaybackStatus;
  paused: boolean;
  hidden: boolean;
}

export type StoryPlaybackEvent =
  | { type: "loaded" }
  | { type: "unavailable" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "toggle-pause" }
  | { type: "visibility"; hidden: boolean };

export const initialStoryPlayback: StoryPlaybackState = {
  status: "loading",
  paused: false,
  hidden: false,
};

export function storyPlaybackReducer(
  state: StoryPlaybackState,
  event: StoryPlaybackEvent,
): StoryPlaybackState {
  switch (event.type) {
    case "loaded":
      return { ...state, status: "ready" };
    case "unavailable":
      return { ...state, status: "unavailable" };
    case "pause":
      return { ...state, paused: true };
    case "resume":
      return { ...state, paused: false };
    case "toggle-pause":
      return { ...state, paused: !state.paused };
    case "visibility":
      return { ...state, hidden: event.hidden };
    default:
      return state;
  }
}
