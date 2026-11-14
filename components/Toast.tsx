"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { waitForExit } from "./Motion";

type ToastKind = "ok" | "err";

const ToastContext = createContext<(msg: string, kind?: ToastKind) => void>(
  () => {},
);

export function useToast() {
  return useContext(ToastContext);
}

/** Durée pendant laquelle un toast reste affiché. */
const TOAST_MS = 3000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: ToastKind }[]>([]);

  /**
   * Les toasts qui jouent leur sortie.
   *
   * Ils restent **montés** le temps de l'animation : à l'instant où React
   * retire l'élément, il n'est plus dans le document, et une animation
   * sur un élément absent ne se voit pas. C'est tout ce que cette liste
   * permet — marquer qui part, plutôt que retirer.
   */
  const [leaving, setLeaving] = useState<Set<number>>(new Set());

  /**
   * Fait sortir un toast, puis l'enlève.
   *
   * Le retrait est **différé** de la durée de l'animation de sortie,
   * lue dans le jeton CSS — donc il suit `--d-fast` s'il change. Sans
   * ce délai, le message s'évaporerait et l'animation de sortie ne
   * serait jamais jouée.
   */
  const dismiss = useCallback(async (id: number) => {
    setLeaving((prev) => new Set(prev).add(id));
    await waitForExit();
    setItems((prev) => prev.filter((t) => t.id !== id));
    setLeaving((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const push = useCallback(
    (msg: string, kind: ToastKind = "ok") => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, msg, kind }]);
      setTimeout(() => void dismiss(id), TOAST_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[9999] flex flex-col items-center gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            // Le bandeau de mode démonstration porte lui aussi
            // `role="status"` : sans ce crochet, un test qui cherche « le
            // toast » trouve le bandeau et conclut qu'aucune confirmation
            // n'a été affichée — un échec inventé par le sélecteur.
            data-toast={t.kind}
            className={`depth-panel pointer-events-auto whitespace-nowrap rounded-(--radius-input) border
              border-line-3 bg-surface px-4 py-2 text-sm font-bold tracking-wide text-chalk
              ${t.kind === "err" ? "border-danger" : "border-ok"}
              ${leaving.has(t.id)
                ? "mo-exit"
                // Une erreur entre **en secouant**, sans fondu : elle est
                // déjà là quand on la voit. Une confirmation, elle, glisse
                // depuis le haut — elle arrive, elle n'interrompt pas.
                : t.kind === "err"
                  ? "mo-deny"
                  : "mo-msg-in"}`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}