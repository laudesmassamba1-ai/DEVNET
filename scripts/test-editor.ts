/**
 * Tests de l'aide à la saisie de l'éditeur.
 *
 * Exécuter avec :  npx tsx scripts/test-editor.ts
 *
 * La complétion, l'indentation et les paires sont **pures** : elles ne
 * touchent pas au DOM. On peut donc prouver en Node qu'un `(` refermé
 * place le curseur au bon endroit, plutôt que de le constater — ou pas —
 * dans un navigateur, à la main.
 */

import {
  backspacePair,
  complete,
  newlineIndent,
  typePair,
  wordBeforeCaret,
} from "../lib/editor/complete";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

function main() {
  /* ── Le mot sous le curseur ───────────────────────────────────── */

  check("le préfixe est lu", wordBeforeCaret("pri", 3).prefix === "pri");
  check(
    "le préfixe s'arrête au non-mot",
    wordBeforeCaret("x = fo", 6).prefix === "fo",
    wordBeforeCaret("x = fo", 6),
  );
  check(
    "le début du préfixe est juste",
    wordBeforeCaret("x = fo", 6).start === 4,
    wordBeforeCaret("x = fo", 6),
  );
  check("pas de préfixe après un espace", wordBeforeCaret("x = ", 4).prefix === "");

  /* ── La complétion ────────────────────────────────────────────── */

  const py = complete("Python", "for x in y:\n  pr", 16);
  check("Python propose print", py !== null && py.items.includes("print"), py);
  check("la complétion remplace le préfixe", py !== null && py.prefix === "pr", py);

  const js = complete("JavaScript", "const foo = 1;\nfo", 17);
  check("JS propose le mot du fichier et le mot-clé",
    js !== null && js.items.includes("foo") && js.items.includes("for"), js);

  const none = complete("Python", "zzzz", 4);
  check("aucune proposition hors vocabulaire", none === null, none);

  check("un nom du fichier est proposé",
    complete("Python", "variable = 1\nvari", 16)?.items.includes("variable") === true);

  check("le préfixe vide ne propose rien", complete("Python", "  ", 2) === null);

  /* ── L'indentation ────────────────────────────────────────────── */

  const block = newlineIndent("if x:", 5);
  check("Python ouvre un bloc sous `:`", block.text === "if x:\n  ", JSON.stringify(block.text));
  check("le curseur suit l'indentation", block.caret === block.text.length, block);

  const same = newlineIndent("    return 1", 12);
  check("l'indentation est conservée", same.text.includes("\n    "), JSON.stringify(same.text));

  const brace = newlineIndent("function f() {", 14);
  check("JS ouvre un bloc sous `{`", brace.text.includes("\n  "), JSON.stringify(brace.text));

  const flat = newlineIndent("x = 1", 5);
  check("hors bloc, pas de cran gratuit", flat.text === "x = 1\n", JSON.stringify(flat.text));

  /* ── Les paires ───────────────────────────────────────────────── */

  const open = typePair("print", 5, 5, "(");
  check("une parenthèse se referme", open !== null && open.text === "print()", open);
  check("le curseur est au milieu", open !== null && open.caret === 6, open);

  const wrap = typePair("abc", 0, 3, "(");
  check("une sélection est encadrée", wrap !== null && wrap.text === "(abc)", wrap);

  const skip = typePair("print()", 6, 6, "(");
  check("un fermant déjà là est sauté", skip !== null && skip.text === "print()" && skip.caret === 7, skip);

  const quote = typePair("mot", 1, 1, '"');
  check("une chaîne se referme", quote !== null && quote.text === 'm""ot', quote);

  const erase = backspacePair("()", 1, 1);
  check("retour arrière efface la paire", erase !== null && erase.text === "", erase);

  const noErase = backspacePair("(x)", 2, 2);
  check("retour arrière ne touche pas un contenu", noErase === null);

  check("un caractère non ouvrant est ignoré", typePair("x", 1, 1, "a") === null);

  /* ── Rapport ──────────────────────────────────────────────────── */

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ L'éditeur indente, referme et propose — sans serveur de langage\n");
}

main();
