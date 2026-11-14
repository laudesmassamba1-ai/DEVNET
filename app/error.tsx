"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Le filet d’erreur de l’application.
 *
 * Sans ce fichier, une exception de rendu laisse l’écran brut du framework —
 * un mur de texte technique devant quelqu’un qui voulait juste lire un fil.
 * Ici on dit ce qui s’est passé, on propose de réessayer, et on donne une
 * sortie de secours vers le fil.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // La trace reste dans la console pour le développement ; l’écran, lui,
    // ne montre qu’une phrase lisible.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col px-5">
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-[460px] text-center">
          <p className="label prompt-label text-signal">Erreur</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-chalk">
            Quelque chose a cassé.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-chalk-3">
            Une erreur inattendue a interrompu l’affichage de cette page. Tu peux
            réessayer ; si cela persiste, reviens plus tard.
          </p>
          {error.digest && (
            <p className="mt-2 font-mono text-[11px] text-chalk-4">
              référence : {error.digest}
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={reset}
              className="lift-press flex h-(--h-tap) items-center justify-center rounded-(--radius-input) border border-signal bg-signal px-5 text-[13px] font-bold text-void shadow-sh-2"
            >
              Réessayer
            </button>
            <Link
              href="/feed"
              className="lift-press flex h-(--h-tap) items-center justify-center rounded-(--radius-input) border border-line-3 bg-surface px-5 text-[13px] font-bold text-chalk hover:border-signal"
            >
              Aller au fil
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
