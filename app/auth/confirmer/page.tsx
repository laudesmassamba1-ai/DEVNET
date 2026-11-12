"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, usingDemoData } from "@/lib/api/client";
import { Logo } from "@/components/Logo";
import { rearmSplash } from "@/components/SplashScreen";

export default function ConfirmEmailPage() {
  const [checking, setChecking] = useState(true);
  const [ok, setOk] = useState(false);
  const [invalid, setInvalid] = useState(false);

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
            await api.auth.exchangeCodeForSession(code);
          } catch {
            if (tokenHash && type) {
              try {
                await api.auth.verifyOtp({ token_hash: tokenHash, type: type as "email" });
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
          setOk(true);
          setChecking(false);
          // Session ouverte par le lien : la scène d'ouverture se rejoue
          // au prochain chargement complet (voir `rearmSplash`).
          rearmSplash();
          return;
        }

        if (tokenHash && type) {
          try {
            await api.auth.verifyOtp({ token_hash: tokenHash, type: type as "email" });
            setOk(true);
            setChecking(false);
            // Session ouverte par le lien : voir le cas `code`.
            rearmSplash();
            return;
          } catch {
            setInvalid(true);
            setChecking(false);
            return;
          }
        }

        const { data: sess } = await api.auth.getSession();
        if (sess.session) {
          setOk(true);
          setChecking(false);
          return;
        }

        setInvalid(true);
        setChecking(false);
      } catch (e) {
        console.error(e);
        setInvalid(true);
        setChecking(false);
      }
    }

    void exchange();
  }, []);

  return (
    <main className="mo-rise relative flex min-h-dvh flex-col items-center justify-start overflow-hidden px-6 pt-14 pb-10">
      <span className="mo-breathe absolute -top-[70px] -right-[70px] size-[200px] rounded-full bg-ok opacity-12" />
      <div className="relative z-1 w-full max-w-[400px]">
        <div className="mb-5 text-center">
          <Logo size={54} className="mx-auto rounded-[var(--radius-card)] border border-line-3" />
        </div>

        <h1 className="text-center font-display text-2xl font-bold tracking-tight text-chalk">
          Confirmation de l’adresse email
        </h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-chalk-3">
          On vérifie ton lien de confirmation…
        </p>

        {checking && (
          <div className="mt-7 rounded-[var(--radius-card)] border border-line-2 bg-surface p-5 text-center">
            <p className="text-sm text-chalk-3">Vérification du lien…</p>
          </div>
        )}

        {invalid && !checking && (
          <div className="mt-7 rounded-[var(--radius-card)] border border-warn/60 bg-surface p-5 text-center">
            <p className="font-display text-[15px] font-bold text-chalk">Lien invalide ou expiré.</p>
            <p className="mt-2 text-sm leading-relaxed text-chalk-3">
              Le lien de confirmation a expiré ou est déjà utilisé. Tu peux te reconnecter
              pour demander un nouveau renvoi.
            </p>
            <Link
              href="/login"
              className="mt-4 inline-flex text-[13px] font-bold text-signal hover:underline"
            >
              Retour à la connexion
            </Link>
          </div>
        )}

        {ok && !checking && (
          <div className="mt-7 rounded-[var(--radius-card)] border border-ok/50 bg-surface p-5 text-center">
            <p className="font-display text-[15px] font-bold text-chalk">Email confirmé.</p>
            <p className="mt-2 text-sm leading-relaxed text-chalk-3">
              Ton adresse email est vérifiée. Tu peux accéder à ton espace.
            </p>
            {usingDemoData() && (
              <p className="mt-3 border-t border-line-2 pt-3 text-xs leading-relaxed text-chalk-4">
                Mode démonstration : la confirmation est simulée.
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
              <Link
                href="/feed"
                className="inline-flex text-[13px] font-bold text-signal hover:underline"
              >
                Aller au fil
              </Link>
              <Link
                href="/login"
                className="inline-flex text-[13px] font-bold text-chalk-3 hover:text-chalk"
              >
                Retour à la connexion
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
