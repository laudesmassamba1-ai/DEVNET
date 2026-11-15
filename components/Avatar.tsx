"use client";

import { Icon } from "./Icon";
import { LoadingLogo } from "./LoadingLogo";

import { avatarClass, initials } from "@/lib/utils";
import type { AvatarColor } from "@/lib/types";

const SIZE = {
  sm: "size-8.5 text-13",
  md: "size-10.5 text-15",
  lg: "size-18 text-[26px] border-(--bw-heavy)",
} as const;

export function Avatar({
  name,
  color,
  src,
  size = "sm",
  className = "",
}: {
  name?: string | null;
  color?: string | null;
  /** Photo de profil ; les initiales restent le repli. */
  src?: string | null;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-(--radius-input) border font-display font-bold
        ${SIZE[size]} ${avatarClass(color as AvatarColor)} ${className}`}
      style={size === "lg" ? { boxShadow: "var(--shadow-avatar-ring)" } : {}}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar déjà dimensionné, URL média arbitraire
        <img src={src} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        initials(name)
      )}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  /* Le logo en boucle remplace le spinner à bordure tournante : un
     chargement dit le nom de l'application, pas « un truc tourne ».
     Même sémantique (`aria-label="Chargement"` portée par le
     composant), même point d'usage ; la marque est ajoutée. */
  return <LoadingLogo size="sm" className={className} />;
}

export function Loading({ label = "Chargement" }: { label?: string }) {
  /* Le chargement n'a plus de texte : le logo qui se construit en
     boucle EST le message. Le libellé reste au `aria-label` du loader,
     donc les lecteurs d'écran gardent l'information sans qu'un
     « Chargement… » clignote sous l'œil d'utilisateur. */
  return (
    <div className="flex items-center justify-center gap-2.5 py-12">
      <LoadingLogo size="md" ariaLabel={label} />
    </div>
  );
}

/**
 * État vide.
 *
 * Une page vide est un **échec de conception**, pas un cas à part : si
 * l'utilisateur tombe dessus, il n'a rien à faire et personne ne lui a
 * dit pourquoi. On traite donc cet écran comme un écran à part entière.
 *
 * Trois règles, appliquées ici :
 *
 * 1. **on explique la situation** — pas seulement « aucun résultat »,
 *    mais ce qui la cause et ce qu'on peut y faire ;
 * 2. **on propose l'action** — un bouton, pas un conseil ;
 * 3. **on ne fait pas culpabiliser** — « aucun » pas « tu n'as rien fait ».
 */
export function EmptyState({
  title,
  hint,
  icon,
  action,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mo-scale mx-3 my-4 rounded-(--radius-card) border border-dashed border-line-2 bg-surface/50"
      role="status">
      <div className="flex items-center gap-2 border-b border-dashed border-line-2 px-4 py-2">
        <Icon name="terminal" size={11} className="text-signal" />
        <span className="label-micro text-chalk-4">buffer vide</span>
      </div>

      <div className="flex flex-col items-center gap-3 px-7 py-8 text-center">
        {/* L'icône respire : un état vide silencieux se lit comme une
            panne ; la respiration discrète dit « la surface est prête,
            il ne s'est encore rien passé ici ». `prefers-reduced-motion`
            la coupe — l'information vit aussi dans le texte. */}
        <div className="mo-breathe flex size-11.5 items-center justify-center rounded-(--radius-input) border
          border-line-2 bg-surface-2 text-chalk-3">
          {icon ?? (
            <span className="font-mono text-[1.1rem] font-bold leading-none text-signal"
              aria-hidden="true">❯_</span>
          )}
        </div>

        <h3 className="font-mono text-[0.95rem] font-bold uppercase
          tracking-[0.14em] text-chalk">
          {title}
        </h3>

        {hint && (
          <p className="max-w-[300px] break-words font-mono text-12
            leading-[1.75] text-chalk-3">
            <span className="text-chalk-4"># </span>
            {hint}
          </p>
        )}

        {action && <div className="mt-1">{action}</div>}
      </div>
    </div>
  );
}

/**
 * Bouton d'action pour un état vide.
 *
 * Variante compacte du bouton principal, avec la même grammaire : filet
 * d'accent, ombre dure, texte sombre sur l'ambre.
 */
export function PrimaryButton({
  onClick,
  icon,
  children,
  type = "button",
}: {
  onClick?: () => void;
  icon?: Parameters<typeof Icon>[0]["name"];
  children: React.ReactNode;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className="mo-press inline-flex h-(--h-tap) items-center justify-center gap-2
        rounded-(--radius-input) border border-line-3 bg-signal px-4
        text-sm font-bold text-void shadow-sh-1
        hover:border-signal hover:shadow-sh-2"
    >
      {icon && <Icon name={icon} size={14} strokeWidth={2.2} />}
      {children}
    </button>
  );
}