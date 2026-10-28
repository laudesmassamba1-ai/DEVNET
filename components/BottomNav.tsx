"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";
import { Logo } from "./Logo";
import { PendingStatus, usePendingVisible } from "./Pending";
import { useStatus } from "./StatusBar";

const LINKS: { href: string; label: string; icon: IconName; key: string }[] = [
  { href: "/feed", label: "Fil", icon: "feed", key: "fil" },
  { href: "/decouvrir", label: "Vivier", icon: "spark", key: "vivier" },
  { href: "/search", label: "Recherche", icon: "search", key: "recherche" },
  { href: "/groups", label: "Groupes", icon: "groups", key: "groupes" },
  { href: "/messages", label: "Messages", icon: "messages", key: "messages" },
  { href: "/profile", label: "Profil", icon: "profile", key: "profil" },
];

/**
 * Barre d'onglets — l'aile basse sur mobile.
 *
 * L'onglet actif se décolle par un liseré d'accent et un fond plus clair :
 * la logique d'un onglet d'éditeur, où seul l'onglet courant quitte le
 * fond. Les libellés sont en minuscules — ce sont des onglets, pas des
 * titres.
 *
 * Au-dessus de 768 px elle cède la place à `<Sidebar>` : sur un écran large,
 * une barre fixe en bas force le regard vers le bas pour rien.
 */
/**
 * Liens de la barre latérale qui n'allaient pas dans la barre basse.
 *
 * Le dépôt est un espace de travail, pas un onglet de navigation
 * quotidienne : on ne le visite pas en scrollant entre le fil et les
 * messages. Six onglets en bas d'un écran de téléphone deviennent six
 * cibles de 60 px, et la moitié ne sert jamais. Il reste donc dans la
 * barre latérale, sous les liens principaux, et accessible depuis le
 * profil — où il est à sa place, puisqu'un dépôt appartient à quelqu'un.
 */
const WORKSPACE: { href: string; label: string; icon: IconName }[] = [
  { href: "/communities", label: "Communautés", icon: "globe" },
  { href: "/projects", label: "Projets", icon: "package" },
  { href: "/github", label: "GitHub", icon: "code" },
  { href: "/extensions", label: "Extensions", icon: "grid" },
];

/**
 * Le centre de notifications, côté panneau.
 *
 * Il a déjà son point d'entrée **dans la barre de titre** — la cloche,
 * avec son compteur — et c'est là qu'il faut le trouver : une icône
 * dans une liste demande qu'on soit déjà dans le bon écran, tandis
 * qu'une cloche visible partout annonce qu'il y a quelque chose à
 * voir.
 *
 * Le lien du panneau n'est donc pas un second point d'entrée : c'est le
 * même endroit, nommé. Sur un grand écran, on lit une liste de liens
 * avant de promener le curseur dans la barre de titre ; sur un écran de
 * téléphone, il n'y a pas de panneau du tout, et la barre basse garde
 * ses cinq onglets.
 *
 * Pas de compteur ici : il serait identique à celui de la cloche, et
 * deux chiffres pour la même valeur finissent par diverger.
 */
