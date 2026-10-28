import Link from "next/link";

export function PublicFooter() {
  return (
    <footer className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-5 py-6">
      <Link href="/" className="inline-flex min-h-6 items-center font-mono text-[11px] text-chalk-4 hover:text-chalk-2 underline-sweep">
        DevNet
      </Link>
      <nav aria-label="Informations légales" className="flex gap-4 font-mono text-[11px] text-chalk-4">
        <Link href="/a-propos" className="inline-flex min-h-6 items-center hover:text-chalk-2 underline-sweep">À propos</Link>
        <Link href="/aide" className="inline-flex min-h-6 items-center hover:text-chalk-2 underline-sweep">Aide</Link>
        <Link href="/confidentialite" className="inline-flex min-h-6 items-center hover:text-chalk-2 underline-sweep">Confidentialité</Link>
        <Link href="/cgu" className="inline-flex min-h-6 items-center hover:text-chalk-2 underline-sweep">CGU</Link>
      </nav>
    </footer>
  );
}
