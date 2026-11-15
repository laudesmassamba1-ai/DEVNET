import {
  LIMITS,
  runtimeForPath,
  type RuntimeSpec,
} from "./runtime";
import { pythonBootstrap, pythonStdin, type FileMap } from "./engine";
import { projectNeedsTranspile, transpileForRun } from "./typescript";
import { createWorker } from "./worker-source";

/**
 * L'exécution, côté interface.
 *
 * `lib/execution/runtime.ts` décrit **quels** moteurs existent et ce
 * qu'ils coûtent ; ce module décrit **comment on les utilise** : un
 * worker, une minuterie, un état, une sortie.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne juge pas le code, et il ne corrige pas les erreurs : une
 * trace Python est affichée telle quelle, préfixe d'implémentation
 * retiré par le worker. Un exécuteur qui réécrirait le message d'erreur
 * pour qu'il soit plus joli produirait des messages qui ne
 * correspondent à rien de vérifiable.
 *
 * ## Pourquoi le timeout est une promesse tenue
 *
 * `LIMITS.timeoutMs` n'est pas un `setTimeout` décoratif : à son
 * échéance, le worker est **terminé**. C'est la seule façon d'interrompre
 * du code arbitraire dans un navigateur, et c'est pourquoi l'exécution se
 * fait dans un worker et non dans la page (voir `worker.ts`).
 */

/**
 * Le temps accordé au **chargement du moteur**, distinct du temps
 * d'exécution. Pyodide pèse plusieurs mégaoctets : le premier lancement
 * sur une connexion lente peut dépasser `LIMITS.timeoutMs`. Sans cette
 * garde séparée, on accuserait le code d'être en boucle alors qu'il n'a
 * pas encore commencé.
 */
const STARTUP_TIMEOUT_MS = 60_000;

/** Ce que voit l'écran. */
export type RunStatus =
  /** Rien à exécuter. */
  | "idle"
  /** Pyodide se télécharge : plusieurs mégaoctets, une fois. */
  | "loading"
  /** Le code tourne. */
  | "running"
  /** Terminé, avec ou sans erreur. */
  | "done"
  /** Arrêté par la personne, pas par une erreur ni par le délai. */
  | "stopped";

export interface RunOutcome {
  status: RunStatus;
  /** Sortie accumulée. */
  output: string;
  /** Message d'erreur, ou `null`. */
  error: string | null;
  /** Le moteur a-t-il abouti ? */
  ok: boolean;
  durationMs: number;
  /** La sortie a-t-elle été coupée ? */
  truncated: boolean;
  /** Le moteur réellement utilisé. */
  engine: RuntimeSpec["id"] | "aucun";
}

/** L'état de départ, exporté pour ne pas le réécrire dans chaque écran. */
export const IDLE: RunOutcome = {
  status: "idle",
  output: "",
  error: null,
  ok: false,
  durationMs: 0,
  truncated: false,
  engine: "aucun",
};

/** Ce que le worker renvoie. */
interface WorkerOutcome {
  output: string;
  truncated: boolean;
  error: string | null;
  ok: boolean;
  durationMs: number;
}

/**
 * Pourquoi on ne peut pas exécuter ce fichier.
 *
 * On répond précisément plutôt que de dire « non » : un bouton grisé
 * qui explique est utilisable, un bouton absent est agaçant.
 */
export function refusalReason(path: string): string | null {
  if (runtimeForPath(path) !== null) return null;

  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1) : path;
  return (
    `Aucun moteur pour « .${extension} ». ` +
    "Python, JavaScript et TypeScript s'exécutent ; le reste se lit mais ne s'exécute pas."
  );
}

/** Un refus n'est pas une erreur : rien n'a été tenté. */
export const REFUSED: RunOutcome = { ...IDLE, status: "idle", error: null };

/**
 * Exécute le contenu d'un fichier.
 *
 * Renvoie l'issue par `onChange` **et** par valeur rendue : l'écran
 * affiche un état de chargement puis le résultat, donc il a besoin des
 * deux — mais `await` reste possible pour un test ou un usage script.
 *
 * `files` est l'ensemble du dépôt (chemin → contenu). Il est
 * indispensable pour qu'un fichier puisse appeler un autre fichier du
 * projet : Python reçoit le tout monté dans son système de fichiers,
 * JavaScript dispose d'un chargeur `require` relatif. Sans lui, on
 * exécute le fichier comme s'il était seul au monde — c'était le bug.
 */
