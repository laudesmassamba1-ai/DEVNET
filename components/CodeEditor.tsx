"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { highlight, toLines } from "@/lib/highlight";
import { guessLanguage } from "@/lib/git/paths";
import {
  backspacePair,
  complete,
  newlineIndent,
  typePair,
  type Completion,
} from "@/lib/editor/complete";

/**
 * L'éditeur de fichiers.
 *
 * ## La technique
 *
 * Un `<textarea>` **transparent** posé sur un `<pre>` coloré. Le texte
 * saisi est invisible, la coloration est derrière, et le curseur reste
 * visible : c'est la seule façon d'avoir un éditeur coloré sans
 * bibliothèque, et sans écrire un modèle de texte.
 *
 * Le prix de cette technique est un alignement **impossible à rater** :
 * si la police, la taille, l'interligne, la gouttière ou les tabulations
 * diffèrent d'un cran entre les deux couches, le curseur ne tombe plus
 * sous le caractère. Tout le style est donc déclaré une seule fois, dans
 * `LAYER`, et réutilisé par les deux.
 *
 * ## Ce qu'il fait, et ce qu'il ne prétend pas faire
 *
 * Un éditeur de club de code doit aider sans mentir : il **indente** à
 * la ligne suivante, **referme** les paires et propose les mots du
 * langage et les noms du fichier. Il n'a pas de serveur de langage — ni
 * types, ni symboles — et il le dit. Ces aides sont pures et testées
 * dans `lib/editor/complete.ts`.
 */

/** La complétion ouverte, avec la position du curseur en coordonnées d'écran. */
interface SuggestState extends Completion {
  index: number;
  left: number;
  top: number;
}

