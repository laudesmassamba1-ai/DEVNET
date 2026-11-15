/**
 * Tests de l'exécution.
 *
 * Exécuter avec :  npx tsx scripts/test-execution.ts
 *
 * Le cœur du moteur (`lib/execution/engine.ts`) est **pur** : il ne touche
 * ni au DOM, ni au réseau, ni au worker. C'est donc testable ici, en
 * Node, sans navigateur — ce qui est le seul moyen d'être sûr que
 * `console.log("bonjour")` produit exactement `bonjour` avant de le
 * découvrir à l'écran.
 *
 * Deux choses ne sont **pas** testables ici, et le test le dit :
 *
 *  · Pyodide, qui a besoin d'un worker et d'Internet ;
 *  · l'interruption par `terminate()`, qui n'a de sens que dans un
 *    worker réel.
 *
 * Ces deux-là sont couvertes par `scripts/parcours-navigateur.py`, qui
 * clique sur « exécuter » dans un vrai Chrome.
 */

import {
  appendOutput,
  createBuffer,
  formatArgs,
  normaliseError,
  normalizeModulePath,
  pythonBootstrap,
  pythonStdin,
  resolveModule,
  runModules,
  runSource,
} from "../lib/execution/engine";
import { buildWorkerSource } from "../lib/execution/worker-source";
import { refusalReason } from "../lib/execution/runner";
import { LIMITS, RUNTIMES, codeReadsStdin, runtimeForPath } from "../lib/execution/runtime";
import { transpileForRun } from "../lib/execution/typescript";
import {
  wasiAppend,
  wasiCommands,
  wasiDefaultEntry,
  wasiFilesystem,
  wasiParseTar,
} from "../lib/execution/wasi";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

/** Exécute du code et renvoie ce que le moteur a écrit. */
function capture(code: string): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];

  runSource(code, {
    log: (t) => out.push(t),
    warn: (t) => err.push(t),
    error: (t) => err.push(t),
  });

  return { out, err };
}

