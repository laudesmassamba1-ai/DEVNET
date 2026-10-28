"use client";

import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import { Motion } from "./Motion";

/**
 * La bulle de saisie.
 *
 * ## Pourquoi elle surgit au lancement, pas au moment du `input()`
 *
 * Un navigateur ne sait pas mettre un programme en pause : Pyodide tourne
 * d'un bloc dans un worker, et on ne peut pas l'interrompre pour attendre
 * une frappe. On peut, en revanche, savoir **avant** de lancer qu'un
 * programme va lire son entrée. La bulle apparaît donc quand on clique
 * « exécuter » — jamais plus tôt, jamais pour un programme qui n'attend
 * aucune saisie.
 *
 * ## Ce qu'elle remplace
 *
 * Un champ toujours affiché sous l'éditeur : il encombrait les programmes
 * qui ne lisent rien, et on ne voyait pas qu'il *fallait* le remplir. Une
 * bulle qui surgit le dit à sa forme même.
 */
export function StdinBubble({
  open,
  value,
  onChange,
  onRun,
  onClose,
}: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // La bulle demande une saisie : le curseur doit y être, sinon on appuie
  // sur Entrée dans le vide.
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-3 z-[var(--z-sheet)]
        bottom-[calc(var(--h-bottomnav)+0.75rem)] flex justify-center
        sm:inset-x-auto sm:right-5 sm:justify-end lg:bottom-5"
    >
      <div className="pointer-events-auto relative w-full max-w-[360px]">
        {/* La respiration : un halo olive qui va et vient derrière la
            bulle — l'équivalent de la sonde en direct. La surface
            *appelle* au lieu d'attendre. Hors du DOM lisible
            (`aria-hidden`) et hors du flux. */}
        <span
          aria-hidden="true"
          className="mo-breathe pointer-events-none absolute -inset-1.5
            rounded-[calc(var(--radius-card)+6px)] bg-signal/25 blur-lg"
        />

        <Motion
          role="scale"
          className="relative w-full rounded-[var(--radius-card)] border-2
            border-signal bg-surface p-3.5 shadow-sh-2"
        >
          {/* Une queue de bulle : elle ne flotte pas au hasard, elle pointe
              vers le bouton qui l'a fait naître. */}
          <span
            aria-hidden="true"
            className="absolute -bottom-[7px] right-8 size-3 rotate-45
              border-b-2 border-r-2 border-signal bg-surface sm:right-10"
          />

          <div className="mb-2 flex items-center gap-2">
            <Icon name="keyboard" size={14} strokeWidth={2} className="shrink-0 text-signal" />
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-chalk">
              Le programme attend une saisie
            </p>
            {/* Un point qui pulse : le même signal que la sortie en
                cours. Il dit « c'est bien toi, maintenant ». */}
            <span
              aria-hidden="true"
              className="mo-pulse size-1.5 shrink-0 rounded-full bg-signal"
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="mo-press -mr-1 ml-auto flex size-6 items-center justify-center
                rounded-[var(--radius-chip)] text-chalk-4 hover:bg-surface-2 hover:text-chalk"
            >
              <Icon name="close" size={12} strokeWidth={2} />
            </button>
          </div>

          <p className="mb-2 font-mono text-[11.5px] leading-snug text-chalk-3">
            Il lit l&apos;entrée standard (<code>input()</code>, <code>gets</code>,
            <code>scanf</code>…). Donnez une valeur par ligne — Entrée pour lancer.
          </p>

          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onRun();
              }
            }}
            rows={3}
            spellCheck={false}
            aria-label="Entrées du programme, une valeur par ligne"
            placeholder={"20\nAminata"}
            className="w-full resize-y rounded-[var(--radius-input)] border
              border-line-3 bg-surface px-3 py-2 font-mono text-[12.5px]
              leading-relaxed text-chalk outline-none transition-colors
              duration-[var(--d-fast)] placeholder:text-chalk-4 focus:border-signal"
          />

          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="mo-press h-[var(--h-tap)] flex-1 rounded-[var(--radius-input)]
                border border-transparent text-[12.5px] font-bold text-chalk-2
                hover:bg-surface-2 hover:text-chalk"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={onRun}
              className="mo-press flex h-[var(--h-tap)] flex-1 items-center
                justify-center gap-1.5 rounded-[var(--radius-input)] border
                border-signal bg-signal text-[12.5px] font-bold text-void shadow-sh-1"
            >
              <Icon name="bolt" size={12} strokeWidth={2.2} />
              Exécuter
              <span
                aria-hidden="true"
                className="ml-0.5 rounded-[4px] border border-void/25 px-1
                  font-mono text-[10px] leading-[1.4] text-void/70"
              >
                ⏎
              </span>
            </button>
          </div>
        </Motion>
      </div>
    </div>
  );
}
