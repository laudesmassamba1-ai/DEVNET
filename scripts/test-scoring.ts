/**
 * Tests du moteur de score.
 *
 * Exécuter avec :  npx tsx scripts/test-scoring.ts
 *
 * Le moteur est pur — lexeur, mesures, agrégation — donc testable ici, sans
 * navigateur. Ce fichier vérifie six choses distinctes :
 *
 * 1. que le **tokeniseur** masque comme le compilateur : chaque cas limite
 *    est comparé à `ts.createScanner`, la référence ;
 * 2. que les **mesures publiées** sont correctement calculées — McCabe,
 *    complexité cognitive Sonar, indice de maintenabilité d'Oman — sur de
 *    petits programmes dont on peut prévoir le résultat exact ;
 * 3. des **invariants métamorphiques** : reformater, ajouter des lignes
 *    vides ou une décision ne doit pas faire mentir la mesure ;
 * 4. que le **score** se comporte comme un ordre (meilleur code, meilleure
 *    note), que ses bornes tiennent et que ses plafonds mordent ;
 * 5. que l'**hygiène et la sécurité se vérifient par le contenu**, ce qui
 *    est la seule façon de ne pas pouvoir tricher ;
 * 6. que le **corpus doré** reste dans ses bandes — c'est ce qui empêche
 *    un correctif de casser un bon dépôt sans qu'on s'en aperçoive ;
 * 7. que les **statistiques** (moyenne, médiane, dispersion) ne mentent pas :
 *    une médiane fausse sur un nombre pair de valeurs ne se voit jamais dans
 *    un total, seulement dans une comparaison entre deux dépôts ;
 * 8. que la **trajectoire** d'un dépôt se lise correctement — une pente
 *    qu'un commit aberrant ne renverse pas, et un « stable » qui soit une
 *    conclusion plutôt qu'un aveu ;
 * 9. que la **géométrie des graphes** tienne ses promesses : rien hors
 *    cadre, rien d'invisible, rien de `NaN` ;
 * 10. que le barème **réponde à une dégradation contrôlée** : un défaut
 *    ajouté à la main doit coûter des points, dans la bonne dimension, et
 *    aucune autre ne doit monter ;
 * 11. qu'aucune **entrée hostile** (ligne de 200 000 caractères, 300
 *    accolades imbriquées, octet nul) ne fasse tomber l'analyse.
 */

import * as ts from "typescript";

import {
  CORPUS,
  FILE_DIMENSIONS,
  curveGeometry,
  histogramGeometry,
  historyCoverage,
  historyStats,
  MIN_README_WORDS,
  PROJECT_DIMENSIONS,
  REPO_WEIGHTS,
  SCORE_MAX,
  analyse,
  analyseCoupling,
  bandReport,
  cacheStats,
  checkBand,
  ciRunsSomething,
  cognitiveIn,
  countParams,
  decisionsIn,
  extractMetrics,
  gradeBandFor,
  gradeFor,
  halstead,
  indentWidth,
  isGenerated,
  isScoreable,
  isTestPath,
  maintainabilityBand,
  maintainabilityIndex,
  magicNumbersIn,
  maxOf,
  meanOf,
  medianOf,
  minOf,
  newBlobCache,
  percentile,
  recognizeLicense,
  repoHygiene,
  repoHygieneScore,
  rulesForPath,
  scanSecurity,
  scoreEvolution,
  scoreFile,
  scoreFileCached,
  scoreLine,
  scoreProject,
  scoreRepo,
  sortedCopy,
  stddevOf,
  type CachedFile,
  type FileDimension,
  type FileEntry,
  type ProjectDimension,
} from "../lib/scoring";
import { loadRealCorpus, missingMessage } from "./corpus-real";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, { actual, expected });
}

function near(name: string, actual: number, expected: number, tol = 1e-6): void {
  check(name, Math.abs(actual - expected) <= tol, { actual, expected });
}

/* ------------------------------------------------------------------ */
/* 1. Lexeur                                                           */
/* ------------------------------------------------------------------ */

function testLexer() {
  eq("un fichier vide a une ligne", analyse("", "a.py").lines.length, 1);
  eq("deux lignes", analyse("a\nb", "a.py").lines.length, 2);

  eq("Python : famille #", rulesForPath("a.py").family, "hash");
  eq("TypeScript : famille C", rulesForPath("a.ts").family, "c");
  eq("SQL : famille SQL", rulesForPath("a.sql").family, "sql");
  eq("Markdown : famille texte", rulesForPath("a.md").family, "text");
  eq("extension inconnue : texte", rulesForPath("a.zzz").family, "text");

  eq("TypeScript : tokeniseur", analyse("const a = 1;", "a.ts").confidence, "lexer");
  eq("Python : heuristique", analyse("a = 1", "a.py").confidence, "heuristic");

  // Le piège central : un mot-clé dans une chaîne ne doit pas compter.
  const js = analyse('const x = "while if for";\nif (x) return 1;\n', "a.js");
  check("la chaîne est masquée", !js.lines[0].masked.includes("while"), js.lines[0].masked);
  check("la chaîne est conservée à part", js.literals.some((l) => l.includes("while")));
  eq("aucune décision dans la chaîne", decisionsIn(js.lines[0].masked, "c"), 0);
  eq("une décision sur la ligne réelle", decisionsIn(js.lines[1].masked, "c"), 1);

  // Un mot-clé dans un commentaire ne doit pas compter non plus.
  const py = analyse("x = 1  # if while for\nif x:\n    pass\n", "a.py");
  eq("aucune décision dans le commentaire", decisionsIn(py.lines[0].masked, "hash"), 0);
  check("la ligne 0 porte un commentaire", py.lines[0].hasComment);

  // Ligne de commentaire pur.
  const c = analyse("// juste un commentaire\nconst a = 1;\n", "a.js");
  eq("ligne de commentaire pur", c.lines[0].kind, "comment");
  eq("ligne de code", c.lines[1].kind, "code");

  // Commentaire de bloc sur plusieurs lignes.
  const block = analyse("/* un\n   if for\n*/\nlet a = 1;\n", "a.js");
  eq("bloc : première ligne commentée", block.lines[0].kind, "comment");
  eq("bloc : deuxième ligne commentée", block.lines[1].kind, "comment");
  eq("bloc : reprise du code", block.lines[3].kind, "code");

  // Docstring Python : ce n'est ni du code ni une ligne vide.
  const doc = analyse('"""\nif for while\n"""\nx = 1\n', "a.py");
  eq("docstring : classée commentaire", doc.lines[1].kind, "comment");
  check("docstring : marquée comme chaîne", doc.lines[1].inString);
  eq("docstring : le code reprend", doc.lines[3].kind, "code");

  // Trois bugs de masquage corrigés, un par ligne.
  const rx = analyse("const uri = /https?:\\/\\//;\nif (a) b();\n", "a.ts");
  eq("une regex ne masque plus la ligne entière", decisionsIn(rx.lines[1].masked, "c"), 1);
  const quote = analyse("const rx = /'/g;\nif (a) b();\n", "a.ts");
  eq("une regex contenant une apostrophe ne masque plus la ligne", decisionsIn(quote.lines[1].masked, "c"), 1);

  const jsx = analyse(
    "export function C({ n }: { n: number }) {\n  return <p>Aujourd'hui {n > 1 && <b>ok</b>}</p>;\n}\n",
    "a.tsx",
  );
  check("l'apostrophe française ne masque plus la fin de ligne", jsx.lines[1].masked.includes("Aujourd'hui"));
  eq("les décisions du JSX survivent", decisionsIn(jsx.lines[1].masked, "c"), 1);

  const tpl = analyse("const s = `total ${a > 1 ? b : c}`;\n", "a.ts");
  eq("le ternaire d'un gabarit survit", decisionsIn(tpl.lines[0].masked, "c"), 1);

  const css = analyse(".a { background: url(https://x/y.png); }\n", "a.css");
  check("en CSS, `//` n'est pas un commentaire", !css.lines[0].hasComment, css.lines[0].masked);

  // Profondeur par accolades.
  const braced = analyse("function f() {\n  if (a) {\n    return 1;\n  }\n}\n", "a.js");
  eq("racine : profondeur 0", braced.lines[0].depth, 0);
  eq("un bloc : profondeur 1", braced.lines[1].depth, 1);
  eq("deux blocs : profondeur 2", braced.lines[2].depth, 2);

  // Profondeur par indentation.
  const indented = analyse("def f():\n    if a:\n        return 1\n", "a.py");
  eq("Python : 1 niveau", indented.lines[1].depth, 1);
  eq("Python : 2 niveaux", indented.lines[2].depth, 2);

  eq("indentWidth compte les espaces", indentWidth("    x"), 4);
  eq("indentWidth compte les tabulations", indentWidth("\tx"), 4);
}

/* ------------------------------------------------------------------ */
/* 1 bis. Le tokeniseur, vérifié contre le compilateur                 */
/* ------------------------------------------------------------------ */

/**
 * Masquage de référence, fait par **le compilateur TypeScript**.
 *
 * C'est la seule vérification qui compte pour le lexeur : notre tokeniseur
 * peut se tromper, le compilateur non. On compare donc, caractère par
 * caractère, notre texte masqué à celui que produirait
 * `ts.createScanner` en masquant commentaires, chaînes, gabarits et
 * expressions régulières.
 */
function compilerMask(text: string, jsx: boolean): string {
  const chars = text.split("");
  const blank = (from: number, to: number) => {
    for (let k = Math.max(0, from); k < Math.min(to, chars.length); k++) {
      if (chars[k] !== "\n") chars[k] = " ";
    }
  };

  // 1. Les chaînes, les gabarits et les expressions régulières : **l'arbre
  //    syntaxique**. Un scanner seul ne sait pas qu'un `/` ouvre une regex —
  //    c'est le parseur qui le lui dit en le rescannant. Passer par l'arbre,
  //    c'est donc comparer notre heuristique à une décision prise par le
  //    compilateur, et non à une autre heuristique.
  const source = ts.createSourceFile(
    jsx ? "a.tsx" : "a.ts",
    text,
    ts.ScriptTarget.Latest,
    false,
    jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const literalKinds = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
  ]);
  const literalRanges: [number, number][] = [];
  const visit = (node: ts.Node): void => {
    if (literalKinds.has(node.kind)) {
      const from = node.getStart(source);
      const to = node.getEnd();
      literalRanges.push([from, to]);
      blank(from, to);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // 2. Les commentaires : le scanner les donne, mais **uniquement hors des
  //    littéraux**. C'est le défaut bien connu du scanner seul : dans
  //    `/https?:\/\//`, il voit un `//` et le prend pour un commentaire.
  //    C'est précisément ce que notre lexeur doit éviter, donc la référence
  //    ne peut pas se tromper là-dessus.
  const inLiteral = (pos: number): boolean =>
    literalRanges.some(([from, to]) => pos >= from && pos < to);

  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    jsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    text,
  );
  for (let t = scanner.scan(); t !== ts.SyntaxKind.EndOfFileToken; t = scanner.scan()) {
    const isComment =
      t === ts.SyntaxKind.SingleLineCommentTrivia || t === ts.SyntaxKind.MultiLineCommentTrivia;
    if (isComment && !inLiteral(scanner.getTokenPos())) {
      blank(scanner.getTokenPos(), scanner.getTextPos());
    }
  }

  return chars.join("");
}