export async function runFile(
  path: string,
  code: string,
  onChange: (outcome: RunOutcome) => void,
  files?: FileMap,
  stdin?: string,
  /**
   * Interrompt l'exécution. À l'`abort`, le worker est **terminé** — pas
   * seulement ignoré : une boucle infinie continuerait sinon de tourner
   * dans le navigateur, consommant un cœur pour rien. C'est le même
   * mécanisme que le délai, déclenché par une personne au lieu d'une
   * horloge.
   */
  signal?: AbortSignal,
): Promise<RunOutcome> {
  const spec = runtimeForPath(path);

  if (spec === null) {
    const outcome: RunOutcome = { ...IDLE, error: refusalReason(path) };
    onChange(outcome);
    return outcome;
  }

  // Le TypeScript ne s'exécute pas tel quel : `const x: string = …` est
  // une erreur de syntaxe pour le navigateur. On le **compile** avec le
  // vrai compilateur TypeScript, embarqué et chargé à la demande, plutôt
  // que de retirer les annotations à l'aveugle — une suppression naïve
  // produit du code qui *paraît* tourner puis se trompe. On compile
  // **tout le projet** : un fichier TS peut importer un voisin TS.
  let runCode = code;
  let runFiles = files;

  if (spec.id === "sandpack" && projectNeedsTranspile(path, files)) {
    // Le compilateur pèse plusieurs mégaoctets : on l'annonce, comme
    // Pyodide, sinon l'écran resterait figé sans explication.
    onChange({ ...IDLE, status: "loading", engine: spec.id });
    try {
      const transpiled = await transpileForRun(path, code, files);
      runCode = transpiled.code;
      runFiles = transpiled.files;
    } catch (cause: unknown) {
      const outcome: RunOutcome = {
        ...IDLE,
        engine: spec.id,
        error:
          "La compilation TypeScript a échoué : " +
          (cause instanceof Error ? cause.message : String(cause)),
      };
      onChange(outcome);
      return outcome;
    }
  }

  // Pyodide et les binaires WASI se téléchargent : on l'annonce, sinon
  // l'écran serait figé sur un bouton pressé pendant plusieurs secondes
  // sans explication.
  const downloads = spec.id === "pyodide" || spec.id === "wasi";
  onChange({ ...IDLE, status: downloads ? "loading" : "running", engine: spec.id });

  if (typeof window === "undefined" || typeof Worker === "undefined") {
    const outcome: RunOutcome = {
      ...IDLE,
      engine: spec.id,
      error: "L'exécution n'est disponible que dans un navigateur.",
    };
    onChange(outcome);
    return outcome;
  }

  let worker: Worker;
  try {
    worker = createWorker();
  } catch (cause: unknown) {
    const outcome: RunOutcome = {
      ...IDLE,
      engine: spec.id,
      error: `Worker indisponible : ${cause instanceof Error ? cause.message : String(cause)}`,
    };
    onChange(outcome);
    return outcome;
  }

  return new Promise<RunOutcome>((resolve) => {
    let settled = false;
    let timer = 0;

    /** Une seule issue, quel que soit le chemin qui y mène. */
    const finish = (outcome: RunOutcome) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      onChange(outcome);
      resolve(outcome);
    };

    /** L'arrêt vient de la personne : ni erreur, ni délai dépassé. */
    const onAbort = () =>
      finish({ ...IDLE, engine: spec.id, status: "stopped", error: null });

    if (signal) {
      // Le signal peut être déjà rompu (double clic sur « arrêter » avant
      // que la promesse ne soit posée) : dans ce cas le worker n'a même pas
      // besoin de démarrer.
      if (signal.aborted) {
        finish({ ...IDLE, engine: spec.id, status: "stopped", error: null });
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    // Garde de **démarrage** : le moteur se télécharge. On accorde plus
    // de temps qu'à l'exécution, et on la remplace par le vrai délai dès
    // que le worker annonce qu'il est prêt à faire tourner le code.
    timer = window.setTimeout(() => {
      finish({
        ...IDLE,
        engine: spec.id,
        status: "done",
        error:
          "Le moteur n'a pas fini de se charger. " +
          "Vérifiez la connexion, puis relancez l'exécution.",
      });
    }, STARTUP_TIMEOUT_MS);

    worker.onmessage = (
      event: MessageEvent<WorkerOutcome | { type: "ready" }>,
    ) => {
      // Le moteur est chargé : à partir d'ici, c'est le code qui est
      // chronométré, pas le réseau.
      if ("type" in event.data && event.data.type === "ready") {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          finish({
            ...IDLE,
            engine: spec.id,
            status: "done",
            error:
              `Arrêté après ${Math.round(LIMITS.timeoutMs / 1000)} s. ` +
              "Sur une machine lente, ou si le code boucle sans rien afficher.",
          });
        }, LIMITS.timeoutMs);
        return;
      }

      // Ici, c'est forcément une issue : le signal « prêt » est reparti
      // plus haut.
      const result = event.data as WorkerOutcome;
      finish({
        status: "done",
        output: result.output,
        error: result.error,
        ok: result.ok,
        durationMs: result.durationMs,
        truncated: result.truncated,
        engine: spec.id,
      });
    };

    // Un worker qui meurt sur une erreur de chargement (CDN injoignable,
    // réseau coupé) ne renvoie rien : sans `onerror`, l'exécution
    // resterait « en cours » jusqu'au timeout, en mentant sur la cause.
    worker.onerror = (event) => {
      finish({
        ...IDLE,
        status: "done",
        engine: spec.id,
        error:
          `Le moteur n'a pas démarré${event.message ? ` : ${event.message}` : ""}. ` +
          `${spec.label} a besoin d'un moteur téléchargé depuis Internet — ` +
          "hors ligne, il ne peut pas s'exécuter.",
      });
    };

    // Le fichier exécuté est celui qu'on voit : on l'emporte sur sa
    // version enregistrée dans le projet transmis au moteur.
    const project: FileMap | undefined = runFiles
      ? { ...runFiles, [path]: runCode }
      : undefined;

    // Python reçoit, avant le code : d'abord l'entrée standard fournie,
    // puis le montage du dépôt. Les deux sont du Python, donc le worker
    // n'a qu'un seul préambule à exécuter.
    const pythonSetup =
      spec.id === "pyodide"
        ? [pythonStdin(stdin), project ? pythonBootstrap(project) : ""]
            .filter((part) => part.length > 0)
            .join("\n")
        : undefined;

    worker.postMessage({
      type: "run",
      code: runCode,
      path,
      // WASI a besoin de deux choses que Pyodide n'a pas : le programme
      // Runno à lancer (`runtime`) et le fichier d'entrée à compiler ou
      // interpréter (`entry`). On les transmet toujours ; les autres
      // moteurs les ignorent.
      runtime: spec.wasi,
      entry: path,
      files: project,
      pythonSetup: pythonSetup || undefined,
      stdin,
      engine: spec.id,
      maxOutput: LIMITS.maxOutput,
    });
  });
}