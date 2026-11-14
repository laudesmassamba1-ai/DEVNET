"use client";

import { Motion } from "./Motion";

/**
 * Les trois points de « en train d'écrire ».
 *
 * Ils ne **battent pas** ensemble : chacun part avec un décalage. Une
 * rangée qui pulse d'un bloc se lit comme un chargement — un.No — alors
 * qu'une vague se lit comme quelqu'un qui écrit. C'est la différence
 * entre « ça charge » et « il est là ».
 *
 * Le décalage passe par `animation-delay`, pas par trois keyframes : une
 * seule grammaire, trois retards. C'est la même règle que la cascade
 * d'entrée, appliquée à l'infini.
 */
export function TypingDots({ label = "écrit" }: { label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-flex items-center gap-[3px]"
    >
      {[0, 1, 2].map((i) => (
        <Motion
          key={i}
          as="span"
          role="pulse"
          delay={i * 160}
          className="inline-block size-[4px] rounded-full bg-signal"
        />
      ))}
    </span>
  );
}

/**
 * La ligne « X écrit… » sous les messages.
 *
 * Elle apparaît **seulement** quand quelqu'un tape, et disparaît sans
 * laisser de trace. Une ligne d'indicateur vide en permanence est le
 * détail le plus facile à rater — on la met partout « au cas où », et
 * elle devient du bruit sur toutes les conversations, y compris celles
 * où personne n'écrit.
 */
export function TypingLine({ names }: { names: string[] }) {
  if (names.length === 0) return null;

  return (
    <div className="mo-fade mb-2 flex items-center gap-2 px-1 text-12 text-chalk-3">
      <TypingDots />
      <span className="truncate">
        {names.length === 1
          ? `${names[0]} écrit`
          : names.length === 2
            ? `${names[0]} et ${names[1]} écrivent`
            : `${names.length} personnes écrivent`}
      </span>
    </div>
  );
}