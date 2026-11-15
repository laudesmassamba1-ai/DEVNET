"use client";

import { Motion, cascade } from "./Motion";

/**
 * BuildPipeline — la publication « compile ».
 *
 * Publier sur DevNet n'est pas envoyer une photo : c'est **livrer du
 * travail**. Le geste passe donc par la métaphore qu'un développeur
 * connaît mieux que toute autre — le pipeline de build. Trois étapes
 * s'affichent en cascade, chacune acquittée par un `✓` :
 *
 *   ❯ lint   ✓
 *   ❯ build  ✓
 *   ❯ ship   ✓
 *
 * Le pipeline est du **théâtre optimiste** : la publication part tout de
 * suite, la séquence est plafonnée (900 ms minimum, une seule fois,
 * jamais de boucle) pour être lue sans ralentir le travail réel. Sous
 * `prefers-reduced-motion`, les lignes apparaissent sans cascade — le
 * CSS neutralise, le contenu reste.
 */

const STEPS = [
  { cmd: "lint", note: "0 erreur" },
  { cmd: "build", note: "ok" },
  { cmd: "ship", note: "en ligne" },
] as const;

export function BuildPipeline() {
  return (
    <div
      role="status"
      className="rounded-(--radius-card) border border-line-2 bg-surface-2"
      aria-label="Publication en cours — lint, build, en ligne"
    >
      {/* Chrome de terminal : une barre de titre sobre, pas une
          fenêtre macétique. */}
      <div className="flex items-center gap-2 border-b border-line-2 px-3 py-1.5">
        <span className="size-1.5 rounded-full bg-line-3" aria-hidden />
        <span className="label-micro text-chalk-4">devnet — publication</span>
      </div>

      <div className="px-3 py-2 font-mono text-12 leading-(--lh-code)">
        {STEPS.map((step, i) => (
          <Motion
            key={step.cmd}
            role="slide"
            delay={cascade(i, 200, 600)}
            className="flex items-baseline gap-2"
          >
            <span className="text-signal" aria-hidden>
              ❯
            </span>
            <span className="text-chalk">{step.cmd}</span>
            {/* L'acquittement arrive un demi-cran après la commande :
                on voit la commande s'exécuter, puis réussir. */}
            <Motion
              as="span"
              role="fade"
              delay={cascade(i, 200, 600) + 220}
              className="ml-auto flex items-center gap-1.5 text-chalk-4"
            >
              {step.note}
              <span className="mo-pop text-phosphor" aria-hidden>
                ✓
              </span>
            </Motion>
          </Motion>
        ))}
      </div>
    </div>
  );
}
