"use client";

import { useCallback, useMemo, useState } from "react";

import { highlight, normalizeLang, toLines } from "@/lib/highlight";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toast";

/**
 * Retard de la ligne `n` dans le déploiement du code.
 *
 * 28 ms par ligne — assez pour que l'œil suive le défilement du texte,
 * pas assez pour qu'un fichier de trente lignes soit pénible à attendre.
 *
 * Le plafond à 18 lignes est le point important : au-delà, toutes les
 * lignes restantes arrivent ensemble. Un extrait de 80 lignes ne doit
 * pas demander quatre secondes — on lit du code, on ne le regarde pas
 * se composer.
 */
const LINE_STEP = 28;
const LINE_CAP = 18;

const lineDelay = (n: number) => Math.min(n * LINE_STEP, LINE_CAP * LINE_STEP);

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
 * **Le code se tape.** Chaque ligne apparaît 28 ms après la précédente,
 * comme si quelqu'un la saisissait. C'est le mouvement qui distingue un
 * réseau de développeurs d'un réseau généraliste : partout ailleurs, un
 * extrait de code est une image insérée ; ici, c'est du texte qui vient
 * d'être écrit. C'est aussi pourquoi `preview` désactive l'animation —
 * un contenu en cours de frappe qu'on relit à chaque rendu devient
 * fatigant, alors qu'un contenu qui apparaît une fois est de la lecture.
 */
export function CodeBlock({
  code,
  lang,
  variant = "paper",
  lineNumbers = false,
  maxHeight,
  copyable = true,
  /** Coupe l'animation ligne à ligne (banc d'essai, aperçus). */
  instant = false,
}: {
  code: string;
  lang?: string | null;
  /** `paper` = encre sur papier · `terminal` = fond encre. */
  variant?: "paper" | "terminal";
  lineNumbers?: boolean;
  /** Hauteur max en px avant défilement. */
  maxHeight?: number;
  copyable?: boolean;
  /** Désactive la révélation ligne à ligne. */
  instant?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const key = normalizeLang(lang);
  const lines = useMemo(() => toLines(highlight(code, key)), [code, key]);

  const copy = useCallback(() => {
    // On copie le texte brut : jamais le HTML rendu.
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      toast("Code copié dans le presse-papiers");
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => {
      toast("Copie impossible", "err");
    });
  }, [code, toast]);

  const dark = variant === "terminal";
  const headText = dark ? "text-chalk/70" : "text-chalk-3";
  const still = instant || lines.length === 0;

  return (
    <figure
      data-code-variant={variant}
      className="mb-1 overflow-hidden rounded-[var(--radius-card)] border
        border-line-3 bg-[var(--color-code-bg)] shadow-sh-1"
    >
      <figcaption
        className="flex h-[34px] items-center gap-2 rounded-t-[var(--radius-card)]
          border-b border-line-3 bg-surface-3 px-2.5"
      >
        <span className={`label-micro ${headText}`}>{key}</span>

        <span className="ml-auto flex items-center gap-1">
          {copyable && (
            <button
              type="button"
              onClick={copy}
              aria-label={copied ? "Copié" : "Copier le code"}
              className={`inline-flex h-[26px] items-center gap-1 rounded-[var(--radius-chip)]
                border-[var(--bw-thin)] px-1.5
                transition-[color,border-color,background-color]
                duration-[var(--d-fast)] ease-[var(--ease-continuous)]
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
              <span className="label-micro text-[10px]">
                {copied ? "Copié" : "Copier"}
              </span>
            </button>
          )}
        </span>
      </figcaption>

      <div
        className="overflow-auto"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <pre
          className="m-0 px-3.5 py-3 font-mono text-[var(--text-code)]
            leading-[var(--lh-code)]"
          style={{ color: "var(--color-code-plain)" }}
        >
          <code>
            {lines.map((tks, n) => (
              <span
                key={n}
                className={still ? "block" : "code-line block"}
                style={still ? undefined : { animationDelay: `${lineDelay(n)}ms` }}
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