async function main() {
  /* ── Le tampon de sortie ──────────────────────────────────────── */

  let buffer = createBuffer();
  buffer = appendOutput(buffer, "première", 100);
  buffer = appendOutput(buffer, "seconde", 100);

  check("les lignes s'ajoutent dans l'ordre", buffer.text === "première\nseconde\n", buffer.text);
  check("un tampon court n'est pas tronqué", buffer.truncated === false);

  const court = appendOutput(createBuffer(), "x".repeat(10), 10);
  check("une sortie exactement à la limite n'est pas tronquée",
    court.truncated === false, court);

  const trop = appendOutput(createBuffer(), "y".repeat(11), 10);
  check("une sortie trop longue est tronquée", trop.truncated === true);
  check("la sortie tronquée respecte le plafond",
    trop.text.length === 10, trop.text.length);

  // Le plafond du moteur et celui du tampon sont le **même** nombre. Les
  // deux sont écrits à deux endroits — le jeton de l'exécution et la
  // valeur transmise au worker — donc ce test attrape le jour où l'un
  // bouge sans l'autre.
  const reel = appendOutput(createBuffer(), "z".repeat(LIMITS.maxOutput), LIMITS.maxOutput);
  // Le tampon garde le saut de ligne de fin — il fait partie du format —
  // alors que ce qui compte est ce que la personne voit, donc la
  // longueur **après** trim. Une sortie exactement à la limite doit
  // passer : c'est elle qui distingue un plafond d'un seuil arbitraire.
  check("une sortie à la taille maximale réelle n'est pas tronquée",
    reel.truncated === false && reel.text.trimEnd().length === LIMITS.maxOutput,
    { visible: reel.text.trimEnd().length, tronque: reel.truncated });

  // Une fois tronqué, on cesse d'écrire : c'est ce qui empêche une
  // exécution bavarde de devenir une fuite de mémoire.
  const apres = appendOutput(trop, "encore", 10);
  check("on n'écrit plus après le plafond",
    apres.text === trop.text && apres.truncated === true, apres);

  /* ── Le formatage ─────────────────────────────────────────────── */

  check("une chaîne est rendue telle quelle",
    formatArgs(["bonjour"]) === "bonjour", formatArgs(["bonjour"]));
  check("plusieurs arguments sont joints par un espace",
    formatArgs(["a", 1, true]) === "a 1 true", formatArgs(["a", 1, true]));
  check("un objet est sérialisé",
    formatArgs([{ a: 1 }]) === '{"a":1}', formatArgs([{ a: 1 }]));
  check("null et undefined sont lisibles",
    formatArgs([null, undefined]) === "null undefined", formatArgs([null, undefined]));

  // Un objet circulaire ne sérialise pas : le cas est la norme en
  // JavaScript, pas une curiosité.
  const circulaire: Record<string, unknown> = {};
  circulaire.soi = circulaire;
  check("un objet circulaire ne fait pas échouer l'affichage",
    formatArgs([circulaire]).length > 0, formatArgs([circulaire]));

  check("une Error garde son type et son message",
    formatArgs([new TypeError("x")]) === "TypeError: x");

  /* ── Les messages d'erreur ────────────────────────────────────── */

  // Les préfixes d'implémentation parlent du moteur, pas du code : en
  // laisser un ferait croire à une faute de la personne.
  check("le préfixe PythonError est retiré",
    normaliseError(new Error("PythonError: NameError: name 'x' is not defined"))
      === "NameError: name 'x' is not defined");
  check("le préfixe Error est retiré",
    normaliseError(new Error("Error: total is not defined")) === "total is not defined");
  check("une chaîne est conservée telle quelle",
    normaliseError("quelque chose") === "quelque chose");

  /* ── L'exécution, pour de vrai ────────────────────────────────── */

  const log = capture('console.log("bonjour");');
  check("console.log écrit le texte", log.out[0] === "bonjour", log.out);

  const nombre = capture("console.log(1 + 1);");
  check("une expression est calculée", nombre.out[0] === "2", nombre.out);

  const multi = capture('console.log("a"); console.log("b");');
  check("chaque appel produit sa ligne", multi.out.join("|") === "a|b", multi.out);

  // C'est le cas pour lequel le projet a écrit sa propre coloration et
  // son dépôt interne : de la logique, pas de la plumbing.
  const calcul = capture(`
    function total(lignes) {
      let somme = 0;
      for (const ligne of lignes) somme += ligne;
      return somme;
    }
    console.log(total([1, 2, 3, 4]));
  `);
  check("une fonction s'exécute et rend le bon résultat",
    calcul.out[0] === "10", calcul.out);

  const objet = capture('console.log({ nom: "koffi", n: 2 });');
  check("un objet composé s'affiche",
    objet.out[0] === '{"nom":"koffi","n":2}', objet.out);

  // Le mode strict est le comportement d'un module : c'est celui qu'on
  // attend d'un éditeur qui prétend exécuter du code moderne.
  let redeclaree = false;
  try {
    capture('let x = 1; let x = 2; console.log(x);');
  } catch {
    redeclaree = true;
  }
  check("une redéclaration échoue en mode strict", redeclaree);

  const thrower = (() => {
    try {
      capture('throw new ReferenceError("total is not defined");');
      return null;
    } catch (e) {
      return normaliseError(e);
    }
  })();
  check("une exception remonte avec son message",
    thrower === "ReferenceError: total is not defined", thrower);

  // `console` injecté : le `console` *nu* du code est le nôtre, et c'est
  // vérifiable ici — chaque `console.log` arrive dans le tampon.
  //
  // Ce qu'on ne peut **pas** vérifier en Node, c'est que le code ne peut
  // pas atteindre la page : `globalThis.console` reste bien visible dans
  // le worker, mais c'est la console du worker, dans un autre monde. La
  // séparation vient du worker, pas de cette fonction — et c'est
  // pourquoi le clic sur « exécuter » se teste dans un vrai navigateur.
  const injection = capture('console.log("vu par le tampon");');
  check("le console du code est celui qu'on injecte",
    injection.out[0] === "vu par le tampon", injection.out);

  /* ── Le multi-fichiers ────────────────────────────────────────── */

  // Un dépôt n'est pas un fichier : le défaut d'origine était qu'un
  // `import`/`require` vers un voisin échouait alors que le fichier
  // existait. Ces tests tiennent la résolution et le chargeur, qui sont
  // du code pur — donc vérifiables hors navigateur.

  check("un chemin est canonisé",
    normalizeModulePath("./lib/../registre.py") === "registre.py",
    normalizeModulePath("./lib/../registre.py"));

  const files: Record<string, string> = {
    "main.js": 'const m = require("./lib/math");\nconsole.log(m.add(2, 3));',
    "lib/math.js": "exports.add = (a, b) => a + b;\nexports.PI = 3.14;",
    "lib/index.js": "module.exports = { missing: true };",
    "dep/default.js": "module.exports = require('./pair');",
    "dep/pair.js": "module.exports = 42;",
  };

  check("un require relatif est résolu",
    resolveModule("./lib/math", "main.js", files) === "lib/math.js",
    resolveModule("./lib/math", "main.js", files));
  check("l'extension optionnelle est essayée",
    resolveModule("./lib/math.js", "main.js", files) === "lib/math.js");
  check("un index de dossier est résolu",
    resolveModule("./lib", "main.js", files) === "lib/index.js",
    resolveModule("./lib", "main.js", files));
  check("un chemin sans point part de la racine",
    resolveModule("lib/math", "main.js", files) === "lib/math.js");
  check("un module absent renvoie null",
    resolveModule("./nope", "main.js", files) === null);

  const moduleOut: string[] = [];
  runModules("main.js", files, {
    log: (t) => moduleOut.push(t),
    warn: (t) => moduleOut.push(t),
    error: (t) => moduleOut.push(t),
  });
  check("un module appelé depuis un autre s'exécute",
    moduleOut.join("|") === "5", moduleOut);

  const nestedOut: string[] = [];
  runModules("dep/default.js", files, {
    log: (t) => nestedOut.push(t), warn: () => {}, error: () => {},
  });
  check("un require en cascade ne produit pas d'erreur",
    nestedOut.length === 0, nestedOut);

  let manquant = "";
  try {
    runModules("main.js", { "main.js": 'require("./absent");' }, {
      log: () => {}, warn: () => {}, error: () => {},
    });
  } catch (e) {
    manquant = normaliseError(e);
  }
  check("un module absent s'explique",
    manquant.includes("./absent") && manquant.includes("absent"),
    manquant);

  // Cycle : deux modules qui s'importent mutuellement ne bouclent pas.
  const cycle: Record<string, string> = {
    "a.js": 'exports.name = "a"; const b = require("./b"); console.log(b.name);',
    "b.js": 'exports.name = "b"; const a = require("./a"); console.log(a.name);',
  };
  const cycleOut: string[] = [];
  runModules("a.js", cycle, {
    log: (t) => cycleOut.push(t), warn: () => {}, error: () => {},
  });
  check("un cycle d'imports ne bloque pas",
    cycleOut.join("|") === "a|b", cycleOut);

  const bootstrap = pythonBootstrap({
    "registre.py": "print(1)",
    "tests/test_registre.py": "print(2)",
  });
  check("l'amorçage Python écrit les fichiers",
    bootstrap.includes("_devnet_files") && bootstrap.includes("registre.py"),
    bootstrap.slice(0, 60));
  check("l'amorçage Python expose la racine et les dossiers",
    bootstrap.includes('_devnet_paths = ["","tests"]'), bootstrap);
  check("l'amorçage Python met sys.path à jour",
    bootstrap.includes("sys.path.insert"), bootstrap);

  /* ── La source du worker ──────────────────────────────────────── */

  const source = buildWorkerSource();

  // Les helpers partagés sont *injected* depuis `engine.ts`. Si l'un
  // disparaît de la liste sans que son source disparaisse, le worker ne
  // compile pas — et ça ne se voit qu'au clic. Ce test le voit ici.
  for (const helper of [
    "appendOutput", "createBuffer", "formatArgs", "normaliseError",
    "consoleFor", "runSource", "normalizeModulePath", "resolveModule", "runModules",
  ]) {
    check(`le worker contient l'implémentation de ${helper}`,
      new RegExp(`function ${helper}\\b`).test(source), helper);
  }

  check("le worker écoute les messages", source.includes("self.onmessage"));
  check("le worker répond par postMessage", source.includes("self.postMessage"));
  // Le signal « prêt » sépare le téléchargement du moteur du temps
  // d'exécution : sans lui, un premier lancement lent serait interrompu
  // avant d'avoir commencé.
  check("le worker signale quand le moteur est prêt",
    source.includes('{ type: "ready" }'), source.slice(0, 40));
  check("Pyodide est chargé à la demande", source.includes("loadPyodide"));
  check("Pyodide est versionné", /PYODIDE_VERSION = "\d+\.\d+\.\d+"/.test(source));

  // Le plafond est transmis au worker : c'est lui qui écrit en continu,
  // donc c'est là qu'il faut l'appliquer.
  check("le worker reçoit le plafond de sortie", source.includes("request.maxOutput"));

  /* ── Le refus, et pourquoi il parle ───────────────────────────── */

  check("un fichier Python a un moteur", runtimeForPath("registre.py") !== null);
  check("un fichier Markdown n'a pas de moteur",
    runtimeForPath("README.md") === null, runtimeForPath("README.md"));

  const raison = refusalReason("logo.png");
  check("un refus sans moteur s'explique", raison !== null && raison.includes(".png"), raison);
  check("un fichier exécutable n'est pas refusé",
    refusalReason("index.js") === null);

  /* ── L'entrée standard Python ─────────────────────────────────── */

  // Même sans valeurs, le préambule est posé : un `input()` lèvera alors
  // un message qui dit quoi faire, au lieu de l'`OSError` de Pyodide.
  const sansEntree = pythonStdin(undefined);
  check("sans entrée, le préambule est posé",
    sansEntree.includes("_devnet_builtins.input = _devnet_input"));
  check("sans entrée, la liste est vide", sansEntree.includes("_devnet_inputs = []"));
  check("l'erreur explique quoi faire", sansEntree.includes("input() attend une saisie"));
  check("entrée vide, la liste est vide", pythonStdin("").includes("_devnet_inputs = []"));

  const stdin = pythonStdin("20\nAminata\n");
  check("le préambule remplace input", stdin.includes("_devnet_builtins.input = _devnet_input"));
  check("les valeurs sont transmises", stdin.includes('"20"') && stdin.includes('"Aminata"'));
  check("le saut de ligne final ne crée pas de saisie vide",
    (stdin.match(/Aminata/g) ?? []).length === 1);

  /* ── Le champ « entrées » ne se montre que s'il sert ───────────── */

  // Le champ n'apparaît que si le code **demande** une saisie : un fichier
  // qui ne lit jamais stdin n'a rien à demander, et lui montrer un
  // formulaire vide serait un champ sans objet.
  const py = runtimeForPath("main.py");
  check("Python sans input : pas de champ", !codeReadsStdin(py, "print('salut')"));
  check("Python avec input() : champ", codeReadsStdin(py, "x = input('nom ? ')"));

  const rb = runtimeForPath("main.rb");
  check("Ruby sans gets : pas de champ", !codeReadsStdin(rb, "puts 'salut'"));
  check("Ruby avec gets : champ", codeReadsStdin(rb, "nom = gets.chomp"));

  const phpSpec = runtimeForPath("main.php");
  check("PHP sans lecture : pas de champ", !codeReadsStdin(phpSpec, "<?php echo 'salut';"));
  check("PHP avec fgets(STDIN) : champ",
    codeReadsStdin(phpSpec, "<?php $l = fgets(STDIN);"));
  check("PHP avec STDIN : champ", codeReadsStdin(phpSpec, "<?php $x = stream_get_contents(STDIN);"));

  const c = runtimeForPath("main.c");
  check("C sans scanf : pas de champ", !codeReadsStdin(c, "int main(){ return 0; }"));
  check("C avec scanf : champ", codeReadsStdin(c, "scanf(\"%d\", &n);"));

  const cpp = runtimeForPath("main.cpp");
  check("C++ avec cin : champ", codeReadsStdin(cpp, "std::cin >> n;"));
  check("C++ sans cin : pas de champ", !codeReadsStdin(cpp, "int main(){ return 0; }"));

  const sqlSpec = runtimeForPath("main.sql");
  check("SQL : jamais de champ, le programme est le fichier",
    !codeReadsStdin(sqlSpec, "select * from notes;"));

  const js = runtimeForPath("main.js");
  check("JavaScript : pas d'entrée standard",
    !codeReadsStdin(js, "console.log('salut')"));
  check("aucun moteur : pas de champ", !codeReadsStdin(null, "input()"));

  /* ── La compilation TypeScript ────────────────────────────────── */

  const simple = await transpileForRun("main.ts", "const x: number = 2;\nconsole.log(x + 1);");
  check("les annotations sont retirées", !simple.code.includes(": number"), simple.code);
  const simpleOut: string[] = [];
  runSource(simple.code, {
    log: (t) => simpleOut.push(t),
    warn: () => {},
    error: () => {},
  });
  check("un fichier TypeScript s'exécute", simpleOut.join("\n") === "3", simpleOut);

  const tsProject = await transpileForRun(
    "main.ts",
    'import { somme } from "./outils";\nconsole.log(somme(2, 3));',
    {
      "main.ts": 'import { somme } from "./outils";\nconsole.log(somme(2, 3));',
      "outils.ts": "export function somme(a: number, b: number): number { return a + b; }",
    },
  );
  check(
    "un fichier voisin est compilé",
    (tsProject.files?.["outils.ts"] ?? "").includes("exports.somme"),
  );

  const tsOut: string[] = [];
  runModules("main.ts", tsProject.files ?? {}, {
    log: (t) => tsOut.push(t),
    warn: () => {},
    error: () => {},
  });
  check("un projet TypeScript s'exécute", tsOut.join("\n") === "5", tsOut);

  /* ── Le registre des langages ─────────────────────────────────── */

  // Un langage sans moteur ne doit **pas** proposer « exécuter » : c'est
  // `refusalReason` qui le dit, et c'est lui que l'interface écoute.
  check("un fichier C a un moteur", refusalReason("src/main.c") === null);
  check("un fichier Ruby a un moteur", refusalReason("main.rb") === null);
  check("un fichier SQL a un moteur", refusalReason("schema.sql") === null);
  check("un fichier Markdown n'a toujours pas de moteur",
    refusalReason("README.md") !== null);
  check("un binaire n'a pas de moteur", refusalReason("logo.png") !== null);

  // L'extension et son alias pointent vers le même langage.
  check(".h appartient au C", runtimeForPath("src/util.h")?.wasi === "clang");
  check("C++ → clangpp", runtimeForPath("main.cpp")?.wasi === "clangpp");
  check("C++ (c++) → clangpp", runtimeForPath("a.c++")?.wasi === "clangpp");
  check("Ruby → ruby", runtimeForPath("main.rb")?.wasi === "ruby");
  check("PHP → php-cgi", runtimeForPath("index.php")?.wasi === "php-cgi");
  check("SQL → sqlite", runtimeForPath("schema.sql")?.wasi === "sqlite");
  check("la casse n'y change rien", runtimeForPath("MAIN.C")?.id === "wasi");
  check("Python garde son moteur", runtimeForPath("a.py")?.id === "pyodide");
  check("JavaScript garde son moteur", runtimeForPath("a.js")?.id === "sandpack");

  // Un langage sans moteur reste sans moteur : Rust n'est pas supporté,
  // et le dire vaut mieux que prétendre le faire.
  check("Rust n'a pas de moteur", runtimeForPath("main.rs") === null);

  const wasiSpecs = ["c", "cpp", "ruby", "php", "sql"].map((k) => RUNTIMES[k]);
  check("cinq langages WASI sont déclarés",
    wasiSpecs.length === 5 && wasiSpecs.every((s) => s?.id === "wasi"), wasiSpecs.length);
  check("chaque langage WASI nomme son programme",
    wasiSpecs.every((s) => typeof s?.wasi === "string"));
  check("chaque langage WASI a un fichier d'entrée",
    wasiSpecs.every((s) => s?.entry.startsWith("main.")));

  /* ── Le montage d'un dépôt dans un système de fichiers WASI ──── */

  const wasiFs = wasiFilesystem({ "main.rb": "puts 1", "src/a.rb": "puts 2" });
  check("les chemins WASI sont absolus",
    Object.keys(wasiFs).sort().join(",") === "/main.rb,/src/a.rb",
    Object.keys(wasiFs));
  check("le contenu du brouillon est porté", wasiFs["/main.rb"].content === "puts 1");
  check("un texte est marqué texte", wasiFs["/main.rb"].mode === "string");

  check("entrée : main.<ext> préféré",
    wasiDefaultEntry({ "util.h": "", "main.c": "", "z.c": "" }, "main.c") === "main.c");
  check("entrée : sinon index.<ext>",
    wasiDefaultEntry({ "index.js": "", "z.js": "" }, "main.js") === "index.js");
  check("entrée : sinon le premier fichier du langage",
    wasiDefaultEntry({ "z.c": "", "a.c": "" }, "main.c") === "a.c");
  check("entrée : sinon le nom souhaité",
    wasiDefaultEntry({ "README.md": "" }, "main.c") === "main.c");

  /* ── Les commandes, mode Runno ────────────────────────────────── */

  const clang = wasiCommands("clang", "/main.c");
  check("C : deux étapes (compile, puis lie)", clang.prepare.length === 2);
  check("C : la compilation produit .o",
    clang.prepare[0].args.includes("-emit-obj") && clang.prepare[0].args.includes("/program.o"));
  check("C : l'étape de lien est wasm-ld", clang.prepare[1].args.includes("wasm-ld"));
  check("C : le programme final est celui du FS", clang.run.fsPath === "/program.wasm");
  check("C : sysroot présent", clang.prepare[0].args.includes("/sys"));
  check("C : en-têtes de base avant compilation",
    typeof clang.prepare[0].baseFs === "string" && clang.prepare[0].baseFs!.endsWith(".tar.gz"));
  // Sans -I, un include relatif échoue : le mode -cc1 ne cherche qu'à
  // côté du sysroot. La racine est donc toujours dans le chemin.
  check("C : la racine est un chemin d'inclusion", clang.prepare[0].args.includes("-I/"));
  check("C : l'entrée est le dernier argument",
    clang.prepare[0].args[clang.prepare[0].args.length - 1] === "/main.c");

  // Les sous-dossiers d'un projet doivent être cherchables aussi.
  const clangProjet = wasiCommands("clang", "/src/main.c", {
    "/src/main.c": "",
    "/src/util/aide.h": "",
    "/lib/commun.h": "",
  });
  check("C : chaque sous-dossier du projet est dans le chemin d'inclusion",
    clangProjet.prepare[0].args.includes("-I/src")
      && clangProjet.prepare[0].args.includes("-I/src/util")
      && clangProjet.prepare[0].args.includes("-I/lib")
      && clangProjet.prepare[0].args.includes("-I/"));
  check("C : les chemins d'inclusion viennent avant l'entrée",
    clangProjet.prepare[0].args.indexOf("-I/") <
      clangProjet.prepare[0].args.indexOf("/src/main.c"));

  const clangpp = wasiCommands("clangpp", "/main.cpp");
  check("C++ : sysroot C++",
    clangpp.prepare[0].args.includes("/sys/include/c++/v1"));
  check("C++ : l'ouverture en C++ est explicite", clangpp.prepare[0].args.includes("c++"));
  check("C++ : lie les bibliothèques C++",
    clangpp.prepare[1].args.includes("-lc++") && clangpp.prepare[1].args.includes("-lc++abi"));
  check("C++ : la racine est un chemin d'inclusion", clangpp.prepare[0].args.includes("-I/"));

  const ruby = wasiCommands("ruby", "/main.rb");
  check("Ruby : options de base chargées",
    ruby.run.args.includes("/ruby-3.2.0/.rubyopts.rb"));
  check("Ruby : système de fichiers de base",
    ruby.run.baseFs === "https://runno.dev/langs/ruby-3.2.0.tar.gz");
  check("Ruby : entrée en dernière position",
    ruby.run.args[ruby.run.args.length - 1] === "/main.rb");

  const sql = wasiCommands("sqlite", "/main.sql");
  check("SQL : le programme est l'entrée standard", sql.run.stdinFromCode === true);
  check("SQL : aucune étape de préparation", sql.prepare.length === 0);

  const quick = wasiCommands("quickjs", "/main.js");
  check("QuickJS : pas d'archive de base", quick.run.baseFs === undefined);
  check("QuickJS : fichier d'entrée passé au binaire", quick.run.args[1] === "/main.js");

  const php = wasiCommands("php-cgi", "/index.php");
  check("PHP : mode CGI explicite", php.run.env?.REDIRECT_STATUS === "1");
  check("PHP : le script est annoncé", php.run.env?.SCRIPT_FILENAME === "/index.php");

  // Un runtime inconnu doit échouer **ici**, pas au milieu d'une exécution.
  let inconnu = false;
  try {
    wasiCommands("COBOL", "/main.c");
  } catch {
    inconnu = true;
  }
  check("un runtime WASI inconnu est refusé", inconnu);

  /* ── L'extraction d'archive ───────────────────────────────────── */

  // Le format tar se décrit en trois lignes : un en-tête de 512 octets,
  // la taille en octal, le type `0`, puis la donnée arrondie à 512.
  function buildTar(path: string, content: string): Uint8Array {
    const enc = new TextEncoder();
    const header = new Uint8Array(512);
    header.set(enc.encode(path.replace(/^\//, "")).subarray(0, 100), 0);
    header.set(enc.encode(content.length.toString(8).padStart(11, "0") + "\0"), 124);
    header[156] = "0".charCodeAt(0);
    const data = enc.encode(content);
    const dataBlocks = Math.max(1, Math.ceil(data.length / 512));
    const out = new Uint8Array(512 + dataBlocks * 512 + 1024);
    out.set(header, 0);
    out.set(data, 512);
    return out;
  }

  const extracted = wasiParseTar(buildTar("/sys/include.h", "#define OK 1"));
  const extractedNames = Object.keys(extracted);
  check("tar : un fichier est extrait", extractedNames.length === 1, extractedNames);
  check("tar : le chemin est absolu", extractedNames[0] === "/sys/include.h", extractedNames);
  check("tar : une archive porte un contenu binaire",
    extracted["/sys/include.h"]?.mode === "binary", extracted["/sys/include.h"]?.mode);
  check("tar : le contenu est exact",
    new TextDecoder().decode(extracted["/sys/include.h"].content as Uint8Array) === "#define OK 1",
    new TextDecoder().decode(extracted["/sys/include.h"].content as Uint8Array));

  // Un nom sans barre oblique reste absolu : sinon le binaire ne
  // retrouve pas un fichier qu'il vient pourtant d'ouvrir.
  const sansSlash = wasiParseTar(buildTar("a.txt", "hi"));
  check("tar : pas de barre oblique, chemin absolu quand même",
    Object.keys(sansSlash).includes("/a.txt"), Object.keys(sansSlash));

  /* ── La sortie WASI ───────────────────────────────────────────── */

  // Le writer générique ajoute un saut de ligne à chaque appel ; celui du
  // WASI doit coller le texte tel quel, sinon l'en-tête CGI de PHP ou
  // une invite sans retour gagne des lignes en trop.
  check("wasiAppend n'ajoute rien",
    wasiAppend({ text: "", truncated: false }, "abc", 100).text === "abc");
  check("wasiAppend conserve le texte écrit",
    wasiAppend({ text: "ab\n", truncated: false }, "cd", 100).text === "ab\ncd");
  check("wasiAppend coupe au plafond",
    wasiAppend({ text: "ab", truncated: false }, "cdef", 3).text === "abc");
  check("wasiAppend signale la troncature",
    wasiAppend({ text: "ab", truncated: false }, "cdef", 3).truncated === true);
  check("wasiAppend reste tronqué après le plafond",
    wasiAppend({ text: "ab", truncated: true }, "cdef", 3).text === "ab");

  /* ── Le worker, les deux côtés ────────────────────────────────── */

  check("le worker connaît WASI", source.includes('request.engine === "wasi"'));
  check("le worker importe le paquet WASI",
    source.includes("const wasiModule = await import(WASI_MODULE_URL)"));
  check("le worker signale le moteur WASI prêt",
    source.includes('self.postMessage({ type: "ready" })'));
  // Le module WASI est sans DOM : c'est la condition pour qu'il tourne
  // dans un worker, contrairement à `@runno/runtime`.
  check("le paquet WASI est épinglé", source.includes("@runno/wasi@0.10.0"));
  check("les binaires viennent de Runno", source.includes("https://runno.dev/langs/"));

  /* ── Rapport ──────────────────────────────────────────────────── */

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ L'exécution calcule, compile, capture et refuse — sans rien charger\n");
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});