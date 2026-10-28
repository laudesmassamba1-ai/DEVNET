"use client";

import { useEffect, useRef, useState } from "react";
import { CodeEditor } from "@/components/CodeEditor";
import { RunOutput } from "@/components/RunOutput";
import { Icon } from "@/components/Icon";
import { IDLE, runFile, type RunOutcome } from "@/lib/execution/runner";

/**
 * Exécuter du code sans créer de compte (fonctionnalité 1).
 *
 * Le cœur de la promesse tient ici : un visiteur écrit quelques lignes et
 * les fait tourner, tout de suite. Aucune inscription, aucun serveur —
 * le moteur se télécharge dans le navigateur et le code s'exécute chez
 * celui qui regarde.
 *
 * On ne propose qu'**un** langage, Python : c'est celui du premier pas,
 * et un choix unique évite de transformer la démonstration en menu.
 */

const DEFAULT_CODE = `# Bienvenue sur DevNet.
# Écris du Python, exécute-le — sans compte, sans serveur.
villes = ["Abidjan", "Dakar", "Lagos", "Nairobi"]

for i, ville in enumerate(villes, start=1):
    print(f"{i}. {ville}")

print("Total :", len(villes), "villes")
`;

export function AnonymousRunner() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [run, setRun] = useState<RunOutcome>(IDLE);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const status = run.status;

  /* L'écran suit la sortie. Ici la page entière défile : sur un
     téléphone, l'éditeur est haut et le résultat naît sous la ligne de
     flottaison — on croit que rien ne s'est passé. `scrollIntoView` amène
     le regard dès que l'exécution démarre, et de nouveau à son terme. */
  useEffect(() => {
    if (status === "idle") return;
    const el = outputRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() =>
      el.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
    return () => cancelAnimationFrame(id);
  }, [status]);

  async function execute() {
    if (busy) return;
    const ctrl = new AbortController();
    controller.current = ctrl;
    setBusy(true);
    try {
      await runFile("essai.py", code, setRun, { "essai.py": code }, "", ctrl.signal);
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }

  return (
    <div>
      <CodeEditor
        path="essai.py"
        value={code}
        onChange={setCode}
        onRun={() => void execute()}
        rows={12}
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void execute()}
          disabled={busy}
          className="mo-press inline-flex h-[var(--h-input)] items-center gap-2 rounded-[var(--radius-input)]
            border border-signal bg-signal px-4 text-[13px] font-bold text-void
            disabled:opacity-50"
        >
          <Icon name="play" size={14} strokeWidth={2.4} />
          {busy ? "Exécution…" : "Exécuter"}
        </button>
        <span className="font-mono text-[11px] text-chalk-4">
          rien n&apos;est envoyé sur un serveur
        </span>
      </div>

      <div ref={outputRef}>
        <RunOutput outcome={run} />
      </div>
    </div>
  );
}
