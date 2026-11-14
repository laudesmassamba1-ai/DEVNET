"use client";

import Link from "next/link";
import { useState } from "react";
import { api, usingDemoData } from "@/lib/api/client";
import { Logo } from "@/components/Logo";

const inputCls =
  "h-(--h-input) w-full rounded-(--radius-input) border border-line-3 bg-surface px-3.5 text-[14px] " +
  "shadow-sh-1 transition-[transform,box-shadow] placeholder:text-chalk-4 " +
  "focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_var(--color-signal)]";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");

    // On ne révèle jamais si l'adresse correspond à un compte : la réponse
    // est la même dans les deux cas, seul un email part (ou pas).
    try {
      const result = await api.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reinitialiser-mot-de-passe`,
      });
      if (result.error) {
        setBusy(false);
        setError(result.error.message);
        return;
      }
    } catch {
      setBusy(false);
      setError("L'envoi du lien est indisponible pour le moment.");
      return;
    }

    setBusy(false);
    setSent(true);
  }

  return (
    <main className="mo-rise relative flex min-h-dvh flex-col items-center justify-start overflow-hidden px-6 pt-14 pb-10">
      <span className="mo-breathe absolute -top-[70px] -right-[70px] size-[200px] rounded-full bg-ok opacity-12" />
      <div className="relative z-1 w-full max-w-[400px]">
        <div className="mb-5 text-center">
          <Logo size={54} className="mx-auto rounded-(--radius-card) border border-line-3" />
        </div>

        <h1 className="text-center font-display text-2xl font-bold tracking-tight text-chalk">
          Mot de passe oublié
        </h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-chalk-3">
          Indique l’adresse de ton compte. Si elle existe, un lien pour choisir un
          nouveau mot de passe t’est envoyé.
        </p>

        {sent ? (
          <div className="mt-7 rounded-(--radius-card) border border-ok/50 bg-surface p-5 text-center">
            <p className="font-display text-[15px] font-bold text-chalk">Demande envoyée.</p>
            <p className="mt-2 text-sm leading-relaxed text-chalk-3">
              Si un compte correspond à <span className="text-chalk">{email.trim()}</span>,
              tu recevras un lien d’ici quelques minutes. Pense à regarder les indésirables.
            </p>
            {usingDemoData() && (
              <p className="mt-3 border-t border-line-2 pt-3 text-xs leading-relaxed text-chalk-4">
                Mode démonstration : aucun email réel n’est envoyé. Le flux est simulé.
              </p>
            )}
            <Link
              href="/login"
              className="mt-4 inline-flex text-[13px] font-bold text-signal hover:underline"
            >
              Retour à la connexion
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-7 space-y-3">
            {error && (
              <p role="alert" className="rounded-(--radius-input) border border-danger bg-danger/8 px-3.5 py-2.5 text-[13px] text-danger">
                {error}
              </p>
            )}
            <label className="block">
              <span className="label mb-1.5 block text-chalk-3">Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="toi@ecole.fr"
                className={inputCls}
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="lift-press flex h-(--h-tap) w-full items-center justify-center rounded-(--radius-input) border border-signal bg-signal px-5 text-[13px] font-bold text-void shadow-sh-2 disabled:opacity-60"
            >
              {busy ? "Envoi…" : "Envoyer le lien"}
            </button>
            <p className="pt-1 text-center text-12 text-chalk-4">
              <Link href="/login" className="hover:text-chalk-2">← Retour à la connexion</Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
