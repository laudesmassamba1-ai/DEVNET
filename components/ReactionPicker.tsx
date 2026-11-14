"use client";

import { useEffect, useRef, useState } from "react";
import { Motion } from "./Motion";
import { Icon } from "./Icon";
import { POST_REACTIONS } from "@/lib/reactions";

/**
 * Le sélecteur de réactions.
 *
 * Il apparaît au survol du bouton « réagir » plutôt qu'en permanence :
 * six icônes sur chaque carte d'un fil de quarante posts seraient
 * quarante-deux fois plus de chrome que d'information. Le geste reste
 * donc celui qu'on attend — le bouton Like ouvre le sélecteur — et le
 * sélecteur disparaît dès qu'on le quitte.
 *
 * Aucune Modale, aucun popover natif : ce serait deux couches
 * d'interaction pour un choix d'une seule frappe. Un panneau ancré,
 * ouvert par survol **et** au clavier (`aria-expanded`), et refermé
 * dès que le pointeur ou le focus en sort.
 */
export function ReactionPicker({
  mine,
  onPick,
  disabled = false,
}: {
  /** Icône déjà posée par le lecteur, s'il y en a une. */
  mine: string | null;
  onPick: (icon: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Le panneau ne reste pas ouvert quand le doigt le quitte : sur
  // mobile, `hover` n'existe pas, et le panneau resterait collé à
  // l'écran. On referme donc au `blur` et après un délai court.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const show = () => {
    if (disabled) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };

  const hideSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    // Le délai laisse au pointeur le temps de traverser la bande
    // entre le bouton et le panneau : sans lui, le survol du bouton
    // ouvrirait et fermerait le sélecteur dans le même geste.
    closeTimer.current = setTimeout(() => setOpen(false), 260);
  };

  return (
    <div ref={wrap} className="relative" onMouseEnter={show} onMouseLeave={hideSoon}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={
          mine ? `Changer ta réaction (${mine})` : "Réagir à cette publication"
        }
        onFocus={show}
        onBlur={(e) => {
          if (!wrap.current?.contains(e.relatedTarget as Node)) hideSoon();
        }}
        onClick={() => (disabled ? undefined : setOpen((v) => !v))}
        className={`inline-flex min-h-(--h-tap) min-w-(--h-tap) items-center
          justify-center gap-1.5 rounded-(--radius-chip)
          border-(--bw-thin) px-2.5 py-2
          font-mono text-12 font-medium
          transition-[color,border-color,background-color,transform]
          duration-(--d-fast)
          ${mine
            ? "border-signal text-signal"
            : "border-line text-chalk-3 hover:border-line-3 hover:bg-surface-2 hover:text-chalk"}
          active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {/* L'icône posée est rejouée à chaque changement de clé : c'est
            l'éclat qui confirme le geste. Sans lui, la seule trace du
            clic est un changement de couleur — information exacte,
            mais qui ne se **voit** pas dans une barre d'actions éclairée
            par quatre autres affordances. */}
        <Motion key={mine ?? "vide"} as="span" role={mine ? "burst" : "fade"} delay={0}
          aria-hidden
          className="shrink-0 leading-none">
          {mine ? (
            <span className="text-15 leading-none">{mine}</span>
          ) : (
            <Icon name="plus" size={14} strokeWidth={2.2} />
          )}
        </Motion>
        <span className="tnum">{mine ? "1" : ""}</span>
      </button>

      {open && (
        <Motion
          role="scale"
          delay={0}
          className="absolute bottom-full left-0 z-(--z-sheet) mb-2 flex gap-0.5
            rounded-(--radius-card) border border-edge overlay-panel
            p-1 shadow-sh-3"
        >
          {POST_REACTIONS.map((r) => {
            const chosen = mine === r.emoji;
            return (
              <button
                key={r.emoji}
                type="button"
                title={r.label}
                aria-label={r.label}
                aria-pressed={chosen}
                onClick={() => {
                  // Recliquer sur la réaction déjà posée la retire :
                  // le même geste retire, comme pour le like.
                  onPick(chosen ? null : r.emoji);
                  setOpen(false);
                }}
                className={`mo-press flex size-7.5 items-center justify-center
                  rounded-full text-[17px] leading-none
                  transition-[background-color,transform,box-shadow] duration-(--d-fast)
                  hover:scale-115 hover:-translate-y-0.5
                  ${chosen
                    ? "bg-surface-2 shadow-(--shadow-sh-1) ring-2 ring-signal/50"
                    : "hover:bg-surface-2"}`}
              >
                <span aria-hidden>{r.emoji}</span>
              </button>
            );
          })}
        </Motion>
      )}
    </div>
  );
}