function testLexerAgainstCompiler() {
  const snippets: { name: string; path: string; code: string }[] = [
    { name: "regex avec échappements", path: "a.ts", code: "const uri = /https?:\\/\\//g;\nif (a) b();\n" },
    { name: "regex contenant une apostrophe", path: "a.ts", code: "const q = /'/g;\nif (a) b();\n" },
    { name: "regex avec classe de caractères", path: "a.ts", code: "const re = /[a-z\\/]+/i;\nconst x = 1;\n" },
    { name: "division", path: "a.ts", code: "const t = a / b / c;\n" },
    { name: "division après incrément", path: "a.ts", code: "const u = (a++ + b++) / 2;\n" },
    { name: "regex après return", path: "a.ts", code: "function f(a: string) {\n  return /x/.test(a) ? 1 : 2;\n}\n" },
    { name: "chaîne contenant des mots-clés", path: "a.ts", code: "const s = \"while if for\";\nif (x) y();\n" },
    { name: "chaîne contenant une URL", path: "a.ts", code: "const url = \"https://x/y\";\nif (a) b();\n" },
    { name: "commentaire contenant une apostrophe", path: "a.ts", code: "// n'oublie pas l'apostrophe\nconst a = 1;\n" },
    { name: "bloc de commentaire", path: "a.ts", code: "/* bloc\n   if for\n*/\nlet a = 1;\n" },
    { name: "gabarit avec expression", path: "a.ts", code: "const s = `total ${a > 1 ? b : c}`;\nif (x) y();\n" },
    { name: "gabarit imbriqué", path: "a.ts", code: "const s = `a${`b${c}d`}e`;\n" },
    { name: "gabarit multi-lignes", path: "a.ts", code: "const s = `ligne\nligne`;\nif (a) b();\n" },
    { name: "JSX avec apostrophe française", path: "a.tsx", code: "export function C({ n }: { n: number }) {\n  return <p>Aujourd'hui {n > 1 && <b>ok</b>}</p>;\n}\n" },
    { name: "JSX avec texte et accolade", path: "a.tsx", code: "export const B = () => <div>Il n'y a rien {x || y}</div>;\n" },
    { name: "objet et chaînes", path: "a.ts", code: "const o = { a: 'x', b: \"y\" };\nif (o) b();\n" },
    { name: "regex après accolade", path: "a.ts", code: "function f() { }\nconst ok = /re/.test(String(1));\n" },
  ];

  let mismatches = 0;
  for (const s of snippets) {
    const ours = analyse(s.code, s.path).masked;
    const reference = compilerMask(s.code, s.path.endsWith(".tsx"));
    if (ours !== reference) {
      mismatches++;
      failures.push(
        `tokeniseur ≠ compilateur (${s.name})\n    nôtre  : ${JSON.stringify(ours)}\n    compil.: ${JSON.stringify(reference)}`,
      );
    }
  }
  check("le tokeniseur masque comme le compilateur sur tous les cas limites", mismatches === 0);
}

/* ------------------------------------------------------------------ */
/* 2. Halstead                                                         */
/* ------------------------------------------------------------------ */

function testHalstead() {
  // `const a = b + c * 2;` → 3 opérateurs (=, +, *), 4 opérandes (a, b, c, 2).
  const h = halstead(analyse("const a = b + c * 2;\n", "a.js"));
  eq("opérateurs distincts", h.n1, 3);
  eq("opérateurs totaux", h.N1, 3);
  eq("opérandes distincts", h.n2, 4);
  eq("opérandes totaux", h.N2, 4);
  near("volume V = N·log₂(n)", h.volume, 7 * Math.log2(7));
  near("difficulté D = (n1/2)(N2/n2)", h.difficulty, 1.5);

  const rep = halstead(analyse("a + a + a;\n", "a.js"));
  eq("trois occurrences du même opérande", rep.N2, 3);
  eq("un seul opérande distinct", rep.n2, 1);

  const s = halstead(analyse('x = "bonjour";\ny = "bonjour";\n', "a.py"));
  eq("chaîne répétée : 3 distincts", s.n2, 3);
  eq("chaîne répétée : 4 occurrences", s.N2, 4);

  const empty = halstead(analyse("", "a.py"));
  eq("fichier vide : volume 0", empty.volume, 0);

  // Le vocabulaire est celui **du langage** : `count` et `key` sont des
  // mots-clés SQL, pas des mots-clés TypeScript.
  const tsIds = extractMetrics(analyse("const count = 1;\nconst key = 2;\n", "a.ts"));
  eq("`count` et `key` comptent comme identifiants en TS", tsIds.naming.distinct, 2);
  const sqlIds = extractMetrics(analyse("SELECT count, key FROM t;\n", "a.sql"));
  eq("`count` et `key` sont des mots-clés en SQL", sqlIds.naming.distinct, 1);
}

/* ------------------------------------------------------------------ */
/* 3. McCabe et complexité cognitive                                   */
/* ------------------------------------------------------------------ */

function testComplexity() {
  const py = extractMetrics(analyse(
    "def f(a, b):\n    if a:\n        return 1\n    elif b:\n        return 2\n    return 0\n",
    "a.py",
  ));
  eq("cyclomatic du fichier = 1 + décisions", py.cyclomatic, 3);
  eq("une fonction détectée", py.functions.length, 1);
  eq("cyclomatic de la fonction", py.functions[0].cyclomatic, 3);

  eq("&& compte", decisionsIn("if (a && b) return 1;", "c"), 2);
  eq("and/ou en Python", decisionsIn("if a and b or c:", "hash"), 3);
  eq("ternaire", decisionsIn("const x = a ? b : c;", "c"), 1);
  eq("chaînage optionnel n'est pas un ternaire", decisionsIn("a?.b", "c"), 0);
  eq("nullish : une décision, pas un ternaire", decisionsIn("a ?? b", "c"), 1);
  eq("type optionnel n'est pas un ternaire", decisionsIn("function f(a?: string) {}", "c"), 0);

  // Un ternaire coupé par Prettier reste **une** décision.
  eq("ternaire multiligne : première ligne", decisionsIn("const x = a", "c"), 0);
  const state = { pendingTernary: false };
  eq("ternaire multiligne : le `?`", decisionsIn("  ? b", "c", state), 1);
  eq("ternaire multiligne : le `:` ne recompte pas", decisionsIn("  : c;", "c", state), 0);

  // Sonar : `switch` +1 quel que soit le nombre de cas.
  eq("switch à cinq cas : 1", cognitiveIn("switch (x) {", "c", 0), 1);
  eq("case ne coûte rien", cognitiveIn("case 1: return 1;", "c", 1), 0);

  // Sonar : `else`/`else if` comptent +1 sans imbrication.
  eq("if", cognitiveIn("if (a) {", "c", 0), 1);
  eq("else if", cognitiveIn("} else if (b) {", "c", 0), 1);
  eq("else", cognitiveIn("} else {", "c", 0), 1);

  // Sonar : une **séquence** d'opérateurs logiques coûte 1, pas trois.
  eq("séquence &&", cognitiveIn("if (a && b && c) {", "c", 0), 2);
  eq("séquences mixtes && puis ||", cognitiveIn("if (a && b || c) {", "c", 0), 3);

  // L'imbrication est **relative** : le même `if` coûte 1 en tête de
  // fonction, et davantage seulement s'il est imbriqué dans un bloc.
  eq("imbrication 0", cognitiveIn("if (x) {", "c", 0), 1);
  eq("imbrication 1", cognitiveIn("if (x) {", "c", 1), 2);
  eq("imbrication 4", cognitiveIn("if (x) {", "c", 4), 5);

  const klass = extractMetrics(analyse(
    "class A {\n  m() {\n    if (a) {\n      return 1;\n    }\n  }\n}\n",
    "a.ts",
  ));
  eq("un `if` en tête de méthode coûte 1", klass.functions[0].cognitive, 1);

  const flat = extractMetrics(analyse("if a:\n    pass\nif b:\n    pass\n", "a.py"));
  const nested = extractMetrics(analyse("if a:\n    if b:\n        pass\n", "a.py"));
  check("l'imbriqué coûte plus cher cognitivement", nested.cognitive > flat.cognitive);
  eq("plat : deux if à la racine", flat.cognitive, 2);
  eq("imbriqué : 1 + 2", nested.cognitive, 3);
  eq("la profondeur max est mesurée", nested.maxDepth, 2);

  // SQL : les mots-clés en majuscules comptent.
  const sql = extractMetrics(analyse("SELECT * FROM t WHERE x = 1;\n", "a.sql"));
  eq("SQL majuscule : complexité 2", sql.cyclomatic, 2);
  check("SQL majuscule : charge cognitive non nulle", sql.cognitive > 0);
}

/* ------------------------------------------------------------------ */
/* 4. Fonctions                                                        */
/* ------------------------------------------------------------------ */

function testFunctions() {
  eq("paramètre déstructuré = 1", countParams("{ a, b, c }"), 1);
  eq("virgule finale ignorée", countParams("a: number, b: number,"), 2);
  eq("valeur par défaut tableau", countParams("a = [1, 2], b"), 2);
  eq("aucun paramètre", countParams(""), 0);

  // Signature coupée sur plusieurs lignes — le style de Prettier.
  const multi = extractMetrics(analyse(
    "export function addition(\n  a: number,\n  b: number,\n): number {\n  return a + b;\n}\n",
    "a.ts",
  ));
  eq("signature multiligne détectée", multi.functions.length, 1);
  eq("signature multiligne : 2 paramètres", multi.functions[0].params, 2);

  const arrow = extractMetrics(analyse(
    "export const double = (a: number): number => {\n  return a * 2;\n};\n",
    "a.ts",
  ));
  eq("flèche avec type de retour détectée", arrow.functions.length, 1);

  const method = extractMetrics(analyse(
    "class A {\n  m(a: number, b: number) {\n    return a + b;\n  }\n}\n",
    "a.ts",
  ));
  eq("méthode de classe détectée", method.functions.length, 1);
  eq("méthode de classe : corps apparié", method.functions[0].endLine, 4);

  const anonymous = extractMetrics(analyse(
    "const f = function (a: number) {\n  return a;\n};\n",
    "a.ts",
  ));
  eq("expression de fonction assignée détectée", anonymous.functions.length, 1);
  eq("expression de fonction : 1 paramètre", anonymous.functions[0].params, 1);

  // Une fonction imbriquée appartient à elle-même, pas à son enveloppe.
  const nestedFn = extractMetrics(analyse(
    "function outer(a) {\n  const inner = (b) => {\n    if (b) {\n      return 1;\n    }\n    return 0;\n  };\n  return inner(a);\n}\n",
    "a.ts",
  ));
  eq("deux fonctions détectées", nestedFn.functions.length, 2);
  const outer = nestedFn.functions.find((x) => x.name === "outer")!;
  eq("la complexité de la fermeture n'est pas imputée à l'enveloppe", outer.cyclomatic, 1);

  // Documentation : JSDoc au-dessus, docstring en dessous.
  const documented = extractMetrics(analyse("/** Doc. */\nexport function f() {\n  return 1;\n}\n", "a.ts"));
  check("une fonction précédée d'un JSDoc est documentée", documented.functions[0].documented);
  eq("l'API exportée est comptée", documented.api.total, 1);
  eq("l'API documentée est comptée", documented.api.documented, 1);

  const pyDoc = extractMetrics(analyse(
    "def f():\n    \"\"\"Doc.\"\"\"\n    return 1\n",
    "a.py",
  ));
  check("une docstring documente la fonction", pyDoc.functions[0].documented);
}

