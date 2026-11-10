"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Bottom sheet — apparaît par glissement, se ferme au swipe vers le bas.
 *
 * ## Pourquoi elle est rendue dans `document.body`
 *
 * Une modale appartient à la **fin** du document, pas à l'endroit du
 * code qui l'a créée. Deux raisons, et la seconde est la grave.
 *
 * 1. **L'ordre d'empilement.** Une feuille dans un panneau de
 *    commentaires s'y trouve dans le DOM — donc *avant* la feuille qui
 *    contient ce panneau. Deux voiles au même `z-index` se peignent
 *    dans l'ordre du document : celui du parent passe par-dessus, il
 *    intercepte les clics, et la feuille enfant devient **inutilisable**.
 *    Symptôme exact : « j'ai cliqué sur Signaler, la fenêtre s'ouvre, je
 *    ne peux rien cocher ». Aucun message d'erreur — la feuille est
 *    visible, donc tout va bien, sauf qu'elle est morte.
 *
 * 2. **Le contexte de positionnement.** `position: fixed` est calculé
 *    par rapport à son ancêtre transformé. Le panneau de commentaires
 *    est animé — donc transformé — donc la feuille à `position: fixed`
 *    qu'il contient se retrouve **encastrée** dans le panneau et
 *    tronquée par son défilement. Un portail évite les deux problèmes
 *    d'un coup.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  size = "default",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** `wide` ouvre la feuille aux outils qui ont besoin de deux colonnes
      (studio de statut) ; le reste garde la largeur de lecture. */
  size?: "default" | "wide";
}) {
  const [dragY, setDragY] = useState(0);
  /** Le portail ne peut être posé qu'après le montage côté client. */
  const [monte, setMonte] = useState(false);
  const [swiping, setSwiping] = useState(false);
  const [startY, setStartY] = useState(0);

  // Verrouille le scroll derrière la sheet
  useLayoutEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonte(true);
  }, []);

  // Fermeture au clavier
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function handleTouchStart(e: React.TouchEvent) {
    setStartY(e.touches[0].clientY);
    setSwiping(true);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!swiping) return;
    const dy = e.touches[0].clientY - startY;
    setDragY(dy > 0 ? dy : dy * 0.2);
  }

  function handleTouchEnd() {
    setSwiping(false);
    if (dragY > 110) {
      onClose();
    }
    setDragY(0);
  }

  if (!open) return null;

  // Le portail n'existe pas pendant le rendu serveur : on attend le
  // premier montage pour le poser. Sans cette garde, `document` serait
  // lu sur le serveur et le rendusequent échouerait sur la moitié des
  // pages — celles qui rendent une feuille ouverte au premier rendu.
  if (typeof document === "undefined" || !monte) return null;

  return createPortal(
    <div
      className="overlay-veil fixed inset-0 z-[var(--z-sheet)] flex items-end justify-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={`mo-sheet w-full ${size === "wide" ? "max-w-[760px]" : "max-w-[520px]"}`}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            transform: `translateY(${dragY}px)`,
            transition: swiping
              ? "none"
              : "transform var(--d-slow) var(--ease-spring)",
          }}
          className="sheet-glass depth-panel max-h-[92vh] w-full overflow-y-auto
            rounded-t-[calc(var(--radius-card)+8px)] border border-b-0 border-edge
            px-[1.3rem] pb-10 shadow-[var(--shadow-sh-1)]"
        >
          <div className="mx-auto my-[13px] h-[5px] w-11 rounded-full bg-chalk-2 opacity-40" />
          <h2 className="mb-[1.15rem] font-display text-[1.3rem] font-bold tracking-[-0.02em]">
            {title}
          </h2>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}