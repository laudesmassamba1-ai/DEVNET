"use client";

import Link from "next/link";

/**
 * Le dernier filet.
 *
 * `app/error.tsx` intercepte les erreurs d'un segment **à l'intérieur** du
 * layout racine. Si le layout lui-même casse — un provider, une police, le
 * script de thème —, Next n'a plus de coquille à réutiliser : sans ce
 * fichier, l'utilisateur voit la page d'erreur brute du framework, en
 * anglais et sans issue. Ici on rend un document complet, avec les jetons de
 * l'application et une issue.
 *
 * Pas de couleur littérale : même ce filet de sécurité passe par les
 * variables de `globals.css`. Si la feuille n'a pas chargé, la page reste
 * lisible — du texte noir sur fond blanc — mais elle ne ment pas sur sa
 * palette en figeant une valeur qui contredirait le thème.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body>
        <main className="mx-auto flex min-h-dvh max-w-[460px] flex-col items-center justify-center px-5 text-center">
          <p className="label prompt-label text-signal">Erreur</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-chalk">
            DevNet n&apos;a pas pu démarrer.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-chalk-3">
            Une erreur est survenue avant même l&apos;affichage de la page.
            Réessayez ; si cela persiste, revenez plus tard.
          </p>
          {error.digest && (
            <p className="mt-2 font-mono text-12 text-chalk-4">
              référence : {error.digest}
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={reset}
              className="lift-press flex h-(--h-tap) items-center justify-center rounded-(--radius-input) border border-signal bg-signal px-5 text-13 font-bold text-void shadow-sh-2"
            >
              Réessayer
            </button>
            <Link
              href="/"
              className="lift-press flex h-(--h-tap) items-center justify-center rounded-(--radius-input) border border-line-3 bg-surface px-5 text-13 font-bold text-chalk hover:border-signal"
            >
              Retour à l&apos;accueil
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