export function CodeEditor({
  path,
  value,
  onChange,
  onSave,
  onRun,
  readOnly = false,
  rows = 18,
}: {
  path: string;
  value: string;
  onChange: (next: string) => void;
  /** Appelé par Ctrl/Cmd+S. */
  onSave?: () => void;
  /** Appelé par Ctrl/Cmd+Entrée — le raccourci annoncé sous le bouton. */
  onRun?: () => void;
  readOnly?: boolean;
  rows?: number;
}) {
  const area = useRef<HTMLTextAreaElement | null>(null);
  const [suggest, setSuggest] = useState<SuggestState | null>(null);

  const language = useMemo(() => guessLanguage(path), [path]);

  // Le chemin dit le langage : passer le chemin à `normalizeLang`
  // renverrait toujours « text » (c'est un libellé humain qu'il attend),
  // et la couche de couleur — la raison d'être de l'éditeur — resterait
  // unie. `guessLanguage` traduit l'extension en ce libellé.
  const lines = useMemo(() => toLines(highlight(value, guessLanguage(path))), [value, path]);
  const numbers = useMemo(() => value.split("\n").length, [value]);

  // La hauteur du champ suit son contenu : la couleur et les numéros
  // étant en flux, **un** rouleau fait tout défiler ensemble. Un champ
  // à défilement interne, lui, laisserait le décor sur les premières
  // lignes pendant que le texte partirait — d'où le décalage qu'on a
  // vu.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // La bulle est en `position: fixed` : sans cela, elle serait rognée
  // par l'`overflow-hidden` de l'éditeur. Comme elle ne suit pas le
  // défilement, on la referme dès que la page bouge, plutôt que de la
  // laisser dériver loin du curseur.
  useEffect(() => {
    if (!suggest) return;
    const close = () => setSuggest(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [suggest]);

  /**
   * Où tombe le curseur, en coordonnées d'écran.
   *
   * On mesure la largeur de la ligne avant le curseur avec un canvas :
   * la police est monospace, donc la largeur mesurée est celle du
   * caractère sous le curseur. Les tabulations comptent pour deux
   * espaces, comme l'éditeur les affiche.
   */
  const caretPoint = useCallback(
    (el: HTMLTextAreaElement, caret: number): { left: number; top: number } => {
      const style = window.getComputedStyle(el);
      const lineHeight = parseFloat(style.lineHeight) || 20;
      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const before = el.value.slice(0, caret);
      const lastBreak = before.lastIndexOf("\n");
      const lineIndex = (before.match(/\n/g) ?? []).length;
      const lineText = before.slice(lastBreak + 1).replace(/\t/g, "  ");

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      let width = 0;
      if (context) {
        context.font = `${style.fontSize} ${style.fontFamily}`;
        width = context.measureText(lineText).width;
      }

      const rect = el.getBoundingClientRect();
      return {
        left: rect.left + paddingLeft + width,
        top: rect.top + (lineIndex + 1) * lineHeight,
      };
    },
    [],
  );

  /** Recalcule la complétion pour la position courante. */
  const refresh = useCallback(() => {
    const el = area.current;
    if (!el || readOnly) return;
    const caret = el.selectionStart;
    if (caret !== el.selectionEnd) {
      setSuggest(null);
      return;
    }
    const found = complete(language, el.value, caret);
    if (!found) {
      setSuggest(null);
      return;
    }
    const point = caretPoint(el, caret);
    setSuggest({ ...found, index: 0, left: point.left, top: point.top });
  }, [caretPoint, language, readOnly]);

  /** Applique le mot choisi à la place du préfixe en cours. */
  const accept = useCallback(
    (choice: SuggestState, index: number) => {
      const el = area.current;
      if (!el) return;
      const word = choice.items[index];
      if (!word) return;
      const text = el.value;
      const next = text.slice(0, choice.start) + word + text.slice(el.selectionStart);
      onChange(next);
      const caret = choice.start + word.length;
      setSuggest(null);
      requestAnimationFrame(() => el.setSelectionRange(caret, caret));
    },
    [onChange],
  );

  /**
   * Tabulation : deux espaces, et détabulation sur les lignes
   * sélectionnées.
   *
   * Un `<textarea>` sans traitement fait **sortir** le focus du champ à la
   * première tabulation — c'est le comportement par défaut d'un
   * navigateur, et il est inopportun ici : on écrit du code. On prend donc le
   * contrôle de la touche, en ne l'empêchant qu'ici.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const el = event.currentTarget;
      const { selectionStart, selectionEnd, value: text } = el;

      // La bulle de complétion capte d'abord Entrée, Tab et les flèches.
      if (suggest) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSuggest({ ...suggest, index: (suggest.index + 1) % suggest.items.length });
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSuggest({
            ...suggest,
            index: (suggest.index - 1 + suggest.items.length) % suggest.items.length,
          });
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSuggest(null);
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          accept(suggest, suggest.index);
          return;
        }
      }

      // Ctrl/Cmd+S : enregistrer. Sans ça, le navigateur ouvre sa boîte
      // « enregistrer la page », ce qui est hors de propos ici.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSave?.();
        return;
      }

      // Ctrl/Cmd+Entrée : exécuter. Le bouton l'annonçait déjà, mais le
      // raccourci n'était pas câblé — promettre une touche qui ne fait
      // rien est pire que ne rien promettre.
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        onRun?.();
        return;
      }

      if (readOnly) return;

      // Entrée : nouvelle ligne indentée comme la précédente.
      if (event.key === "Enter") {
        event.preventDefault();
        const base = text.slice(0, selectionStart) + text.slice(selectionEnd);
        const edit = newlineIndent(base, selectionStart);
        onChange(edit.text);
        setSuggest(null);
        requestAnimationFrame(() => el.setSelectionRange(edit.caret, edit.caret));
        return;
      }

      // Retour arrière entre une paire vide : on efface les deux.
      if (event.key === "Backspace") {
        const edit = backspacePair(text, selectionStart, selectionEnd);
        if (edit) {
          event.preventDefault();
          onChange(edit.text);
          requestAnimationFrame(() => el.setSelectionRange(edit.caret, edit.caret));
        }
        return;
      }

      // Coller/couper/copier : laisser le navigateur agir.
      if ((event.metaKey || event.ctrlKey) && ['v','c','x','a','z','y'].includes(event.key.toLowerCase())) {
        return;
      }

      // Un caractère ouvrant referme sa paire (ou encadre la sélection).
      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        const edit = typePair(text, selectionStart, selectionEnd, event.key);
        if (edit) {
          event.preventDefault();
          if (edit.text !== text) onChange(edit.text);
          requestAnimationFrame(() => el.setSelectionRange(edit.caret, edit.caret));
          setSuggest(null);
          return;
        }
      }

      if (event.key !== "Tab") return;

      event.preventDefault();

      // Sélection multiligne : on indente ou détabule chaque ligne
      // touchée, sinon la colonne d'un bloc de code se désaligne d'un
      // cran — et c'est le cas le plus fréquent quand on colle un
      // bloc.
      const spansLines = text.slice(selectionStart, selectionEnd).includes("\n");

      if (spansLines) {
        const from = text.lastIndexOf("\n", selectionStart - 1) + 1;
        const block = text.slice(from, selectionEnd);
        const shifted = event.shiftKey
          ? block.replace(/^ {1,2}/gm, "")
          : block.replace(/^/gm, "  ");

        onChange(text.slice(0, from) + shifted + text.slice(selectionEnd));

        // Le curseur suit le bloc : on le place en fin de sélection
        // recalculée, sinon il saute au début du fichier sur une
        // sélection de vingt lignes.
        requestAnimationFrame(() => {
          const after = from + shifted.length;
          el.setSelectionRange(after, after);
        });
        return;
      }

      // Tabulation : on remplace la sélection par deux espaces, le
      // curseur suit.
      if (!event.shiftKey) {
        onChange(`${text.slice(0, selectionStart)}  ${text.slice(selectionEnd)}`);
        const caret = selectionStart + 2;
        requestAnimationFrame(() => {
          el.setSelectionRange(caret, caret);
        });
        return;
      }

      // Détabulation de la **ligne** courante — pas seulement des espaces
      // collés au curseur, qui pouvaient être en plein milieu d'un mot.
      // On retire la tête indentée et on recale la sélection du même
      // cran : une sélection horizontale survit à la frappe, au lieu de
      // disparaître.
      const lineStart = text.lastIndexOf("\n", selectionStart - 1) + 1;
      const lineBreak = text.indexOf("\n", selectionEnd);
      const lineEnd = lineBreak === -1 ? text.length : lineBreak;
      const lead = /^ +/.exec(text.slice(lineStart, lineEnd))?.[0] ?? "";
      const remove = Math.min(2, lead.length);
      if (remove === 0) return;

      onChange(text.slice(0, lineStart) + text.slice(lineStart + remove));
      const caretStart = Math.max(lineStart, selectionStart - remove);
      const caretEnd = Math.max(lineStart, selectionEnd - remove);
      requestAnimationFrame(() => {
        el.setSelectionRange(caretStart, caretEnd);
      });
    },
    [accept, onChange, onSave, onRun, readOnly, suggest],
  );

  /**
   * Après une frappe, on recalcule la complétion.
   *
   * On ne le fait pas dans `onKeyDown` : le texte n'y est pas encore à
   * jour. Au `keyup`, la valeur du champ reflète le caractère inséré, et
   * la mesure du curseur tombe juste.
   */
  const onKeyUp = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") return;
      if (event.ctrlKey || event.metaKey || event.altKey) {
        setSuggest(null);
        return;
      }
      if (event.key.length === 1 || event.key === "Backspace") {
        refresh();
        return;
      }
      setSuggest(null);
    },
    [refresh],
  );

  return (
    <div
      className="relative overflow-hidden rounded-[var(--radius-card)] border
        border-line-2 bg-[var(--color-code-bg)] shadow-sh-1 transition-[border-color]
        duration-[var(--d-fast)] focus-within:border-signal"
    >
      {/* Un seul rouleau pour les trois couches. La marge verticale vit
          sur le rouleau, pas sur une couche : la numérotation, la
          coloration et le texte commencent au même pixel, et ils
          défilent ensemble — c'est la seule façon de n'avoir jamais de
          décalage. */}
      <div className="flex overflow-auto py-3">
        {/* La gouttière : elle compte les lignes **du texte**, pas celles
            de la coloration. Les deux viennent de la même découpe, donc
            ils ne peuvent pas diverger. */}
        <pre
          aria-hidden="true"
          className={`${CODE_FONT} shrink-0 select-none border-r border-line-3/60
            pl-2 pr-2 text-right text-[var(--color-code-comment)]`}
        >
          {Array.from({ length: numbers }, (_, i) => `${i + 1}\n`).join("")}
        </pre>

        {/* Les deux couches du texte — décors et champ — partagent la même
            case de grille : mêmes dimensions, même origine, donc même
            curseur. La hauteur du champ suit le contenu (`scrollHeight`),
            identique à celle du décor en flux. */}
        <div className="grid min-w-0 flex-1 grid-cols-1">
          <pre
            aria-hidden="true"
            className={`${LAYER} [grid-area:1/1] pointer-events-none overflow-hidden`}
            style={{ color: "var(--color-code-plain)" }}
          >
            <code>
              {lines.map((tokens, n) => (
                <span key={n} className="block">
                  {tokens.length === 0
                    ? " "
                    : tokens.map((t, j) => (
                        <span key={j} className={`tok-${t.type}`}>
                          {t.value}
                        </span>
                      ))}
                </span>
              ))}
            </code>
          </pre>

          <textarea
            ref={area}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onClick={refresh}
            onBlur={() => setSuggest(null)}
            rows={rows}
            readOnly={readOnly}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            wrap="off"
            aria-label={`Contenu de ${path}`}
            role="combobox"
            aria-controls="code-suggest"
            aria-autocomplete="list"
            aria-expanded={suggest !== null}
            // Coller/couper/copier ne doivent jamais être bloqués par
            // l'autocomplétion ni par les paires d'accents.
            onPaste={() => {
              setSuggest(null);
            }}
            onCut={() => {
              setSuggest(null);
            }}
            onCopy={() => {
              setSuggest(null);
            }}
            onDrop={() => {
              // Permettre le dépôt de texte brut depuis ailleurs.
              setSuggest(null);
            }}
            className={`${LAYER} [grid-area:1/1] block w-full resize-none overflow-hidden
              border-0 bg-transparent text-transparent caret-signal outline-none
              placeholder:text-[var(--color-code-comment)]`}
          />
        </div>
      </div>

      {/* La bulle de complétion. Elle flotte en coordonnées d'écran : le
          clic la choisit, la souris ne vole pas le focus au champ. */}
      {suggest && (
        <ul
          id="code-suggest"
          role="listbox"
          aria-label="Suggestions"
          className="fixed z-[var(--z-toast)] max-h-48 w-56 overflow-auto rounded-[var(--radius-card)]
            border border-line-3 bg-surface py-1 shadow-sh-3"
          style={{ left: suggest.left, top: suggest.top }}
        >
          {suggest.items.map((item, index) => (
            <li key={item} role="option" aria-selected={index === suggest.index}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  accept(suggest, index);
                }}
                onMouseEnter={() => setSuggest({ ...suggest, index })}
                className={`block w-full px-3 py-1 text-left font-mono text-[12.5px] ${
                  index === suggest.index
                    ? "bg-signal/15 text-signal"
                    : "text-chalk hover:bg-surface-2"
                }`}
              >
                {item}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Le style partagé par les deux couches.
 *
 * Une seule source, deux usages : c'est la seule façon de garantir
 * l'alignement. Toute divergence d'un demi-pilote se voit à l'œil sur la
 * première ligne saisie, mais il faut l'éviter par construction plutôt
 * que par relecture.
 */
const CODE_FONT =
  "m-0 font-mono text-[var(--text-code)] leading-[var(--lh-code)] " +
  "whitespace-pre tab-size-2";

const LAYER = `${CODE_FONT} px-3`;
