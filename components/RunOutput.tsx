"use client";

import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Avatar";
import { Motion } from "@/components/Motion";
import { engineLabel, truncationNotice } from "@/lib/execution/runtime";
import type { RunOutcome } from "@/lib/execution/runner";

/**
 * La sortie d'exécution.
 *
 * Trois états qu'il faut distinguer, et qui sont souvent confondus :
 *
 *  · **rien** — on n'a rien exécuté. Rien ne s'affiche : un cadre vide
 *    sous l'éditeur ferait croire à un fichier sans sortie.
 *  · **en cours** — dont le *téléchargement du moteur*, qui est très
 *    différent d'une exécution : plusieurs secondes contre quelques
 *    millisecondes, et un message qui l'explique vaut mieux qu'un
 *    spinner muet.
 *  · **terminé** — avec ou sans erreur. L'erreur n'est pas un cas
 *    particulier : c'est le résultat le plus fréquent quand on apprend.
 *
 * ## Pourquoi la sortie est *vive`
 *
 * Une sortie qui se pose sans un mot se confond avec le vide : on vient de
 * demander quelque chose, on ne voit rien arriver, on doute. Le panneau se
 * pose (`mo-rise`), sa tranche gauche prend la couleur du verdict, un
 * point pulse tant que le moteur travaille, et une ligne balaie la console
 * pendant l'exécution — `mo-scan`, la même grammaire que le reste du
 * dépôt. C'est du mouvement d'**état** : il dit « ça tourne » ou « c'est
 * fini », il ne décore pas.
 *
 * La sortie est rendue en `pre` : c'est un terminal, pas un paragraphe.
 * Une sortie qui se ré-wrappe ligne par ligne devient illisible — on ne
 * sait plus où une ligne commence.
 */

/** Les trois verdicts possibles, et ce que chacun colore. */
const TONE = {
  ok: { text: "text-ok", border: "border-l-ok", chip: "bg-ok/15 text-ok", icon: "check" },
  danger: {
    text: "text-danger",
    border: "border-l-danger",
    chip: "bg-danger/15 text-danger",
    icon: "close",
  },
  warn: { text: "text-warn", border: "border-l-warn", chip: "bg-warn/15 text-warn", icon: "stop" },
} as const;

export function RunOutput({ outcome }: { outcome: RunOutcome }) {
  if (outcome.status === "idle") return null;

  const loading = outcome.status === "loading";
  const running = outcome.status === "running";
  const stopped = outcome.status === "stopped";
  const busy = loading || running;

  const tone = TONE[stopped ? "warn" : outcome.ok ? "ok" : "danger"];

  const label = loading
    ? "Téléchargement du moteur"
    : running
      ? "Exécution"
      : stopped
        ? "Arrêté"
        : outcome.ok
          ? "Terminé"
          : "Échec";

  const notice = outcome.truncated ? truncationNotice(outcome.output) : null;

  return (
    <Motion
      role="rise"
      className={`relative mt-3 overflow-hidden rounded-(--radius-card) border
        border-l-[5px] border-line-3 ${tone.border} bg-(--color-code-bg) shadow-sh-1`}
    >
      <section
        // `aria-live` : une exécution qui se termine seule doit être
        // annoncée. Sans cela, la personne qui a lancé le code n'a aucun
        // moyen de savoir que ça s'est terminé.
        aria-live="polite"
      >
        <div className="flex h-8.5 items-center gap-2 border-b border-line-3 bg-surface-3 px-2.5">
          {busy ? (
            <Spinner />
          ) : (
            <span
              className={`flex size-4 items-center justify-center rounded-full ${tone.chip}`}
            >
              <Icon name={tone.icon} size={11} strokeWidth={2.6} />
            </span>
          )}

          <span
            className={`font-mono text-12 font-bold uppercase tracking-[0.12em] ${
              busy ? "text-chalk-3" : tone.text
            }`}
          >
            {label}
          </span>

          {busy && (
            <span className="mo-pulse size-1.5 rounded-full bg-signal" aria-hidden="true" />
          )}

          <span className="ml-auto flex items-center gap-1.5">
            {outcome.status === "done" && (
              <span className="tnum rounded-(--radius-chip) border border-line-3 bg-surface-2 px-1.5 py-0.5 font-mono text-12 text-chalk-3">
                {outcome.durationMs} ms
              </span>
            )}
            <span className="label-micro rounded-(--radius-chip) border border-line-3 px-1.5 py-0.5 text-chalk-3">
              {engineLabel(outcome.engine)}
            </span>
          </span>
        </div>

        {loading && (
          <p className="px-3 py-2.5 font-mono text-12 leading-relaxed text-chalk-4">
            Le moteur arrive — une fois pour toutes, puis il reste en
            mémoire. C&apos;est le seul moment où lancer prend du temps.
          </p>
        )}

        {outcome.error && (
          <div className="flex items-start gap-2 border-b border-line-2/50 px-3 py-2.5">
            <Icon
              name="close"
              size={12}
              strokeWidth={2.4}
              className="mt-0.5 shrink-0 text-danger"
            />
            <pre
              className="min-w-0 flex-1 font-mono text-(--text-code)
                leading-(--lh-code) whitespace-pre-wrap text-danger"
            >
              {outcome.error}
            </pre>
          </div>
        )}

        {outcome.output.length > 0 && (
          <pre
            className="overflow-x-auto px-3 py-2.5 font-mono text-(--text-code)
              leading-(--lh-code)"
            style={{ color: "var(--color-code-plain)" }}
          >
            {outcome.output}
          </pre>
        )}

        {/* Rien à montrer encore : une ligne d'invite avec un curseur qui
            respire. Le vide *actif* se lit comme « ça travaille » ; une
            boîte noire immobile se lit comme « c'est cassé ». */}
        {running && outcome.output.length === 0 && !outcome.error && (
          <div className="flex items-center gap-2 px-3 py-2.5 font-mono text-(--text-code)">
            <span className="text-signal">&rsaquo;</span>
            <span className="mo-breathe inline-block h-[1em] w-[0.55em] bg-signal/80" />
          </div>
        )}

        {notice && (
          <p className="border-t border-line-2/50 px-3 py-2 font-mono text-12 text-chalk-4">
            {notice}
          </p>
        )}

        {stopped && (
          <p className="px-3 py-2.5 font-mono text-12 leading-relaxed text-chalk-4">
            Exécution interrompue. Le worker a été terminé — rien ne continue
            de tourner en arrière-plan.
          </p>
        )}

        {outcome.status === "done" && outcome.output.length === 0 && outcome.ok && (
          <p className="px-3 py-2.5 font-mono text-12 text-chalk-4">
            Aucune sortie — un code qui calcule sans afficher ne dit rien.
          </p>
        )}
      </section>

      {/* Le balayage : une ligne qui descend la console pendant que le
          moteur travaille. Il est hors du flux (absolu) et hors du
          `aria-live`, sinon chaque passage serait annoncé. */}
      {busy && (
        <div
          aria-hidden
          className="mo-scan pointer-events-none absolute inset-x-0 top-[34px] h-px bg-signal/70"
        />
      )}
    </Motion>
  );
}