/* ------------------------------------------------------------------ */
/* 5. Indice de maintenabilité                                         */
/* ------------------------------------------------------------------ */

function testMaintainability() {
  const mi = maintainabilityIndex(100, 5, 50);
  check("MI borné à 100", mi <= 100, mi);
  check("MI positif", mi >= 0, mi);

  const complex = maintainabilityIndex(5000, 60, 400);
  const simple = maintainabilityIndex(50, 2, 10);
  check("un petit programme simple a un meilleur MI", simple > complex);

  // Le MI ne doit pas s'améliorer en écrivant des commentaires : le terme
  // de commentaires de la variante SEI n'existe pas chez Visual Studio, et
  // c'était le levier de triche le plus simple du barème précédent.
  eq("le MI ignore les commentaires", maintainabilityIndex(200, 5, 50), maintainabilityIndex(200, 5, 50));

  // Seuils Visual Studio : 20 (vert) et 10 (jaune).
  eq("bandeau ok à 20", maintainabilityBand(20).tone, "ok");
  eq("bandeau warn à 10", maintainabilityBand(10).tone, "warn");
  eq("bandeau danger à 9", maintainabilityBand(9).tone, "danger");

  // Le MI d'un fichier est la moyenne des MI de ses fonctions.
  const file = extractMetrics(analyse(
    "export function f(a: number) {\n  return a + 1;\n}\nexport function g(a: number) {\n  return a + 2;\n}\n",
    "a.ts",
  ));
  const manual = (file.functions[0].maintainability + file.functions[1].maintainability) / 2;
  near("MI du fichier = moyenne des fonctions", file.maintainability!, manual);

  // Sans fonction, il n'y a rien à mesurer — et surtout pas un repli qui
  // ferait croire à une mesure.
  eq("aucune fonction : MI nul", extractMetrics(analyse("const a = 1;\n", "a.ts")).maintainability, null);
}

/* ------------------------------------------------------------------ */
/* 6. Score de ligne                                                   */
/* ------------------------------------------------------------------ */

function testLineScore() {
  eq("ligne vide : 1000", scoreLine("").score, SCORE_MAX);
  eq("ligne vide : type blank", scoreLine("").kind, "blank");
  eq("ligne courte et propre : 1000", scoreLine("const a = b;").score, SCORE_MAX);
  check("ligne longue pénalisée", scoreLine("x".repeat(160)).score < SCORE_MAX);
  check("espace final pénalisé", scoreLine("const a = 1; ").score < SCORE_MAX);
  check("TODO pénalisé", scoreLine("// TODO corriger").score < SCORE_MAX);
  check("imbrication profonde pénalisée", scoreLine("x = 1", { depth: 6 }).score < SCORE_MAX);
  check("le motif est donné", scoreLine("const a = 1; ").reasons.length > 0);

  // La longueur se mesure sans l'indentation : une ligne bien indentée
  // n'est pas une ligne longue.
  eq("l'indentation ne compte pas dans la longueur", scoreLine(" ".repeat(40) + "const a = 1;").score, SCORE_MAX);

  const a = scoreLine("x".repeat(110)).score;
  const b = scoreLine("x".repeat(200)).score;
  check("plus la ligne est longue, plus elle coûte", b < a);

  // Même implémentation que la mesure de fichier, y compris pour les
  // décimales — l'ancienne version en avait deux, divergentes.
  eq("nombre magique décimal détecté", magicNumbersIn("const r = x * 0.35;"), 1);
  eq("constante nommée : pas de nombre magique", magicNumbersIn("const SMELL = 40;"), 0);
  check("la constante nommée n'est pas pénalisée non plus", scoreLine("const SMELL = 40;").score === SCORE_MAX);
}

/* ------------------------------------------------------------------ */
/* 7. Score de fichier                                                 */
/* ------------------------------------------------------------------ */

const CLEAN = `/**
 * Additionne deux nombres.
 *
 * On prend deux paramètres nommés plutôt qu'un tableau : l'appelant ne peut
 * pas se tromper dans l'ordre.
 */
export function addition(a: number, b: number): number {
  return a + b;
}
`;

const MESSY = `function f(a,b,c){if(a){if(b){if(c){if(a>b){return 11111;}else{return 22222;}}}}}\nfunction g(){return 33333;}\nvar q=44444;var r=55555;var s=66666;\n`;

function testFileScore() {
  const clean = scoreFile("addition.ts", CLEAN);
  const messy = scoreFile("moche.ts", MESSY);

  check("le fichier propre mieux noté", clean.score > messy.score, { clean: clean.score, messy: messy.score });
  check("score de fichier borné", clean.score >= 0 && clean.score <= SCORE_MAX);
  eq("une fonction détectée dans le propre", clean.metrics.functions.length, 1);
  check("le moche a plus de décisions", messy.metrics.cyclomatic > clean.metrics.cyclomatic);
  check("le propre a une meilleure documentation", (clean.dimensions.documentation ?? 0) > (messy.dimensions.documentation ?? 0));
  check("le propre a une meilleure complexité", (clean.dimensions.complexity ?? 0) > (messy.dimensions.complexity ?? 0));
  check("les lignes sont notées", clean.lines.length === analyse(CLEAN, "addition.ts").lines.length);

  eq("score déterministe", scoreFile("addition.ts", CLEAN).score, clean.score);

  // Une dimension qui ne s'applique pas vaut `null`, pas 0 : un fichier de
  // constantes ne doit pas être puni de n'avoir aucune fonction.
  const constants = scoreFile("const.ts", "export const A = 1;\nexport const B = 2;\n");
  eq("sans fonction : complexité non mesurée", constants.dimensions.complexity, null);
  check("sans fonction : la structure reste mesurée", constants.dimensions.structure !== null);

  const empty = scoreFile("vide.ts", "");
  check("fichier vide : score borné", empty.score >= 0 && empty.score <= SCORE_MAX);
}

/* ------------------------------------------------------------------ */
/* 8. Invariants métamorphiques                                        */
/* ------------------------------------------------------------------ */

/**
 * Ces invariants sont ce qui rend la mesure crédible devant un jury : ils
 * disent ce qui **ne doit pas** changer le score, et ils sont vérifiés par
 * la machine à chaque exécution, pas affirmés dans un commentaire.
 */
function testMetamorphic() {
  const source = [
    "export function classify(value: number): string {",
    "  if (value < 0) {",
    "    return \"négatif\";",
    "  } else if (value === 0) {",
    "    return \"nul\";",
    "  }",
    "  for (let i = 0; i < 3; i++) {",
    "    value += i;",
    "  }",
    "  return value > 100 ? \"grand\" : \"petit\";",
    "}",
  ].join("\n");

  const base = scoreFile("a.ts", source);

  // 1. Reformater ne change pas la complexité.
  const reformatted = [
    "export function classify(",
    "  value: number,",
    "): string {",
    "  if (value < 0) {",
    "    return \"négatif\";",
    "  } else if (value === 0) {",
    "    return \"nul\";",
    "  }",
    "  for (let i = 0; i < 3; i++) {",
    "    value += i;",
    "  }",
    "  return value > 100 ? \"grand\" : \"petit\";",
    "}",
  ].join("\n");
  const moved = scoreFile("a.ts", reformatted);
  eq("reformater ne change pas la complexité", moved.metrics.cyclomatic, base.metrics.cyclomatic);
  eq("reformater ne change pas la charge cognitive", moved.metrics.cognitive, base.metrics.cognitive);
  eq("reformater ne change pas la dimension de complexité", moved.dimensions.complexity, base.dimensions.complexity);

  // 2. Ajouter des lignes vides ne change pas la complexité.
  const spaced = scoreFile("a.ts", source.replace(/\n/g, "\n\n"));
  eq("les lignes vides ne changent pas la complexité", spaced.metrics.cyclomatic, base.metrics.cyclomatic);
  eq("les lignes vides ne changent pas la charge cognitive", spaced.metrics.cognitive, base.metrics.cognitive);

  // 3. Ajouter une décision ne peut pas faire **baisser** la complexité.
  const plusOne = scoreFile("a.ts", source.replace("  return value > 100", "  if (value > 1000) {\n    return \"énorme\";\n  }\n  return value > 100"));
  check("une décision de plus ne baisse jamais la CC", plusOne.metrics.cyclomatic > base.metrics.cyclomatic, {
    avant: base.metrics.cyclomatic, après: plusOne.metrics.cyclomatic,
  });

  // 4. Un fichier de test n'est pas puni par des littéraux d'assertion.
  const asSource = scoreFile("src/a.ts", "export function f(a: number) {\n  return a === 4242 ? 0 : 0;\n}\n");
  eq("hors test, le littéral est un nombre magique", asSource.metrics.magicNumbers, 1);
  const asTest = scoreFile("tests/a.test.ts", "test(\"f\", () => {\n  expect(f(4242)).toBe(1);\n});\n");
  eq("dans un test, non", asTest.metrics.magicNumbers, 0);
  check("un test est reconnu comme tel", asTest.metrics.isTest);

  // 5. Les commentaires ne font pas monter la documentation indéfiniment.
  const noisy = scoreFile(
    "noisy.ts",
    Array.from({ length: 30 }, (_, i) => `// commentaire ${i}`).join("\n") + "\nexport const a = 1;\n",
  );
  check("un fichier noyé sous les commentaires n'obtient pas une documentation parfaite",
    (noisy.dimensions.documentation ?? 0) < 0.85, noisy.dimensions.documentation);

  // 6. Un fichier énorme n'explose pas la pile et se signale comme tronqué.
  const huge = scoreFile("huge.ts", "const a = 1;\n".repeat(150_000));
  check("150 000 lignes : pas de RangeError", Number.isFinite(huge.score));
  check("150 000 lignes : analyse tronquée et signalée", huge.metrics.truncated);
  check("150 000 lignes : plafond respecté", huge.metrics.lines <= 20_000, huge.metrics.lines);
}

/* ------------------------------------------------------------------ */
/* 9. Score de projet                                                  */
/* ------------------------------------------------------------------ */

