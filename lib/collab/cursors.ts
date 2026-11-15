/**
 * Le curseur distant — le **modèle**, séparé du temps réel.
 *
 * ## Pourquoi ce fichier n'importe rien
 *
 * Un curseur collaboratif est une information fragile : une position, un
 * décalage d'un caractère, une couleur qui change à chaque frappe. Ce genre
 * de logique se vérifie à la main, hors navigateur, sinon chaque essai coûte
 * un onglet et un second compte. On garde donc ici **tout ce qui est pur** —
 * encodage, décodage, couleurs, arithmétique de position, fusion de listes —
 * et rien d'autre. `useCollab.ts` porte le canal ; ce module porte les règles.
 *
 * ## Les coordonnées
 *
 * Les positions sont en **1-based** (`line`, `column`), exactement comme
 * Monaco (`{ lineNumber, column }`). Une position 0-based aurait obligé
 * chaque appelant à se souvenir du sens de conversion ; en partageant la
 * convention de l'éditeur, la traduction est l'identité.
 */

/** Position dans un fichier, en coordonnées 1-based comme Monaco. */
export interface CollabPosition {
  line: number;
  column: number;
}

/**
 * Un curseur distant.
 *
 * `anchor` est l'origine de la sélection, `head` la fin. Pour un simple
 * caret, les deux sont égaux. On porte la sélection complète plutôt qu'un
 * point : s'en passer obligerait à distinguer deux formes d'événements, et
 * un curseur qui se déplace en sélectionnant doit être **une** mise à jour,
 * pas deux qui se croisent dans un ordre incertain.
 */
export interface CollabCursor {
  userId: string;
  pseudo: string;
  color: string;
  path: string;
  anchor: CollabPosition;
  head: CollabPosition;
}

/** Qui je suis, tel que je le diffuse aux autres. */
export interface CollabSelf {
  id: string;
  pseudo: string;
  color: string;
  path: string;
}

/** Un message du fil d'équipe — volatile, il ne vit que sur le canal. */
export interface CollabChatMessage {
  id: string;
  userId: string;
  pseudo: string;
  color: string;
  text: string;
  at: string;
}

/* ------------------------------------------------------------------ */
/* Couleur : stable par personne, jamais tirée au sort                 */
/* ------------------------------------------------------------------ */

/**
 * Les couleurs de curseur disponibles.
 *
 * Ce sont les jetons d'avatar du reste du produit : un curseur doit
 * ressembler à la personne, pas introduire une palette parallèle que
 * l'œil devrait réapprendre.
 */
export const CURSOR_PALETTE = [
  "av-lime",
  "av-sage",
  "av-pink",
  "av-orange",
  "av-violet",
] as const;

/**
 * Hachage FNV-1a d'un identifiant.
 *
 * Déterministe et sans dépendance : la couleur d'un pair est la même sur
 * tous les postes, sans coordination. Un `Math.random()` aurait fait
 * clignoter la couleur à chaque reconnexion — et deux personnes auraient
 * vu des couleurs différentes pour la même personne.
 */
