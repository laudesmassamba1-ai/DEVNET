"use client";

import { avatarClass, initials } from "@/lib/utils";
import type { PresenceEntry } from "@/lib/presence";

/**
 * Le rail de présence d'un dépôt.
 *
 * Il répond à une seule question — **qui d'autre travaille ici, et sur
 * quoi** — et il y répond **même quand la réponse est « personne »**. Un
 * rail qui disparaîtrait quand il est vide laisserait croire que le
 * mécanisme n'existe pas ; c'est la leçon de la session « ça ne marche
 * pas », appliquée à un bandeau plutôt qu'à un écran.
 *
 * La ligne surlignée est celle dont le fichier est **celui qu'on a
 * ouvert** : c'est l'information qui compte avant d'écrire, et elle est
 * signalée en or, pas en ambre — l'ambre est l'interactif, pas l'état.
 */
export function PresenceRail({
  entries,
  openPath,
}: {
  entries: PresenceEntry[];
  openPath: string | null;
}) {
  return (
    <section
      aria-label="Éditeurs présents"
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line-2 pb-2"
    >
      <span className="label-micro flex items-center gap-1.5 text-chalk-4">
        <span aria-hidden="true" className="mo-breathe size-[6px] rounded-full bg-phosphor" />
        présence
      </span>

      {entries.length === 0 && (
        <span className="font-mono text-[11px] text-chalk-4">
          personne d&apos;autre sur ce dépôt
        </span>
      )}

      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {entries.map((entry) => {
          const name = entry.user?.prenom ?? "un compte";
          const same = Boolean(openPath) && entry.file_path === openPath;

          return (
            <li
              key={entry.user_id}
              className="inline-flex items-center gap-1.5 font-mono text-[11px]"
            >
              <span
                aria-hidden="true"
                className={`flex size-[18px] shrink-0 items-center justify-center rounded-full
                  border font-display text-[9px] font-bold
                  ${avatarClass(entry.color || entry.user?.avatar_color)}`}
              >
                {initials(name)}
              </span>

              <span className="text-chalk-2">{name}</span>

              {entry.file_path ? (
                <span className={`truncate ${same ? "text-warn" : "text-chalk-4"}`}>
                  {entry.file_path}
                  {same && <span className="ml-1 text-warn">· même fichier</span>}
                </span>
              ) : (
                <span className="text-chalk-4">hors fichier</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