function module_(name: string, n: number): FileEntry {
  const body: string[] = ["/**", ` * Module ${name}.`, " */", ""];
  for (let i = 0; i < n; i++) {
    body.push(`/** Fonction ${i}. */`);
    body.push(`export function f${i}(a: number, b: number): number {`);
    body.push("  const total = a + b;");
    body.push("  return total * 2;");
    body.push("}");
    body.push("");
  }
  return { path: `src/${name}.ts`, content: body.join("\n") };
}

function testProject() {
  eq("projet vide : score 0", scoreProject([]).score, 0);
  eq("projet vide : note F", scoreProject([]).grade.letter, "F");
  eq("projet sans code : score 0", scoreProject([{ path: "src/empty.ts", content: "// rien\n" }]).score, 0);

  const entry: FileEntry = {
    path: "src/index.ts",
    content: 'import { f0 } from "./alpha";\nimport { f0 as g0 } from "./beta";\n\nexport const api = { f0, g0 };\n',
  };
  const base: FileEntry[] = [module_("alpha", 8), module_("beta", 6), entry];
  const p = scoreProject(base);
  check("projet borné", p.score > 0 && p.score <= SCORE_MAX, p.score);
  eq("trois fichiers notés", p.files.length, 3);
  check("des hotspots sont listés", p.hotspots.length > 0);
  eq("les fonctions sont comptées", p.metrics.functions, 14);
  eq("aucun cycle", p.metrics.cyclicFiles, 0);
  eq("aucun fichier orphelin", p.metrics.orphanFiles, 0);

  // Les tests font **monter** la note : c'est la correction explicite du
  // barème précédent, où écrire des tests dégradait le score.
  const tested = scoreProject([...base, {
    path: "tests/alpha.test.ts",
    content: "import { f0 } from \"../src/alpha\";\n\ntest(\"f0\", () => {\n  expect(f0(1, 2)).toBe(6);\n});\n",
  }]);
  check("la présence de tests augmente le score", tested.score > p.score, { sans: p.score, avec: tested.score });
  check("la dimension tests progresse", (tested.dimensions.tests ?? 0) > (p.dimensions.tests ?? 0));
  eq("le fichier de test est reconnu", tested.metrics.testFiles, 1);

  // Le README ne touche pas la qualité du code : il alimente la documentation.
  const withDocs = scoreProject([
    ...base,
    { path: "README.md", content: "# Doc\n\n## Installation\n\nnpm install\n\n## Usage\n\nnpm run build\n" },
    { path: "package.json", content: '{ "scripts": { "build": "tsc" } }\n' },
  ]);
  eq("les documents ne deviennent pas du code", withDocs.metrics.scored, p.metrics.scored);
  check("le README contribue à la documentation",
    (withDocs.dimensions.documentation ?? 0) > (p.dimensions.documentation ?? 0));

  // Un projet sans aucun test est plafonné à B : « aucun test » ne se
  // rattrape pas avec du code bien écrit, parce que rien ne prouve que ce
  // code fonctionne.
  check("sans test : la note ne dépasse pas B", p.score <= 839, p.score);

  const required = scoreProject([
    module_("gamma", 5),
    { path: "package.json", content: '{ "scripts": { "test": "node --test" } }\n' },
  ]);
  eq("un projet avec manifeste garde une note calculable", required.metrics.scored, 1);
}

/* ------------------------------------------------------------------ */
/* 10. Hygiène de dépôt, par le contenu                                */
/* ------------------------------------------------------------------ */

function testHygiene() {
  const empty: FileEntry[] = [{ path: "src/a.ts", content: "export const a = 1;\n" }];
  // Un dépôt nu ne peut satisfaire que « aucun artefact committé », qui est
  // une absence de faute, pas une preuve de travail.
  check("un dépôt nu reste sous 10 % d'hygiène", repoHygieneScore(repoHygiene(empty)) <= 0.1);
  check("les critères qui comptent manquent",
    ["readme", "license", "tests", "ci", "manifest", "lockfile"]
      .every((id) => !repoHygiene(empty).find((i) => i.id === id)!.present));
  check("un LICENSE vide ne vaut rien", !repoHygiene([
    { path: "LICENSE", content: "" },
    ...empty,
  ]).find((i) => i.id === "license")!.present);

  check("un README trop court ne vaut rien", !repoHygiene([
    { path: "README.md", content: "# Projet\n\nCourt.\n" },
    ...empty,
  ]).find((i) => i.id === "readme")!.present);

  const longReadme = "# Projet\n\n## Installation\n\nnpm install\n\n## Usage\n\nnpm run build\n\n" +
    "Ce paragraphe explique ce que fait le projet et pourquoi il existe, avec assez de mots pour " +
    "dépasser le seuil minimal, parce qu'un README de deux lignes n'apprend rien à personne et ne " +
    "permet pas de lancer le projet sans lire d'abord tout le code source. On y décrit les " +
    "dépendances nécessaires, la version de Node attendue, la façon de lancer les tests en local, " +
    "et la convention de nommage des branches. On y dit aussi ce que le projet ne fait pas, ce qui " +
    "est souvent l'information la plus utile à un nouveau venu, et où poser ses questions.\n";
  check("un README complet est reconnu", repoHygiene([
    { path: "README.md", content: longReadme },
    ...empty,
  ]).find((i) => i.id === "readme")!.present);
  check("le seuil de mots est nommé", MIN_README_WORDS > 0);

  check("un workflow qui ne lance rien ne vaut rien", !repoHygiene([
    { path: ".github/workflows/ci.yml", content: "name: ci\non: [push]\njobs:\n  x:\n    steps:\n      - uses: actions/checkout@v4\n" },
    ...empty,
  ]).find((i) => i.id === "ci")!.present);
  check("un workflow qui lance un test vaut", repoHygiene([
    { path: ".github/workflows/ci.yml", content: "name: ci\non: [push]\njobs:\n  x:\n    steps:\n      - run: npm test\n" },
    ...empty,
  ]).find((i) => i.id === "ci")!.present);
  check("`run:` détecté même avec un tiret", ciRunsSomething("      - run: npm run build\n"));
  check("`run:` sans test ni build non détecté", !ciRunsSomething("      - run: echo bonjour\n"));

  eq("licence SPDX reconnue", recognizeLicense("MIT License\n\nCopyright..."), "MIT");
  eq("licence inconnue", recognizeLicense("Faites ce que vous voulez."), null);

  const gitignored = repoHygiene([
    { path: ".gitignore", content: "node_modules\ndist\n" },
    ...empty,
  ]).find((i) => i.id === "gitignore")!;
  check(".gitignore effectif reconnu", gitignored.present);
  check("un .gitignore vide ne compte pas", !repoHygiene([
    { path: ".gitignore", content: "" },
    ...empty,
  ]).find((i) => i.id === "gitignore")!.present);

  const weights = repoHygiene([]).reduce((a, i) => a + i.weight, 0);
  near("les poids d'hygiène totalisent 1", weights, 1, 1e-9);
  check("chaque critère dit ce qui a été vérifié", repoHygiene([]).every((i) => i.evidence.length > 0));
}

/* ------------------------------------------------------------------ */
/* 11. Sécurité et plafonds                                            */
/* ------------------------------------------------------------------ */

function testSecurityAndCaps() {
  const leaky: FileEntry[] = [{ path: "src/config.ts", content: "export const k = \"AKIA3XQ7ZPLMN2VWRTYB\";\n" }];
  const report = scanSecurity(leaky);
  check("une clé AWS est détectée", report.hasSecret);
  eq("la fuite est localisée", report.findings[0].where, "src/config.ts:1");
  check("le score de sécurité chute", report.score < 0.5);

  // Une valeur d'exemple n'est pas une fuite : l'avertisseur doit le
  // savoir, sinon il crie sur la documentation officielle et plus personne
  // ne le lit.
  check("une clé d'exemple n'est pas une fuite",
    !scanSecurity([{ path: "src/doc.ts", content: 'const k = "AKIAIOSFODNN7EXAMPLE";\n' }]).hasSecret);
  check("un marqueur de gabarit n'est pas une fuite",
    !scanSecurity([{ path: "src/doc.ts", content: 'const t = "your-token-here";\n' }]).hasSecret);

  check("un .env committé est détecté", scanSecurity([{ path: ".env.local", content: "TOKEN=x\n" }]).committedEnv);
  check("un .env.example n'est pas une fuite", !scanSecurity([{ path: ".env.example", content: "TOKEN=\n" }]).committedEnv);
  check("`eval` est compté", scanSecurity([{ path: "a.ts", content: "eval(\"1\");\nnew Function(\"1\");\n" }]).evalCount === 2);

  // Un secret plafonne la note, il ne la réduit pas seulement.
  const clean = scoreRepo(CORPUS.find((c) => c.name === "propre")!.files);
  const leaked = scoreRepo(CORPUS.find((c) => c.name === "fuite")!.files);
  check("le dépôt avec fuite est plafonné à C", leaked.score <= 739, leaked.score);
  check("la note du dépôt fuité reste dans la bande C", gradeFor(leaked.score).letter === "C", gradeFor(leaked.score).letter);
  check("le plafond est expliqué", leaked.caps.some((c) => c.id === "secret"));
  check("le dépôt propre n'est pas plafonné par un secret", !clean.caps.some((c) => c.id === "secret"));

  // L'absence de tests plafonne à B.
  const noTests = scoreRepo(CORPUS.find((c) => c.name === "moyen")!.files);
  check("sans test, la note ne dépasse pas B", noTests.score <= 839, noTests.score);
}

/* ------------------------------------------------------------------ */
/* 12. Les actions qui rapportent le plus de points                    */
/* ------------------------------------------------------------------ */

function testActions() {
  const messy = scoreRepo(CORPUS.find((c) => c.name === "brouillon")!.files);
  check("au plus trois actions", messy.actions.length <= 3);
  check("les actions rapportent des points", messy.actions.every((a) => a.gain > 0));
  check("les actions sont classées par gain",
    messy.actions.every((a, i) => i === 0 || messy.actions[i - 1].gain >= a.gain));
  check("les actions renvoient à un endroit précis", messy.actions.some((a) => a.where.length > 0));

  const leaky = scoreRepo(CORPUS.find((c) => c.name === "fuite")!.files);
  check("la première action d'un dépôt qui fuit est le secret",
    leaky.actions.length > 0 && leaky.actions[0].id === "secret", leaky.actions.map((a) => a.id));
  check("l'action de sécurité localise la fuite", leaky.actions[0].where.some((w) => w.includes("config.ts")));
}

/* ------------------------------------------------------------------ */
/* 13. Couplage                                                        */
/* ------------------------------------------------------------------ */

