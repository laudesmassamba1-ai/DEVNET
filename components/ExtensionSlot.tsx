"use client";

import { useEffect, useId, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { fetchSlotContributions, type SlotContribution } from "@/lib/extensions";

/**
 * Affiche les cartes que les extensions **actives** déclarent pour un
 * emplacement donné.
 *
 * Le composant ne décide pas du contenu : il lit le manifeste et rend ce
 * qu'il y trouve. Sans extension active, il ne rend **rien** — pas de cadre
 * vide, pas de titre orphelin : un emplacement sans contribution ne doit pas
 * ressembler à une fonctionnalité en panne.
 *
 * La carte reste volontairement textuelle (titre, corps, lien vérifié côté
 * validation) : le niveau 1 n'exécute aucun code et n'interprète aucun HTML.
 */
export function ExtensionSlot({
  slot,
  title = "Extensions actives",
}: {
  slot: string;
  title?: string;
}) {
  const { profile } = useSession();
  const headingId = useId();
  const [rows, setRows] = useState<SlotContribution[]>([]);

  useEffect(() => {
    let alive = true;
    if (!profile?.id) return;

    void fetchSlotContributions(profile.id, slot).then((next) => {
      if (alive) setRows(next);
    });

    return () => {
      alive = false;
    };
  }, [profile?.id, slot]);

  // Sans session, aucune contribution ne peut être lue : on n'affiche rien
  // même si un état précédent traîne (déconnexion).
  const visible = profile?.id ? rows : [];
  if (visible.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-[var(--radius-card)] border border-dashed border-line-2 p-4"
    >
      <p id={headingId} className="label-micro text-chalk-4">
        {title}
      </p>
      <ul className="mt-3 space-y-3">
        {visible.map(({ extension, slot: card }, index) => {
          const external = card.href?.startsWith("https://") ?? false;
          return (
            <li
              key={`${extension.id}-${index}`}
              className="text-sm leading-relaxed text-chalk-3"
            >
              <p className="font-bold text-chalk">{card.title}</p>
              {card.body && <p className="mt-0.5">{card.body}</p>}
              <p className="label-micro mt-1 text-chalk-4">via {extension.name}</p>
              {card.href && (
                <a
                  href={card.href}
                  {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="mt-1 inline-flex min-h-[var(--h-tap)] items-center text-[12px]
                    font-bold text-signal hover:underline focus-visible:outline-2
                    focus-visible:outline-offset-2 focus-visible:outline-signal"
                >
                  Ouvrir
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
