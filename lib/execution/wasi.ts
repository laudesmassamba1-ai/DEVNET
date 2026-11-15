/**
 * Le moteur WASI — un interpréteur WebAssembly par langage.
 *
 * ## Pourquoi ce module ressemble à `engine.ts`
 *
 * Le worker ne peut pas importer de module : il reçoit son code sous forme
 * de texte. Comme pour `ENGINE_SOURCE`, on écrit donc les helpers **une
 * seule fois**, en JavaScript autonome, et :
 *
 * - le fil principal les évalue pour ses propres fonctions (et les tests
 *   en Node) ;
 * - le worker reçoit exactement le même texte.
 *
 * Impossible que les deux divergent : c'est le même texte.
 *
 * ## Ce que fait ce moteur
 *
 * Chaque langage non couvert par Pyodide ou Sandpack a un binaire WASI
 * publié par Runno (`https://runno.dev/langs/`). On télécharge le binaire,
 * on monte le dépôt dans son système de fichiers virtuel, puis on le
 * lance. C'est le même chemin pour du C (qui se compile en deux temps :
 * `clang` puis `wasm-ld`) que pour du Ruby ou du PHP (un seul binaire).
 *
 * Aucune requête ne part vers DevNet : tout l'échange est entre le
 * navigateur et le CDN public de Runno.
 */

/**
 * Le paquet qui sait faire tourner du WASI.
 *
 * `@runno/wasi` est sans dépendance et sans accès au DOM : il s'importe
 * donc dans un worker, contrairement à `@runno/runtime` (qui enregistre
 * des éléments personnalisés au chargement). On le prend au CDN, comme
 * Pyodide, pour ne rien embarquer dans le paquet de l'application.
 */
export const WASI_MODULE_URL = "https://cdn.jsdelivr.net/npm/@runno/wasi@0.10.0/+esm";

/** Le socle des binaires et des systèmes de fichiers. */
export const WASI_BASE_URL = "https://runno.dev/langs/";

/** Un fichier du système de fichiers virtuel WASI. */
export interface WasiFile {
  path: string;
  timestamps: { access: Date; modification: Date; change: Date };
  mode: "string" | "binary";
  content: string | Uint8Array;
}

/** Une étape d'exécution (compilation ou lancement). */
export interface WasiCommand {
  /** URL du binaire, ou chemin d'un fichier déjà compilé. */
  url?: string;
  fsPath?: string;
  args: string[];
  env?: Record<string, string>;
  /** Archive `.tar.gz` à décompresser avant l'étape. */
  baseFs?: string;
  /** L'entrée standard est le code lui-même (SQLite). */
  stdinFromCode?: boolean;
}

export interface WasiCommands {
  prepare: WasiCommand[];
  run: WasiCommand;
}

/**
 * Le code des helpers — identique pour le fil principal et le worker.
 *
 * Aucun gabarit inversé (`String.raw` porte déjà ce texte) et aucune
 * interpolation, pour ne pas interférer avec la chaîne qui l'englobe.
 * Aucun de ces helpers ne référence un symbole du module : ils
 * n'utilisent que des globales (`TextDecoder`, `fetch`, `Response`,
 * `Blob`, `DecompressionStream`, `WebAssembly`).
 */
