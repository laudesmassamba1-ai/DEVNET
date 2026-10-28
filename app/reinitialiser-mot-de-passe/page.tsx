"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase, usingDemoData } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";

const inputCls =
  "h-[var(--h-input)] w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3.5 text-[14px] " +
  "shadow-sh-1 outline-none transition-[transform,box-shadow] placeholder:text-chalk-4 " +
  "focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_#FF8A3D]";

export default function ResetPasswordPage() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function exchange() {
      try {
        const search = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

        const code = search.get("code");
        const tokenHash = search.get("token_hash") ?? hash.get("token_hash");
        const type = search.get("type") ?? hash.get("type");
        const err = search.get("error_description") || search.get("error") || hash.get("error_description") || hash.get("error");

        if (err) {
          setInvalid(true);
          setChecking(false);
          return;
        }

        if (code) {
          try {
            await supabase.auth.exchangeCodeForSession(code);
          } catch {
            // essai alternatif via verifyOtp si ce type est renvoyé
            if (tokenHash && type) {
              try {
                await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "recovery" });
              } catch {
                setInvalid(true);
                setChecking(false);
                return;
              }
            } else {
              setInvalid(true);
              setChecking(false);
              return;
            }
          }
          setChecking(false);
          return;
        }

        if (tokenHash && type) {
          try {
            await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "recovery" });
            setChecking(false);
            return;
          } catch {
            setInvalid(true);
            setChecking(false);
            return;
          }
        }

        // aucun paramètre ; on vérifie si une session de récupération existe
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) {
          setInvalid(true);
          setChecking(false);
          return;
        }

        setChecking(false);
      } catch (e) {
        console.error(e);
        setInvalid(true);
        setChecking(false);
      }
    }

    void exchange();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");

    if (pw.length < 6) {
      setError("Mot de passe trop court (6 caractères minimum).");
      return;
    }
    if (pw !== pw2) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setBusy(true);
    try {
      const res = await supabase.auth.updateUser({ password: pw });
      if (res.error) {
        setBusy(false);
        setError(res.error.message);
        return;
      }
      setBusy(false);
      setDone(true);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Erreur lors de la mise à jour.");
    }
  }

  return (
    <main className="mo-rise relative flex min-h-dvh flex-col items-center justify-start overflow-hidden px-6 pt-14 pb-10">
      <span className="mo-breathe absolute -top-[70px] -right-[70px] size-[200px] rounded-full bg-ok opacity-12" />
      <div className="relative z-1 w-full max-w-[400px]">
        <div className="mb-5 text-center">
          <Logo size={54} className="mx-auto rounded-[var(--radius-card)] border border-line-3" />
        </div>

        <h1 className="text-center font-display text-2xl font-bold tracking-tight text-chalk">
          Choisir un nouveau mot de passe
        </h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-chalk-3">
          Saisis et confirme ton nouveau mot de passe. Après validation, tu pourras te
          connecter avec celui-ci.
        </p>

        {checking && (
          <div className="mt-7 rounded-[var(--radius-card)] border border-line-2 bg-surface p-5 text-center">
            <p className="text-sm text-chalk-3">Vérification du lien…</p>
          </div>
        )}

        {invalid && !checking && !done && (
          <div className="mt-7 rounded-[var(--radius-card)] border border-warn/60 bg-surface p-5 text-center">
            <p className="font-display text-[15px] font-bold text-chalk">Lien invalide ou expiré.</p>
            <p className="mt-2 text-sm leading-relaxed text-chalk-3">
              Le lien de réinitialisation n’est plus valide. Demande un nouveau lien pour
              continuer.
            </p>
            <Link
              href="/mot-de-passe-oublie"
              className="mt-4 inline-flex text-[13px] font-bold text-signal hover:underline"
            >
              Demander un nouveau lien
            </Link>
          </div>
        )}

        {!checking && !invalid && done && (
          <div className="mt-7 rounded-[var(--radius-card)] border border-ok/50 bg-surface p-5 text-center">
            <p className="font-display text-[15px] font-bold text-chalk">Mot de passe mis à jour.</p>
            <p className="mt-2 text-sm leading-relaxed text-chalk-3">
              Tu peux désormais te connecter avec ton nouveau mot de passe.
            </p>
            {usingDemoData() && (
              <p className="mt-3 border-t border-line-2 pt-3 text-xs leading-relaxed text-chalk-4">
                Mode démonstration : l’accès est à nouveau fonctionnel, aucun service
                de messagerie n’a été sollicité.
              </p>
            )}
            <Link
              href="/login"
              className="mt-4 inline-flex text-[13px] font-bold text-signal hover:underline"
            >
              Aller à la connexion
            </Link>
          </div>
        )}

        {!checking && !invalid && !done && (
          <form onSubmit={submit} className="mt-7 space-y-3">
            <label className="block">
              <span className="label mb-1.5 block text-chalk-3">Nouveau mot de passe</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="6 caractères minimum"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="label mb-1.5 block text-chalk-3">Confirmer le mot de passe</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                placeholder="••••••••"
                className={inputCls}
              />
            </label>
            {error && <p className="text-xs text-warn">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="lift-press flex h-[var(--h-tap)] w-full items-center justify-center rounded-[var(--radius-input)] border border-signal bg-signal px-5 text-[13px] font-bold text-void shadow-sh-2 disabled:opacity-60"
            >
              {busy ? "Enregistrement…" : "Changer le mot de passe"}
            </button>
            <p className="pt-1 text-center text-[12px] text-chalk-4">
              <Link href="/login" className="hover:text-chalk-2">← Retour à la connexion</Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