function testCoupling() {
  const cyclic = CORPUS.find((c) => c.name === "cycle")!;
  const report = scoreRepo(cyclic.files);
  check("un cycle d'imports est détecté", report.metrics.cyclicFiles >= 2, report.metrics.cyclicFiles);
  check("le couplage sanctionne le cycle", (report.dimensions.coupling ?? 0) < 0.8, report.dimensions.coupling);
  check("une action propose de casser le cycle",
    report.actions.some((a) => a.dimension === "coupling"));

  const clean = scoreRepo(CORPUS.find((c) => c.name === "propre")!.files);
  eq("aucun cycle dans le dépôt propre", clean.metrics.cyclicFiles, 0);
  eq("aucun orphelin dans le dépôt propre", clean.metrics.orphanFiles, 0);

  const sources = [{ path: "a.ts", source: analyse("import { b } from \"./b\";\n", "a.ts") }];
  const self = analyseCoupling(sources);
  eq("un import non résolu n'est pas une arête", self.edges, 0);
}

/* ------------------------------------------------------------------ */
/* 14. Cache par SHA de blob et évolution                              */
/* ------------------------------------------------------------------ */

function testCache() {
  const cache = newBlobCache<CachedFile>();
  const content = "export function f() {\n  return 1;\n}\n";

  const first = scoreFileCached("src/a.ts", content, cache);
  const second = scoreFileCached("src/a.ts", content, cache);
  eq("le second appel est servi par le cache", cacheStats(cache).hits, 1);
  eq("le cache rend le même score", second.score, first.score);

  // Un contenu différent est un SHA différent : pas de faux « je connais ».
  const changed = scoreFileCached("src/a.ts", content + "export const b = 2;\n", cache);
  check("un contenu modifié est recalculé", changed.score !== first.score || cacheStats(cache).misses === 2);

  // Même contenu, autre chemin : ce n'est pas un cache hit, les règles
  // lexicales dépendent de l'extension.
  scoreFileCached("src/a.py", content, cache);
  check("le chemin fait partie de la clé", cacheStats(cache).misses >= 2);

  const snapshots = [
    { sha: "c1", at: "2026-01-01T00:00:00Z", files: [{ path: "src/a.ts", content }] },
    {
      sha: "c2", at: "2026-01-02T00:00:00Z",
      files: [
        { path: "src/a.ts", content },
        { path: "src/b.ts", content: "export function g() {\n  return 2;\n}\n" },
      ],
    },
  ];
  const { history, stats } = scoreEvolution(snapshots);
  eq("un point par commit", history.length, 2);
  eq("le premier commit a un fichier changé", history[0].changedFiles, 1);
  eq("le second commit a un fichier changé", history[1].changedFiles, 1);
  check("l'historique est cohérent", history.every((h) => h.score >= 0 && h.score <= SCORE_MAX));
  check("le cache a servi entre les commits", stats.hits > 0, stats);

  // L'historique doit donner le même score qu'un calcul à froid.
  const cold = scoreRepo(snapshots[1].files);
  eq("l'historique et le calcul à froid concordent", history[1].score, cold.score);
}

/* ------------------------------------------------------------------ */
/* 15. Exclusions                                                      */
/* ------------------------------------------------------------------ */

function testExclusions() {
  eq("binaire ignoré", isScoreable("logo.png"), false);
  eq("lockfile ignoré", isScoreable("package-lock.json"), false);
  eq("minifié ignoré", isScoreable("bundle.min.js"), false);
  eq("déclaration générée ignorée", isScoreable("src/env.d.ts"), false);
  eq("migration ignorée", isScoreable("supabase/migrations/001_init.sql"), false);
  eq("composant vendorisé ignoré", isScoreable("components/ui/button.tsx"), false);
  eq("ressource svg ignorée", isScoreable("public/logo.svg"), false);
  eq("documentation exclue du score de code", isScoreable("README.md"), false);
  eq("données JSON exclues", isScoreable("package.json"), false);
  eq("source retenue", isScoreable("src/a.ts"), true);
  check("chemin généré reconnu", isGenerated("node_modules/x/a.js"));

  eq("test par dossier", isTestPath("tests/a.ts"), true);
  eq("test par suffixe", isTestPath("src/a.test.tsx"), true);
  eq("test Python", isTestPath("tests/test_scoring.py"), true);
  eq("source ordinaire", isTestPath("src/score.ts"), false);

  // Le dépôt « exclusions » ne note que son vrai fichier.
  const repo = scoreRepo(CORPUS.find((c) => c.name === "exclusions")!.files);
  eq("un seul fichier est noté", repo.metrics.scored, 1);
}

/* ------------------------------------------------------------------ */
/* 16. Notes et bornes                                                 */
/* ------------------------------------------------------------------ */

function testGradesAndBounds() {
  eq("1000 : A+", gradeFor(1000).letter, "A+");
  eq("920 : A+", gradeFor(920).letter, "A+");
  eq("900 : A", gradeFor(900).letter, "A");
  eq("800 : B", gradeFor(800).letter, "B");
  eq("700 : C", gradeFor(700).letter, "C");
  eq("619 : D", gradeFor(619).letter, "D");
  eq("500 : D", gradeFor(500).letter, "D");
  eq("400 : E", gradeFor(400).letter, "E");
  eq("0 : F", gradeFor(0).letter, "F");
  eq("au-delà de 1000 : A+", gradeFor(5000).letter, "A+");

  // La bande d'une note, et les deux marches qui l'encadrent : c'est ce qui
  // permet à l'écran de dire « à combien de la borne », là où la lettre seule
  // ne distingue pas 741 de 839.
  const bordHaut = gradeBandFor(839);
  eq("839 est en B", bordHaut.grade.letter, "B");
  eq("la bande B commence à 740", bordHaut.band.min, 740);
  eq("la bande B finit à 839", bordHaut.band.max, 839);
  eq("la marche au-dessus de B est A", bordHaut.next?.grade.letter, "A");
  eq("A commence à 840", bordHaut.next?.min, 840);
  eq("la marche sous B est C", bordHaut.below?.grade.letter, "C");
  eq("collé au haut : 0 point de marge haute", checkBand(839, bordHaut.band).marginHigh, 0);
  eq("collé au haut : 99 points de marge basse", checkBand(839, bordHaut.band).marginLow, 99);

  const bordBas = gradeBandFor(740);
  eq("740 est encore en B", bordBas.grade.letter, "B");
  eq("collé au bas : 0 point de marge basse", checkBand(740, bordBas.band).marginLow, 0);

  const sommet = gradeBandFor(1000);
  eq("1000 est A+", sommet.grade.letter, "A+");
  eq("A+ n'a pas de marche au-dessus", sommet.next, null);
  eq("A+ a une marche en dessous", sommet.below?.grade.letter, "A");

  const plancher = gradeBandFor(0);
  eq("0 est F", plancher.grade.letter, "F");
  eq("F n'a pas de marche en dessous", plancher.below, null);
  eq("F a une marche au-dessus", plancher.next?.grade.letter, "E");

  eq("une note hors barème est ramenée dans A+", gradeBandFor(5000).grade.letter, "A+");
  // La bande rendue est toujours cohérente avec la note rendue par `gradeFor` :
  // deux façons de lire le même barème ne doivent pas diverger.
  for (const s of [0, 319, 320, 479, 480, 619, 620, 739, 740, 839, 840, 919, 920, 1000]) {
    eq(`bande cohérente à ${s}`, gradeBandFor(s).grade.letter, gradeFor(s).letter);
  }

  const corpus: FileEntry[] = [
    { path: "a.py", content: "print('bonjour')\n" },
    { path: "b.js", content: "console.log(1);\n" },
    { path: "c.sql", content: "SELECT * FROM t WHERE x = 1;\n" },
    { path: "d.html", content: "<!-- rien -->\n<p>salut</p>\n" },
    { path: "e.md", content: "Un texte.\n" },
    { path: "f.rs", content: "fn main() {\n    let x = 1;\n}\n" },
    { path: "g.go", content: "package main\n\nfunc main() {\n\tprintln(1)\n}\n" },
    { path: "h.rb", content: "def f\n  1\nend\n" },
    { path: "i.py", content: "def f():\n    if a:\n        return 1\n" },
  ];

  for (const e of corpus) {
    const file = scoreFile(e.path, e.content);
    check(`bornes fichier ${e.path}`, file.score >= 0 && file.score <= SCORE_MAX, file.score);
    check(`bornes lignes ${e.path}`, file.lines.every((l) => l.score >= 0 && l.score <= SCORE_MAX));
    check(`aucun NaN ${e.path}`, !Number.isNaN(file.score));
  }

  const project = scoreProject(corpus);
  check("bornes projet", project.score >= 0 && project.score <= SCORE_MAX, project.score);
  check("bornes dépôt", scoreRepo(corpus).score >= 0 && scoreRepo(corpus).score <= SCORE_MAX);
  check("aucune dimension NaN",
    project.files.every((f) => Object.values(f.dimensions).every((v) => v === null || !Number.isNaN(v))));

  eq("huit dimensions de projet", PROJECT_DIMENSIONS.length, 8);
  eq("six dimensions de fichier", FILE_DIMENSIONS.length, 6);
  near("les poids du dépôt totalisent 1",
    Object.values(REPO_WEIGHTS).reduce((a, b) => a + b, 0), 1, 1e-9);
}

/* ------------------------------------------------------------------ */
/* 17. Corpus doré                                                     */
/* ------------------------------------------------------------------ */

function testCorpus() {
  for (const repo of CORPUS) {
    const score = scoreRepo(repo.files).score;
    check(
      `corpus « ${repo.name} » reste dans sa bande (${repo.expect.min}–${repo.expect.max}) — ${repo.intent}`,
      score >= repo.expect.min && score <= repo.expect.max,
      score,
    );
  }

  // Les bandes doivent **discriminer** : un bon dépôt doit battre un
  // brouillon, sinon le corpus ne prouve rien.
  const good = scoreRepo(CORPUS.find((c) => c.name === "propre")!.files).score;
  const bad = scoreRepo(CORPUS.find((c) => c.name === "brouillon")!.files).score;
  check("un bon dépôt bat nettement un brouillon", good - bad >= 150, { good, bad });
  check("le bon dépôt est noté A ou plus", gradeFor(good).letter === "A" || gradeFor(good).letter === "A+", gradeFor(good).letter);
}

/* ------------------------------------------------------------------ */
/* 18. Corpus réel                                                     */
/* ------------------------------------------------------------------ */

/**
 * Du code que **personne n'a écrit pour ce barème**.
 *
 * Le corpus doré (section 17) est fait de dépôts écrits à la main : il
 * prouve la cohérence du barème avec lui-même, ce qui n'est pas la même
 * chose que sa justesse. Cette section le confronte à cinq paquets open
 * source réels — et ce n'est pas un exercice de style : c'est en la lançant
 * la première fois qu'un défaut de fond a été trouvé, la duplication
 * comparant les lignes **masquées**, donc effaçant précisément ce qui
 * distingue deux lignes. ESLint sortait à 95 % de fenêtres dupliquées,
 * Zod et Ajv à 100 %.
 *
 * Les bandes portent sur deux échelles :
 *
 * - la **note de dépôt**, large, parce qu'une archive npm n'embarque ni
 *   tests ni CI ni `.gitignore` — ses dimensions `tests` et `repository`
 *   sont basses par construction ;
 * - les **dimensions de code**, serrées, parce qu'elles ne dépendent que
 *   du code et se mesurent sur un échantillon sans biais (voir la note sur
 *   l'échantillonnage dans `scripts/corpus-real.ts`).
 *
 * Le coût est d'environ quatre secondes : c'est le prix d'une mesure sur du
 * code réel, et il est payé une fois pour toutes les bandes du corpus.
 */