export const WASI_SOURCE = String.raw`
const WASI_BASE = ${JSON.stringify(WASI_BASE_URL)};

/**
 * Les chemins d'inclusion que clang doit chercher.
 *
 * Le mode -cc1 ne cherche pas les include relatifs a cote du fichier
 * source : il ne trouve que les chemins absolus du sysroot. Sans -I,
 * un include relatif echoue meme si le fichier est bien monte — et,
 * surtout, les fichiers d'un projet sont repartis dans des sous-dossiers.
 * On donne donc a clang chaque repertoire present dans le projet, plus la
 * racine.
 */
function wasiIncludeArgs(files) {
  var dirs = { "/": true };
  var list = files || {};
  for (var raw in list) {
    if (!Object.prototype.hasOwnProperty.call(list, raw)) continue;
    var path = String(raw).replace(/\\/g, "/");
    var slash = path.lastIndexOf("/");
    if (slash > 0) dirs["/" + path.slice(0, slash).replace(/^\/*/, "")] = true;
  }
  var out = [];
  for (var dir in dirs) {
    if (Object.prototype.hasOwnProperty.call(dirs, dir)) out.push("-I" + dir);
  }
  return out;
}

/** Les commandes d'un langage, copiées de Runno (voir son dépôt). */
function wasiCommands(runtime, entry, files) {
  if (runtime === "quickjs") {
    return {
      prepare: [],
      run: { url: WASI_BASE + "wasmedge_quickjs.wasm", args: ["quickjs", entry], env: {} },
    };
  }
  if (runtime === "sqlite") {
    return {
      prepare: [],
      run: { url: WASI_BASE + "sqlite.wasm", args: ["sqlite"], env: {}, stdinFromCode: true },
    };
  }
  if (runtime === "ruby") {
    return {
      prepare: [],
      run: {
        url: WASI_BASE + "ruby-3.2.0.wasm",
        args: ["ruby", "-r", "/ruby-3.2.0/.rubyopts.rb", entry],
        env: {},
        baseFs: WASI_BASE + "ruby-3.2.0.tar.gz",
      },
    };
  }
  if (runtime === "php-cgi") {
    return {
      prepare: [],
      run: {
        url: WASI_BASE + "php-cgi-8.2.0.wasm",
        args: ["php", entry],
        env: {
          REDIRECT_STATUS: "1",
          REQUEST_METHOD: "GET",
          SCRIPT_FILENAME: entry,
          PATH_TRANSLATED: entry,
          GATEWAY_INTERFACE: "CGI/1.1",
        },
      },
    };
  }
  if (runtime === "clang" || runtime === "clangpp") {
    var cxx = runtime === "clangpp";
    var compileArgs = [
      "-cc1", "-Werror", "-emit-obj", "-disable-free",
      "-isysroot", "/sys",
      "-internal-isystem", cxx ? "/sys/include/c++/v1" : "/sys/include",
      "-internal-isystem", "/sys/include",
      "-internal-isystem", "/sys/lib/clang/8.0.1/include",
      "-ferror-limit", "4", "-fmessage-length", "80", "-fcolor-diagnostics",
      "-O2", "-o", "/program.o",
    ];
    if (!cxx) {
      compileArgs = [
        "-cc1", "-Werror", "-triple", "wasm32-unknown-wasi",
        "-isysroot", "/sys",
        "-internal-isystem", "/sys/include",
        "-internal-isystem", "/sys/lib/clang/8.0.1/include",
        "-ferror-limit", "4", "-fmessage-length", "80", "-fcolor-diagnostics",
        "-O2", "-emit-obj", "-o", "/program.o",
      ];
    } else {
      compileArgs.push("-x", "c++");
    }
    compileArgs = compileArgs.concat(wasiIncludeArgs(files));
    compileArgs.push(entry);
    var linkArgs = [
      "--no-threads", "--export-dynamic", "-z", "stack-size=1048576",
      "-L/sys/lib/wasm32-wasi", "/sys/lib/wasm32-wasi/crt1.o", "/program.o",
      "-lc",
    ];
    if (cxx) linkArgs.push("-lc++", "-lc++abi");
    linkArgs.push("-o", "/program.wasm");
    return {
      prepare: [
        {
          url: WASI_BASE + "clang.wasm",
          args: ["clang"].concat(compileArgs),
          env: {},
          baseFs: WASI_BASE + "clang-fs.tar.gz",
        },
        { url: WASI_BASE + "wasm-ld.wasm", args: ["wasm-ld"].concat(linkArgs), env: {} },
      ],
      run: { fsPath: "/program.wasm", args: ["program"], env: {} },
    };
  }
  throw new Error("Moteur WASI inconnu : « " + runtime + " ».");
}

/** Un horodatage unique, réutilisé pour les fichiers créés. */
function wasiStamp() {
  var now = new Date();
  return { access: now, modification: now, change: now };
}

/** Un fichier texte du dépôt, prêt pour le montage. */
function wasiTextFile(path, content) {
  return { path: path, timestamps: wasiStamp(), mode: "string", content: content };
}

/**
 * Le dépôt monté dans un système de fichiers WASI.
 *
 * Les clés sont normalisées en chemins absolus : un binaire WASI voit
 * /main.rb, jamais main.rb. Sans la barre oblique, un require ou un
 * #include relatif échoue alors que le fichier est bien là.
 */
function wasiFilesystem(files) {
  var fs = {};
  var list = files || {};
  for (var raw in list) {
    if (!Object.prototype.hasOwnProperty.call(list, raw)) continue;
    var path = String(raw).replace(/\\/g, "/");
    if (path.charAt(0) !== "/") path = "/" + path;
    fs[path] = wasiTextFile(path, list[raw]);
  }
  return fs;
}

/** Fusionne deux systèmes de fichiers, le second l'emportant. */
function wasiMerge(base, extra) {
  var out = {};
  var key;
  for (key in base) if (Object.prototype.hasOwnProperty.call(base, key)) out[key] = base[key];
  for (key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) out[key] = extra[key];
  return out;
}

/**
 * Le fichier d'entrée à lancer pour « exécuter le projet ».
 *
 * On préfère main.<ext> ; puis index.<ext> ; sinon le premier fichier
 * portant l'extension du langage, par ordre alphabétique. Renvoie le nom
 * souhaité si rien ne correspond : le worker montera alors un fichier
 * inexistant, et l'erreur dira que le point d'entrée est introuvable — une
 * erreur qui parle vaut mieux qu'un silence.
 */
function wasiDefaultEntry(files, entry) {
  var list = files || {};
  if (Object.prototype.hasOwnProperty.call(list, entry)) return entry;
  var dot = entry.lastIndexOf(".");
  if (dot === -1) return entry;
  var suffix = entry.slice(dot);
  var index = "index" + suffix;
  if (Object.prototype.hasOwnProperty.call(list, index)) return index;
  var names = Object.keys(list).sort();
  for (var i = 0; i < names.length; i += 1) {
    var name = names[i];
    if (name.slice(-suffix.length) === suffix) return name;
  }
  return entry;
}

/**
 * Un tampon de sortie qui n'ajoute **rien**.
 *
 * Le writer générique (voir engine.ts) ajoute un saut de ligne à chaque
 * appel : parfait pour console.log, faux pour un binaire WASI qui écrit
 * par morceaux (un en-tête CGI, une invite sans retour). Ici on colle le
 * texte tel quel.
 */
function wasiAppend(buffer, text, maxOutput) {
  if (buffer.truncated) return buffer;
  var next = buffer.text + text;
  if (next.length > maxOutput) {
    return { text: next.slice(0, maxOutput), truncated: true };
  }
  return { text: next, truncated: false };
}

/** Télécharge un binaire WASM et le présente avec le bon type MIME. */
async function wasiFetchWasm(url) {
  var res = await fetch(url);
  if (!res.ok) {
    throw new Error("Téléchargement impossible : " + url + " (" + res.status + ").");
  }
  var bytes = await res.arrayBuffer();
  // instantiateStreaming refuse un flux qui n'est pas application/wasm :
  // certains CDN servent pourtant le binaire en text/html. On re-emballe.
  return new Response(bytes, { headers: { "content-type": "application/wasm" } });
}

/** Le même emballage, pour un programme déjà compilé dans le FS. */
function wasiBytesResponse(bytes) {
  return new Response(bytes, { headers: { "content-type": "application/wasm" } });
}

/** Télécharge, décompresse et monte le système de fichiers de base. */
async function wasiFetchBaseFs(url) {
  var res = await fetch(url);
  if (!res.ok) {
    throw new Error("Système de fichiers de base introuvable : " + url + ".");
  }
  var gz = new Uint8Array(await res.arrayBuffer());
  var stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
  var tar = new Uint8Array(await new Response(stream).arrayBuffer());
  return wasiParseTar(tar);
}

/**
 * Extrait une archive tar (non compressée) en système de fichiers WASI.
 *
 * Format tar POSIX : des blocs de 512 octets, un en-tête puis les données
 * arrondies à 512. On ne lit que les fichiers réguliers (typeflag 0) ;
 * dossiers et liens sont ignorés, un système de fichiers de fichiers fait
 * l'affaire pour nos runtimes. Les noms prefix + name sont recollés.
 */
function wasiParseTar(bytes) {
  var fs = {};
  var decoder = new TextDecoder();
  var offset = 0;
  function readString(start, length) {
    var end = start;
    var limit = start + length;
    while (end < limit && bytes[end] !== 0) end += 1;
    return decoder.decode(bytes.subarray(start, end));
  }
  while (offset + 512 <= bytes.length) {
    var name = readString(offset, 100);
    if (name === "") break;
    var sizeField = readString(offset + 124, 12).trim();
    var size = sizeField === "" ? 0 : parseInt(sizeField, 8);
    var typeFlag = String.fromCharCode(bytes[offset + 156]);
    var prefix = readString(offset + 345, 155);
    var dataStart = offset + 512;
    if (typeFlag === "0" || typeFlag === "\0" || typeFlag === "") {
      var full = prefix ? prefix + "/" + name : name;
      var path = full.charAt(0) === "/" ? full : "/" + full;
      fs[path] = {
        path: path,
        timestamps: wasiStamp(),
        mode: "binary",
        content: new Uint8Array(bytes.subarray(dataStart, dataStart + size)),
      };
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return fs;
}

/**
 * Les lignes offertes à l'entrée standard.
 *
 * SQL n'a pas de fichier d'entrée lu par le binaire : son programme
 * **est** l'entrée standard. Les autres langages reçoivent la saisie du
 * formulaire. Chaque ligne est terminée par un saut, comme un vrai
 * terminal ; l'épuisement renvoie null, c'est-à-dire une fin de flux.
 */
function wasiStdin(request, run) {
  var lines;
  if (run.stdinFromCode) {
    lines = String(request.code || "").replace(/\r\n?/g, "\n").split("\n");
  } else {
    lines = String(request.stdin || "").replace(/\r\n?/g, "\n").split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    if (lines.length === 1 && lines[0] === "") lines.length = 0;
  }
  var index = 0;
  return function () {
    if (index >= lines.length) return null;
    var line = lines[index];
    index += 1;
    return line + "\n";
  };
}

/**
 * Exécute un langage WASI : compilation éventuelle, puis lancement.
 *
 * mod est le module @runno/wasi déjà importé ; le passer en paramètre
 * garde cette fonction testable hors du worker (voir le test live).
 * emit reçoit la sortie brute ; ready est appelé quand le moteur est
 * chargé, pour distinguer le téléchargement du temps d'exécution.
 */
async function wasiRun(mod, request, emit, ready) {
  // Le binaire voit un système de fichiers absolu : l'entrée doit l'être
  // aussi, sinon un chemin relatif dépend du répertoire courant du guest.
  var entry = String(request.entry || "");
  if (entry && entry.charAt(0) !== "/") entry = "/" + entry;
  var spec = wasiCommands(request.runtime, entry, request.files);
  var fs = wasiFilesystem(request.files);
  var prepare = spec.prepare || [];

  for (var i = 0; i < prepare.length; i += 1) {
    var step = prepare[i];
    if (step.baseFs) fs = wasiMerge(fs, await wasiFetchBaseFs(step.baseFs));
    var compiled = await mod.WASI.start(await wasiFetchWasm(step.url), {
      args: step.args,
      env: step.env || {},
      fs: fs,
      stdout: emit,
      stderr: emit,
    });
    fs = wasiMerge(fs, compiled.fs);
    if (compiled.exitCode !== 0) {
      throw new Error("La compilation a échoué (code " + compiled.exitCode + ").");
    }
  }

  var run = spec.run;
  if (run.baseFs) fs = wasiMerge(fs, await wasiFetchBaseFs(run.baseFs));

  var source;
  if (run.fsPath) {
    var program = fs[run.fsPath];
    if (!program) throw new Error("Le programme compilé est introuvable.");
    source = wasiBytesResponse(program.content);
  } else {
    source = await wasiFetchWasm(run.url);
  }

  // Le moteur est chargé : à partir d'ici, c'est le programme qui est
  // chronométré, pas le téléchargement. On prévient **après** avoir tiré
  // le binaire — un .wasm de plusieurs mégaoctets a le droit à plus que
  // les dix secondes d'exécution.
  if (ready) ready();

  return mod.WASI.start(source, {
    args: run.args,
    env: run.env || {},
    fs: fs,
    stdout: emit,
    stderr: emit,
    stdin: wasiStdin(request, run),
  });
}
`;

