/**
 * Test d'intégration du moteur WASI — réel, réseau requis.
 *
 *   npx tsx scripts/test-wasi-live.ts   (ou : npm run test:wasi-live)
 *
 * Ce test ne figure pas dans `npm test` : il télécharge les binaires
 * publics de Runno, donc il ne peut pas passer hors ligne. Il existe
 * parce qu'une bonne partie de ce module (compilation en deux temps,
 * archive .tar.gz, entrée standard) est invisible aux tests purs : ces
 * derniers vérifient que les **commandes** sont justes, pas qu'un binaire
 * les exécute.
 *
 * Il exécute le code **réel** — `wasiRun`, la même chaîne que le worker
 * reçoit — contre le vrai paquet @runno/wasi, téléchargé au CDN comme
 * l'application le fait.
 */

import { WASI_MODULE_URL, wasiRun, type WasiRunRequest } from "../lib/execution/wasi";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

/**
 * Le paquet WASI, importé comme le fait le worker.
 *
 * Node refuse un import depuis une URL https : on passe donc par une
 * data: URL, ce qui garde le test sur la chaîne réelle (fetch + import
 * dynamique) sans fichier intermédiaire.
 */
let modulePromise: Promise<Record<string, unknown>> | null = null;
function loadWasi(): Promise<Record<string, unknown>> {
  if (modulePromise === null) {
    modulePromise = (async () => {
      const res = await fetch(WASI_MODULE_URL);
      if (!res.ok) throw new Error(`${WASI_MODULE_URL} → ${res.status}`);
      const text = await res.text();
      const url =
        "data:text/javascript;base64," + Buffer.from(text, "utf8").toString("base64");
      return (await import(url)) as Record<string, unknown>;
    })().catch((cause) => {
      modulePromise = null;
      throw cause;
    });
  }
  return modulePromise;
}

interface RunResult {
  output: string;
  exitCode: number;
  ready: boolean;
  durationMs: number;
}

async function run(
  runtime: string,
  entry: string,
  files: Record<string, string>,
  extra: { code?: string; stdin?: string } = {},
): Promise<RunResult> {
  const mod = await loadWasi();
  const started = Date.now();
  let output = "";
  let ready = false;

  const request: WasiRunRequest = {
    runtime,
    entry,
    files,
    code: extra.code,
    stdin: extra.stdin,
    maxOutput: 200_000,
  };

  const result = await wasiRun(
    mod as never,
    request,
    (text) => {
      output += text;
    },
    () => {
      ready = true;
    },
  );

  return { output, exitCode: result.exitCode, ready, durationMs: Date.now() - started };
}

/** Chaque étape est annoncée sur stderr : un test muet ressemble à un plantage. */
function step(label: string): void {
  process.stderr.write(`  … ${label}\n`);
}

/*
 * Les binaires WASI pèsent plusieurs mégaoctets et C puis C++ téléchargent
 * le même clang. Le worker, lui, exécute un programme à la fois : il n'a
 * jamais besoin de ce cache. Le test, si — sans quoi il dépasse les dix
 * minutes à retélécharger le même fichier. On met donc en cache les octets,
 * sans toucher au code de production.
 */
const realFetch = globalThis.fetch.bind(globalThis);
const fetched = new Map<string, Promise<Uint8Array>>();
globalThis.fetch = ((input: never, init?: never) => {
  const url =
    typeof input === "string" ? input : (input as { url?: string } | null)?.url;
  if (typeof url === "string" && /^https?:/.test(url)) {
    let bytes = fetched.get(url);
    if (bytes === undefined) {
      bytes = realFetch(input, init).then(async (res) => {
        if (!res.ok) throw new Error(`${url} → ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      });
      fetched.set(url, bytes);
    }
    return bytes.then(
      (data) => new Response(data.slice(), { status: 200 }),
    ) as Promise<Response>;
  }
  return realFetch(input, init);
}) as typeof fetch;


async function main(): Promise<void> {
  step("paquet @runno/wasi");
  await loadWasi();

  /* ── JavaScript isolé (QuickJS) ───────────────────────────────── */
  step("QuickJS");
  const js = await run("quickjs", "/main.js", {
    "/main.js": 'console.log("quickjs ok");\n',
  });
  check("QuickJS s'exécute", js.exitCode === 0 && js.output.includes("quickjs ok"), js.output);
  check("QuickJS annonce son moteur prêt", js.ready === true);

  /* ── SQL, via l'entrée standard ───────────────────────────────── */
  step("SQL");
  const sql = await run("sqlite", "/main.sql", { "/main.sql": "" }, {
    code: "select 1 + 1 as somme;\n",
  });
  check("SQL s'exécute", sql.exitCode === 0 && sql.output.includes("2"), sql.output);

  /* ── Ruby, avec son système de fichiers de base ───────────────── */
  step("Ruby");
  const ruby = await run("ruby", "/main.rb", {
    "/main.rb": "require_relative 'outil'\nputs somme(2, 3)\n",
    "/outil.rb": "def somme(a, b)\n  a + b\nend\n",
  });
  check("Ruby s'exécute", ruby.exitCode === 0 && ruby.output.includes("5"), ruby.output);
  check("Ruby a monté la base", ruby.ready === true);

  /* ── PHP, en mode CGI ─────────────────────────────────────────── */
  step("PHP");
  const php = await run("php-cgi", "/index.php", {
    "/index.php": '<?php echo "php ok\\n"; echo array_sum([1, 2, 3]), "\\n"; ?>\n',
  });
  check("PHP s'exécute", php.exitCode === 0 && php.output.includes("php ok"), php.output);
  check("PHP calcule", php.output.includes("6"), php.output);

  /* ── C : compile, lie, exécute ────────────────────────────────── */
  step("C (téléchargement de clang ≈ 31 Mo, une fois)");
  const c = await run("clang", "/main.c", {
    "/main.c":
      '#include <stdio.h>\n#include "aide.h"\nint main(void){ printf("%d\\n", ALPHABET); return 0; }\n',
    "/aide.h": "#define ALPHABET 42\n",
  });
  check("C s'exécute", c.exitCode === 0 && c.output.includes("42"), {
    exit: c.exitCode,
    out: c.output.slice(0, 400),
  });

  /* ── C++ : même chemin, autre compilation ─────────────────────── */
  step("C++");
  const cpp = await run("clangpp", "/main.cpp", {
    "/main.cpp":
      '#include <iostream>\nint main(){ std::cout << "cpp ok" << std::endl; return 0; }\n',
  });
  check("C++ s'exécute", cpp.exitCode === 0 && cpp.output.includes("cpp ok"), {
    exit: cpp.exitCode,
    out: cpp.output.slice(0, 400),
  });

  /* ── Rapport ──────────────────────────────────────────────────── */

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ Le moteur WASI compile, lie et exécute pour de vrai\n");
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
