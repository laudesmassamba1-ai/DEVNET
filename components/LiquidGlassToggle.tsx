"use client";

import { useEffect, useState } from "react";
import { applyLiquidGlass, LIQUID_GLASS_KEY, normalizeLiquidGlass } from "@/lib/ui-preferences";

/**
 * Interrupteur du thème « Verre liquide ». Le thème lui-même vit dans
 * globals.css (`:root[data-liquid="true"]`) ; ce composant ne fait que
 * poser l'attribut et le mémoriser sur cet appareil.
 */
export function LiquidGlassToggle() {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preference is read after hydration
      setEnabled(normalizeLiquidGlass(localStorage.getItem(LIQUID_GLASS_KEY)));
    } catch {
      // Stockage indisponible : l'interrupteur reste sur « Désactivé ».
    }
  }, []);

  function choose(next: boolean) {
    setEnabled(next);
    const saved = applyLiquidGlass(next);
    setMessage(
      saved
        ? next ? "Verre liquide activé sur cet appareil." : "Verre liquide désactivé sur cet appareil."
        : "Préférence active pour cette session ; le stockage local est bloqué.",
    );
  }

  return (
    <fieldset className="mt-5 border-t border-line-2 pt-4">
      <legend className="text-13 font-semibold text-chalk">Verre liquide</legend>
      <p className="mt-1 text-12 text-chalk-4">
        Un habillage en verre translucide, par-dessus le thème choisi. La mise en page ne change pas.
        Si la transparence est réduite dans le système, le verre devient une surface pleine.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {([
          [true, "Activé"],
          [false, "Désactivé"],
        ] as const).map(([value, label]) => (
          <button
            key={label}
            type="button"
            onClick={() => choose(value)}
            aria-pressed={enabled === value}
            className={`min-h-11 rounded-md border px-3 text-12 font-semibold ${
              enabled === value
                ? "border-signal bg-signal text-void"
                : "border-line-3 bg-surface text-chalk hover:border-signal"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p aria-live="polite" className="mt-2 text-12 text-chalk-4">{message}</p>
    </fieldset>
  );
}
