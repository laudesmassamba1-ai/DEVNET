"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, usingDemoData } from "@/lib/supabase/client";
import { useSession } from "@/hooks/useSession";
import { Icon } from "@/components/Icon";
import { Loading } from "@/components/Avatar";
import { PublicFooter } from "@/components/PublicFooter";
import { accountLabel } from "@/lib/utils";
import { asVerificationStatus, VERIFY_STATUS_LABEL } from "@/lib/verification";

const inputCls =
  "h-[var(--h-input)] w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3.5 text-[14px] " +
  "shadow-sh-1 outline-none transition-[transform,box-shadow] placeholder:text-chalk-4 " +
  "focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_#FF8A3D]";

type Theme = "liquid-bleu" | "light";

export default function SettingsPage() {
  const router = useRouter();
  const { session, profile, loading } = useSession();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [theme, setTheme] = useState<Theme>("liquid-bleu");
  const [showDelete, setShowDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifPush, setNotifPush] = useState(false);

  useEffect(() => {
    try {
      const t = localStorage.getItem("devnet:theme");
      if (t === "light")
    // eslint-disable-next-line react-hooks/set-state-in-effect
        setTheme("light");
      else setTheme("liquid-bleu");
    } catch {}
  }, []);

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/login");
    }
  }, [loading, session, router]);

  function applyTheme(next: Theme) {
    setTheme(next);
    try {
      localStorage.setItem("devnet:theme", next);
      document.documentElement.dataset.theme = next;
    } catch {}
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg("");
    setPwErr("");
    if (pw.length < 6) {
      setPwErr("Mot de passe trop court (6 caractères minimum).");
      return;
    }
    if (pw !== pw2) {
      setPwErr("Les mots de passe ne correspondent pas.");
      return;
    }
    setPwBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) {
        setPwErr(error.message);
        setPwBusy(false);
        return;
      }
      setPw("");
      setPw2("");
      setPwMsg("Mot de passe mis à jour avec succès.");
    } catch (err) {
      setPwErr(err instanceof Error ? err.message : "Erreur inconnue");
    }
    setPwBusy(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function deleteAccount() {
    setDeleteBusy(true);
    try {
      if (usingDemoData()) {
        await supabase.auth.signOut();
        try {
          localStorage.removeItem("devnet:demo.store");
          localStorage.removeItem("devnet:demo.session");
          sessionStorage.removeItem("devnet.demo.pick");
        } catch {}
        router.replace("/login");
        return;
      }
      await supabase.auth.signOut();
      router.replace("/login");
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="mo-rise flex min-h-dvh items-center justify-center px-5">
        {/* Le logo en boucle porte la scène : aucun « Chargement… »
            sous l'œil, l'information reste au lecteur d'écran. */}
        <Loading label="Chargement des réglages" />
      </main>
    );
  }

  if (!session) return null;

  return (
    <main className="mo-rise min-h-dvh px-5">
      <header className="mx-auto flex h-[var(--h-topbar)] max-w-[900px] items-center border-b border-line-2">
        <Link href="/" className="font-display text-lg font-bold text-chalk">
          DevNet<span className="text-signal">.</span>
        </Link>
        <div className="ml-auto flex items-center gap-3 text-[13px] font-bold text-chalk-3">
          <Link href="/profile" className="hover:text-chalk">Mon profil</Link>
          <Link href="/feed" className="hover:text-chalk">Fil</Link>
        </div>
      </header>

      <div className="mx-auto max-w-[760px] py-10 sm:py-14">
        <p className="label prompt-label text-signal">Compte</p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-chalk sm:text-4xl">
          Paramètres
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-chalk-3">
          Gère ton compte, ta sécurité et tes préférences.
        </p>

        <div className="mt-8 space-y-6">
          <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
              <Icon name="profile" size={18} strokeWidth={2} />
              Informations du compte
            </h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-chalk-4">Email</dt>
                <dd className="mt-0.5 text-chalk">{session.user.email}</dd>
              </div>
              <div>
                <dt className="text-chalk-4">Pseudo</dt>
                <dd className="mt-0.5 text-chalk">{profile?.pseudo ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-chalk-4">Type de compte</dt>
                <dd className="mt-0.5 text-chalk">
                  {profile ? accountLabel(profile.account_type) : "—"}
                </dd>
              </div>
              {/* La vérification n'est plus un simple Oui/Non : elle a un
                  état (demande en cours, refusée) et un endroit où on la
                  demande. La case affiche l'état et mène au flux. */}
              <div>
                <dt className="text-chalk-4">Vérification</dt>
                <dd className="mt-0.5 text-chalk">
                  {VERIFY_STATUS_LABEL[asVerificationStatus(profile?.verification_status)]}
                  {" "}
                  <Link
                    href="/profile?tab=settings"
                    className="font-bold text-signal hover:underline"
                  >
                    gérer →
                  </Link>
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
              <Icon name="lock" size={18} strokeWidth={2} />
              Sécurité
            </h2>
            <form onSubmit={changePassword} className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-1">
                <span className="label mb-1.5 block text-chalk-3">Nouveau mot de passe</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="6 caractères minimum"
                  className={inputCls}
                />
              </label>
              <label className="block sm:col-span-1">
                <span className="label mb-1.5 block text-chalk-3">Confirmer</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  placeholder="••••••••"
                  className={inputCls}
                />
              </label>
              <div className="sm:col-span-2">
                {pwErr && <p className="text-xs text-warn">{pwErr}</p>}
                {pwMsg && <p className="text-xs text-ok">{pwMsg}</p>}
                <button
                  type="submit"
                  disabled={pwBusy}
                  className="lift-press mt-1 flex h-[var(--h-tap)] items-center justify-center rounded-[var(--radius-input)] border border-signal bg-signal px-5 text-[13px] font-bold text-void shadow-sh-2 disabled:opacity-60"
                >
                  {pwBusy ? "Enregistrement…" : "Changer le mot de passe"}
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
              <Icon name="sun" size={18} strokeWidth={2} />
              Apparence
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => applyTheme("liquid-bleu")}
                className={`lift-press flex h-[var(--h-tap)] items-center justify-center rounded-[var(--radius-input)] border px-4 text-[13px] font-bold ${
                  theme === "liquid-bleu"
                    ? "border-signal bg-signal text-void"
                    : "border-line-3 bg-surface text-chalk hover:border-signal"
                }`}
              >
                Thème sombre
              </button>
              <button
                type="button"
                onClick={() => applyTheme("light")}
                className={`lift-press flex h-[var(--h-tap)] items-center justify-center rounded-[var(--radius-input)] border px-4 text-[13px] font-bold ${
                  theme === "light"
                    ? "border-signal bg-signal text-void"
                    : "border-line-3 bg-surface text-chalk hover:border-signal"
                }`}
              >
                Thème clair
              </button>
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
              <Icon name="notifications" size={18} strokeWidth={2} />
              Notifications
            </h2>
            <div className="mt-3 space-y-2 text-sm">
              <label className="flex items-center justify-between rounded-[var(--radius-input)] border border-line-2 bg-surface-2 p-3">
                <div>
                  <p className="font-bold text-chalk">Email</p>
                  <p className="text-xs text-chalk-4">Alertes sur mentions, réponses et messages</p>
                </div>
                <button
                  type="button"
                  onClick={() => setNotifEmail((v) => !v)}
                  className={`relative h-6 w-11 rounded-full border transition ${
                    notifEmail ? "border-signal bg-signal" : "border-line-3 bg-surface"
                  }`}
                  aria-pressed={notifEmail}
                >
                  <span
                    className={`absolute top-[2px] size-5 rounded-full bg-chalk shadow transition ${
                      notifEmail ? "right-[2px]" : "left-[2px]"
                    }`}
                  />
                </button>
              </label>
              <label className="flex items-center justify-between rounded-[var(--radius-input)] border border-line-2 bg-surface-2 p-3">
                <div>
                  <p className="font-bold text-chalk">Push (navigateur)</p>
                  <p className="text-xs text-chalk-4">Notifications dans cet onglet</p>
                </div>
                <button
                  type="button"
                  onClick={() => setNotifPush((v) => !v)}
                  className={`relative h-6 w-11 rounded-full border transition ${
                    notifPush ? "border-signal bg-signal" : "border-line-3 bg-surface"
                  }`}
                  aria-pressed={notifPush}
                >
                  <span
                    className={`absolute top-[2px] size-5 rounded-full bg-chalk shadow transition ${
                      notifPush ? "right-[2px]" : "left-[2px]"
                    }`}
                  />
                </button>
              </label>
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
              <Icon name="link" size={18} strokeWidth={2} />
              Liens utiles
            </h2>
            <div className="mt-3 flex flex-wrap gap-2 text-[13px] font-bold text-chalk-3">
              <Link href="/aide" className="hover:text-chalk">Aide</Link>
              <Link href="/confidentialite" className="hover:text-chalk">Confidentialité</Link>
              <Link href="/cgu" className="hover:text-chalk">CGU</Link>
              <Link href="/a-propos" className="hover:text-chalk">À propos</Link>
              <Link href="/setup" className="hover:text-chalk">Diagnostic</Link>
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-warn/40 bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
              <Icon name="flag" size={18} strokeWidth={2} />
              Zone de danger
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-chalk-3">
              Supprimer ton compte est irréversible. Tes contenus resteront visibles selon les règles
              existantes, mais ton accès sera définitivement retiré.
            </p>
            {!showDelete ? (
              <button
                type="button"
                onClick={() => setShowDelete(true)}
                className="lift-press mt-4 flex h-[var(--h-tap)] items-center justify-center rounded-[var(--radius-input)] border border-warn bg-warn px-5 text-[13px] font-bold text-void shadow-sh-2"
              >
                Supprimer mon compte
              </button>
            ) : (
              <div className="mt-4 rounded-[var(--radius-card)] border border-warn/60 bg-surface-2 p-4">
                <p className="text-sm font-bold text-chalk">Es-tu sûr de vouloir supprimer ton compte ?</p>
                <p className="mt-1 text-xs text-chalk-4">Cette action ne peut pas être annulée.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={deleteAccount}
                    disabled={deleteBusy}
                    className="lift-press flex h-[var(--h-tap)] items-center justify-center rounded-[var(--radius-input)] border border-warn bg-warn px-5 text-[13px] font-bold text-void shadow-sh-2 disabled:opacity-60"
                  >
                    {deleteBusy ? "Suppression…" : "Oui, supprimer définitivement"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDelete(false)}
                    className="lift-press flex h-[var(--h-tap)] items-center justify-center rounded-[var(--radius-input)] border border-line-3 bg-surface px-5 text-[13px] font-bold text-chalk hover:border-signal"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </section>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={signOut}
              className="lift-press flex h-[var(--h-tap)] items-center justify-center rounded-[var(--radius-input)] border border-line-3 bg-surface px-5 text-[13px] font-bold text-chalk hover:border-signal"
            >
              Se déconnecter
            </button>
          </div>
        </div>
      </div>

      <PublicFooter />
    </main>
  );
}
