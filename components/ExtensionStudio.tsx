"use client";

import Link from "next/link";
import { ExtensionGuide } from "@/components/ExtensionGuide";
import { Icon } from "@/components/Icon";
import { EXAMPLE_EXTENSION, EXAMPLE_SLOT_IDS } from "@/lib/example-extension";
import type { ExtensionInstall, ExtensionWithAuthor } from "@/lib/types";

/**
 * Le bloc « extension d’exemple » de la place de marché.
 *
 * Il ne fabrique aucune donnée : si l’exemple existe, il montre son état
 * réel ; sinon il propose de le publier pour le compte connecté. Les trois
 * actions (publier, installer, activer/désactiver) sont branchées sur les
 * fonctions de `lib/extensions.ts` par la page.
 */
export function ExtensionStudio({
  example,
  install,
  signedIn,
  onPublish,
  onInstall,
  onToggle,
  onSettings,
}: {
  example: ExtensionWithAuthor | null;
  install?: ExtensionInstall;
  signedIn: boolean;
  onPublish: () => void;
  onInstall: () => void;
  onToggle: () => void;
  onSettings: () => void;
}) {
  const capabilities = [
    ["Extraits", example?.manifest.snippets?.length ?? EXAMPLE_EXTENSION.manifest.snippets?.length ?? 0],
    ["Commandes", example?.manifest.commands?.length ?? EXAMPLE_EXTENSION.manifest.commands?.length ?? 0],
    ["Réglages", example?.manifest.settings?.length ?? EXAMPLE_EXTENSION.manifest.settings?.length ?? 0],
    ["Cartes", example?.manifest.slots?.length ?? EXAMPLE_EXTENSION.manifest.slots?.length ?? 0],
  ] as const;

  return (
    <div className="mb-4 space-y-3">
      <section
        aria-labelledby="example-extension-title"
        className="rounded-[var(--radius-card)] border border-line-3 bg-surface p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="label-micro text-signal">Extension d’exemple</p>
            <h2 id="example-extension-title" className="mt-1 font-display text-[19px] font-bold text-chalk">
              {EXAMPLE_EXTENSION.name}
            </h2>
            <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-chalk-3">
              {EXAMPLE_EXTENSION.description}
            </p>
          </div>
          <span className="shrink-0 rounded-[var(--radius-chip)] border border-line-3 px-2 py-1
            text-[10px] font-bold uppercase tracking-[0.08em] text-chalk-3">
            Exemple complet
          </span>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {capabilities.map(([label, count]) => (
            <div key={label} className="rounded-[var(--radius-input)] border border-line-2 bg-surface-2 px-3 py-2">
              <dt className="label-micro text-chalk-4">{label}</dt>
              <dd className="tnum mt-0.5 font-display text-[17px] font-bold text-chalk">{count}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 text-[11.5px] leading-relaxed text-chalk-4">
          {example
            ? install
              ? install.enabled
                ? `Installée et active. Ses cartes ciblent ${EXAMPLE_SLOT_IDS.join(" et ")}.`
                : "Installée mais désactivée : ses contributions sont retirées, ses réglages conservés."
              : "Présente dans la place de marché, pas encore installée sur ce compte."
            : "Pas encore publiée sur ce backend. Le bouton la crée pour ton compte, sans migration."}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {!signedIn && (
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-input)]
                border border-line-3 bg-signal px-4 text-sm font-bold text-void"
            >
              Se connecter pour l’essayer
            </Link>
          )}

          {signedIn && !example && (
            <button
              type="button"
              onClick={onPublish}
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-input)]
                border border-line-3 bg-signal px-4 text-sm font-bold text-void"
            >
              Publier l’exemple
            </button>
          )}

          {signedIn && example && !install && (
            <button
              type="button"
              onClick={onInstall}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-input)]
                border border-line-3 bg-signal px-4 text-sm font-bold text-void"
            >
              <Icon name="package" size={14} /> Installer l’exemple
            </button>
          )}

          {signedIn && example && install && (
            <button
              type="button"
              onClick={onToggle}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-input)]
                border border-line-3 bg-surface px-4 text-sm font-bold text-chalk"
            >
              <Icon name={install.enabled ? "check" : "lock"} size={14} />
              {install.enabled ? "Désactiver" : "Activer"}
            </button>
          )}

          {signedIn && example && install && !!example.manifest.settings?.length && (
            <button
              type="button"
              onClick={onSettings}
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-input)]
                border border-line-3 px-4 text-sm font-bold text-chalk-2"
            >
              Réglages
            </button>
          )}

          <Link
            href="/decouvrir"
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-input)]
              px-3 text-sm font-bold text-signal hover:underline"
          >
            Voir dans Découvrir
          </Link>
        </div>
      </section>

      <ExtensionGuide />
    </div>
  );
}
