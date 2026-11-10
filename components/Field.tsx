"use client";

import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";

const CONTROL = /^(input|textarea|select)$/;

/**
 * Étiquette de champ.
 *
 * Avant : trois copies locales rendaient `<label>` en **frère** du champ, sans
 * `htmlFor` ni `id`. Le libellé était donc purement visuel : un lecteur
 * d'écran annonçait « zone de texte » et rien d'autre, et cliquer sur
 * l'étiquette ne donnait pas le focus. Ici, un `useId` unique relie les deux.
 *
 * Quand l'enfant est un groupe de contrôles (sélecteur d'icônes, lignes
 * clé/valeur), l'étiquette nomme le groupe via `aria-labelledby` au lieu de
 * pointer vers un élément qui n'est pas un champ.
 */
export function Field({
  label,
  children,
  tight,
}: {
  label: string;
  children: ReactNode;
  tight?: boolean;
}) {
  const id = useId();
  const child = isValidElement(children)
    ? (children as ReactElement<{ id?: string }>)
    : null;
  const isControl =
    !!child && typeof child.type === "string" && CONTROL.test(child.type);

  return (
    <div className={tight ? "" : "mb-4"}>
      <label
        htmlFor={isControl ? id : undefined}
        id={isControl ? undefined : `${id}-label`}
        className="label mb-1.5 block text-chalk"
      >
        {label}
      </label>
      {isControl ? (
        cloneElement(child, { id })
      ) : (
        <div role="group" aria-labelledby={`${id}-label`}>
          {children}
        </div>
      )}
    </div>
  );
}
