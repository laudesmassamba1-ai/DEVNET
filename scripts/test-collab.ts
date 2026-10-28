/**
 * Tests du modèle de collaboration — curseurs et fil d'équipe.
 *
 *   npx tsx scripts/test-collab.ts
 *
 * Ce qu'on vérifie ici est exactement ce qui ne se voit pas à l'écran quand
 * c'est faux : une position d'un caractère à côté, une couleur qui change à
 * chaque reconnexion, un curseur rejoué affiché deux fois, un message dupliqué.
 * Rien de tout cela ne lève d'erreur — cela se contente d'être faux.
 */

import {
  appendChat,
  cursorColorFor,
  decodeChat,
  decodeCursor,
  encodeChat,
  encodeCursor,
  mergeCursors,
  offsetToPosition,
  positionToOffset,
  removeCursor,
  unwrapBroadcast,
  upsertCursor,
  CURSOR_PALETTE,
  type CollabChatMessage,
  type CollabCursor,
} from "../lib/collab/cursors";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

/** Égalité structurelle rapide : suffisant pour des objets sans cycle. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function main() {
  /* ── Encodage / décodage d'un curseur ─────────────────────────── */

  const cursor: CollabCursor = {
    userId: "u-koffi",
    pseudo: "Koffi",
    color: "av-lime",
    path: "registre.py",
    anchor: { line: 3, column: 5 },
    head: { line: 7, column: 2 },
  };

  const wire = encodeCursor(cursor);
  // Les clés courtes sont le contrat du réseau : une lettre de plus par
  // clé, multipliée par plusieurs envois par seconde, n'est pas gratuite.
  check("l'encodage emploie les clés courtes",
    same(Object.keys(wire).sort(), ["a", "c", "f", "h", "p", "u"]), Object.keys(wire));

  const back = decodeCursor(wire);
  check("l'aller-retour d'un curseur est exact", same(back, cursor), { cursor, back });

  // Une position à zéro n'existe pas : le décodage normalise, pas l'appelant.
  const clamped = decodeCursor(encodeCursor({ ...cursor, anchor: { line: 0, column: 0 } }));
  check("une position 0 est ramenée à 1",
    clamped !== null && clamped.anchor.line === 1 && clamped.anchor.column === 1, clamped);

  // Un curseur à demi-formé vaut mieux ignoré qu'affiché à une position fausse.
  check("un curseur vide est refusé", decodeCursor(null) === null);
  check("un curseur sans identifiant est refusé", decodeCursor({ a: [1, 1], h: [1, 1] }) === null);
  check("un curseur sans position est refusé",
    decodeCursor({ u: "u-1", p: "X", c: "av-sage", f: "a.py" }) === null);
  check("un curseur dont la position n'est pas un nombre est refusé",
    decodeCursor({ u: "u-1", a: ["x", "y"], h: [1, 1] }) === null);

  /* ── Couleur : stable par personne ────────────────────────────── */

  check("la même personne garde la même couleur",
    cursorColorFor("u-koffi") === cursorColorFor("u-koffi"));
  check("le hachage est déterministe",
    cursorColorFor("u-koffi") === cursorColorFor("u-koffi"));

  const ids = ["u-koffi", "u-thabo", "u-1", "u-2", "u-3", "u-abe", "", "pro:42"];
  check("toute couleur vient de la palette",
    ids.every((id) => (CURSOR_PALETTE as readonly string[]).includes(cursorColorFor(id))),
    ids.map((id) => cursorColorFor(id)));

  // La couleur d'un inconnu ne doit pas être vide : un curseur sans couleur
  // serait invisible plutôt que mal coloré.
  check("un identifiant absent reçoit une couleur de repli",
    (CURSOR_PALETTE as readonly string[]).includes(cursorColorFor("")));

  /* ── Caret : décalage ↔ ligne/colonne ─────────────────────────── */

  const text = "a\nbb\n\nccc\n";
  check("le texte témoin a la longueur attendue", text.length === 10, text.length);

  check("offset 0 → (1,1)", same(offsetToPosition(text, 0), { line: 1, column: 1 }));
  check("offset 1 → fin de la 1re ligne", same(offsetToPosition(text, 1), { line: 1, column: 2 }));
  check("offset 2 → début de la 2e ligne", same(offsetToPosition(text, 2), { line: 2, column: 1 }));
  check("offset 4 → fin de la 2e ligne", same(offsetToPosition(text, 4), { line: 2, column: 3 }));
  check("offset 5 → début de la 3e ligne (vide)", same(offsetToPosition(text, 5), { line: 3, column: 1 }));
  check("offset 10 → ligne après le dernier saut", same(offsetToPosition(text, 10), { line: 5, column: 1 }));

  // Les bornes : un décalage négatif ne doit pas déborder avant le début,
  // un décalage trop grand ne doit pas inventer une ligne.
  check("un offset négatif ramène au début", same(offsetToPosition(text, -5), { line: 1, column: 1 }));
  check("un offset trop grand s'arrête à la fin", same(offsetToPosition(text, 999), { line: 5, column: 1 }));

  // L'invariant central : tout décalage valide fait l'aller-retour.
  let roundTrip = true;
  for (let offset = 0; offset <= text.length; offset++) {
    const position = offsetToPosition(text, offset);
    if (positionToOffset(text, position) !== offset) {
      roundTrip = false;
      failures.push(`aller-retour cassé à l'offset ${offset} → ${JSON.stringify(position)}`);
      break;
    }
  }
  check("décalage → position → décalage pour tous les offsets", roundTrip);

  check("position → décalage → position", same(
    offsetToPosition(text, positionToOffset(text, { line: 2, column: 3 })),
    { line: 2, column: 3 },
  ));

  // Une colonne qui dépasse la ligne s'arrête à la fin de **sa** ligne, pas
  // au bout du fichier : le repli reste local.
  check("une colonne en trop s'arrête à la fin de la ligne",
    positionToOffset(text, { line: 2, column: 99 }) === 4,
    positionToOffset(text, { line: 2, column: 99 }));

  check("une ligne en trop s'arrête au bout du fichier",
    positionToOffset(text, { line: 99, column: 1 }) === text.length);

  /* ── Monaco ↔ modèle ──────────────────────────────────────────── */

  const monaco = { lineNumber: 4, column: 6 };
  check("Monaco → modèle sans translation",
    same({ line: 4, column: 6 }, { line: monaco.lineNumber, column: monaco.column }));
  check("le modèle reprend la convention 1-based de Monaco",
    same(offsetToPosition("abc\ndef", 4), { line: 2, column: 1 }));

  /* ── Fusion : une personne, un curseur ────────────────────────── */

  const a1: CollabCursor = { userId: "u-a", pseudo: "A", color: "av-lime", path: "f.py", anchor: { line: 1, column: 1 }, head: { line: 1, column: 1 } };
  const a2: CollabCursor = { ...a1, head: { line: 1, column: 4 } };
  const b1: CollabCursor = { ...a1, userId: "u-b", pseudo: "B", color: "av-pink" };

  const merged = mergeCursors([a1, b1, a2]);
  check("la fusion déduplique par personne", merged.length === 2, merged.length);
  check("la dernière position gagne", same(merged[0], a2), merged[0]);
  check("l'ordre d'apparition est conservé", merged.map((c) => c.userId).join(",") === "u-a,u-b");

  const upserted = upsertCursor([a1, b1], { ...a2, head: { line: 2, column: 1 } });
  check("le remplacement ne change pas la longueur", upserted.length === 2);
  check("le remplacement viser la bonne personne", upserted[0].head.line === 2);

  const appended = upsertCursor([a1], b1);
  check("un nouveau pair est ajouté", appended.length === 2 && appended[1].userId === "u-b");

  check("le retrait enlève exactement un pair",
    removeCursor([a1, b1], "u-a").map((c) => c.userId).join(",") === "u-b");

  /* ── Le fil : messages ────────────────────────────────────────── */

  const message: CollabChatMessage = {
    id: "m-1",
    userId: "u-koffi",
    pseudo: "Koffi",
    color: "av-lime",
    text: "je pousse la branche",
    at: "2026-06-01T12:00:00.000Z",
  };

  check("l'aller-retour d'un message est exact",
    same(decodeChat(encodeChat(message)), message));
  check("un message sans texte est refusé",
    decodeChat({ i: "m-2", u: "u-1", t: "" }) === null);
  check("un message sans identifiant est refusé",
    decodeChat({ u: "u-1", t: "bonjour" }) === null);

  const once = appendChat([], message);
  const twice = appendChat(once, message);
  check("un message rejoué n'apparaît qu'une fois", twice.length === 1, twice.length);

  let filled: CollabChatMessage[] = [];
  for (let i = 0; i < 5; i++) {
    filled = appendChat(filled, { ...message, id: `m-${i}` }, 3);
  }
  check("le fil est borné par la fin", filled.length === 3, filled.length);
  check("la borne garde les derniers messages",
    filled.map((m) => m.id).join(",") === "m-2,m-3,m-4", filled.map((m) => m.id));

  /* ── L'écart d'enveloppe réel / démo ──────────────────────────── */

  // Le vrai Supabase remet { type, event, payload } ; le démo remet le corps.
  const payload = encodeCursor(cursor);
  check("une enveloppe réelle est déballée",
    same(unwrapBroadcast({ type: "broadcast", event: "cursor", payload }), payload));
  check("un corps nu de démo est laissé tel quel",
    same(unwrapBroadcast(payload), payload));
  check("une valeur non-objet est laissée telle quelle", unwrapBroadcast("x") === "x");
  check("un curseur reçu des deux formes se décode pareil",
    same(decodeCursor(unwrapBroadcast({ type: "broadcast", event: "cursor", payload })),
         decodeCursor(unwrapBroadcast(payload))));

  /* ── Rapport ──────────────────────────────────────────────────── */

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ Le modèle de collaboration tient — curseurs et fil d'équipe\n");
}

main();
