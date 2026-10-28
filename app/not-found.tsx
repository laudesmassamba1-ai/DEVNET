import Link from "next/link";
import type { Metadata } from "next";
import { PublicFooter } from "@/components/PublicFooter";

export const metadata: Metadata = {
  title: "Page introuvable — DevNet",
};

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col px-5">
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-[460px] text-center">
          <p className="label prompt-label text-signal">Erreur 404</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-chalk">
            Cette page n’existe pas.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-chalk-3">
            Le lien est peut-être ancien, ou la ressource a été supprimée. Rien
            d’inquiétant : le reste de DevNet est toujours là.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <Link
              href="/feed"
              className="lift-press flex h-[var(--h-tap)] items-center justify-center rounded-[var(--radius-input)] border border-signal bg-signal px-5 text-[13px] font-bold text-void shadow-sh-2"
            >
              Aller au fil
            </Link>
            <Link
              href="/"
              className="lift-press flex h-[var(--h-tap)] items-center justify-center rounded-[var(--radius-input)] border border-line-3 bg-surface px-5 text-[13px] font-bold text-chalk hover:border-signal"
            >
              Retour à l’accueil
            </Link>
          </div>
        </div>
      </div>
      <PublicFooter />
    </main>
  );
}
