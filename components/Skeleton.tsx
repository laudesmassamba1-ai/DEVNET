"use client";

/**
 * Squelettes de chargement.
 *
 * Le défaut d'origine : quinze `loading.tsx` identiques, un spinner plein
 * écran. Un spinner dit « attends » ; il ne dit pas *ce qui* arrive, et
 * l'écran saute ensuite d'une page vide à une page pleine. Un squelette qui
 * reprend la forme du contenu réserve la place, évite le saut de mise en
 * page et laisse déjà voir la structure de ce qu'on attend.
 *
 * Les blocs portent `aria-hidden` : ils ne sont pas du contenu, et un
 * lecteur d'écran n'a rien à annoncer d'autre que le libellé du conteneur.
 * Le conteneur, lui, est `role="status"` avec un texte lisible — l'attente
 * est annoncée une fois, pas bloc par bloc.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`mo-pulse rounded-[var(--radius-chip)] bg-surface-2 ${className}`}
    />
  );
}

export function ListSkeleton({
  rows = 6,
  avatar = true,
  label = "Chargement…",
}: {
  rows?: number;
  avatar?: boolean;
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="px-(--gutter) pt-3"
    >
      <span className="sr-only">{label}</span>
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="rounded-[var(--radius-card)] border border-line-2 bg-surface px-3.5 py-3"
          >
            <div className="flex gap-3">
              {avatar && (
                <Skeleton className="size-10 shrink-0 rounded-full" />
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
                {!avatar && <Skeleton className="h-10 w-full" />}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Page à deux volets (messagerie, IDE) : une colonne de liste, un panneau. */
export function SplitSkeleton({ label = "Chargement…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex h-full min-h-[50dvh] gap-2 px-(--gutter) pt-3"
    >
      <span className="sr-only">{label}</span>
      <div className="w-2/5 space-y-2 border-r border-line-2 pr-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-4/5" />
      </div>
    </div>
  );
}
