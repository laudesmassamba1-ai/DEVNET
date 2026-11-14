"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { GitHubMark, GoogleMark } from "@/components/BrandIcons";
import { Icon } from "@/components/Icon";
import { Avatar, Spinner } from "@/components/Avatar";
import { Motion, cascade } from "@/components/Motion";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { DevBugStoryStage } from "@/components/DevBugStory";
import { rearmSplash } from "@/components/SplashScreen";
import { api } from "@/lib/api/client";
import { authErrorMessage } from "@/lib/utils";
import { useSession } from "@/hooks/useSession";
import { useBackend } from "@/hooks/useBackend";
import { DEMO_ADMINS, DEMO_ME, DEMO_USERS } from "@/lib/demo/data";
import { accountLabel } from "@/lib/utils";
import type { User } from "@/lib/types";

const OAUTH_ERRORS: Record<string, string> = {
  denied: "Connexion annulée ou refusée par le fournisseur.",
  unconfigured:
    "Connexion Google/GitHub indisponible : la configuration serveur est incomplète.",
  state: "La tentative de connexion a expiré. Réessaie.",
  email:
    "Aucune adresse email vérifiée n'a été fournie. Vérifie ton compte chez le fournisseur.",
  failed: "Connexion impossible. Réessaie dans un instant.",
};