export function hashUserId(userId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** La couleur de repli d'une personne : stable tant que l'id l'est. */
export function cursorColorFor(userId: string): string {
  if (!userId) return CURSOR_PALETTE[0];
  return CURSOR_PALETTE[hashUserId(userId) % CURSOR_PALETTE.length];
}

/**
 * Le jeton de couleur résolu en propriété CSS, avec repli sûr.
 *
 * On rend la teinte **de fond** (`-bg`), pas l'encre : un caret est dessiné
 * sur le fond sombre de l'éditeur (`--color-code-bg`), où les encres
 * d'avatar — volontairement foncées pour un chip clair — disparaîtraient.
 */
export function cursorColorVar(color: string | null | undefined): string {
  const token = (CURSOR_PALETTE as readonly string[]).includes(color ?? "")
    ? color
    : "av-sage";
  return `var(--color-${token}-bg)`;
}

/* ------------------------------------------------------------------ */
/* Enveloppe `broadcast`                                               */
/* ------------------------------------------------------------------ */

/**
 * Déballe un message de diffusion.
 *
 * Supabase réel remet une enveloppe `{ type, event, payload }` ; le démo
 * local, lui, remet le corps nu. Deux formes pour un seul geste — les
 * appeler différemment obligerait chaque écouteur à savoir dans quel mode
 * il tourne. Une ligne suffit à absorber l'écart.
 *
 * Le repli est sûr : notre propre charge (`u`, `i`, `t`…) n'a jamais de clé
 * `payload`, donc un corps nu n'est pas pris pour une enveloppe.
 */
export function unwrapBroadcast(arg: unknown): unknown {
  if (arg && typeof arg === "object") {
    const body = arg as Record<string, unknown>;
    if (body.payload && typeof body.payload === "object") return body.payload;
  }
  return arg;
}

/* ------------------------------------------------------------------ */
/* Encodage / décodage : la charge minimale qui traverse le réseau      */
/* ------------------------------------------------------------------ */

/**
 * La charge utile d'un curseur, en clés courtes.
 *
 * Un curseur se diffuse plusieurs fois par seconde : la clé `userId` en
 * toute lettre coûte huit octets par message pour la même information
 * qu'un `u`. Sur un canal qui porte du mouvement, ce n'est pas de la
 * micro-optimisation, c'est la différence entre un signal et un flux.
 */
export interface CursorWire {
  u: string;
  p: string;
  c: string;
  f: string;
  a: [number, number];
  h: [number, number];
}

export interface ChatWire {
  i: string;
  u: string;
  p: string;
  c: string;
  t: string;
  a: string;
}

/** Ramène une position dans les bornes du raisonnable (1-based). */
export function normalizePosition(position: CollabPosition): CollabPosition {
  const line = Number.isFinite(position.line) ? Math.trunc(position.line) : 1;
  const column = Number.isFinite(position.column) ? Math.trunc(position.column) : 1;
  return { line: Math.max(1, line), column: Math.max(1, column) };
}

export function encodeCursor(cursor: CollabCursor): CursorWire {
  const anchor = normalizePosition(cursor.anchor);
  const head = normalizePosition(cursor.head);
  return {
    u: cursor.userId,
    p: cursor.pseudo,
    c: cursor.color,
    f: cursor.path,
    a: [anchor.line, anchor.column],
    h: [head.line, head.column],
  };
}

/** Une paire `[ligne, colonne]` lue avec méfiance. */
function readPair(value: unknown): CollabPosition | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const line = Number(value[0]);
  const column = Number(value[1]);
  if (!Number.isFinite(line) || !Number.isFinite(column)) return null;
  return normalizePosition({ line, column });
}

/**
 * Relit un curseur reçu.
 *
 * Tout ce qui n'est pas lisible compte comme **absent** : un curseur à
 * demi-formé vaut mieux ignoré qu'affiché à une ligne 1 par accident, ce
 * qui poserait un faux caret en tête de fichier.
 */
export function decodeCursor(value: unknown): CollabCursor | null {
  if (!value || typeof value !== "object") return null;
  const wire = value as Partial<CursorWire>;

  if (typeof wire.u !== "string" || wire.u.length === 0) return null;
  const anchor = readPair(wire.a);
  const head = readPair(wire.h);
  if (!anchor || !head) return null;

  return {
    userId: wire.u,
    pseudo: typeof wire.p === "string" ? wire.p : "",
    color: typeof wire.c === "string" ? wire.c : cursorColorFor(wire.u),
    path: typeof wire.f === "string" ? wire.f : "",
    anchor,
    head,
  };
}

export function encodeChat(message: CollabChatMessage): ChatWire {
  return {
    i: message.id,
    u: message.userId,
    p: message.pseudo,
    c: message.color,
    t: message.text,
    a: message.at,
  };
}

