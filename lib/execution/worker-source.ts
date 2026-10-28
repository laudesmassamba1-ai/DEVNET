import { ENGINE_SOURCE } from "./engine";
import { WASI_MODULE_URL, WASI_SOURCE } from "./wasi";

/**
 * Le worker d'exécution, construit à partir d'une chaîne.
 *
 * ## Pourquoi une chaîne, et non un import
 *
 * Un worker ne partage pas la portée du fil principal : il doit
 * recevoir son code. Le reflexe serait d'écrire `new Worker(new URL(…))`,
 * ou de recopier les helpers par `fonction.toString()`. Les deux se
 * cassent au build : `URL` n'est pas résolu partout, et les compilateurs
 * renomment les fonctions et injectent des appels internes (`__name(…)`)
 * qui n'existent pas dans le worker.
 *
 * Le noyau (`ENGINE_SOURCE`, voir `engine.ts`) est donc écrit **une
 * fois**, en JavaScript autonome, et collé ici. Le fil principal l'évalue
 * pour ses propres fonctions : les deux côtés ne peuvent pas diverger,
 * puisqu'il n'y a qu'un texte.
 *
 * ## Ce que le worker reçoit
 *
 * Un unique message `{ type: "run", engine, code, path, files,
 * pythonSetup, maxOutput }`, et il répond soit `{ type: "ready" }` quand
 * le moteur est chargé — pour distinguer le temps de téléchargement du
 * temps d'exécution — soit le résultat final.
 */

/** Version de Pyodide, épinglée : jamais « la dernière ». */
const PYODIDE_VERSION = "0.26.4";

export function buildWorkerSource(): string {
  return `${ENGINE_SOURCE}
${WASI_SOURCE}
const PYODIDE_VERSION = ${JSON.stringify(PYODIDE_VERSION)};
const WASI_MODULE_URL = ${JSON.stringify(WASI_MODULE_URL)};

/**
 * Pyodide, chargé à la demande et une seule fois.
 *
 * Le premier appel télécharge plusieurs mégaoctets ; les suivants
 * réutilisent la même promesse. En cas d'échec, la promesse est oubliée
 * pour qu'un réseau revenu permette de réessayer.
 */
let pyodideLoading = null;

function loadPyodide(onOutput) {
  if (pyodideLoading === null) {
    pyodideLoading = import(
      "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/pyodide.mjs"
    )
      .then((mod) =>
        mod.loadPyodide({ stdout: onOutput, stderr: onOutput }),
      )
      .catch((cause) => {
        pyodideLoading = null;
        throw cause;
      });
  }
  return pyodideLoading;
}

self.onmessage = async (event) => {
  const request = event.data;
  if (!request || request.type !== "run") return;

  // eslint-disable-next-line no-unused-vars

  const started = Date.now();
  let buffer = createBuffer();

  const write = (line) => {
    buffer = appendOutput(buffer, String(line), request.maxOutput);
  };

  const sink = {
    log: write,
    warn: write,
    error: write,
  };

  const finish = (error) => {
    self.postMessage({
      output: buffer.text,
      truncated: buffer.truncated,
      error: error,
      ok: error === null,
      durationMs: Date.now() - started,
    });
  };

  try {
    if (request.engine === "pyodide") {
      const pyodide = await loadPyodide(write);
      // Le projet entier est monté avant l'exécution : un fichier peut
      // ainsi importer un voisin, comme dans un vrai dépôt.
      if (request.pythonSetup) pyodide.runPython(request.pythonSetup);
      // À partir d'ici, c'est le code qui est chronométré, pas le réseau.
      self.postMessage({ type: "ready" });
      pyodide.runPython(request.code);
    } else if (request.engine === "wasi") {
      // Le paquet WASI est sans dependance et sans DOM : il s'importe au
      // CDN, comme Pyodide. Le binaire du langage lui-meme est tire par
      // wasiRun, qui signale « pret » une fois le moteur en place.
      const wasiModule = await import(WASI_MODULE_URL);
      const wasiWrite = (text) => {
        buffer = wasiAppend(buffer, String(text), request.maxOutput);
      };
      await wasiRun(wasiModule, request, wasiWrite, () =>
        self.postMessage({ type: "ready" }),
      );
    } else if (request.files) {
      self.postMessage({ type: "ready" });
      runModules(request.path, request.files, sink);
    } else {
      self.postMessage({ type: "ready" });
      runSource(request.code, sink);
    }
    finish(null);
  } catch (cause) {
    finish(normaliseError(cause));
  }
};
`;
}

/**
 * Crée le worker.
 *
 * Le `Blob` transforme la source en une URL que le navigateur peut
 * charger dans un contexte isolé. Aucun `import` de ce module ne traverse
 * la frontière : le worker ne reçoit que du texte, et c'est exactement ce
 * qui garantit qu'il ne peut pas toucher à la page.
 */
export function createWorker(): Worker {
  const blob = new Blob([buildWorkerSource()], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  return worker;
}
