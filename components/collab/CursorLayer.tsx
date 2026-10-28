"use client";

import { avatarClass } from "@/lib/utils";
import { cursorColorVar, type CollabCursor } from "@/lib/collab/cursors";

/**
 * Le calque des curseurs distants.
 *
 * ## Pourquoi un calque, et pas des décorations Monaco
 *
 * Monaco sait dessiner des décorations, mais les y brancher aurait marié
 * l'affichage à l'éditeur : impossible de rendre un caret sans instance
 * Monaco, impossible de tester le rendu sans navigateur, et une montée de
 * version de Monaco aurait emporté le calque avec elle. Ici, le composant
 * ne reçoit que des **positions** et des **mesures** — il ne connaît ni
 * Monaco, ni le fichier, ni le canal.
 *
 * ## Ce que l'appelant doit fournir
 *
 * Le calque se pose en absolu dans le conteneur de défilement de l'éditeur,
 * à qui il emprunte le repère : `lineHeight` (hauteur d'une ligne, en px),
 * `charWidth` (largeur d'un caractère, en px — Monaco est monospace) et les
 * marges internes de l'éditeur. Une sélection qui déborde sur plusieurs
 * lignes n'est **pas** peinte : seule la ligne de tête l'est. C'est une
 * limite assumée de cette tranche, pas un oubli.
 */
export interface CursorLayerProps {
  cursors: CollabCursor[];
  /** Le fichier affiché : les curseurs des autres fichiers sont ignorés. */
  path: string;
  /** Hauteur d'une ligne, en pixels (option `lineHeight` de Monaco). */
  lineHeight: number;
  /** Largeur d'un caractère, en pixels. Monospace, donc constante. */
  charWidth: number;
  /** Marge haute interne de l'éditeur (option `padding.top`). */
  paddingTop?: number;
  /** Marge gauche interne de l'éditeur. */
  paddingLeft?: number;
  className?: string;
}

export function CursorLayer({
  cursors,
  path,
  lineHeight,
  charWidth,
  paddingTop = 12,
  paddingLeft = 0,
  className = "",
}: CursorLayerProps) {
  const onThisFile = cursors.filter((cursor) => cursor.path === path);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-20 overflow-hidden ${className}`}
    >
      {onThisFile.map((cursor) => {
        const color = cursorColorVar(cursor.color);
        const { anchor, head } = cursor;

        const top = paddingTop + (head.line - 1) * lineHeight;
        const left = paddingLeft + (head.column - 1) * charWidth;

        // Sélection sur une seule ligne : une bande teintée de l'ancre à la
        // tête. Si les deux lignes diffèrent, on ne peint que le caret.
        const sameLine = anchor.line === head.line;
        const from = Math.min(anchor.column, head.column);
        const to = Math.max(anchor.column, head.column);
        const selection =
          sameLine && to > from
            ? {
                top: paddingTop + (head.line - 1) * lineHeight,
                left: paddingLeft + (from - 1) * charWidth,
                width: (to - from) * charWidth,
                height: lineHeight,
              }
            : null;

        return (
          <div key={cursor.userId}>
            {selection && (
              <span
                className="absolute block rounded-[2px]"
                style={{ ...selection, backgroundColor: color, opacity: 0.22 }}
              />
            )}

            {/* Le caret : une barre verticale de la hauteur d'une ligne. */}
            <span
              className="absolute block w-[2px] rounded-full"
              style={{ top, left, height: lineHeight, backgroundColor: color }}
            />

            {/* L'étiquette : qui écrit, au-dessus du caret. */}
            <span
              className={`absolute -translate-y-full whitespace-nowrap rounded-[var(--radius-chip)]
                border px-1.5 py-px font-mono text-[10px] leading-[1.3] shadow-sh-1
                ${avatarClass(cursor.color)}`}
              style={{ top: top - 2, left }}
            >
              {cursor.pseudo || "un pair"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
