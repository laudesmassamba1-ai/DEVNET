/**
 * Test du tokenizer de coloration syntaxique.
 *
 *   npx tsx scripts/test-highlight.ts
 *
 * La coloration n'est pas un simple affichage : une régression ici change ce
 * que voit un utilisateur sur un post de code, qui est le contenu principal
 * du produit. On vérifie donc la découpe, pas seulement « ça ne plante pas ».
 */

import { highlight, normalizeLang, toLines, type TokenType } from "../lib/highlight";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

/** Valeurs concaténées : le texte d'origine doit être restitué tel quel. */
function text(ts: { value: string }[]): string {
  return ts.map((t) => t.value).join("");
}

/** Types présents dans le résultat, pour une recherche ciblée. */
function types(ts: { type: TokenType }[]): Set<TokenType> {
  return new Set(ts.map((t) => t.type));
}

/** Les jetons d'un type donné, texte à texte. */
function values(ts: { type: TokenType; value: string }[], type: TokenType): string[] {
  return ts.filter((t) => t.type === type).map((t) => t.value);
}

function main() {
  // ── Normalisation des noms de langage ──
  const cases: [string, string][] = [
    ["Python", "python"],
    ["python", "python"],
    ["JS", "javascript"],
    ["TypeScript", "typescript"],
    ["C / C++", "c"],
    ["C++", "cpp"],
    ["SQL", "sql"],
    ["postgresql", "sql"],
    ["golang", "go"],
    ["rs", "rust"],
    ["HTML/CSS", "text"],
    ["", "text"],
    ["Klingon", "text"],
  ];

  for (const [input, expected] of cases) {
    check(`normalizeLang(${JSON.stringify(input)})`, normalizeLang(input) === expected,
      normalizeLang(input));
  }

  // ── Invariant fundamental : le texte est restitué à l'identique ──
  // Un coloriage imparfait reste acceptable ; perdre un caractère, non.
  const samples: [string, string][] = [
    ["python", "def norm(X):\n    return X / 100  # normaliser\n"],
    ["javascript", "const f = async (x) => `v=${x ?? 'none'}`; // arrow\n"],
    ["sql", "SELECT id, pseudo FROM users WHERE account_type = 'professional';\n"],
    ["go", "func main() {\n\tfmt.Println(\"hi\")\n}\n"],
    ["rust", "fn main() {\n    let v: Vec<String> = vec![];\n}\n"],
    ["php", "<?php\nfunction f($a) { return $a ?? null; }\n"],
    ["kotlin", "fun main() { val x: Int = 3 }\n"],
    ["dart", "void main() { final x = <String>[]; }\n"],
    ["c", "int main(void) { return 0; /* fin */ }\n"],
    ["unknown-lang", "du textearbitrary ~~ 123\n"],
  ];

  for (const [lang, code] of samples) {
    const tokens = highlight(code, lang);
    check(`${lang} : texte intégralement restitué`, text(tokens) === code,
      { attendu: code, obtenu: text(tokens) });
  }

  // ── Python : mots-clés, chaîne, nombre, commentaire, fonction ──
  const py = highlight(
    "def norm(X):\n    scaler = StandardScaler()  # avant split\n    return X.mean()\n",
    "python",
  );
  check("python : `def` est un mot-clé", values(py, "keyword").includes("def"));
  check("python : commentaire identifié",
    values(py, "comment").some((v) => v.includes("avant split")));
  check("python : appel de fonction colorié `function`",
    values(py, "function").some((v) => v === "norm" || v === "StandardScaler"));
  check("python : aucun mot-clé dans le commentaire",
    !values(py, "comment").some((v) => v.includes("def")));

  // ── Python : chaîne triple + guillemets simples ──
  const pyStr = highlight('a = """doc\nstring""" + \'s\'', "python");
  check("python : chaîne triple reconnue",
    values(pyStr, "string").some((v) => v.includes("doc")));
  check("python : guillemet simple reconnu",
    values(pyStr, "string").includes("'s'"));

  // ── JavaScript : template string, mot-clé, arrow function ──
  const js = highlight("const msg = `bonjour ${nom}`;\nlet n = 42; // fin", "javascript");
  check("js : `const` est un mot-clé", values(js, "keyword").includes("const"));
  check("js : `let` est un mot-clé", values(js, "keyword").includes("let"));
  check("js : template string entière coloriée",
    values(js, "string").some((v) => v.includes("${nom}")));
  check("js : nombre colorié", values(js, "number").includes("42"));
  check("js : commentaire fin de ligne", values(js, "comment").includes("// fin"));

  // ── JS : commentaire multi-lignes ne doit pas déborder ──
  const jsBlock = highlight("/* a\nb */ const x = 1;", "javascript");
  check("js : commentaire /* */ entier",
    values(jsBlock, "comment").some((v) => v === "/* a\nb */"));
  check("js : rien après le commentaire n'est perdu", text(jsBlock) === "/* a\nb */ const x = 1;");

  // ── SQL : insensible à la casse, tiret tiret ──
  const sql = highlight(
    "select COUNT(*) -- total\nfrom users where pseudo ilike '%ami%';",
    "sql",
  );
  // Le tokenizer préserve la casse source : SELECT et select sont équivalents,
  // mais le jeton restitué est celui qu'on a écrit.
  const kw = values(sql, "keyword").map((v) => v.toLowerCase());
  check("sql : SELECT reconnu", kw.includes("select"));
  check("sql : WHERE majuscule reconnu", kw.includes("where"));
  check("sql : commentaire `--`", values(sql, "comment").some((v) => v.startsWith("-- total")));
  check("sql : chaîne avec % coloriée", values(sql, "string").some((v) => v.includes("%ami%")));
  check("sql : ilike colorié comme fonction",
    values(sql, "function").map((v) => v.toLowerCase()).includes("ilike"));
  check("sql : COUNT colorié comme fonction, pas comme type",
    values(sql, "function").includes("COUNT") && !values(sql, "type").includes("COUNT"));

  // ── SQL : un mot-clé dans une chaîne ne doit pas le devenir ──
  const sqlStr = highlight("select 'from where' as x;", "sql");
  check("sql : mots-clés dans une chaîne non coloriés comme tels",
    values(sqlStr, "string").some((v) => v.includes("from where")));

  // ── Go / Rust / C : mots-clés ──
  check("go : func est un mot-clé", values(highlight("func main() {}", "go"), "keyword").includes("func"));
  check("rust : fn est un mot-clé", values(highlight("fn main() {}", "rust"), "keyword").includes("fn"));
  check("c : int est un mot-clé", values(highlight("int x = 1;", "c"), "keyword").includes("int"));
  check("php : function est un mot-clé",
    values(highlight("function f() {}", "php"), "keyword").includes("function"));

  // ── Les natives précèdent la convention « majuscule = type » ──
  check("python : print colorié comme fonction",
    values(highlight("print(1)", "python"), "function").includes("print"));
  check("python : len colorié comme fonction",
    values(highlight("len(x)", "python"), "function").includes("len"));
  check("js : console colorié comme fonction, pas comme type",
    values(highlight("console.log(1)", "javascript"), "function").includes("console"));
  check("go : fmt colorié comme fonction",
    values(highlight("fmt.Println(1)", "go"), "function").includes("fmt"));

  // ── Les majuscules désignent un type ──
  check("type : identifiant capitalisé",
    values(highlight("class FooBar:", "python"), "type").includes("FooBar"));

  // ── Nombres : hexadécimal, décimal, flottant ──
  const nums = highlight("0xFF 3.14 1_000 42", "python");
  const nvals = values(nums, "number");
  check("nombres : hexadécimal", nvals.includes("0xFF"), nvals);
  check("nombres : flottant", nvals.includes("3.14"), nvals);
  check("nombres : séparateur _", nvals.includes("1_000"), nvals);

  // ── Segementation en lignes ──
  const lines = toLines(highlight("a = 1\nb = 2\n", "python"));
  check("lignes : 3 lignes attendues", lines.length === 3, lines.length);
  check("lignes : contenu de la 2e ligne",
    text(lines[1]).trim() === "b = 2", text(lines[1]));

  // ── Cas limites ──
  check("chaîne vide", highlight("", "python").length === 0);
  check("code vide → une ligne vide", toLines(highlight("", "python")).length === 1);
  check("chaîne non fermée ne boucle pas",
    text(highlight('a = "pas fermé', "python")) === 'a = "pas fermé');
  check("guillemet échappé", values(highlight('a = "x\\"y"', "python"), "string")
    .some((v) => v.includes("\\\"y")));
  check("résultat non vide pour du texte",
    types(highlight("bonjour", "python")).has("plain"));

  // ── Rapport ──
  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ Le tokenizer restitue le code et colourise correctement\n");
}

main();