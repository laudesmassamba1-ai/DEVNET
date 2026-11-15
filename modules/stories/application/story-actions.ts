/**
 * Validation des gestes d'une story, avant la base.
 *
 * Le corps d'une requête est une entrée utilisateur : rien n'y est supposé.
 * Les bornes vivent ici, pas dans l'écran — un `x = 4` ou une réponse de
 * 10 000 caractères doit être refusé avant d'atteindre Postgres, avec un
 * message qui dit quoi corriger.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STICKER_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const STORY_REPLY_MAX = 500;

export type StoryAction =
  | { action: "like"; storyId: string }
  | { action: "view"; storyId: string }
  | { action: "reply"; storyId: string; body: string }
  | {
      action: "sticker";
      storyId: string;
      stickerId: string;
      x: number;
      y: number;
      scale: number;
      rotation: number;
    }
  | {
      action: "move-sticker";
      storyId: string;
      placedId: string;
      x: number;
      y: number;
      scale: number;
      rotation: number;
    }
  | { action: "remove-sticker"; storyId: string; placedId: string };

export type StoryActionRead = { ok: true; value: StoryAction } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Nombre fini, borné — `NaN` et `Infinity` n'ont aucune coordonnée. */
function bounded(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return Math.round(value * 1000) / 1000;
}

export function readStoryAction(raw: unknown): StoryActionRead {
  if (!isRecord(raw)) return { ok: false, error: "corps de requête invalide" };

  const storyId = typeof raw.storyId === "string" ? raw.storyId.trim() : "";
  if (!UUID.test(storyId)) return { ok: false, error: "story inconnue" };

  if (raw.action === "like") return { ok: true, value: { action: "like", storyId } };
  if (raw.action === "view") return { ok: true, value: { action: "view", storyId } };

  if (raw.action === "reply") {
    const body = typeof raw.body === "string" ? raw.body.trim() : "";
    if (body.length === 0) return { ok: false, error: "réponse vide" };
    if (body.length > STORY_REPLY_MAX) {
      return { ok: false, error: `${STORY_REPLY_MAX} caractères maximum` };
    }
    return { ok: true, value: { action: "reply", storyId, body } };
  }

  if (raw.action === "move-sticker" || raw.action === "remove-sticker") {
    const placedId = typeof raw.placedId === "string" ? raw.placedId.trim() : "";
    if (!UUID.test(placedId)) return { ok: false, error: "sticker posé inconnu" };
    if (raw.action === "remove-sticker") {
      return { ok: true, value: { action: "remove-sticker", storyId, placedId } };
    }

    const x = bounded(raw.x, 0, 1);
    const y = bounded(raw.y, 0, 1);
    const scale = bounded(raw.scale, 0.5, 3);
    const rotation = bounded(raw.rotation, -180, 180);
    if (x === null || y === null) return { ok: false, error: "position hors de la story" };
    if (scale === null) return { ok: false, error: "taille hors bornes" };
    if (rotation === null) return { ok: false, error: "rotation hors bornes" };
    return { ok: true, value: { action: "move-sticker", storyId, placedId, x, y, scale, rotation } };
  }

  if (raw.action === "sticker") {
    const stickerId = typeof raw.stickerId === "string" ? raw.stickerId.trim() : "";
    if (!STICKER_ID.test(stickerId)) return { ok: false, error: "sticker inconnu" };

    const x = bounded(raw.x, 0, 1);
    const y = bounded(raw.y, 0, 1);
    const scale = bounded(raw.scale ?? 1, 0.5, 3);
    const rotation = bounded(raw.rotation ?? 0, -180, 180);
    if (x === null || y === null) return { ok: false, error: "position hors de la story" };
    if (scale === null) return { ok: false, error: "taille hors bornes" };
    if (rotation === null) return { ok: false, error: "rotation hors bornes" };

    return {
      ok: true,
      value: { action: "sticker", storyId, stickerId, x, y, scale, rotation },
    };
  }

  return { ok: false, error: "action inconnue" };
}
