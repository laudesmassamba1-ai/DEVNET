"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { useSession } from "@/hooks/useSession";
import { useChallenges } from "@/hooks/useChallenges";
import { challengeXp } from "@/lib/challenges";
import { markChallengeAlertSeen } from "@/lib/challengeAlert";

/**
 * La **notification horaire des défis du jour**.
 *
 * Les défis ne sont plus posés dans le fil : un bloc ancré entre deux
 * publications obligeait à lire le fil pour tomber dessus, et il restait
 * affiché en permanence alors qu'il ne change qu'une fois par jour. Ils
 * arrivent donc comme un **message**, au-dessus de l'interface, une fois
 * par heure, et repartent tout seuls.
 *
 * Trois propriétés tiennent cette promesse :
 *
 * - **global** — le composant est monté dans le layout, pas dans une
 *   page. Il ne dépend donc d'aucun écran et ne peut pas être « oublié »
 *   en changeant de route ;
 * - **flottant** — rendu dans `document.body` via un portail, il échappe
 *   aux `transform`/`backdrop-filter` des ancêtres qui créeraient un bloc
 *   conteneur et figeraient son `position: fixed` ;
 * - **temporaire** — il s'efface après quelques secondes et revient à
 *   l'heure suivante. Un bandeau permanent n'est plus lu.
 *
 * Le premier affichage est différé de quelques secondes : laisser la page
 * se poser avant de faire parler l'interface évite qu'un pop up soit la
 * première chose qu'on voie en arrivant.
 *
 * **Elle laisse une trace dans la cloche.** Un message qu'on rate en
 * changeant d'onglet ne doit pas être perdu : tant qu'on ne l'a pas
 * acquittée, le centre de notifications en montre une entrée non lue
 * (`lib/challengeAlert.ts`) qui mène au même onglet Progrès. La
 * notification horaire est le rappel ; l'entrée du centre est la trace.
 * C'est aussi pourquoi « Voir mes défis » l'acquitte : on vient d'aller
 * voir, la cloche n'a plus rien à annoncer.
 */
const FIRST_SHOW_MS = 3_500;
/** Une fois par heure — l'énoncé du produit, pas un réglage décoratif. */
const REPEAT_MS = 60 * 60 * 1000;
/** Assez pour lire trois lignes, assez court pour ne pas s'installer. */
const VISIBLE_MS = 18_000;

export function ChallengeNotification() {
  const { profile } = useSession();
  const challenges = useChallenges(profile);
  const router = useRouter();

  const [visible, setVisible] = useState(false);

  const ready = Boolean(profile) && challenges.length > 0;

  // Le rythme : un premier passage, puis un toutes les heures. Le
  // nettoyage retire les deux, sinon changer de compte empilerait les
  // minuteries et la notification reviendrait plusieurs fois par heure.
  useEffect(() => {
    if (!ready) return;
    const first = window.setTimeout(() => setVisible(true), FIRST_SHOW_MS);
    const every = window.setInterval(() => setVisible(true), REPEAT_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [ready]);

  // La disparition. Elle est relancée à chaque apparition : sans le
  // `clearTimeout` du nettoyage, la minuterie d'une apparition précédente
  // fermerait la suivante au milieu de sa lecture.
  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  // `visible` ne passe à vrai que depuis une minuterie d'effet, donc
  // jamais au rendu serveur : le portail n'est atteint que dans le
  // navigateur et `document` existe forcément.
  if (!visible || !ready || typeof document === "undefined") return null;

  const gain = challengeXp(challenges);
  const done = challenges.filter((c) => c.done).length;

  const node = (
    <aside
      role="status"
      aria-live="polite"
      aria-label="Défis du jour"
      className="mo-msg-in pointer-events-auto fixed right-3 z-[var(--z-toast)]
        w-[min(340px,calc(100vw-1.5rem))] overflow-hidden rounded-[var(--radius-card)]
        border border-line-3 bg-surface/95 p-3.5 pr-10 shadow-sh-2 backdrop-blur-sm
        top-[calc(var(--h-banner,0px)+var(--h-topbar)+0.75rem)] shell:right-4"
    >
      {/* Le filet d'accent à gauche : la lecture d'« il y a du nouveau » se
          fait avant la lecture du texte, comme dans la liste de
          notifications. */}
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-signal" />

      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Fermer la notification des défis"
        className="absolute right-2 top-2 inline-flex size-6 items-center justify-center
          rounded-full border border-line-2 text-chalk-4 transition-colors
          duration-[var(--d-fast)] hover:border-line-3 hover:text-chalk"
      >
        <Icon name="close" size={12} strokeWidth={2} />
      </button>

      <header className="mb-2.5 flex items-center gap-2">
        {/* La sonnerie : le glyphe oscille une fois à l'apparition, comme
            une cloche qu'on vient de faire tinter. C'est le seul moment
            où le mouvement porte le sens « il y a du nouveau ». */}
        <span className="mo-bell flex size-8 shrink-0 items-center justify-center rounded-full
          border border-signal/40 bg-signal/12 text-signal">
          <Icon name="target" size={14} strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <p className="text-[12.5px] font-bold leading-tight">DevNet · Défis du jour</p>
          <p className="label-micro text-chalk-4">
            il y a un instant · {done}/{challenges.length} terminés
          </p>
        </div>
      </header>

      <ul className="space-y-1.5">
        {challenges.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full border
                ${c.done
                  ? "border-signal bg-signal text-void"
                  : "border-line-2 bg-surface-2 text-chalk-3"}`}
            >
              <Icon name={c.done ? "check" : c.icon} size={12} strokeWidth={2} />
            </span>
            <span className={`min-w-0 flex-1 truncate text-[12.5px] ${c.done ? "text-chalk-3" : "text-chalk"}`}>
              {c.label}
            </span>
            <span className="tnum shrink-0 font-mono text-[10.5px] text-chalk-4">
              {c.done ? `+${c.xp}` : `${c.progress}/${c.target}`}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line-2 pt-2.5">
        <span className="label-micro text-chalk-4">
          {gain > 0 ? `+${gain} XP gagnés` : "à toi de jouer"}
        </span>
        <button
          type="button"
          onClick={() => {
            // On a cliqué « Voir mes défis » : l'entrée correspondante du
            // centre est donc lue. Sans cet acquittement, la cloche
            // continuerait d'annoncer quelque chose qu'on vient d'aller
            // consulter.
            if (profile) markChallengeAlertSeen(profile.id);
            setVisible(false);
            router.push("/profile?tab=progress");
          }}
          className="mo-press inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-chip)]
            border border-signal bg-signal px-2.5 font-mono text-[10.5px] font-bold
            uppercase tracking-[0.1em] text-void"
        >
          Voir mes défis
        </button>
      </div>
    </aside>
  );

  return createPortal(node, document.body);
}
