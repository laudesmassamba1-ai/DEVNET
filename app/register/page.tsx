"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Avatar";
import { Motion } from "@/components/Motion";
import { rearmSplash } from "@/components/SplashScreen";
import { api } from "@/lib/api/client";
import { useSession } from "@/hooks/useSession";
import { AVATARS, FILIERES, LANGAGES, NIVEAUX, type AccountType } from "@/lib/types";

const TERMS_VERSION = "2026-10-16";

export default function Register() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [step, setStep] = useState<1 | 2>(1);
  const [accountType, setAccountType] = useState<AccountType>("student");
  const [prenom, setPrenom] = useState("");
  const [pseudo, setPseudo] = useState("");
  const [email, setEmail] = useState("");
  const [filiere, setFiliere] = useState("");
  const [niveau, setNiveau] = useState("");
  const [langs, setLangs] = useState<Set<string>>(new Set());
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  useEffect(() => {
    if (!loading && session) router.replace("/feed");
  }, [loading, session, router]);

  function next() {
    setError("");
    if (!prenom || !pseudo || !email || !filiere || !niveau) {
      setError("Remplis tous les champs.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Adresse email invalide.");
      return;
    }
    setStep(2);
  }

  function toggleLang(l: string) {
    setLangs((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (pw !== pw2) return setError("Les mots de passe ne correspondent pas.");
    if (pw.length < 6) return setError("Mot de passe trop court (6 caractères minimum).");
    if (!acceptedTerms) return setError("Acceptez les CGU pour créer votre compte.");

    setBusy(true);
    const cleanPseudo = pseudo.toLowerCase().replace(/[^a-z0-9_]/g, "");
    const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const termsAcceptedAt = new Date().toISOString();

    const { data, error: err } = await api.auth.signUp({
      email,
      password: pw,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirmer`,
        data: {
          prenom,
          pseudo: cleanPseudo,
          filiere,
          niveau,
          langages: [...langs],
          avatar_color: avatar,
          account_type: accountType,
          terms_accepted_at: termsAcceptedAt,
          terms_version: TERMS_VERSION,
        },
      },
    });

    if (err) {
      setBusy(false);
      setError(err.message.toLowerCase().includes("already")
        ? "Email déjà utilisé."
        : err.message);
      return;
    }

    if (data.user) {
      await api.from("users").upsert({
        id: data.user.id,
        prenom,
        pseudo: cleanPseudo,
        email,
        filiere,
        niveau,
        langages: [...langs],
        avatar_color: avatar,
        account_type: accountType,
        verified: false,
      }, { onConflict: "id" });
    }

    const { data: sess } = await api.auth.getSession();
    if (sess.session) {
      // La session vient de s'ouvrir : l'écran de lancement se rejoue
      // au prochain chargement complet (voir `rearmSplash`).
      rearmSplash();
      router.replace("/feed");
    } else setError("Compte créé. Vérifiez votre email pour confirmer.");
  }

  const inputCls =
    "h-(--h-input) w-full rounded-(--radius-input) border border-line-3 bg-surface px-3.5 text-[14px] " +
    "outline transition-[transform,box-shadow] placeholder:text-chalk-4 " +
    "focus-visible:ring-2 focus-visible:ring-signal/70 focus-visible:ring-offset-2 focus-visible:ring-offset-page";

  return (
    <main className="relative flex min-h-dvh flex-col items-center overflow-hidden
      px-4 py-8 sm:px-6 sm:py-12">
      <div className="relative z-1 w-full max-w-[520px]">
        <Motion role="fade" className="mb-6 flex items-center justify-center gap-3">
          <Logo size={46} className="shrink-0" />
          <div>
            <h1 className="font-display text-[1.65rem] font-bold leading-none
              tracking-[-0.05em] text-chalk">
              DevNet<span className="text-signal">.</span>
            </h1>
            <p className="mt-1.5 text-[13px] text-chalk-3">
              Deux étapes pour créer ton compte DevNet.
            </p>
          </div>
        </Motion>

        <div className="mb-5 flex items-center justify-between text-12 text-chalk-3">
          <span>Création du compte</span>
          <span className="font-mono tabular-nums">Étape {step} sur 2</span>
        </div>
        <div className="mb-5 flex h-2 gap-1" role="progressbar"
          aria-valuemin={1} aria-valuemax={2} aria-valuenow={step}
          aria-label="Progression de l'inscription">
          {[0, 1].map((i) => (
            <span key={i} className="h-full flex-1 overflow-hidden rounded-full border
              border-line-3 bg-surface-3">
              <span
                className="block h-full origin-left bg-signal transition-transform
                  duration-(--d-base) ease-(--ease-spring)"
                style={{ transform: i < step ? "scaleX(1)" : "scaleX(0)" }}
              />
            </span>
          ))}
        </div>

        {error && (
          <Motion role="rise" className="mb-3.5">
            <div
              id="register-error"
              role="alert"
              className="rounded-(--radius-input) border
                border-danger bg-danger/12 px-3.5 py-2.5 text-sm font-medium text-danger"
            >
              {error}
            </div>
          </Motion>
        )}

        {/* ── Les deux étapes ne se remplacent pas côte à côte : chacune
            entre par son propre bord, comme deux volets d'un même tiroir.
            Le sens du geste se lit donc avant même le contenu. ── */}
        {step === 1 && (
          <Motion
            key="etape-1"
            role="slide"
            delay={460}
            className="rounded-(--radius-card) border border-edge bg-surface
              p-5 sm:p-7"
          >
            <h2 className="mb-1 font-display text-[1.5rem] font-bold tracking-[-0.03em]">
              Informations
            </h2>
            {/* Les deux types de compte s'ouvrent comme deux volets
                d'un sélecteur — c'est le choix structurant, donc il se
                pose avant les champs. */}
            <div className="mb-4">
              <span className="label mb-1.5 block text-chalk">Type de compte</span>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["student", "Étudiant"],
                  ["professional", "Professionnel"],
                ] as const).map(([value, label], i) => (
                  <Motion key={value} role="rise" delay={520 + i * 55} as="div">
                    <button
                      type="button"
                      onClick={() => setAccountType(value)}
                      aria-pressed={accountType === value}
                      className={`w-full rounded-(--radius-input) border px-3 py-2.5
                        text-left transition-[background-color,border-color]
                        duration-(--d-fast) ${accountType === value
                          ? "border-signal bg-signal/10"
                          : "border-line-2 bg-surface hover:border-line-3 hover:bg-surface-2"}`}
                    >
                      <span className="block text-sm font-bold">{label}</span>
                    </button>
                  </Motion>
                ))}
              </div>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="prenom" className="label mb-1.5 block text-chalk">Prénom</label>
                <Motion role="rise" delay={640} as="div">
                  <input id="prenom" value={prenom} onChange={(e) => setPrenom(e.target.value)}
                    placeholder="Koffi" className={inputCls} />
                </Motion>
              </div>
              <div>
                <label htmlFor="pseudo" className="label mb-1.5 block text-chalk">Pseudo</label>
                <Motion role="rise" delay={695} as="div">
                  <input id="pseudo" value={pseudo} onChange={(e) => setPseudo(e.target.value)}
                    placeholder="koffi_dev" className={inputCls} />
                </Motion>
              </div>
            </div>

            <div className="mb-4">
              <label htmlFor="email" className="label mb-1.5 block text-chalk">Email</label>
              <Motion role="rise" delay={750} as="div">
                <input id="email" type="email" autoComplete="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="votre@email.com"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "register-error" : undefined}
                  className={inputCls} />
              </Motion>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="filiere" className="label mb-1.5 block text-chalk">Filière</label>
                <Motion role="rise" delay={805} as="div">
                  <select id="filiere" value={filiere} onChange={(e) => setFiliere(e.target.value)}
                    className={`${inputCls} cursor-pointer`}>
                    <option value="">Choisir…</option>
                    {FILIERES.map((f) => <option key={f}>{f}</option>)}
                  </select>
                </Motion>
              </div>
              <div>
                <label htmlFor="niveau" className="label mb-1.5 block text-chalk">Niveau</label>
                <Motion role="rise" delay={860} as="div">
                  <select id="niveau" value={niveau} onChange={(e) => setNiveau(e.target.value)}
                    className={`${inputCls} cursor-pointer`}>
                    <option value="">Choisir…</option>
                    {NIVEAUX.map((n) => <option key={n}>{n}</option>)}
                  </select>
                </Motion>
              </div>
            </div>

            <Motion role="rise" delay={915} as="div">
              <button type="button" onClick={next}
                className="lift-press flex h-(--h-tap) w-full items-center justify-center
                  rounded-(--radius-input) border border-line-3 bg-signal
                  text-[13px] font-bold text-void shadow-sh-2"
              >
                Continuer
              </button>
            </Motion>
          </Motion>
        )}

        {/* ── Étape 2 : le profil technique — la carte s'incline aussi :
            mêmes gestes qu'à la connexion, même surface unique. ── */}
        {step === 2 && (
          <Motion key="etape-2" role="rise" delay={120} as="form"
            onSubmit={submit}
            className="rounded-(--radius-card) border border-edge glass-strong
              p-5 shadow-sh-3 sm:p-7"
          >
            <h2 className="mb-1 font-display text-[1.5rem] font-bold tracking-[-0.03em]">
              Profil technique
            </h2>
            {/* Les langages sont des pavés, pas des cases à cocher : chacun
                se pose sur la grille, l'écart de 40 ms assez pour qu'on
                les voie arriver un par un. */}
            <div className="mb-4">
              <span className="label mb-1 block text-chalk">Langages maîtrisés</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {LANGAGES.map((l, i) => (
                  <Motion key={l} role="rise" delay={200 + i * 40} as="div">
                    <button
                      type="button"
                      onClick={() => toggleLang(l)}
                      aria-pressed={langs.has(l)}
                      className={`rounded-(--radius-chip) border-(--bw-thin) px-3 py-1.5
                        text-[11.5px] font-bold transition-[background-color,color,border-color]
                        duration-(--d-fast) ${langs.has(l)
                          ? "border-signal bg-signal/15 text-signal"
                          : "border-line-2 text-chalk-3 hover:border-line-3 hover:bg-surface-2 hover:text-chalk"}`}
                    >
                      {l}
                    </button>
                  </Motion>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label htmlFor="pw" className="label mb-1.5 block text-chalk">Mot de passe</label>
              <Motion role="rise" delay={420} as="div">
                <input id="pw" type="password" autoComplete="new-password" value={pw}
                  onChange={(e) => setPw(e.target.value)} placeholder="Minimum 6 caractères"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "register-error" : undefined}
                  className={inputCls} />
              </Motion>
            </div>

            <div className="mb-5">
              <label htmlFor="pw2" className="label mb-1.5 block text-chalk">Confirmer le mot de passe</label>
              <Motion role="rise" delay={475} as="div">
                <input id="pw2" type="password" autoComplete="new-password" value={pw2}
                  onChange={(e) => setPw2(e.target.value)} placeholder="Répétez votre mot de passe"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "register-error" : undefined}
                  className={inputCls} />
              </Motion>
            </div>

            <label className="mb-4 flex items-start gap-2.5 text-12 leading-relaxed text-chalk-3">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "register-error" : undefined}
                className="mt-0.5 accent-(--color-signal)"
              />
              <span>
                J’accepte les{" "}
                <Link href="/cgu" target="_blank" rel="noopener noreferrer" className="text-signal underline">
                  conditions générales d’utilisation
                </Link>.
              </span>
            </label>

            <div className="flex gap-2.5">
              <Motion role="rise" delay={530} as="div">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  aria-label="Revenir aux informations"
                  className="lift-press flex size-[44px] items-center justify-center
                    rounded-(--radius-input) border border-line-3 bg-transparent
                    text-chalk hover:bg-surface-2"
                >
                  <Icon name="chevron-left" size={16} strokeWidth={2.5} />
                </button>
              </Motion>

              <Motion role="rise" delay={585} as="div" className="flex-1">
                <button
                  type="submit"
                  disabled={busy || !acceptedTerms}
                  className="lift-press flex h-(--h-tap) w-full items-center justify-center gap-2
                    rounded-(--radius-input) border border-line-3 bg-signal
                    text-[13px] font-bold text-void shadow-sh-2 disabled:opacity-40"
                >
                  {busy ? <Spinner /> : "Créer mon compte"}
                </button>
              </Motion>
            </div>
          </Motion>
        )}

        <Motion role="fade" delay={760}>
          <p className="mt-5 text-center text-sm text-chalk-3">
            Déjà inscrit ?{" "}
            <Link href="/login" className="font-bold text-signal underline-sweep">
              Se connecter
            </Link>
          </p>
          <p className="mt-3 text-center text-[11px] text-chalk-4">
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