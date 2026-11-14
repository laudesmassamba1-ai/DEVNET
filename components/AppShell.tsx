"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { BottomNav, Sidebar } from "./BottomNav";
import { Loading } from "./Avatar";
import { Logo } from "./Logo";
import { Motion } from "./Motion";
import { NotificationBell } from "./NotificationBell";
import { StatusBar, StatusProvider } from "./StatusBar";
import { useSession } from "@/hooks/useSession";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { getBackFallback } from "@/lib/navigation";

/** Navigation par clavier, comme dans un terminal : une touche, un écran. */
const KEY_FOCUS: Record<string, string> = {
  g: "/feed",
  m: "/messages",
  n: "/notifications",
  s: "/search",
  p: "/profile",
  b: "/signets",
  v: "/decouvrir",
};

/**
 * Détermine si l'élément cible reçoit du texte.
 * Couvre : INPUT, TEXTAREA, contentEditable, Monaco editor, rôle textbox/searchbox,
 * et les éditeurs custom (CodeEditor avec textarea transparent).
 */
function isTypingTarget(el: HTMLElement): boolean {
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute("role");
  if (role === "textbox" || role === "searchbox" || role === "combobox") return true;
  // Monaco editor : l'éditeur principal a la classe .monaco-editor
  if (el.closest(".monaco-editor")) return true;
  // CodeEditor maison : textarea transparent dans .code-editor
  if (el.closest(".code-editor")) return true;
  // Tout champ avec data-typing="true" (escape hatch pour composants custom)
  if (el.getAttribute("data-typing") === "true") return true;
  return false;
}

/**
 * Coquille commune aux pages protégées.
 *
 * **Deux dispositions, une seule métaphore.**
 *
 * - En dessous de 880 px : la colonne unique. Onglet de titre en haut,
 *   contenu, onglets en bas, ligne d'état — la disposition qu'on
 *   attend d'un mobile.
 * - Au-dessus : le **panneau de gauche**. Une colonne de 620 px perdue au
 *   milieu d'un écran large donne une application qui a l'air cassée ;
 *   l'espace gagné devient un explorateur, et la ligne d'état y trouve sa
 *   place naturelle, au pied du panneau.
 *
 * Le basculement passe par une requête média et non par un rendu
 * différent : le DOM doit rester unique, sinon on perd l'état, le focus et
 * la position de défilement à chaque rotation d'écran.
 *
 * **Mouvement de la coque.** La coque est le repère fixe de
 * l'application ; elle ne doit donc pas bouger quand on navigue, sinon
 * l'utilisateur perdrait le fil de l'interface. Seule l'onglet de titre
 * change — et il glisse, parce que c'est bien un onglet qu'on ouvre. Le
 * panneau de gauche n'a aucune animation d'entrée : il est *là*, comme
 * l'établi d'un atelier.
 */
