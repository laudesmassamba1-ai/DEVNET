"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { AppShell } from "@/components/AppShell";
import { usePwa } from "@/components/PwaManager";
import { useSession } from "@/hooks/useSession";
import { Icon } from "@/components/Icon";
import { Loading } from "@/components/Avatar";
import { accountLabel } from "@/lib/utils";
import {
  currentPushState,
  notificationState,
  requestNotifications,
  subscribeToPush,
  unlockAudio,
  unsubscribeFromPush,
  type PushState,
} from "@/lib/device-notify";
import { asVerificationStatus, VERIFY_STATUS_LABEL } from "@/lib/verification";
import { broadcastTheme, normalizeTheme, THEMES, THEME_STORAGE_KEY } from "@/lib/theme";
import {
  applyReducedMotion,
  FEED_DENSITY_KEY,
  REDUCED_MOTION_KEY,
  type FeedDensity,
} from "@/lib/ui-preferences";

const inputCls =
  "h-[var(--h-input)] w-full rounded-(--radius-input) border border-line-3 bg-surface px-3.5 text-[14px] " +
  "shadow-sh-1 transition-[box-shadow,border-color] placeholder:text-chalk-4 " +
  "focus-visible:ring-2 focus-visible:ring-signal/70 focus-visible:ring-offset-2 focus-visible:ring-offset-page";

type Theme = (typeof THEMES)[number]["id"];