const ACTIVITY: { href: string; label: string; icon: IconName }[] = [
  // Les signets quittent la barre basse pour le Vivier : on les garde ici,
  // sur grand écran, et sous la touche `b`. Six onglets au pouce, pas sept.
  { href: "/signets", label: "Signets", icon: "bookmark" },
  { href: "/notifications", label: "Notifications", icon: "notifications" },
  // La modération rejoint l'activité, pas l'explorateur : on ne va pas y
  // chercher du contenu, on y va traiter ce qui a été signalé sur le
  // sien. Elle n'apparaît pas dans la barre basse du téléphone, qui est
  // déjà à cinq entrées — c'est un écran de gestion, pas une destination.
  { href: "/moderation", label: "Modération", icon: "flag" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      data-tour="nav-main"
      className="fixed inset-x-0 bottom-0 z-[var(--z-nav)] flex
        h-[var(--h-bottomnav)] items-stretch border-t-[var(--bw-heavy)]
        border-edge glass-strong pb-[env(safe-area-inset-bottom)]
        rounded-[var(--radius-card)] shell:hidden"
    >
      {LINKS.map((l) => {
        const active = pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`relative mx-1 my-1.5 flex flex-1 flex-col items-center
              justify-center gap-[5px] rounded-[var(--radius-chip)] label-micro
              transition-[color,background-color] duration-[var(--d-fast)]
              ease-[var(--ease-continuous)] active:translate-y-px
              ${active
                ? "bg-surface-2 text-signal shadow-[var(--glass-rim)]"
                : "text-chalk-4 hover:bg-surface-2/60 hover:text-chalk-2"}`}
          >
            {/* L'onglet actif est une gélule : la capsule translucide
                et son reflet suffisent à le désigner — pas de repère
                sérigraphié en plus sur une surface de verre. */}

            {/* L'icône de l'onglet actif se redresse d'un demi-trait :
                le passage de 1.6 à 2 px est le seul « gras » du jeu,
                donc il ne peut pas être contesté. */}
            <span
              className="flex items-center justify-center"
              style={{
                transition: "transform var(--d-base) var(--ease-spring)",
                transform: active ? "translateY(-1px)" : "none",
              }}
            >
              <Icon name={l.icon} size={20} strokeWidth={active ? 2 : 1.6} />
            </span>

            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Sidebar — l'explorateur, au-dessus de 768 px.
 *
 * C'est la réponse au problème le plus visible du design mobile : à 1280 px,
 * une colonne de 520 px perdue dans le vide donne une application qui a l'air
 * cassée. Ici l'espace gagné devient un **panneau de navigation réel**, à
 * l'image de la barre latérale d'un éditeur — et la ligne d'état, qui est
 * normalement tout en bas d'un terminal, y trouve sa place naturelle.
 *
 * Le panneau est `sticky` et non `fixed` : il reste visible au défilement
 * sans se désynchroniser du flux, et il disparaît avec la page.
 */
export function Sidebar({
  path,
  onCollapse,
}: {
  path?: string;
  /** Replier le panneau. Absent, aucun bouton n'est montré. */
  onCollapse?: () => void;
}) {
  const pathname = usePathname();
  const { demo, clock } = useStatus();
  const pending = usePendingVisible();

  return (
    <aside
      data-tour="nav-main"
      className="sticky top-[var(--h-banner,0px)] hidden h-[calc(100dvh-var(--h-banner,0px))]
        w-[236px] shrink-0 flex-col rounded-[var(--radius-card)] border-r-[var(--bw-heavy)] border-edge
        glass shell:flex"
    >
      {/* Marque */}
      <div className="flex h-[var(--h-topbar)] shrink-0 items-center gap-2.5
        border-b-[var(--bw-thin)] border-line px-4">
        <Logo size={26} className="mo-pop" key={path} />
        <span className="font-display text-[1.15rem] font-bold
          tracking-[-0.02em] leading-none text-chalk">
          DevNet<span className="text-signal">.</span>
        </span>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Replier la navigation"
            title="Replier la navigation"
            className="mo-press ml-auto flex size-[var(--h-action)] shrink-0 items-center
              justify-center rounded-full border-[var(--bw-thin)] border-line-2/40 text-chalk-4
              transition-colors hover:border-signal hover:bg-signal hover:text-void"
          >
            <Icon name="chevron-left" size={14} />
          </button>
        )}
      </div>

      {/* Explorateur */}
      <div className="flex-1 overflow-y-auto py-3">
        <p className="label-micro px-4 pb-2 text-chalk-4">Explorateur</p>
        <ul>
          {LINKS.map((l) => {
            const active = pathname.startsWith(l.href);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative mx-2 flex items-center gap-2.5 rounded-full
                    px-3.5 py-2.5 text-[13.5px]
                    transition-[color,background-color] duration-[var(--d-fast)]
                    ease-[var(--ease-continuous)]
                    ${active
                      ? "bg-surface-2 font-semibold text-signal shadow-[var(--glass-rim)]"
                      : "text-chalk-3 hover:bg-surface-2/60 hover:text-chalk"}`}
                >
                  <Icon name={l.icon} size={16} strokeWidth={active ? 2 : 1.6} />
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="label-micro px-4 pt-4 pb-2 text-chalk-4">Activité</p>
        <ul>
          {ACTIVITY.map((l) => {
            const active = pathname.startsWith(l.href);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex items-center gap-2.5 py-2.5 pl-4 pr-3
                    rounded-[var(--radius-input)] text-[13.5px]
                    transition-[color,background-color] duration-[var(--d-fast)]
                    ease-[var(--ease-continuous)]
                    ${active
                      ? "bg-surface-2 font-semibold text-signal"
                      : "text-chalk-3 hover:bg-surface-2/60 hover:text-chalk"}`}
                >
                  {active && (
                    <span
                      className="absolute inset-y-0 left-0 w-[3px] origin-top border-signal"
                      style={{
                        background: "var(--gradient-amber-fire)",
                        boxShadow: "var(--shadow-sh-1)",
                        animation: "enterRise var(--d-base) var(--ease-spring) both",
                      }}
                    />
                  )}
                  <Icon name={l.icon} size={16} strokeWidth={active ? 2 : 1.6} />
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="label-micro px-4 pt-4 pb-2 text-chalk-4">Espace de travail</p>
        <ul>
          {WORKSPACE.map((l) => {
            const active = pathname.startsWith(l.href);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex items-center gap-2.5 py-2.5 pl-4 pr-3
                    rounded-[var(--radius-input)] text-[13.5px]
                    transition-[color,background-color] duration-[var(--d-fast)]
                    ease-[var(--ease-continuous)]
                    ${active
                      ? "bg-surface-2 font-semibold text-signal"
                      : "text-chalk-3 hover:bg-surface-2/60 hover:text-chalk"}`}
                >
                  {active && (
                    <span
                      className="absolute inset-y-0 left-0 w-[3px] origin-top border-signal"
                      style={{
                        background: "var(--gradient-amber-fire)",
                        boxShadow: "var(--shadow-sh-1)",
                        animation: "enterRise var(--d-base) var(--ease-spring) both",
                      }}
                    />
                  )}
                  <Icon name={l.icon} size={16} strokeWidth={active ? 2 : 1.6} />
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <nav
        aria-label="Informations"
        className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-t-[var(--bw-thin)]
          border-line px-4 py-2 font-mono text-[10px] text-chalk-4"
      >
        <Link href="/settings" className="inline-flex items-center gap-1 hover:text-chalk-2">
          <Icon name="settings" size={9} strokeWidth={1.8} />
          Paramètres
        </Link>
        <Link href="/aide" className="hover:text-chalk-2">Aide</Link>
        <Link href="/a-propos" className="hover:text-chalk-2">À propos</Link>
        <Link href="/confidentialite" className="hover:text-chalk-2">Confidentialité</Link>
        <Link href="/cgu" className="hover:text-chalk-2">CGU</Link>
        <Link href="/setup" className="hover:text-chalk-2">Diagnostic</Link>
      </nav>

      {/* Ligne d'état : sur grand écran elle rejoint le pied du panneau,
          qui est exactement où un éditeur la place. */}
      <div className="shrink-0 border-t-[var(--bw-thin)] border-line px-4 py-2.5">
        {path && (
          <p className="label-micro flex items-center gap-1.5 text-chalk-4">
            <Icon name="terminal" size={11} />
            <span className="truncate">{path}</span>
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          {demo ? (
            <span className="label-micro flex items-center gap-1 rounded-full bg-signal
              px-1.5 py-px text-void">
              <Icon name="bolt" size={9} strokeWidth={2.4} />
              démo
            </span>
          ) : pending ? (
            /* Le réseau travaille : le mini-logo suit le vrai temps des
               requêtes (lib/pending), sur la ligne d'état aussi. */
            <PendingStatus />
          ) : (
            <span className="label-micro flex items-center gap-1 text-phosphor">
              <span className="mode-live block size-[5px] bg-phosphor" />
              en ligne
            </span>
          )}
          <span className="label-micro tnum ml-auto text-chalk-4">{clock}</span>
        </div>

      </div>
    </aside>
  );
}