export default function Login() {
  return (
    <Suspense
      fallback={
        <main className="relative isolate flex min-h-dvh items-center justify-center px-5">
          <AnimatedLogo size={48} wordmark={false} />
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { session, loading } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const backend = useBackend();

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoPick, setDemoPick] = useState<User | null>(null);

  const isDemo = backend.state === "offline";
  const oauthKind = searchParams.get("oauth");
  const oauthError = oauthKind ? OAUTH_ERRORS[oauthKind] ?? OAUTH_ERRORS.failed : "";
  const message = error || oauthError;

  /**
   * Destination après connexion.
   *
   * Seuls les chemins internes sont acceptés : `//hôte` et les URL
   * absolues sont écartés pour ne pas transformer `?next=` en redirection
   * ouverte. Sans `next`, on revient au fil.
   */
  const destination = useCallback(() => {
    const raw = searchParams.get("next");
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/feed";
  }, [searchParams]);

  useEffect(() => {
    if (!loading && session) router.replace(destination());
  }, [loading, session, router, destination]);

  const signIn = useCallback(
    async (emailToUse: string, password: string, pick?: User) => {
      setBusy(true);
      setError("");
      try {
        const result = await api.auth.signInWithPassword({
          email: emailToUse,
          password,
        });
        if (result.error) {
          setError(authErrorMessage(result.error));
          setBusy(false);
          return false;
        }
        if (pick) {
          // En démo, forcer la session sur le compte choisi en local
          // tant que le backend distant est injoignable : l'UI doit
          // afficher le bon profil dès le rendu suivant.
          sessionStorage.setItem("devnet.demo.pick", pick.id);
        }
        // La session vient de s'ouvrir : l'écran de lancement se rejoue
        // au prochain chargement complet (voir `rearmSplash`).
        rearmSplash();
        router.replace(destination());
        return true;
      } finally {
        setBusy(false);
      }
    },
    [router, destination],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (!email || !pw) {
      setError("Remplis les deux champs.");
      return;
    }

    await signIn(email, pw, demoPick ?? undefined);
  }

  const enterDemo = useCallback(async () => {
    const who = demoPick ?? DEMO_ME;
    await signIn(who.email, "demo", who);
  }, [signIn, demoPick]);

  useEffect(() => {
    if (!isDemo || loading || session) return;

    const wanted = new URLSearchParams(window.location.search).has("demo");
    if (!wanted && !sessionStorage.getItem("devnet.demo.pick")) return;

    const storedPick = sessionStorage.getItem("devnet.demo.pick");
    const pick = DEMO_USERS.find((u) => u.id === storedPick) ?? DEMO_ME;

    void (async () => {
      // On rend d'abord la page avec le pick existant — si le pick est
      // déjà en sessionStorage, `demoPick` est déjà le bon pendant le
      // rendu — ... puis on lance la connexion asynchrone. Mais si l'état
      // local diverge (rechargement, nouvel onglet), on le resynchronise
      // par une mise à jour asynchrone, et non au corps de l'effet :
      // `setDemoPick(pick)` dans ce corps déclenche un rendu de cascade
      // signalé par le linter React-compiler.
      setDemoPick((current) => (current?.id === pick.id ? current : pick));
      await signIn(pick.email, "demo", pick);
    })();
  }, [isDemo, loading, session, signIn]);

  function chooseDemo(pick: User) {
    setDemoPick((current) => (current?.id === pick.id ? current : pick));
    sessionStorage.setItem("devnet.demo.pick", pick.id);
  }

  function clearPick() {
    setDemoPick(null);
    sessionStorage.removeItem("devnet.demo.pick");
  }

  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center
      overflow-hidden px-5 py-10">
      <div className="relative z-1 w-full max-w-[440px]">
        <Motion role="fade" className="mb-6 flex items-center justify-center gap-3">
          {/* La marque animée est la version courte de son splash : le
              logo se construit, puis se pose. Sous mouvement réduit, il
              tombe sur sa cellule finale — même image, sans frémissement. */}
          <AnimatedLogo size={48} wordmark={false} className="shrink-0" />
          <div>
            <h1 className="font-display text-[1.65rem] font-bold leading-none
              tracking-[-0.05em] text-chalk">
              DevNet<span className="text-signal">.</span>
            </h1>
            <p className="mt-1.5 text-13 text-chalk-3">
              Fil, projets et échanges de développeurs.
            </p>
          </div>
        </Motion>

        {/* Le scénario : un dev, son bug, la photo, DevNet, l'aide qui
            arrive — la promesse du produit racontée en une prise. Une
            seule lecture, rejouable ; sous mouvement réduit, l'affiche
            finale. */}
        <Motion role="fade" delay={200} className="mb-6">
          <DevBugStoryStage />
        </Motion>

        <Motion
          role="rise"
          delay={80}
          className="rounded-(--radius-card) border border-edge bg-surface
            p-6 sm:p-8"
        >
          <h2 className="font-display text-[1.5rem] font-bold tracking-[-0.035em] text-chalk">
            {isDemo ? "Démonstration" : "Connexion"}
          </h2>
          <p className="mt-1 mb-5 text-13 text-chalk-3">
            Accède à ton fil, tes projets et tes messages.
          </p>

          {!isDemo && (
            <Motion role="rise" className="mb-5">
              <div className="grid gap-2 sm:grid-cols-2">
                {(["google", "github"] as const).map((provider) => (
                  <a
                    key={provider}
                    href={`/api/auth/oauth/${provider}/start?next=${encodeURIComponent(destination())}`}
                    aria-disabled={busy}
                    onClick={(event) => {
                      if (busy) event.preventDefault();
                    }}
                    className="lift-press flex h-(--h-tap) items-center justify-center gap-2
                      rounded-(--radius-input) border border-line-3 bg-surface px-3
                      text-13 font-semibold text-chalk shadow-sh-2
                      transition-colors hover:border-signal aria-disabled:opacity-40"
                  >
                    {provider === "google" ? <GoogleMark /> : <GitHubMark />}
                    <span>
                      Continuer avec {provider === "google" ? "Google" : "GitHub"}
                    </span>
                  </a>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-line-2" />
                <span className="label-micro text-chalk-4">ou</span>
                <span className="h-px flex-1 bg-line-2" />
              </div>
            </Motion>
          )}
          {/* ── Choix du compte en démo ──
              Quand un profil est choisi, on l'affiche et on propose de
              revenir au choix par défaut. Ce n'est pas un écran à part :
              c'est le même formulaire, avec un choix explicité. */}
          {isDemo && demoPick && (
            <Motion role="rise" className="mb-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <Avatar name={demoPick.prenom} color={demoPick.avatar_color} size="md" />
                  <div>
                    <p className="font-display text-14 font-bold text-chalk">
                      @{demoPick.pseudo}
                    </p>
                    <p className="label-micro text-chalk-4">
                      {accountLabel(demoPick.account_type)}
                      {demoPick.verified ? " · vérifié" : ""}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearPick}
                  className="label-micro h-7 shrink-0 border border-line-3 px-2 text-chalk-3 transition-colors hover:border-signal hover:text-signal"
                >
                  Retour
                </button>
              </div>
            </Motion>
          )}

          {/* ── Grille des comptes démo ──
              Ce n'est pas un menu caché : c'est la première chose qu'on
              voit, parce que dans une démo le choix du compte est le
              premier geste productif. */}
          {isDemo && !demoPick && (
            <Motion role="rise" className="mb-4">
              <p className="mb-2 label-micro text-chalk-4">Comptes disponibles</p>
              <div className="grid grid-cols-2 gap-2">
                {DEMO_USERS.filter((u) => !u.is_admin).slice(0, 6).map((u, i) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => chooseDemo(u)}
                    /* La cascade des comptes : chaque carte arrive avec
                       un demi-cran de retard, la lecture suit le rang.
                       Plafonnée à 400 ms — au-delà, la page serait déjà
                       comprise et le mouvement ne dirait plus rien. */
                    className="mo-rise group flex items-start gap-2.5 rounded-(--radius-card) border
                      border-line-2 bg-surface/60 p-2 text-left transition-colors
                      hover:border-signal hover:bg-surface"
                    style={{ animationDelay: `${cascade(i, 40, 400)}ms` }}
                  >
                    <Avatar name={u.prenom} color={u.avatar_color} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-display text-sm font-bold text-chalk">
                        @{u.pseudo}
                      </p>
                      <p className="truncate label-micro text-chalk-4">
                        {u.followers > 0 ? `${u.followers} abonnés` : "neau"}
                      </p>
                      {u.verified && (
                        <span className="mt-0.5 inline-flex items-center gap-1 label-micro text-12 uppercase text-signal">
                          <Icon name="verified" size={9} />
                          vérifié
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {/* ── Les comptes d'administration ──
                  Un groupe séparé : ce ne sont pas des profils du fil,
                  et les mêler aux six comptes ferait croire qu'on en est
                  un. Ils portent le cachet de base — c'est par lui qu'on
                  reconnaît l'équipe. */}
              {DEMO_ADMINS.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 label-micro text-chalk-4">Administration</p>
                  <div className="grid grid-cols-2 gap-2">
                    {DEMO_ADMINS.map((u, i) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => chooseDemo(u)}
                        className="mo-rise group flex items-start gap-2.5 rounded-(--radius-card) border
                          border-line-2 bg-surface/60 p-2 text-left transition-colors
                          hover:border-signal hover:bg-surface"
                        style={{ animationDelay: `${cascade(i + 6, 40, 400)}ms` }}
                      >
                        <Avatar name={u.prenom} color={u.avatar_color} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-display text-sm font-bold text-chalk">
                            @{u.pseudo}
                          </p>
                          <p className="truncate label-micro text-chalk-4">{u.ville}</p>
                          <span className="mt-0.5 inline-flex items-center gap-1 label-micro text-12 uppercase text-info">
                            <Icon name="lock" size={9} />
                            administration
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Motion>
          )}

          {/* ── Mode démonstration : l'action principale ──
              Le bouton passe **avant** le formulaire, et non après. En
              démonstration, le formulaire est un détour : on ne veut pas
              que le présentateur perde vingt secondes à chercher un mot de
              passe qui n'existe pas, ni que le jury conclue à une
              application vide. Le formulaire reste là pour qui préfère
              changer de compte et voir un autre profil. */}
          {isDemo && (
            <Motion role="rise" className="mb-4">
              <button
                type="button"
                onClick={enterDemo}
                disabled={busy}
                className="lift-press flex h-(--h-tap) w-full items-center justify-center gap-2
                  rounded-(--radius-input) border border-signal bg-signal
                  text-13 font-bold text-void shadow-sh-2 disabled:opacity-40"
              >
                {busy ? <Spinner /> : <>Entrer comme @{(demoPick ?? DEMO_ME).pseudo}</>}
              </button>
            </Motion>
          )}

          {isDemo && (
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-line-2" />
              <span className="label-micro text-chalk-4">ou</span>
              <span className="h-px flex-1 bg-line-2" />
            </div>
          )}

          {message && (
            <Motion role="rise" className="mb-3.5">
              <div
                id="login-error"
                role="alert"
                className="rounded-(--radius-input) border
                  border-danger bg-danger/12 px-3.5 py-2.5 text-sm font-medium text-danger"
              >
                {message}
              </div>
            </Motion>
          )}

          <form onSubmit={submit} noValidate>
          <div className="mb-4">
            <label htmlFor="email" className="prompt-label mb-1.5 block text-chalk-2">
              adresse email
            </label>
            <Motion role="rise" delay={780} as="div">
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="votre@email.com"
                aria-invalid={message ? true : undefined}
                aria-describedby={message ? "login-error" : undefined}
                className="h-(--h-input) w-full rounded-(--radius-input) border border-line-3 bg-surface px-3.5
                  text-14
                  transition-[transform,box-shadow] duration-(--d-base) ease-(--ease-spring)
                  placeholder:text-chalk-4 focus-visible:ring-2 focus-visible:ring-signal/70
                  focus-visible:ring-offset-2 focus-visible:ring-offset-page"
              />
            </Motion>
          </div>

          <div className="mb-5">
            <label htmlFor="pw" className="prompt-label mb-1.5 block text-chalk-2">
              mot de passe
            </label>
            <div className="relative">
              <Motion role="rise" delay={840} as="div">
                <input
                  id="pw"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="••••••••"
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? "login-error" : undefined}
                  className="h-(--h-input) w-full rounded-(--radius-input) border border-line-3 bg-surface
                    px-3.5 pr-12 text-14
                    transition-[transform,box-shadow] duration-(--d-base) ease-(--ease-spring)
                    placeholder:text-chalk-4 focus-visible:ring-2 focus-visible:ring-signal/70
                    focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                />
              </Motion>

              {/* L'icône ne glisse pas, elle bascule : un déplacement
                  ajouterait une seconde information à un simple changement
                  d'état. */}
              <button
                type="button"
                aria-label={showPw ? "Masquer" : "Afficher"}
                onClick={() => setShowPw((v) => !v)}
                className="absolute top-0 right-0 flex h-11 w-11 items-center
                  justify-center text-chalk-3 transition-colors
                  duration-(--d-fast) hover:text-signal"
              >
                <Icon name={showPw ? "eye-off" : "eye"} size={18} strokeWidth={2} />
              </button>
            </div>
          </div>

          <Motion role="rise" delay={880} as="div" className="mb-4 flex justify-end">
            <Link
              href="/mot-de-passe-oublie"
              className="text-12 font-bold text-chalk-4 hover:text-chalk"
            >
              Mot de passe oublié ?
            </Link>
          </Motion>

          <Motion role="rise" delay={900} as="div">
            <button
              type="submit"
              disabled={busy}
              className={`lift-press flex h-(--h-tap) w-full items-center justify-center gap-2
                rounded-(--radius-input) border
                ${isDemo
                  ? "border-line-3 bg-surface text-chalk hover:border-signal"
                  : "border-signal bg-signal text-void"}
                text-13 font-semibold shadow-sh-2 disabled:opacity-40`}
            >
              {busy ? <Spinner /> : "Se connecter"}
            </button>
          </Motion>
          </form>
        </Motion>

        <Motion role="fade" delay={1000}>
          <p className="mt-5 text-center text-sm text-chalk-3">
            Pas encore de compte ?{" "}
            <Link href="/register" className="font-bold text-signal underline-sweep">
              Créer un compte
            </Link>
          </p>
          <p className="mt-3 text-center text-12 text-chalk-4">
            <Link href="/a-propos" className="hover:text-chalk-2">À propos</Link>
            {" · "}
            <Link href="/aide" className="hover:text-chalk-2">Aide</Link>
            {" · "}
            <Link href="/confidentialite" className="hover:text-chalk-2">Confidentialité</Link>
            {" · "}
            <Link href="/cgu" className="hover:text-chalk-2">CGU</Link>
          </p>
        </Motion>
    </div>
    </main>
  );
}
