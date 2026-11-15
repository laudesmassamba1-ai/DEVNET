"use client";

/**
 * Contrôles de l'éditeur de statut : une entrée d'outil (icône + mot) et un
 * réglage (nom + valeur). Purement présentationnels : l'état reste dans
 * `StatusComposer`.
 */
import { Icon, type IconName } from "@/components/Icon";

/** Une entrée de la ligne d'outils : icône au-dessus, mot en dessous. */
export function ToolItem({
  label,
  icon,
  onClick,
  active = false,
  disabled = false,
  title,
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-disabled={disabled || undefined}
      title={title}
      className={`flex min-h-13 flex-1 flex-col items-center justify-center gap-1
        rounded-(--radius-chip) px-1 text-12 font-semibold
        transition-colors disabled:cursor-not-allowed disabled:opacity-35
        ${active ? "text-signal" : "text-chalk-3 hover:text-chalk"}`}
    >
      <Icon name={icon} size={18} />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

/**
 * Un réglage : le nom reste lisible à côté de sa valeur, pour qu'un cycle
 * ne demande pas de le presser pour savoir ce qu'il règle.
 */
export function Setting({
  label,
  hint,
  icon,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  hint: string;
  icon: IconName;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={`${hint} — ${label}`}
      className={`flex min-h-(--h-tap) flex-1 items-center justify-center gap-1.5
        rounded-(--radius-chip) border px-2 text-12 font-semibold
        transition-colors min-w-0 disabled:opacity-35
        ${active ? "border-signal/60 bg-signal/10 text-chalk" : "border-line-3 bg-surface text-chalk-3 hover:border-line-2 hover:text-chalk"}`}
    >
      <Icon name={icon} size={14} />
      <span className="truncate capitalize">{label}</span>
    </button>
  );
}

/** Pastille de couleur d'encre, sélectionnable. */
export function Swatch({
  label,
  cssVar,
  selected,
  onClick,
}: {
  label: string;
  cssVar: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`Couleur ${label}`}
      title={label}
      className={`flex min-h-(--h-tap) min-w-(--h-tap) items-center justify-center rounded-full
        ${selected ? "ring-2 ring-signal ring-offset-2 ring-offset-surface" : ""}`}
    >
      <span
        aria-hidden="true"
        className="block h-6 w-6 rounded-full border border-line-3"
        style={{ background: `var(${cssVar})` }}
      />
    </button>
  );
}