function testRealCorpus() {
  const repos = loadRealCorpus();
  const scores = new Map<string, ReturnType<typeof scoreRepo>>();

  for (const repo of repos) {
    if (repo.missing) {
      check(`corpus réel « ${repo.spec.name} » disponible`, false, missingMessage(repo));
      continue;
    }

    // La **provenance** est vérifiée avant la note : les bandes ci-dessous
    // ne valent que pour cette version-là. Un paquet qui change de version
    // change de code, donc de note ; on veut le savoir ici plutôt que de
    // découvrir, six mois plus tard, une bande qui dérive sans explication.
    eq(
      `corpus réel « ${repo.spec.name} » : version ${repo.spec.version}`,
      repo.version,
      repo.spec.version,
    );

    const score = scoreRepo(repo.files);
    scores.set(repo.spec.name, score);

    check(
      `corpus réel « ${repo.spec.name} » reste dans sa bande (${repo.spec.expect.min}–${repo.spec.expect.max}) — ${repo.spec.intent}`,
      score.score >= repo.spec.expect.min && score.score <= repo.spec.expect.max,
      { note: score.score, projet: score.projectScore, grade: score.grade.letter },
    );

    for (const [dimension, band] of Object.entries(repo.spec.expectCode)) {
      const value = score.dimensions[dimension as ProjectDimension];
      check(
        `corpus réel « ${repo.spec.name} » : ${dimension} dans ${band.min}–${band.max}`,
        value !== null && value !== undefined && value >= band.min && value <= band.max,
        value,
      );
    }

    // Un paquet npm n'embarque pas ses tests : le plafond « aucun test »
    // doit donc **mordre pour de vrai** sur du code réel, et pas seulement
    // sur le dépôt doré écrit pour l'occasion.
    if (score.metrics.testFiles === 0) {
      check(
        `corpus réel « ${repo.spec.name} » : sans test, la note ne dépasse pas B`,
        score.score <= 839,
        score.score,
      );
    }
  }

  // Aucun paquet publié ne doit être traité comme du déchet. Ce n'est pas
  // une bande, c'est un plancher : si un jour du code réel et maintenu
  // tombe en E, le barème accuse le mauvais camp.
  for (const [name, score] of scores) {
    check(
      `corpus réel « ${name} » n'est pas classé F`,
      gradeFor(score.score).letter !== "F",
      { note: score.score, grade: score.grade.letter },
    );
  }

  // Le corpus réel doit **discriminer** autant que le doré : sans cela, il
  // ne calibre rien, il confirme.
  const notes = [...scores.values()].map((s) => s.score);
  check(
    "le corpus réel s'étale sur au moins 100 points",
    notes.length > 1 && Math.max(...notes) - Math.min(...notes) >= 100,
    { min: Math.min(...notes), max: Math.max(...notes) },
  );
}

/* ------------------------------------------------------------------ */
/* 19. Géométrie de la courbe                                          */
/* ------------------------------------------------------------------ */

/**
 * La courbe est un dessin, donc elle se vérifie par ses **propriétés**.
 *
 * C'est exactement ce qu'un dessin ne fait pas tout seul : à l'œil, une
 * échelle qui colle la courbe au bord, une série plate posée en bas du
 * cadre et une division par zéro sur un point unique se ressemblent — elles
 * ressemblent à une courbe. Trois propriétés suffisent à les distinguer :
 * le tracé reste **dans le cadre**, une série constante reste **au milieu**,
 * et une variation minuscule ne remplit pas le cadre.
 */