export function decodeChat(value: unknown): CollabChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const wire = value as Partial<ChatWire>;

  if (typeof wire.i !== "string" || wire.i.length === 0) return null;
  if (typeof wire.t !== "string" || wire.t.length === 0) return null;
  if (typeof wire.u !== "string" || wire.u.length === 0) return null;

  return {
    id: wire.i,
    userId: wire.u,
    pseudo: typeof wire.p === "string" ? wire.p : "",
    color: typeof wire.c === "string" ? wire.c : cursorColorFor(wire.u),
    text: wire.t,
    at: typeof wire.a === "string" ? wire.a : new Date(0).toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Caret Monaco ↔ décalage texte                                       */
/* ------------------------------------------------------------------ */

/** La position telle que Monaco la nomme. */
export interface MonacoPosition {
  lineNumber: number;
  column: number;
}

/** Monaco → modèle. */
export function fromMonacoPosition(position: MonacoPosition): CollabPosition {
  return normalizePosition({ line: position.lineNumber, column: position.column });
}

/** Modèle → Monaco. */
export function toMonacoPosition(position: CollabPosition): MonacoPosition {
  const safe = normalizePosition(position);
  return { lineNumber: safe.line, column: safe.column };
}

/**
 * Décalage (0-based) → ligne/colonne (1-based).
 *
 * C'est la traduction que Monaco fait avec `getPositionAt`, mais sans
 * Monaco : le test peut alors la vérifier sans navigateur, ce qui est le
 * seul endroit où une erreur de borne se voit.
 */
export function offsetToPosition(text: string, offset: number): CollabPosition {
  const raw = Number.isFinite(offset) ? Math.trunc(offset) : 0;
  const at = Math.max(0, Math.min(raw, text.length));

  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < at; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: at - lineStart + 1 };
}

/**
 * Ligne/colonne (1-based) → décalage (0-based).
 *
 * Une colonne qui dépasse la fin de sa ligne s'arrête au bout de la ligne
 * plutôt qu'au bout du fichier : le repli reste local, ce qui évite qu'un
 * curseur légèrement en avance saute dans la ligne suivante.
 */
export function positionToOffset(text: string, position: CollabPosition): number {
  const safe = normalizePosition(position);

  let offset = 0;
  let line = 1;
  while (line < safe.line) {
    const next = text.indexOf("\n", offset);
    if (next === -1) {
      offset = text.length;
      break;
    }
    offset = next + 1;
    line++;
  }

  let remaining = safe.column - 1;
  while (remaining > 0 && offset < text.length && text[offset] !== "\n") {
    offset++;
    remaining--;
  }
  return offset;
}

/* ------------------------------------------------------------------ */
/* Fusion : une personne = un curseur                                  */
/* ------------------------------------------------------------------ */

/**
 * Déduplique une liste de curseurs par personne, **la dernière gagne**.
 *
 * Une reconnexion peut livrer deux fois le même pair ; sans ce filtre, le
 * calque afficherait deux carets pour un seul doigt. La `Map` conserve la
 * position d'insertion d'origine de la clé, donc l'ordre d'apparition reste
 * stable même quand la valeur est remplacée.
 */
export function mergeCursors(cursors: CollabCursor[]): CollabCursor[] {
  const byUser = new Map<string, CollabCursor>();
  for (const cursor of cursors) byUser.set(cursor.userId, cursor);
  return Array.from(byUser.values());
}

/** Pose ou remplace mon curseur dans la liste d'un pair. */
export function upsertCursor(
  cursors: CollabCursor[],
  cursor: CollabCursor,
): CollabCursor[] {
  const index = cursors.findIndex((c) => c.userId === cursor.userId);
  if (index === -1) return [...cursors, cursor];
  const next = cursors.slice();
  next[index] = cursor;
  return next;
}

/** Retire un pair (expiration, départ). */
export function removeCursor(cursors: CollabCursor[], userId: string): CollabCursor[] {
  return cursors.filter((c) => c.userId !== userId);
}

/**
 * Ajoute un message s'il est nouveau, borne la mémoire.
 *
 * L'identifiant fait foi : un message rejoué n'apparaît pas deux fois. La
 * borne évite qu'un long après-midi de discussion ne fasse croître une
 * liste qui n'est jamais persistée.
 */
export function appendChat(
  messages: CollabChatMessage[],
  message: CollabChatMessage,
  cap = 200,
): CollabChatMessage[] {
  if (messages.some((m) => m.id === message.id)) return messages;
  const next = [...messages, message];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