export function AppShell({
  title,
  /** Chemin affiché dans la ligne d'état, ex. `~/fil`. */
  path,
  action,
  /** Pleine largeur : pour les écrans à deux volets (messages, groupe). */
  wide = false,
  /**
   * Immersif : la page occupe exactement le reste de la fenêtre, sans
   * défilement. C'est le mode de l'**IDE** — la coquille cesse d'être un
   * cadre qui défile et devient un simple conteneur, l'éditeur gérant son
   * propre défilement.
   *
   * Sans cela, la page défilerait sous l'éditeur : la barre d'outils
   * sortirait par le haut dès qu'on lit la fin d'un fichier, et le panneau
   * de sortie serait à mille pixels sous les yeux.
   *
   * Sur un téléphone, le mode reste non immersif : un IDE plein écran sur
   * 6 pouces de haut n'est pas un IDE, c'est une fente.
   */
  immersive = false,
  children,
}: {
  title?: string;
  path?: string;
  action?: React.ReactNode;
  wide?: boolean;
  immersive?: boolean;
  children: React.ReactNode;
}) {
  const { session, profile, loading } = useSession();
  const router = useRouter();
  /* Le pathname est le battement du re-tampon : à chaque navigation,
     le logo de la barre se « tamponne » à nouveau et la barre de
     progression se re-trace — la navigation a un pouls. */
  const pathname = usePathname();
  const desktop = useIsDesktop();
  const backFallback = getBackFallback(pathname);

  /**
   * Le panneau de navigation est **repliable**.
   *
   * Un explorateur de 236 px est le bon choix pour naviguer, et le mauvais
   * pour lire un long fil : sur un écran large, on veut pouvoir le ranger
   * et récupérer la largeur. Le choix est mémorisé — un panneau qui se
   * rouvre à chaque navigation serait plus pénible que de ne pas pouvoir
   * le fermer.
   *
   * Il est lu **au montage**, jamais pendant le rendu : le serveur ne
   * connaît pas `localStorage`, et lire sa valeur au premier rendu ferait
   * diverger l'hydratation.
   */
  const [navOpen, setNavOpen] = useState(true);

  useEffect(() => {
    if (window.localStorage.getItem("devnet.nav") === "closed")
    // eslint-disable-next-line react-hooks/set-state-in-effect
      setNavOpen(false);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("devnet.nav", navOpen ? "open" : "closed");
  }, [navOpen]);

  function navigateBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    if (backFallback) router.push(backFallback);
  }

  // Raccourcis clavier. Ignorés quand on tape dans un champ : « g » dans
  // le composeur veut dire « g », pas « aller au fil ».
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && isTypingTarget(t)) return;
      const dest = KEY_FOCUS[e.key.toLowerCase()];
      if (dest) {
        e.preventDefault();
        router.push(dest);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  if (loading) {
    return (
      <div className="flex min-h-[calc(100dvh-var(--h-banner,0px))] items-center justify-center">
        <Loading label="Ouverture de la session" />
      </div>
    );
  }

  if (!session) return null;

  return (
    <StatusProvider>
      <div className={desktop ? "flex min-h-[calc(100dvh-var(--h-banner,0px))]" : ""}>
        {desktop && navOpen && (
          <Sidebar
            path={path}
            isAdmin={profile?.is_admin === true}
            onCollapse={() => setNavOpen(false)}
          />
        )}

        <div className="min-w-0 flex-1">
          <header
            className="sticky top-[var(--h-banner,0px)] z-(--z-sticky) relative flex
              h-(--h-topbar) items-stretch justify-between
              border-b-(--bw-heavy) border-edge glass-strong
              rounded-none safe-top"
          >
            {/* La barre de progression de navigation : tracée à chaque
                changement de route, de gauche à droite, puis rendue à
                l'écran du contenu. Une ligne fine — la coque est déjà
                là ; elle raconte juste « ça avance ». */}
            {/* Un `span` natif suffit ici : le `key={pathname}` rejoue
                la classe `mo-grow` à chaque navigation. `Motion` n'est
                intervenu que pour le retard, dont ce trait n'a pas
                besoin. */}
            <span
              key={pathname}
              aria-hidden
              className="mo-grow pointer-events-none absolute inset-x-0 bottom-0 h-0.5
                origin-left bg-signal opacity-60"
            />
            {/* La réouverture vit ici, et pas dans le panneau : c'est le
                seul bouton qui doit rester quand le panneau a disparu —
                un bouton qui s'en va avec ce qu'il rouvre ne sert à rien.
                Fermer se fait depuis le panneau lui-même, là où le geste
                a un sens ; rouvrir se fait depuis la position stable. */}
            {desktop && !navOpen && (
              <div className="flex items-center border-r-(--bw-thin)
                border-line px-2">
                <IconButton
                  label="Déplier la navigation"
                  name="menu"
                  onClick={() => setNavOpen(true)}
                />
              </div>
            )}

            {backFallback && (
              <div className="flex items-center border-r-(--bw-thin) border-line px-1">
                <IconButton label="Retour" name="arrow-left" onClick={navigateBack} />
              </div>
            )}

            {title ? (
              /* Onglet ouvert : il partage la ligne avec le contenu, et
                 l'absence de coins le distingue de la barre qui le porte.
                 La `key` force le remontage à chaque navigation — sans elle,
                 React réutilise le nœud et l'animation ne se rejoue pas,
                 ce qui est exactement le comportement voulu d'un onglet
                 qu'on rouvre. */
              <Motion
                key={title}
                role="slide"
                as="h1"
                className="flex min-w-0 flex-1 items-center gap-2 self-center
                  border-l-[3px] border-signal bg-surface-2 px-(--gutter) text-chalk
                  font-display text-15 font-semibold tracking-[-0.02em]"
              >
                <Icon name="file" size={12} className="shrink-0 text-chalk-4" />
                {/* Le titre cède avant les icônes : sur un écran de 320 px,
                    quatre commandes à droite laissent peu de place, et un
                    titre tronqué vaut mieux qu'une barre qui déborde. */}
                <span className="truncate">{title}</span>
              </Motion>
            ) : (
              <div className="flex flex-1 items-center gap-2.5 px-(--gutter) shell:hidden">
                <Logo size={26} className="mo-pop" key={pathname} />
                <span className="font-display text-[1.15rem] font-bold
                  tracking-[-0.02em] leading-none">
                  DevNet<span className="text-signal">.</span>
                </span>
              </div>
            )}

            {!title && (
              <div className="hidden flex-1 items-center shell:flex">
                <h1 className="label text-chalk-3">{path ?? "~"}</h1>
              </div>
            )}

            {action && (
              <div className="flex shrink-0 items-center gap-2 border-l-(--bw-thin)
                border-line px-(--gutter)">
                {action}
              </div>
            )}

            {/* La cloche vit dans la barre de titre, **avant** l'action
                de la page, et non à côté : elle est la seule icône qui
                existe sur tous les écrans, donc elle a besoin d'une
                position stable — celle qu'occupe toujours l'action à sa
                droite. Sans cela, la cloche sauterait d'une colonne de
                quelques pixels selon les écrans, et l'œil la perdrait
                en la cherchant. */}
            <div className="flex shrink-0 items-center border-l-(--bw-thin)
              border-line px-1 sm:px-(--gutter)">
              <NotificationBell />
            </div>
          </header>

          {/* La colonne entre par une ascension de 8 px seulement : assez
              pour qu'on perçoive un changement de page, pas assez pour
              qu'on ait l'impression que la page « saute ».

              **Largeur : 560 px sur mobile, 720 px au-delà du seuil coque,
              et plus d'élargissement ensuite.** Le palier de 960 px qui
              existait au-delà de 1440 donnait des lignes de ~110 caractères
              dans le fil : lisible pour un tableau, épuisant pour un texte
              suivi. Une colonne de lecture ne s'élargit pas parce qu'un
              écran est plus grand ; les surfaces qui ont besoin de largeur
              (IDE, messagerie à deux volets) passent `wide` ou `immersive`
              et ne sont pas concernées. */}
          <Motion
            key={path}
            role={immersive ? "none" : "slide"}
            delay={60}
            as="main"
            className={`mx-auto
              ${immersive
                ? "h-[calc(100dvh-var(--h-topbar)-var(--h-banner,0px))] w-full max-w-none overflow-hidden"
                : desktop
                  ? wide
                    ? "min-h-[calc(100dvh-var(--h-topbar)-var(--h-banner,0px))] max-w-none"
                    : "min-h-[calc(100dvh-var(--h-topbar)-var(--h-banner,0px))] w-full max-w-[720px]"
                  : "max-w-[560px] min-h-0"}
              ${immersive
                ? "pb-0"
                : desktop && !wide ? "pb-10" : desktop ? "pb-0" : "pb-[calc(var(--h-bottomnav)+var(--h-status)+var(--space-lg))]"}`}
          >
            {children}
          </Motion>
        </div>

        {!desktop && !immersive && (
          <>
            <BottomNav isAdmin={profile?.is_admin === true} />
            <StatusBar path={path} />
          </>
        )}
      </div>
    </StatusProvider>
  );
}

/**
 * Le bouton d'en-tête.
 *
 * Sa taille est **le jeton**, jamais une valeur écrite : `--h-tap` est
 * déclaré « cible tactile minimale, règle dure » dans `globals.css`, et
 * une valeur écrite ici la contourne. C'était le cas : 34 px en dur, sur
 * tous les en-têtes de l'application — le bouton le plus proche du pouce
 * était le plus petit, ce qui est l'inverse de ce qu'on veut.
 *
 * La barre fait 56 px de haut : un bouton de 44 px y entre avec 6 px de
 * respiration. Il n'y a donc pas de conflit à arbitrer.
 */
export function IconButton({
  onClick,
  name,
  label,
  dataTour,
}: {
  onClick?: () => void;
  name: IconName;
  label: string;
  /** Ancre de la prise en main — `data-tour` posé sur le bouton. */
  dataTour?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      data-tour={dataTour}
      className="glass-pill mo-press flex size-(--h-tap) items-center justify-center
        rounded-full border-(--bw-thin) border-line-2/40 text-chalk
        transition-[background-color,color,border-color]
        duration-(--d-fast) ease-(--ease-spring)
        hover:border-signal hover:bg-signal hover:text-void"
    >
      <Icon name={name} size={16} />
    </button>
  );
}
