"use client";

import { useCallback, useMemo, useState } from "react";

import { highlight, normalizeLang, toLines } from "@/lib/highlight";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toast";

const COLLAPSE_AFTER = 12;

/**
 * Bloc de code.
 *
 * Deux variantes, mêmes jetons :
 *
 * - `paper`   — code posé sur la page, fond clair. La signature DevNet.
 * - `terminal` — fond encre, pour isoler fortement le code (fiche projet,
 *               extrait long).
 *
 * La variante ne change que des variables CSS : la coloration est calculée
 * une seule fois, et passer de l'une à l'autre ne reclasse rien.
 *
 * Les longues publications restent courtes dans le fil : le lecteur choisit
 * d'ouvrir la suite. Les numéros restent alignés quand l'extrait est déplié.
 */
export function CodeBlock({
  code,
  lang,
  variant = "paper",
  filename,
  lineNumbers = true,
  maxHeight,
  copyable = true,
}: {
  code: string;
  lang?: string | null;
  /** `paper` = encre sur papier · `terminal` = fond encre. */
  variant?: "paper" | "terminal";
  filename?: string;
  lineNumbers?: boolean;
  /** Hauteur max en px avant défilement. */
  maxHeight?: number;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const toast = useToast();

  const key = normalizeLang(lang);
  // L'étiquette dit le langage **écrit**, pas la grammaire de coloration :
  // un extrait CSS ou JSON est surligné comme du texte, mais annoncer
  // « text » à l'écran serait faux et ne renseigne personne.
  const languageLabel = (lang ?? "").trim() || key;
  const lines = useMemo(() => toLines(highlight(code, key)), [code, key]);
  const isFolded = lines.length > COLLAPSE_AFTER && !expanded;
  const visibleLines = isFolded ? lines.slice(0, COLLAPSE_AFTER) : lines;

  const copy = useCallback(() => {
    if (!navigator.clipboard?.writeText) {
      toast("Copie indisponible dans ce navigateur", "err");
      return;
    }

    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      toast("Code copié dans le presse-papiers");
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => {
      toast("Copie impossible", "err");
    });
  }, [code, toast]);

  const dark = variant === "terminal";
  const headText = dark ? "text-chalk/70" : "text-chalk-3";

  return (
    <figure
      data-code-variant={variant}
      className="mb-1 overflow-hidden rounded-(--radius-card) border
        border-line-3 bg-(--color-code-bg)"
    >
      <figcaption
        className="flex min-h-(--h-tap) items-center gap-2 border-b
          border-line-3 bg-surface-3 px-3"
      >
        {filename && (
          <span className="truncate font-mono text-12 text-chalk-2">
            {filename}
          </span>
        )}
        <span className={`label-micro ${headText}`}>{languageLabel}</span>

        <span className="ml-auto flex items-center gap-1">
          {lines.length > COLLAPSE_AFTER && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="inline-flex min-h-(--h-tap) items-center px-2
                font-mono text-12 text-chalk-3 hover:text-chalk"
            >
              {expanded ? "Réduire" : `+${lines.length - COLLAPSE_AFTER} lignes`}
            </button>
          )}
          {copyable && (
            <button
              type="button"
              onClick={copy}
              aria-label={copied ? "Copié" : "Copier le code"}
              className={`inline-flex min-h-(--h-tap) items-center gap-1
                border-(--bw-thin) px-1.5
                transition-[color,border-color,background-color]
                duration-(--d-fast) ease-(--ease-continuous)
                active:translate-y-px
                ${copied
                  ? "border-ok text-ok"
                  : dark
                    ? "border-line-2/30 text-chalk/70 hover:border-signal hover:text-signal"
                    : "border-line-2 text-chalk-3 hover:border-line-3 hover:text-chalk"}`}
            >
              {/* L'icône est remplacée, pas agrandie : une icône qui
                  grossit parle de taille, pas de l'action accomplie. */}
              {copied
                ? <Icon name="check" size={11} strokeWidth={2.6} />
                : <Icon name="copy" size={11} />}
              <span className="label-micro text-12">
                {copied ? "Copié" : "Copier"}
              </span>
            </button>
          )}
        </span>
      </figcaption>

      {/* Zone défilante : sans arrêt de tabulation, un clavier ne peut pas
          atteindre le code qui déborde. `region` lui donne un nom, donc une
          raison d'être annoncée. */}
      <div
        className="overflow-auto"
        tabIndex={0}
        role="region"
        aria-label={lang ? `Code ${lang}` : "Code source"}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <pre
          className="m-0 px-3.5 py-3 font-mono text-(--text-code)
            leading-(--lh-code)"
          style={{ color: "var(--color-code-plain)" }}
        >
          <code>
            {visibleLines.map((tks, n) => (
              <span
                key={n}
                className="block"
              >
                {lineNumbers && (
                  <span className="code-line-no mr-3 inline-block w-[1.6em] text-right">
                    {n + 1}
                  </span>
                )}
                {tks.length === 0
                  ? " "
                  : tks.map((t, j) => (
                      <span key={j} className={`tok-${t.type}`}>
                        {t.value}
                      </span>
                    ))}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </figure>
  );
}