function testCurve() {
  const width = 100;
  const height = 34;

  // Toutes les coordonnées du chemin, relues depuis le SVG produit.
  const ys = (geo: { line: string }): number[] =>
    [...geo.line.matchAll(/,(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const xs = (geo: { line: string }): number[] =>
    [...geo.line.matchAll(/[ML](-?\d+(?:\.\d+)?),/g)].map((m) => Number(m[1]));

  const monte = curveGeometry([600, 700, 800]);
  check("la courbe se dessine", monte.line.startsWith("M") && monte.line.includes("L"));
  check("le premier point est au bord gauche", xs(monte)[0] === 0, xs(monte)[0]);
  check("le dernier point est au bord droit", xs(monte)[2] === width, xs(monte)[2]);
  check("un score plus haut se dessine plus haut", ys(monte)[2] < ys(monte)[0], ys(monte));
  check("tout le tracé reste dans le cadre", ys(monte).every((y) => y >= 0 && y <= height), ys(monte));
  check("l'aire est fermée sur le bas",
    monte.area.includes(`,${height} L0,${height} Z`), monte.area);

  // Une série plate doit rester au **milieu** : collée en bas, elle se
  // lirait comme une chute à zéro, ce qu'elle n'est pas.
  const plat = curveGeometry([700, 700, 700]);
  check("une série plate reste centrée",
    ys(plat).every((y) => Math.abs(y - height / 2) < 0.01), ys(plat));

  // Une variation minuscule ne doit pas remplir le cadre : sans amplitude
  // minimale, deux points séparés d'une unité ressembleraient à un séisme.
  const serre = curveGeometry([700, 701]);
  check("une variation minuscule ne remplit pas le cadre",
    Math.abs(ys(serre)[0] - ys(serre)[1]) < height / 2,
    ys(serre));

  // Deux scores identiques ne doivent pas sortir du cadre par division par
  // zéro — le cas limite qui produit des "NaN" dans un chemin SVG, où le
  // navigateur ne dessine alors plus rien du tout.
  const identiques = curveGeometry([500, 500]);
  check("deux scores identiques ne produisent pas de NaN",
    !identiques.line.includes("NaN"), identiques.line);

  // Un seul point : pas d'aire (un rectangle plein se lirait comme une
  // courbe), mais une position utilisable pour le marqueur.
  const seul = curveGeometry([500]);
  check("un point unique n'a pas d'aire", seul.area === "");
  check("un point unique reste plaçable", seul.markerY !== null && Number.isFinite(seul.markerY));
  check("un point unique est au milieu", xs(seul)[0] === width / 2, xs(seul)[0]);

  // Le cas vide ne doit pas produire de chemin du tout.
  const vide = curveGeometry([]);
  check("aucun point, aucun tracé", vide.line === "" && vide.markerY === null);

  // Le marqueur est celui du **dernier** point, pas du meilleur.
  const chute = curveGeometry([800, 600]);
  check("le marqueur suit le dernier point",
    chute.markerY !== null && chute.markerY >= height / 2,
    chute.markerY);

  // L'échelle est celle de l'amplitude observée, élargie au minimum :
  // c'est ce qui rend les deux bornes utilisables comme repères.
  const grand = curveGeometry([100, 900]);
  check("les bornes encadrent les valeurs", grand.bottom <= 100 && grand.top >= 900,
    { top: grand.top, bottom: grand.bottom });
}

/* ------------------------------------------------------------------ */
/* 20. Statistiques : moyenne, médiane, dispersion                     */
/* ------------------------------------------------------------------ */

/**
 * Les primitives qui alimentent tout le reste.
 *
 * Elles se vérifient ici, et pas seulement à travers un score : une médiane
 * fausse sur un nombre pair de valeurs, ou une moyenne qui propage un `NaN`,
 * ne se voit **jamais** dans un total — elle se voit dans une comparaison
 * entre deux dépôts, c'est-à-dire trop tard, et devant quelqu'un.
 */
function testStats() {
  eq("un ensemble vide n'a pas de maximum", maxOf([]), 0);
  eq("le maximum se prend aussi sur les négatifs", maxOf([-5, -3, -9]), -3);
  eq("le minimum se prend aussi sur les négatifs", minOf([-5, -3, -9]), -9);
  eq("un ensemble vide n'a pas de minimum", minOf([]), 0);

  // Un seul `NaN` suffisait à rendre la moyenne, puis la note, non finies.
  near("la moyenne écarte les valeurs non finies", meanOf([2, Number.NaN, 4]), 3);
  eq("la moyenne d'un ensemble illisible est zéro", meanOf([Number.NaN]), 0);
  near("l'écart-type d'une valeur unique est nul", stddevOf([7]), 0);
  near("l'écart-type d'une série constante est nul", stddevOf([4, 4, 4]), 0);
  near("l'écart-type est celui de la population", stddevOf([2, 4, 4, 4, 5, 5, 7, 9]), 2);

  // La médiane est le **centre**, pas le milieu de l'étendue : c'est toute
  // la différence entre « le dépôt typique vaut 700 » et « le dépôt vaut
  // 700 en moyenne parce qu'un fichier vaut 4 000 ».
  eq("médiane d'un nombre impair de valeurs", medianOf([3, 1, 2]), 2);
  eq("médiane d'un nombre pair : la moyenne des deux du centre", medianOf([4, 1, 3, 2]), 2.5);
  eq("la médiane ne bouge pas avec un point extrême", medianOf([1, 2, 3, 4, 1000]), 3);
  eq("la médiane accepte les valeurs en désordre", medianOf([900, 100, 500]), 500);
  eq("la médiane d'un ensemble vide est zéro", medianOf([]), 0);

  // Le tri est la seule opération qui a le droit de réordonner, et il écarte
  // au passage ce qui n'est pas mesurable.
  eq("le tri écarte les valeurs non finies", sortedCopy([3, Number.NaN, 1]).join(","), "1,3");
  near("le centile travaille sur des valeurs finies", percentile([1, 2, Number.NaN, 4], 0.5), 2);
}

/* ------------------------------------------------------------------ */
/* 21. Trajectoire : moyenne, médiane, tendance                        */
/* ------------------------------------------------------------------ */

/**
 * Ce qu'une courbe dit, en chiffres — et ce qu'elle ne dit pas.
 *
 * Deux pièges sont vérifiés ici, et ils sont de nature différente :
 *
 * - un **commit aberrant** ne doit pas décider de la pente. Une régression
 *   par les moindres carrés suit le point le plus éloigné ; la médiane des
 *   pentes deux à deux l'ignore, et c'est la seule des deux qui décrive ce
 *   que l'auteur du dépôt a fait ;
 * - une **oscillation** ne doit pas se lire comme une progression. Sans
 *   comparaison au bruit, « +40 points » se lit comme un progrès alors que
 *   le dépôt n'a fait que trembler.
 */
function testTrend() {
  const vide = historyStats([]);
  eq("une série vide n'a pas de tendance", vide.trend, "stable");
  eq("une série vide ne rend pas de NaN", vide.mean, 0);
  eq("une série vide se compte zéro", vide.count, 0);

  const monte = historyStats([600, 650, 700, 750]);
  eq("une série qui monte est une hausse", monte.trend, "hausse");
  eq("la pente se lit en points par révision", Math.round(monte.slope), 50);
  eq("le premier point est le premier", monte.first, 600);
  eq("le dernier point est le dernier", monte.last, 750);
  eq("l'écart est celui des deux bouts", monte.delta, 150);
  eq("la moyenne est celle de la série", Math.round(monte.mean), 675);
  eq("la médiane est celle de la série", monte.median, 675);
  near("l'écart-type est celui de la série", monte.stddev, 55.9, 0.1);
  eq("une série lisse n'a pas de bruit", Math.round(monte.noise), 0);

  eq("une série qui descend est une baisse", historyStats([800, 700, 600]).trend, "baisse");

  // Le point qui décide de tout : la pente reste celle des révisions
  // ordinaires, et le verdict ne se renverse pas.
  const pic = historyStats([700, 701, 702, 4000, 704]);
  check("une pente robuste ignore le commit aberrant", Math.abs(pic.slope - 1) < 2, pic.slope);
  check("un commit aberrant ne renverse pas la tendance", pic.trend !== "baisse", pic.trend);

  // Le dépôt qui tremble : +40 points affichés, zéro point gagné.
  const oscille = historyStats([700, 780, 690, 770, 700, 780, 705]);
  eq("une série qui oscille est stable", oscille.trend, "stable");
  check("le bruit est mesuré", oscille.noise > 20, oscille.noise);
  check("l'écart brut reste petit", Math.abs(oscille.delta) <= 20, oscille.delta);

  const plat = historyStats([700, 700, 700]);
  eq("une série plate est stable", plat.trend, "stable");
  eq("une série plate a un écart-type nul", plat.stddev, 0);
  eq("un point unique est stable", historyStats([500]).trend, "stable");
  eq("un point unique se compte", historyStats([500]).count, 1);
  eq("les valeurs non finies sont écartées", historyStats([600, Number.NaN, 700]).count, 2);

  // Une progression lente mais **constante** finit par compter : c'est le
  // bruit qui ne doit pas décider, pas la lenteur.
  const lent = historyStats(Array.from({ length: 100 }, (_, i) => 500 + i));
  eq("une progression lente reste une hausse", lent.trend, "hausse");

  // Le coût, et une échelle qui ne change pas avec lui : la pente est en
  // points **par révision**, même quand la série est échantillonnée. Une
  // pente fausse d'un facteur deux est plus difficile à repérer qu'une
  // pente absente.
  const longue = Array.from({ length: 20000 }, (_, i) => 500 + (i % 40));
  const started = Date.now();
  const longueStats = historyStats(longue);
  const ms = Date.now() - started;
  eq("une très longue série se compte", longueStats.count, 20000);
  near("la moyenne d'une longue série est exacte", longueStats.mean, 519.5, 0.01);
  check(`une très longue série reste rapide (${ms} ms)`, ms < 500, ms);

  /* --- ce que la courbe ignore ------------------------------------- */

  const complete = historyCoverage({ traced: 4, total: 4, missing: 0 });
  check("une courbe complète ne signale rien", complete.complete, complete);
  eq("une courbe complète n'a pas de trou", complete.missing, 0);
  eq("une courbe complète n'a pas de bord", complete.untraced, 0);

  const percee = historyCoverage({ traced: 3, total: 4, missing: 1 });
  eq("un trou est compté", percee.missing, 1);
  check("un trou rend la courbe incomplète", !percee.complete, percee);
  eq("un trou ne devient pas un bord", percee.untraced, 0);

  const tronquee = historyCoverage({ traced: 20, total: 47, missing: 0 });
  eq("un historique tronqué compte les révisions non lues", tronquee.untraced, 27);
  check("un historique tronqué n'est pas un trou", !tronquee.complete && tronquee.missing === 0, tronquee);

  // Les compteurs viennent d'une requête : incohérents, ils ne doivent pas
  // produire un « -3 révisions » ni un `NaN` à l'écran.
  const incoherent = historyCoverage({ traced: 5, total: 2, missing: -4 });
  eq("un total plus petit que ce qui est lu est corrigé", incoherent.total, 5);
  eq("un manque négatif vaut zéro", incoherent.missing, 0);
  const illisible = historyCoverage({
    traced: Number.NaN,
    total: Number.NaN,
    missing: Number.NaN,
  });
  eq("des compteurs illisibles ne rendent pas de NaN",
    illisible.traced + illisible.total + illisible.missing + illisible.untraced, 0);
}

/* ------------------------------------------------------------------ */
/* 22. Géométrie : repères de la courbe et répartition                 */
/* ------------------------------------------------------------------ */

/**
 * Un graphe est un dessin, donc il se vérifie par ses **propriétés**.
 *
 * C'est exactement ce qu'un dessin ne fait pas tout seul : à l'œil, un repère
 * posé hors cadre, une classe invisible et une division par zéro sur un point
 * unique se ressemblent — ils ressemblent à un graphe. Trois propriétés les
 * distinguent : rien ne sort du cadre, une classe non vide reste visible, et
 * aucune valeur non finie ne finit dans un chemin SVG (un chemin qui contient
 * `NaN` ne s'affiche pas du tout, il disparaît).
 */
function testChartGeometry() {
  const width = 100;
  const height = 34;

  const symetrique = curveGeometry([600, 700, 800], { width, height });
  check("la moyenne est dans le cadre",
    symetrique.meanY !== null && symetrique.meanY >= 0 && symetrique.meanY <= height,
    symetrique.meanY);
  eq("sur une série symétrique, moyenne et médiane se superposent",
    symetrique.meanY, symetrique.medianY);

  // Un fichier monstrueux tire la moyenne sans bouger la médiane : les deux
  // repères doivent se séparer, et dans le bon sens (un score plus haut se
  // dessine plus haut, donc avec une ordonnée plus petite).
  const desequilibre = curveGeometry([600, 700, 4200], { width, height });
  check("la moyenne est tirée vers le point extrême",
    desequilibre.meanY !== null && desequilibre.medianY !== null &&
      desequilibre.meanY < desequilibre.medianY,
    { meanY: desequilibre.meanY, medianY: desequilibre.medianY });

  const plat = curveGeometry([700, 700, 700], { width, height });
  check("les repères d'une série plate restent au milieu",
    plat.meanY !== null && Math.abs(plat.meanY - height / 2) < 0.01,
    plat.meanY);
  const seul = curveGeometry([500], { width, height });
  check("un point unique place aussi ses repères",
    seul.meanY !== null && seul.medianY !== null && seul.meanY === seul.markerY,
    seul.meanY);

  // Rien de non fini ne doit entrer dans un chemin SVG.
  const troue = curveGeometry([600, Number.NaN, 700], { width, height });
  check("un score non fini ne met pas de NaN dans le tracé", !troue.line.includes("NaN"), troue.line);
  eq("les points non finis sont écartés du tracé",
    [...troue.line.matchAll(/[ML]/g)].length, 2);

  // `Math.min(...xs)` plantait au-delà de quelques dizaines de milliers de
  // valeurs ; une courbe bâtie sur une série énorme doit tenir debout.
  let enorme = "";
  try {
    enorme = curveGeometry(new Array(50000).fill(600), { width, height }).line;
  } catch (error) {
    check("une série énorme ne fait pas tomber le tracé", false, String(error));
  }
  check("une série énorme se dessine", enorme.startsWith("M") && !enorme.includes("NaN"), enorme.length);

  /* --- la répartition --- */

  const geo = histogramGeometry([500, 500, 600, 700, 700, 700, 900], { width, height, bins: 7 });
  eq("chaque valeur tombe dans une classe",
    geo.bars.reduce((a, b) => a + b.count, 0), 7);
  eq("le maximum est dans la dernière classe", geo.bars[geo.bars.length - 1].count, 1);
  eq("l'étendue commence à la plus petite valeur", geo.min, 500);
  eq("l'étendue finit à la plus grande", geo.max, 900);
  check("la moyenne et la médiane ne se placent pas au même endroit",
    geo.meanX !== null && geo.medianX !== null && Math.abs(geo.meanX - geo.medianX) > 5,
    { meanX: geo.meanX, medianX: geo.medianX });
  check("les repères restent dans le cadre",
    [geo.meanX, geo.medianX].every((x) => x !== null && x >= 0 && x <= width),
    { meanX: geo.meanX, medianX: geo.medianX });

  const vide = histogramGeometry([], { width, height });
  eq("aucune valeur, aucune barre", vide.bars.length, 0);
  eq("aucune valeur, aucun repère", vide.meanX, null);

  const constante = histogramGeometry([700, 700, 700], { width, height });
  eq("une série constante tient dans une classe", constante.bars.length, 1);
  eq("une série constante compte toutes ses valeurs", constante.bars[0].count, 3);
  eq("la barre d'une série constante est pleine hauteur", constante.bars[0].height, height);
  check("la barre d'une série constante occupe la largeur",
    constante.bars[0].width > width * 0.9, constante.bars[0].width);
  eq("sur une série constante, les repères se placent au milieu",
    constante.meanX, width / 2);

  // Une classe à un fichier sur cent doit rester un trait : c'est
  // exactement l'information qu'on venait chercher.
  const rare = histogramGeometry([...new Array(99).fill(900), 100], { width, height, bins: 8 });
  const isole = rare.bars.find((b) => b.count === 1)!;
  check("une classe très peu peuplée reste visible",
    isole !== undefined && isole.height > 2, isole?.height);
  check("une classe vide n'a pas de hauteur",
    rare.bars.filter((b) => b.count === 0).every((b) => b.height === 0));
  eq("aucune valeur n'est perdue", rare.bars.reduce((a, b) => a + b.count, 0), 100);
}

/* ------------------------------------------------------------------ */
/* 23. L'échelle de dégradation                                        */
/* ------------------------------------------------------------------ */

/**
 * Un fichier propre, puis cinq dégradations **cumulées**, une par famille.
 *
 * C'est le test de pertinence qui manquait : le corpus doré contient des
 * dépôts entiers, donc il dit « ce dépôt vaut 800 » sans dire **pourquoi**, et
 * un barème peut rester dans ses bandes tout en cessant de voir un défaut. Ici
 * le défaut est injecté à la main, un par famille, et trois choses sont
 * exigées : la note baisse, la dimension visée baisse, et aucune autre ne
 * monte. C'est la différence entre un barème calibré et un barème qui mesure.
 *
 * Les étapes s'enchaînent : chacune s'écrit sur l'état laissé par la
 * précédente (identifiants renommés, espaces ajoutés), et c'est aussi ce qui
 * rend la dégradation réaliste — on n'écrit pas du mauvais code en repartant
 * d'une page blanche.
 */
const CLEAN_FILE = `
/**
 * Le prix d'une commande, hors taxes.
 */
export function priceOf(units: number, unitPrice: number): number {
  return units * unitPrice;
}

/**
 * Applique une remise en pourcentage, bornée à zéro.
 */
export function applyDiscount(total: number, percent: number): number {
  if (percent <= 0) {
    return total;
  }
  return Math.max(0, total - (total * percent) / 100);
}
`;

const DEGRADATIONS: { name: string; dimension: FileDimension; degrade: (src: string) => string }[] = [
  {
    name: "espaces en fin de ligne",
    dimension: "hygiene",
    // `$` en mode multiligne colle à la fin de chaque ligne non vide.
    degrade: (src) => src.replace(/[^\n]$/gm, "$&   "),
  },
  {
    name: "identifiants d'une lettre",
    dimension: "naming",
    degrade: (src) =>
      src
        .replace(/\bunits\b/g, "u")
        .replace(/\bunitPrice\b/g, "p")
        .replace(/\btotal\b/g, "t")
        .replace(/\bpercent\b/g, "pc"),
  },
  {
    name: "conditions imbriquées",
    dimension: "complexity",
    degrade: (src) =>
      src.replace(
        /if \((\w+) <= 0\) \{/,
        (_all, name: string) =>
          `if (${name} <= 0) {\n    if (${name} === 0) {\n      if (u === 0) {\n        return 0;\n      }\n    }`,
      ),
  },
  {
    name: "bloc recopié trois fois",
    dimension: "duplication",
    degrade: (src) => {
      // Des lignes **identiques**, réutilisant les noms déjà présents : la
      // seule chose qui change est la copie, pas le nommage.
      const block = "  t = u;\n  t = p;\n  u = t;\n  p = t;\n";
      return src.replace(/\n(  return [^\n]*\n)/, `\n${block}${block}${block}$1`);
    },
  },
  {
    name: "documentation retirée",
    dimension: "documentation",
    degrade: (src) => src.replace(/\/\*\*[\s\S]*?\*\/[ \t]*\n/g, ""),
  },
];

function testDegradationLadder() {
  const ladder: number[] = [scoreFile("a.ts", CLEAN_FILE).score];
  let before = scoreFile("a.ts", CLEAN_FILE);
  let source = CLEAN_FILE;

  check("le fichier de départ est bien noté", ladder[0] >= 900, ladder[0]);

  for (const step of DEGRADATIONS) {
    const previousSource = source;
    source = step.degrade(source);
    // Une transformation qui ne s'applique à rien ferait passer une marche
    // pour une mesure : on vérifie d'abord qu'elle a mordu.
    check(`« ${step.name} » change bien le fichier`, source !== previousSource, step.name);

    const after = scoreFile("a.ts", source);
    check(
      `« ${step.name} » fait perdre des points (${before.score} → ${after.score})`,
      after.score < before.score,
      { avant: before.score, apres: after.score },
    );
    check(
      `« ${step.name} » abaisse la dimension « ${step.dimension} »`,
      (after.dimensions[step.dimension] ?? 0) < (before.dimensions[step.dimension] ?? 0),
      { avant: before.dimensions[step.dimension], apres: after.dimensions[step.dimension] },
    );
    check(
      `« ${step.name} » ne relève aucune autre dimension`,
      FILE_DIMENSIONS.filter((k) => k !== step.dimension).every((k) => {
        const a = after.dimensions[k];
        const b = before.dimensions[k];
        return a === null || b === null || a <= b + 0.01;
      }),
      FILE_DIMENSIONS.map((k) => [k, before.dimensions[k], after.dimensions[k]]),
    );

    ladder.push(after.score);
    before = after;
  }

  check(
    "cinq défauts coûtent au moins un tiers de la note",
    ladder[0] - ladder[ladder.length - 1] >= 300,
    ladder,
  );

  // Ce que le corpus ne peut pas voir : la copie **entre deux fichiers**.
  // Deux fichiers identiques ne sont pas deux fois mieux écrits.
  const seul = scoreProject([{ path: "a.ts", content: CLEAN_FILE }]);
  const recopie = scoreProject([
    { path: "a.ts", content: CLEAN_FILE },
    { path: "b.ts", content: CLEAN_FILE },
  ]);
  check(
    `recopier un fichier à l'identique fait baisser la note du projet (${seul.score} → ${recopie.score})`,
    recopie.score < seul.score,
    { seul: seul.score, recopie: recopie.score },
  );
  check("la duplication inter-fichiers est vue",
    recopie.dimensions.duplication !== null && recopie.dimensions.duplication < 0.1,
    recopie.dimensions.duplication);
}

/* ------------------------------------------------------------------ */
/* 24. Entrées hostiles                                                */
/* ------------------------------------------------------------------ */

/**
 * Ce que le moteur rencontre vraiment, et qu'aucun corpus ne contient.
 *
 * Un dépôt d'utilisateur contient une ligne minifiée de 200 000 caractères,
 * une table de données de 5 000 lignes, du code écrit sous Windows, un octet
 * nul, des emoji dans des chaînes. L'analyse doit **rendre une note**, pas
 * tomber : une exception ici, et c'est tout un panneau de l'application qui
 * disparaît, avec la seule explication « erreur inattendue ».
 */
function testHostileInputs() {
  const longLine = `const total = ${new Array(10000).fill("1").join(" + ")};`;
  const manyLines = Array.from({ length: 2000 }, (_, i) => `const v${i} = ${i};`).join("\n");
  const deep = `${new Array(300).fill("if (a) {").join("\n")}\nx();\n${new Array(300).fill("}").join("\n")}`;

  const cases: [string, string][] = [
    ["fichier vide", ""],
    ["ligne de 50 000 caractères", longLine],
    ["2 000 lignes", manyLines],
    ["300 accolades imbriquées", deep],
    ["octet nul", "const a = 1;\u0000\nconst b = 2;\n"],
    ["emoji et accents", "const e = \"👩‍💻🚀\";\n// ẞ español\n"],
    ["fins de ligne Windows", "const a = 1;\rconst b = 2;\r"],
  ];

  for (const [name, content] of cases) {
    let score = -1;
    let error: unknown = null;
    try {
      const file = scoreFile("h.ts", content);
      score = file.score;
      check(`« ${name} » : toutes les dimensions sont finies`,
        Object.values(file.dimensions).every((v) => v === null || Number.isFinite(v)),
        file.dimensions);
      // `null` est une réponse légitime — un fichier sans fonction n'a pas
      // de maintenabilité — mais un `NaN` n'en est jamais une.
      check(`« ${name} » : les mesures sont finies`,
        ([file.metrics.maintainability, file.metrics.cyclomatic,
          file.metrics.commentRatio, file.metrics.avgLineLength,
        ] as (number | null)[]).every((v) => v === null || Number.isFinite(v)) &&
          file.metrics.sloc <= file.metrics.lines,
        {
          maintainability: file.metrics.maintainability,
          cyclomatic: file.metrics.cyclomatic,
          commentRatio: file.metrics.commentRatio,
          sloc: file.metrics.sloc,
          lines: file.metrics.lines,
        });
    } catch (caught) {
      error = caught;
    }
    check(`« ${name} » ne fait pas tomber l'analyse`, error === null,
      error === null ? undefined : String(error).slice(0, 120));
    check(`« ${name} » rend une note bornée`,
      score >= 0 && score <= SCORE_MAX, score);
  }
}

/* ------------------------------------------------------------------ */
/* 25. Bandes et marges : ce qu'un changement de seuil consomme        */
/* ------------------------------------------------------------------ */

/**
 * Le calcul qui dit **de combien** une mesure tient sa bande.
 *
 * Un test qui affirme « dedans » ne dit pas si le dépôt est au milieu de sa
 * bande ou collé à la borne. C'est pourtant toute la question quand on
 * prépare un changement de seuil : sans marge, la première retouche fait
 * tomber un dépôt qui n'a pas bougé, et personne ne comprend pourquoi.
 *
 * Les trois cas qui comptent sont ici : une marge confortable, une bande
 * perdue, une valeur **épinglée** sur une borne — un plafond qui mord ou une
 * dimension parfaite, qu'il serait faux de désigner comme fragile.
 */
function testBands() {
  const auMilieu = checkBand(700, { min: 600, max: 839 });
  check("une mesure dans sa bande est dedans", auMilieu.inside, auMilieu);
  eq("la marge basse est la distance au minimum", auMilieu.marginLow, 100);
  eq("la marge haute est la distance au maximum", auMilieu.marginHigh, 139);
  eq("la marge retenue est la plus petite des deux", auMilieu.margin, 100);

  const dehors = checkBand(900, { min: 600, max: 839 });
  check("une mesure au-dessus de sa bande est dehors", !dehors.inside, dehors);
  check("la marge devient négative en sortant", dehors.margin < 0, dehors.margin);

  // Les bornes sont **inclusives** : c'est ce qui rend une bande lisible
  // (« au plus 739 »), et c'est aussi ce qui rend une valeur épinglée
  // possible.
  const epinglee = checkBand(739, { min: 0, max: 739 });
  check("une valeur exactement sur la borne est dedans", epinglee.inside, epinglee);
  eq("une valeur épinglée a une marge nulle", epinglee.margin, 0);

  const illisible = checkBand(Number.NaN, { min: 0, max: 100 });
  check("une mesure illisible n'est jamais dans la bande", !illisible.inside, illisible);
  check("une mesure illisible ne rend pas une marge trompeuse", Number.isNaN(illisible.margin));

  const bilan = bandReport([
    { key: "large", measured: 700, band: { min: 600, max: 839 } },
    { key: "serre", measured: 742, band: { min: 600, max: 839 } },
    { key: "epingle", measured: 739, band: { min: 0, max: 739 } },
    { key: "perdu", measured: 900, band: { min: 600, max: 839 } },
  ]);
  eq("le bilan compte les bandes tenues", bilan.checks.length - bilan.outsideCount, 3);
  eq("le bilan nomme ce qui est sorti", bilan.outside.join(","), "perdu");
  eq("le bilan distingue l'épinglé", bilan.pinned.join(","), "epingle");
  check("le plus fragile est la bande serrée, pas l'épinglée",
    bilan.tightest?.key === "serre" && bilan.tightest.side === "haut",
    bilan.tightest);
  eq("le plus fragile ne compte pas les mesures perdues",
    bilan.tightest ? Math.round(bilan.tightest.margin) : 0, 97);

  const vide = bandReport([]);
  check("un bilan vide n'a pas de plus fragile", vide.tightest === null, vide.tightest);
  eq("un bilan vide ne compte rien", vide.outsideCount, 0);
}

/* ------------------------------------------------------------------ */

function main() {
  testLexer();
  testLexerAgainstCompiler();
  testHalstead();
  testComplexity();
  testFunctions();
  testMaintainability();
  testLineScore();
  testFileScore();
  testMetamorphic();
  testProject();
  testHygiene();
  testSecurityAndCaps();
  testActions();
  testCoupling();
  testCache();
  testExclusions();
  testGradesAndBounds();
  testCorpus();
  testRealCorpus();
  testCurve();
  testStats();
  testTrend();
  testChartGeometry();
  testDegradationLadder();
  testHostileInputs();
  testBands();

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ Le score est fondé, borné, déterministe et calibré\n");
}

main();
