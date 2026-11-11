"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useSession } from "@/hooks/useSession";
import { Icon } from "@/components/Icon";
import { Loading } from "@/components/Avatar";
import { accountLabel } from "@/lib/utils";
import { asVerificationStatus, VERIFY_STATUS_LABEL } from "@/lib/verification";
import { broadcastTheme, DEFAULT_THEME, LIGHT_THEME, THEME_STORAGE_KEY } from "@/lib/theme";
import {
  applyReducedMotion,
  FEED_DENSITY_KEY,
  REDUCED_MOTION_KEY,
  type FeedDensity,
} from "@/lib/ui-preferences";

const inputCls =
  "h-[var(--h-input)] w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3.5 text-[14px] " +
  "shadow-sh-1 transition-[box-shadow,border-color] placeholder:text-chalk-4 " +
  "focus-visible:ring-2 focus-visible:ring-signal/70 focus-visible:ring-offset-2 focus-visible:ring-offset-page";

type Theme = typeof DEFAULT_THEME | typeof LIGHT_THEME;

export default function SettingsPage() {
  const router = useRouter();
  const { session, profile, loading } = useSession();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [themeBusy, setThemeBusy] = useState(false);
  const [appearanceMessage, setAppearanceMessage] = useState("");
  const [appearanceError, setAppearanceError] = useState("");
  /** Préférence de réception des médias en messages privés. */
  const [dmMediaOverride, setDmMediaOverride] = useState<boolean | null>(null);
  const [dmMediaBusy, setDmMediaBusy] = useState(false);
  const [dmMediaMessage, setDmMediaMessage] = useState("");
  const [dmMediaError, setDmMediaError] = useState("");

  // `null` tant que rien n'a été touché : la valeur vient du profil, et
  // un état séparé éviterait deux sources de vérité qui divergent.
  const dmMedia = dmMediaOverride ?? profile?.dm_media ?? true;

  async function saveDmMedia(enabled: boolean) {
    setDmMediaBusy(true);
    setDmMediaMessage("");
    setDmMediaError("");
    const { error } = await supabase
      .from("users")
      .update({ dm_media: enabled })
      .eq("id", profile?.id ?? "");
    setDmMediaBusy(false);
    if (error) return setDmMediaError(error.message);
    setDmMediaOverride(enabled);
    setDmMediaMessage(
      enabled
        ? "Les photos et vidéos sont acceptées dans vos messages."
        : "Les photos et vidéos ne seront plus acceptées dans vos messages.",
    );
  }
  const [feedDensity, setFeedDensity] = useState<FeedDensity>("comfortable");
  const [reduceMotion, setReduceMotion] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      const savedDensity = localStorage.getItem(FEED_DENSITY_KEY);
      const savedMotion = localStorage.getItem(REDUCED_MOTION_KEY) === "true";
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preferences are read after hydration
      setTheme(savedTheme === LIGHT_THEME ? LIGHT_THEME : DEFAULT_THEME);
      setFeedDensity(savedDensity === "compact" ? "compact" : "comfortable");
      setReduceMotion(savedMotion);
      applyReducedMotion(savedMotion);
    } catch (error) {
      setAppearanceError(
        error instanceof Error ? `Préférences locales indisponibles : ${error.message}` : "Préférences locales indisponibles.",
      );
    }
  }, []);

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/login");
    }
  }, [loading, session, router]);

  async function saveTheme(next: Theme) {
    setTheme(next);
    broadcastTheme(next);
    setAppearanceMessage("");
    setAppearanceError("");
    if (!profile?.id) {
      setAppearanceError("Le thème est appliqué sur cet appareil, mais le profil n'est pas encore chargé.");
      return;
    }

    setThemeBusy(true);
    try {
      const { error } = await supabase
        .from("users")
        .update({ theme: next })
        .eq("id", profile.id);
      if (error) {
        setAppearanceError(`Thème non enregistré sur le compte : ${error.message}`);
        return;
      }
      setAppearanceMessage("Thème enregistré sur ton compte et cet appareil.");
    } catch (error) {
      setAppearanceError(
        error instanceof Error ? `Thème non enregistré : ${error.message}` : "Thème non enregistré.",
      );
    } finally {
      setThemeBusy(false);
    }
  }

  function saveDensity(next: FeedDensity) {
    setFeedDensity(next);
    try {
      localStorage.setItem(FEED_DENSITY_KEY, next);
      setAppearanceMessage("Densité enregistrée sur cet appareil.");
      setAppearanceError("");
    } catch (error) {
      setAppearanceError(
        error instanceof Error ? `Densité non enregistrée : ${error.message}` : "Densité non enregistrée.",
      );
    }
  }

  function saveMotionPreference(enabled: boolean) {
    setReduceMotion(enabled);
    const saved = applyReducedMotion(enabled);
    setAppearanceMessage(
      saved
        ? "Préférence de mouvement enregistrée sur cet appareil."
        : "Préférence active pour cette session ; le stockage local est bloqué.",
    );
    setAppearanceError("");
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
    setSignOutError("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setSignOutError(`Déconnexion impossible : ${error.message}`);
        return;
      }
      router.replace("/login");
    } catch (error) {
      setSignOutError(
        error instanceof Error ? `Déconnexion impossible : ${error.message}` : "Déconnexion impossible.",
      );
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
    <AppShell title="Paramètres" path="~/settings">
      <div className="mo-rise mx-auto w-full max-w-[760px] px-5 py-8 sm:py-10">
        <p className="label prompt-label text-signal">Compte</p>
        <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-chalk sm:text-4xl">
          Paramètres
        </h2>
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
                  {" · "}
                  <Link
                    href="/profile?tab=settings"
                    className="inline-flex min-h-[var(--h-tap)] items-center font-bold text-signal hover:underline"
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
            <p className="mt-1 text-[13px] text-chalk-3">
              Le thème suit ton compte ; les options de lecture restent sur cet appareil.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void saveTheme(DEFAULT_THEME)}
                disabled={themeBusy}
                aria-pressed={theme === DEFAULT_THEME}
                className={`lift-press flex h-[var(--h-tap)] items-center justify-center gap-2 rounded-[var(--radius-input)] border px-3 text-[12px] font-bold ${
                  theme === DEFAULT_THEME
                    ? "border-signal bg-signal text-void"
                    : "border-line-3 bg-surface text-chalk hover:border-signal"
                } disabled:opacity-60`}
              >
                <Icon name="moon" size={16} />
                Sombre
              </button>
              <button
                type="button"
                onClick={() => void saveTheme(LIGHT_THEME)}
                disabled={themeBusy}
                aria-pressed={theme === "light"}
                className={`lift-press flex h-[var(--h-tap)] items-center justify-center gap-2 rounded-[var(--radius-input)] border px-3 text-[12px] font-bold ${
                  theme === "light"
                    ? "border-signal bg-signal text-void"
                    : "border-line-3 bg-surface text-chalk hover:border-signal"
                } disabled:opacity-60`}
              >
                <Icon name="sun" size={16} />
                Clair
              </button>
            </div>
            <fieldset className="mt-6">
              <legend className="label text-chalk-3">Densité du fil</legend>
              <p className="mt-1 text-[12px] text-chalk-4">
                Le choix est appliqué au prochain affichage du fil.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {([
                  ["comfortable", "Confortable"],
                  ["compact", "Compacte"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => saveDensity(value)}
                    aria-pressed={feedDensity === value}
                    className={`min-h-[var(--h-tap)] rounded-[var(--radius-input)] border px-3
                      text-[12px] font-semibold ${
                        feedDensity === value
                          ? "border-signal bg-signal text-void"
                          : "border-line-3 bg-surface text-chalk hover:border-signal"
                      }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="mt-5 flex min-h-[var(--h-tap)] items-center justify-between gap-4 border-t border-line-2 pt-4">
              <span>
                <span className="block text-[13px] font-semibold text-chalk">Réduire les animations</span>
                <span className="mt-1 block text-[12px] text-chalk-4">
                  Désactive les mouvements de l’interface sur cet appareil.
                </span>
              </span>
              <input
                type="checkbox"
                checked={reduceMotion}
                onChange={(event) => saveMotionPreference(event.target.checked)}
                className="size-5 shrink-0 accent-[var(--color-signal)]"
              />
            </label>
            {(appearanceMessage || appearanceError) && (
              <p
                role={appearanceError ? "alert" : "status"}
                className={`mt-3 text-[12px] ${appearanceError ? "text-warn" : "text-ok"}`}
              >
                {appearanceError || appearanceMessage}
              </p>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
              <Icon name="notifications" size={18} strokeWidth={2} />
              Notifications
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-chalk-3">
              Les alertes disponibles apparaissent dans le centre intégré. Les envois par email
              et les notifications push ne sont pas configurés.
            </p>
            <Link
              href="/notifications"
              className="mt-3 inline-flex min-h-[var(--h-tap)] items-center gap-2
                font-semibold text-signal hover:underline"
            >
              Ouvrir le centre de notifications
              <Icon name="chevron-right" size={14} />
            </Link>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
              <Icon name="messages" size={18} strokeWidth={2} />
              Messages
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-chalk-3">
              Choisissez ce que vous acceptez de recevoir en conversation privée.
            </p>
            <label className="mt-4 flex min-h-[var(--h-tap)] items-center justify-between gap-4 border-t border-line-2 pt-4">
              <span>
                <span className="block text-[13px] font-semibold text-chalk">
                  Accepter les photos et vidéos
                </span>
                <span className="mt-1 block text-[12px] text-chalk-4">
                  Quand c'est désactivé, vos contacts ne peuvent plus vous en envoyer en privé.
                  Le texte reste possible.
                </span>
              </span>
              <input
                type="checkbox"
                checked={dmMedia}
                disabled={dmMediaBusy || !profile}
                onChange={(event) => void saveDmMedia(event.target.checked)}
                className="size-5 shrink-0 accent-[var(--color-signal)] disabled:opacity-50"
              />
            </label>
            {(dmMediaMessage || dmMediaError) && (
              <p
                role={dmMediaError ? "alert" : "status"}
                className={`mt-3 text-[12px] ${dmMediaError ? "text-warn" : "text-ok"}`}
              >
                {dmMediaError || dmMediaMessage}
              </p>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
              <Icon name="link" size={18} strokeWidth={2} />
              Liens utiles
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] font-bold text-chalk-3">
              <Link href="/aide" className="inline-flex min-h-[var(--h-tap)] items-center hover:text-chalk">Aide</Link>
              <Link href="/confidentialite" className="inline-flex min-h-[var(--h-tap)] items-center hover:text-chalk">Confidentialité</Link>
              <Link href="/cgu" className="inline-flex min-h-[var(--h-tap)] items-center hover:text-chalk">CGU</Link>
              <Link href="/a-propos" className="inline-flex min-h-[var(--h-tap)] items-center hover:text-chalk">À propos</Link>
              <Link href="/setup" className="inline-flex min-h-[var(--h-tap)] items-center hover:text-chalk">Diagnostic</Link>
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-warn/40 bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
              <Icon name="flag" size={18} strokeWidth={2} />
              Suppression du compte
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-chalk-3">
              La suppression automatisée n&apos;est pas disponible. Aucun bouton de cette page
              ne supprimera tes données ni ne désactivera ton compte.
            </p>
            <Link href="/aide" className="mt-3 inline-flex min-h-[var(--h-tap)] items-center font-semibold text-signal hover:underline">
              Consulter l&apos;aide
            </Link>
          </section>

          <div className="flex justify-end">
            {signOutError && <p role="alert" className="mr-auto self-center text-[12px] text-warn">{signOutError}</p>}
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

    </AppShell>
  );
}
