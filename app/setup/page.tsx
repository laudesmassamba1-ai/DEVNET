"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Logo } from "@/components/Logo";
import {
  getBackend, probeBackend, subscribe, type BackendProbe,
} from "@/lib/backend";
import { resetStore } from "@/lib/demo/store";

const STEPS: { title: string; body: string; code?: string }[] = [
  {
    title: "1. Préparer PostgreSQL",
    body: "DevNet utilise PostgreSQL, local ou hébergé. Aucun compte Supabase n'est nécessaire : le schéma, les rôles et les politiques vivent dans db/migrations/ et s'appliquent avec la couche de compatibilité.",
  },
  {
    title: "2. Appliquer les migrations",
    body: "Renseigne DATABASE_URL dans .env.local, puis lance le garde-fou et les migrations. Le garde-fou refuse une cible distante sans confirmation explicite.",
    code: "npm run db:guard\nnpm run db:migrate",
  },
  {
    title: "3. Démarrer",
    body: "L'application parle à PostgreSQL via /api/rest et /api/auth. Sans DATABASE_URL, elle bascule en mode démonstration local.",
    code: "npm run dev",
  },
];

export default function SetupPage() {
  const backend = useSyncExternalStore(subscribe, getBackend, getBackend);
  const [busy, setBusy] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  async function retry() {
    setBusy(true);
    await probeBackend(true);
    setBusy(false);
  }

  function hardReset() {
    resetStore();
    setResetDone(true);
  }

  const offline = backend.state === "offline";

  return (
    <div className="mx-auto min-h-dvh max-w-[520px] px-(--gutter) py-8">
      <header className="mb-7 flex items-center gap-3">
        <Logo size={38} className="rounded-[var(--radius-card)] ring-2 ring-signal" />
        <div>
          <h1 className="font-display text-[1.6rem] font-bold tracking-[-0.03em]">
            État du backend
          </h1>
          <p className="label text-chalk-3">
            DevNet · diagnostic
          </p>
        </div>
      </header>

      <div
        className={`mb-6 rounded-[var(--radius-card)] border border-line-3 p-4 shadow-sh-2 ${
          offline ? "bg-danger text-chalk" : "bg-ok text-chalk"
        }`}
      >
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] opacity-70">
          {backend.state === "checking" ? "Vérification en cours" : "Statut"}
        </p>
        <p className="font-display text-[1.35rem] font-bold tracking-[-0.02em]">
          {backend.state === "offline"
            ? "Backend injoignable"
            : backend.state === "online"
              ? "Backend connecté"
              : backend.state === "checking"
                ? "Interrogation en cours…"
                : "Non vérifié"}
        </p>
        {backend.reason && (
          <p className="mt-2 text-sm leading-[1.5] opacity-90">{backend.reason}</p>
        )}
        {backend.url && (
          <p className="mt-2 font-mono text-[11px] opacity-75">{backend.url}</p>
        )}
      </div>

      {offline && (
        <div className="mb-6 rounded-[var(--radius-card)] border border-line-3 bg-surface p-4 shadow-sh-1">
          <p className="text-[13px] leading-[1.6] text-chalk-2">
            L&apos;application tourne sur un{" "}
            <strong className="text-chalk">backend local de démonstration</strong> :
            comptes, posts, groupes et messages fictifs, sur ce navigateur.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <button
              type="button" onClick={retry} disabled={busy}
              className="mo-press h-[40px] rounded-[var(--radius-input)] border border-line-3 bg-signal px-4
                text-sm font-bold text-chalk shadow-sh-1 disabled:opacity-40"
            >
              {busy ? "Vérification…" : "Réessayer maintenant"}
            </button>
            <button
              type="button" onClick={hardReset}
              className="h-[40px] rounded-[var(--radius-input)] border border-line-3 px-4 text-sm
                font-bold transition-colors hover:bg-surface-2"
            >
              Réinitialiser les données de démo
            </button>
          </div>
          {resetDone && (
            <p className="mt-3 text-[12px] text-ok">Données de démonstration réinitialisées.</p>
          )}
        </div>
      )}

      <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-chalk">
        Reconnecter un backend
      </h2>

      <ol className="mb-7 space-y-3">
        {STEPS.map((s) => (
          <li key={s.title}
            className="rounded-[var(--radius-card)] border border-line-3 bg-surface p-4 shadow-sh-1">
            <h3 className="mb-1.5 text-[13.5px] font-bold">{s.title}</h3>
            <p className="text-sm leading-[1.6] text-chalk-2">{s.body}</p>
            {s.code && (
              <pre className="mt-3 overflow-x-auto rounded-[var(--radius-input)] border-[var(--bw-thin)]
                border-line-2 bg-surface-2 px-3 py-2 font-mono text-[11px] text-chalk">
                {s.code}
              </pre>
            )}
          </li>
        ))}
      </ol>

      <div className="mb-7 rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface-2 p-4">
        <h3 className="mb-1.5 text-sm font-bold">Compte de démonstration</h3>
        <p className="text-[12px] leading-[1.6] text-chalk-2">
          Pour ouvrir le fil sans backend :{" "}
          <span className="font-mono text-chalk">koffi@devnet.africa</span>, n&apos;importe
          quel mot de passe.
        </p>
      </div>

      <div className="flex gap-2.5">
        <Link
          href="/feed"
          className="mo-press flex h-[var(--h-tap)] flex-1 items-center justify-center
            rounded-[var(--radius-input)] border border-line-3 bg-surface text-[13px] font-bold text-chalk"
        >
          Retour à l&apos;application
        </Link>
        <Link
          href="/login"
          className="flex h-[var(--h-tap)] items-center rounded-[var(--radius-input)] border
            border-line-3 px-4 text-[13px] font-bold transition-colors hover:bg-surface-2"
        >
          Connexion
        </Link>
      </div>
    </div>
  );
}

/** Réexport pour réutiliser le type dans d'éventuels tests. */
export type { BackendProbe };