/** La forme des helpers purs, pour typer ce que `new Function` renvoie. */
type WasiHelpers = {
  wasiParseTar: (bytes: Uint8Array) => Record<string, WasiFile>;
  wasiFilesystem: (files: Record<string, string>) => Record<string, WasiFile>;
  wasiCommands: (runtime: string, entry: string, files?: Record<string, string>) => {
    prepare: WasiCommand[];
    run: WasiCommand;
  };
  wasiIncludeArgs: (files?: Record<string, string>) => string[];
  wasiDefaultEntry: (files: Record<string, string>, entry: string) => string;
  wasiAppend: (
    buffer: { text: string; truncated: boolean },
    text: string,
    maxOutput: number,
  ) => { text: string; truncated: boolean };
  /** Non exporté par défaut : le worker l'obtient par sa chaîne. */
  wasiRun: (
    mod: { WASI: { start: (src: unknown, ctx: Record<string, unknown>) => Promise<{ exitCode: number }> } },
    request: WasiRunRequest,
    emit: (text: string) => void,
    ready?: () => void,
  ) => Promise<{ exitCode: number }>;
};

/** Ce que `wasiRun` attend du worker. */
export interface WasiRunRequest {
  runtime: string;
  entry: string;
  files: Record<string, string>;
  code?: string;
  stdin?: string;
  maxOutput?: number;
}

function evaluateWasi(): WasiHelpers {
  return new Function(
    WASI_SOURCE +
      "\nreturn { wasiParseTar, wasiFilesystem, wasiCommands, wasiIncludeArgs, " +
      "wasiDefaultEntry, wasiAppend, wasiRun };",
  )() as WasiHelpers;
}

const helpers = evaluateWasi();

export const wasiParseTar = helpers.wasiParseTar;
export const wasiFilesystem = helpers.wasiFilesystem;
export const wasiCommands = helpers.wasiCommands;
export const wasiIncludeArgs = helpers.wasiIncludeArgs;
export const wasiDefaultEntry = helpers.wasiDefaultEntry;
export const wasiAppend = helpers.wasiAppend;
/** Exporté pour les tests d'intégration ; le worker utilise sa copie. */
export const wasiRun = helpers.wasiRun;