export default function SettingsPage() {
  const router = useRouter();
  const { session, profile, loading } = useSession();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [theme, setTheme] = useState<Theme>(THEMES[0].id);
  const [themeBusy, setThemeBusy] = useState(false);
  const [appearanceMessage, setAppearanceMessage] = useState("");
  const [appearanceError, setAppearanceError] = useState("");
  /** Préférence de réception des médias en messages privés. */
  const [dmMediaOverride, setDmMediaOverride] = useState<boolean | null>(null);
  const [dmMediaBusy, setDmMediaBusy] = useState(false);
  const [dmMediaMessage, setDmMediaMessage] = useState("");
  const [dmMediaError, setDmMediaError] = useState("");
  /** Permission d'afficher des bannières sur cet appareil. */
  const [notifyState, setNotifyState] = useState<ReturnType<typeof notificationState>>("default");
  const [notifyBusy, setNotifyBusy] = useState(false);
  /** Abonnement push : la seule voie pour être prévenu écran verrouillé. */
  const [pushState, setPushState] = useState<PushState | "loading">("loading");
  const [pushBusy, setPushBusy] = useState(false);
  /** Retour du test d'envoi : ce qui a été remis, ce qui a manqué. */
  const [pushTest, setPushTest] = useState<{ busy: boolean; message: string; failed: boolean }>({
    busy: false,
    message: "",
    failed: false,
  });

  useEffect(() => {
    setNotifyState(notificationState());
    void currentPushState().then(setPushState);
  }, []);

  async function enableNotifications() {
    setNotifyBusy(true);
    // Le geste qui suit la demande est aussi celui qui débloque le son.
    unlockAudio();
    const next = await requestNotifications();
    setNotifyState(next === "unsupported" ? "unsupported" : next);
    setNotifyBusy(false);
    if (next === "granted") {
      setPushBusy(true);
      setPushState(await subscribeToPush());
      setPushBusy(false);
    }
  }

  async function togglePush() {
    setPushBusy(true);
    setPushState(pushState === "on" ? await unsubscribeFromPush() : await subscribeToPush());
    setPushBusy(false);
  }

  /**
   * Test réel : le serveur pousse à cet appareil, comme pour un message.
   *
   * C'est le seul moyen de distinguer « abonnement enregistré » de
   * « bannière qui arrive vraiment ». Le message le dit sans promettre
   * plus que ce que la route confirme.
   */
  async function sendTestPush() {
    setPushTest({ busy: true, message: "", failed: false });
    try {
      const response = await fetch("/api/push/test", { method: "POST" });
      const data = (await response.json()) as {
        ok?: boolean;
        devices?: number;
        reason?: string;
        error?: string;
      };
      if (response.ok && data.ok) {
        setPushTest({
          busy: false,
          failed: false,
          message: `Notification envoyée à ${data.devices ?? 1} appareil${(data.devices ?? 1) > 1 ? "s" : ""}. Verrouille l'écran pour la voir arriver.`,
        });
      } else if (data.reason === "aucun_appareil") {
        setPushTest({
          busy: false,
          failed: true,
          message: "Aucun appareil abonné pour ce compte : active d'abord l'alerte écran verrouillé.",
        });
      } else {
        setPushTest({
          busy: false,
          failed: true,
          message: data.error === "session requise"
            ? "Session expirée : reconnecte-toi pour tester."
            : "Le serveur n'a pas pu envoyer le test.",
        });
      }
    } catch {
      setPushTest({ busy: false, failed: true, message: "Réseau indisponible : test non envoyé." });
    }
  }

  // `null` tant que rien n'a été touché : la valeur vient du profil, et
  // un état séparé éviterait deux sources de vérité qui divergent.
  const dmMedia = dmMediaOverride ?? profile?.dm_media ?? true;

  async function saveDmMedia(enabled: boolean) {
    setDmMediaBusy(true);
    setDmMediaMessage("");
    setDmMediaError("");
    const { error } = await api
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
      setTheme(normalizeTheme(savedTheme) as Theme);
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
      const { error } = await api
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
      const { error } = await api.auth.updateUser({ password: pw });
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
      const { error } = await api.auth.signOut();
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
          <section className="rounded-(--radius-card) border border-line-2 bg-surface p-5 sm:p-6">
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
                    className="inline-flex min-h-(--h-tap) items-center font-bold text-signal hover:underline"
                  >
                    gérer →
                  </Link>
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-(--radius-card) border border-line-2 bg-surface p-5 sm:p-6">
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
                  className="lift-press mt-1 flex h-(--h-tap) items-center justify-center rounded-(--radius-input) border border-signal bg-signal px-5 text-[13px] font-bold text-void shadow-sh-2 disabled:opacity-60"
                >
                  {pwBusy ? "Enregistrement…" : "Changer le mot de passe"}
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-(--radius-card) border border-line-2 bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
              <Icon name="sun" size={18} strokeWidth={2} />
              Apparence
            </h2>
            <p className="mt-1 text-[13px] text-chalk-3">
              Le thème suit ton compte ; les options de lecture restent sur cet appareil.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {THEMES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => void saveTheme(entry.id)}
                  disabled={themeBusy}
                  aria-pressed={theme === entry.id}
                  className={`lift-press flex h-(--h-tap) flex-col items-center justify-center gap-1 rounded-(--radius-input) border px-2 text-[12px] font-bold ${
                    theme === entry.id
                      ? "border-signal bg-signal text-void"
                      : "border-line-3 bg-surface text-chalk hover:border-signal"
                  } disabled:opacity-60`}
                >
                  <Icon name={entry.icon} size={16} />
                  {entry.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-chalk-4">
              {THEMES.find((entry) => entry.id === theme)?.hint}
            </p>
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
                    className={`min-h-(--h-tap) rounded-(--radius-input) border px-3
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
            <label className="mt-5 flex min-h-(--h-tap) items-center justify-between gap-4 border-t border-line-2 pt-4">
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
                className="size-5 shrink-0 accent-(--color-signal)"
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

          <PwaInstallSection />

          <section className="rounded-(--radius-card) border border-line-2 bg-surface p-5 sm:p-6">
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
              className="mt-3 inline-flex min-h-(--h-tap) items-center gap-2
                font-semibold text-signal hover:underline"
            >
              Ouvrir le centre de notifications
              <Icon name="chevron-right" size={14} />
            </Link>
          </section>

          <section className="rounded-(--radius-card) border border-line-2 bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
              <Icon name="messages" size={18} strokeWidth={2} />
              Messages
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-chalk-3">
              Choisissez ce que vous acceptez de recevoir en conversation privée.
            </p>
            <label className="mt-4 flex min-h-(--h-tap) items-center justify-between gap-4 border-t border-line-2 pt-4">
              <span>
                <span className="block text-[13px] font-semibold text-chalk">
                  Accepter les photos et vidéos
                </span>
                <span className="mt-1 block text-[12px] text-chalk-4">
                  Quand c&apos;est désactivé, vos contacts ne peuvent plus vous en envoyer en privé.
                  Le texte reste possible.
                </span>
              </span>
              <input
                type="checkbox"
                checked={dmMedia}
                disabled={dmMediaBusy || !profile}
                onChange={(event) => void saveDmMedia(event.target.checked)}
                className="size-5 shrink-0 accent-(--color-signal) disabled:opacity-50"
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

          <section className="rounded-(--radius-card) border border-line-2 bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
              <Icon name="notifications" size={18} strokeWidth={2} />
              Alertes sur cet appareil
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-chalk-3">
              Le son, la bannière et le chiffre sur l&apos;icône signalent un message reçu
              pendant que DevNet est ouvert. Sur iPhone, la bannière demande d&apos;abord
              l&apos;application ajoutée à l&apos;écran d&apos;accueil.
            </p>

            {notifyState === "granted" ? (
              <div className="mt-4 space-y-3">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-ok">
                  <Icon name="check" size={14} strokeWidth={2.4} />
                  Bannières activées sur cet appareil
                </p>
                {pushState === "loading" ? (
                  <p className="text-[13px] text-chalk-4">Vérification des alertes à distance…</p>
                ) : pushState === "on" ? (
                  <>
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-[13px] text-chalk-3">
                      Alertes écran verrouillé actives sur cet appareil.
                    </p>
                    <button
                      type="button"
                      onClick={() => void sendTestPush()}
                      disabled={pushTest.busy}
                      className="lift-press flex h-(--h-tap) items-center justify-center
                        rounded-(--radius-input) border border-line-3 bg-surface px-4
                        text-[13px] font-bold text-chalk hover:border-signal disabled:opacity-60"
                    >
                      {pushTest.busy ? "Envoi…" : "Envoyer un test"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void togglePush()}
                      disabled={pushBusy}
                      className="lift-press flex h-(--h-tap) items-center justify-center
                        rounded-(--radius-input) border border-line-3 bg-surface px-4
                        text-[13px] font-bold text-chalk hover:border-signal disabled:opacity-60"
                    >
                      {pushBusy ? "Mise à jour…" : "Désactiver à distance"}
                    </button>
                  </div>
                  {pushTest.message && (
                    <p
                      role={pushTest.failed ? "alert" : "status"}
                      className={`text-[12px] ${pushTest.failed ? "text-warn" : "text-ok"}`}
                    >
                      {pushTest.message}
                    </p>
                  )}
                  </>
                ) : pushState === "off" ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-[13px] text-chalk-3">
                      Pour être prévenu écran verrouillé, active l&apos;alerte à distance.
                    </p>
                    <button
                      type="button"
                      onClick={() => void togglePush()}
                      disabled={pushBusy}
                      className="lift-press flex h-(--h-tap) items-center justify-center
                        rounded-(--radius-input) border border-signal bg-signal px-4
                        text-[13px] font-bold text-void shadow-sh-2 disabled:opacity-60"
                    >
                      {pushBusy ? "Activation…" : "Activer écran verrouillé"}
                    </button>
                  </div>
                ) : pushState === "unsupported" ? (
                  <p className="text-[13px] text-chalk-4">
                    Les alertes écran verrouillé ne sont pas disponibles (clés VAPID absentes ou appareil non compatible). Les bannières et le son fonctionnent tant que DevNet est ouvert.
                  </p>
                ) : pushState === "denied" ? (
                  <p className="text-[13px] text-warn">
                    Les bannières sont refusées : l&apos;alerte écran verrouillé ne peut pas s&apos;activer.
                  </p>
                ) : (
                  <p className="text-[13px] text-warn">
                    L&apos;activation à distance a échoué. Réessaie depuis l&apos;application installée.
                  </p>
                )}
              </div>
            ) : notifyState === "denied" ? (
              <p className="mt-4 text-[13px] text-warn">
                Refusées dans le navigateur. Il faut les réactiver dans ses réglages —
                l&apos;application ne peut pas redemander.
              </p>
            ) : notifyState === "unsupported" ? (
              <p className="mt-4 text-[13px] text-chalk-4">
                Cet appareil ne prend pas en charge les bannières.
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void enableNotifications()}
                disabled={notifyBusy}
                className="lift-press mt-4 flex h-(--h-tap) items-center justify-center
                  rounded-(--radius-input) border border-signal bg-signal px-5
                  text-[13px] font-bold text-void shadow-sh-2 disabled:opacity-60"
              >
                {notifyBusy ? "Demande…" : "Activer les alertes"}
              </button>
            )}
          </section>

          <section className="rounded-(--radius-card) border border-line-2 bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
              <Icon name="link" size={18} strokeWidth={2} />
              Liens utiles
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] font-bold text-chalk-3">
              <Link href="/aide" className="inline-flex min-h-(--h-tap) items-center hover:text-chalk">Aide</Link>
              <Link href="/confidentialite" className="inline-flex min-h-(--h-tap) items-center hover:text-chalk">Confidentialité</Link>
              <Link href="/cgu" className="inline-flex min-h-(--h-tap) items-center hover:text-chalk">CGU</Link>
              <Link href="/a-propos" className="inline-flex min-h-(--h-tap) items-center hover:text-chalk">À propos</Link>
              <Link href="/setup" className="inline-flex min-h-(--h-tap) items-center hover:text-chalk">Diagnostic</Link>
            </div>
          </section>

          <section className="rounded-(--radius-card) border border-warn/40 bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
              <Icon name="flag" size={18} strokeWidth={2} />
              Suppression du compte
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-chalk-3">
              La suppression automatisée n&apos;est pas disponible. Aucun bouton de cette page
              ne supprimera tes données ni ne désactivera ton compte.
            </p>
            <Link href="/aide" className="mt-3 inline-flex min-h-(--h-tap) items-center font-semibold text-signal hover:underline">
              Consulter l&apos;aide
            </Link>
          </section>

          <div className="flex justify-end">
            {signOutError && <p role="alert" className="mr-auto self-center text-[12px] text-warn">{signOutError}</p>}
            <button
              type="button"
              onClick={signOut}
              className="lift-press flex h-(--h-tap) items-center justify-center rounded-(--radius-input) border border-line-3 bg-surface px-5 text-[13px] font-bold text-chalk hover:border-signal"
            >
              Se déconnecter
            </button>
          </div>
        </div>
      </div>

    </AppShell>
  );
}

function PwaInstallSection() {
  const { installed, canInstall, isIos, updateReady, install, applyUpdate } = usePwa();

  return (
    <section className="rounded-(--radius-card) border border-line-2 bg-surface p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-chalk">
        <Icon name="download" size={18} strokeWidth={2} />
        Application
      </h2>

      {installed ? (
        <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-chalk-3">
          <Icon name="check" size={16} className="mt-0.5 shrink-0 text-ok" />
          DevNet est installée sur cet appareil. Elle s&apos;ouvre en plein écran,
          comme une application native.
        </p>
      ) : canInstall ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-chalk-3">
            Installe DevNet pour l&apos;ouvrir en plein écran et la lancer plus vite.
          </p>
          <button
            type="button"
            onClick={() => void install()}
            className="lift-press mt-4 flex h-(--h-tap) items-center justify-center gap-2
              rounded-(--radius-input) border border-signal bg-signal px-5
              text-sm font-bold text-void shadow-sh-2"
          >
            <Icon name="download" size={16} />
            Installer DevNet
          </button>
        </>
      ) : isIos ? (
        <div className="mt-2 text-sm leading-relaxed text-chalk-3">
          <p>Pour installer DevNet sur ton iPhone ou iPad :</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Ouvre cette page dans Safari.</li>
            <li>Appuie sur le bouton Partager.</li>
            <li>Choisis « Sur l&apos;écran d&apos;accueil ».</li>
          </ol>
        </div>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-chalk-3">
          Ouvre le menu de ton navigateur puis choisis « Installer DevNet » ou
          « Ajouter à l&apos;écran d&apos;accueil ». L&apos;installation est aussi
          proposée automatiquement quand le navigateur le permet.
        </p>
      )}

      {updateReady && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line-2 pt-4">
          <p className="text-sm text-chalk-3">Une nouvelle version est prête.</p>
          <button
            type="button"
            onClick={applyUpdate}
            className="flex h-(--h-tap) items-center justify-center rounded-(--radius-input)
              border border-line-3 bg-surface px-4 text-xs font-bold text-chalk
              hover:border-signal"
          >
            Recharger
          </button>
        </div>
      )}
    </section>
  );
}
