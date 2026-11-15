import { Icon } from "./Icon";
import type { IconSize } from "./Icon";
import type { VerifiedBadge as TierBadge } from "@/lib/verification";

/**
 * Le cachet de vérification — un badge **3D cel-shading** avec textures HD.
 *
 * Le badge lit d'un coup d'œil : sa forme dit le palier (losange pour
 * un Nouveau, sceau pour une Légende), sa couleur suit la silhouette,
 * son emblème redit le palier à qui regarde de près. Rien n'est écrit
 * dessus : le titre et le mot d'ordre vivent dans `title` et
 * `aria-label`, et les pages qui portent le badge annoncent déjà le
 * palier à côté.
 *
 * Onze formes + onze teintes avec ombrage cel-shading, lumières directionnelles
 * et textures haute résolution qui donnent profondeur et caractère sans
 * jamais recourir à des dégradés flous. La lisibilité à petit format est
 * garantie par des bords nets et des contrastes marqués.
 */
export function VerifiedBadge({
  label,
  tier,
  size = "inline",
  className = "",
}: {
  /** Écrase le libellé accessible. Par défaut : « Compte vérifié », ou le palier. */
  label?: string;
  /** La variante de palier ; `null`/absent = cachet de base. */
  tier?: TierBadge | null;
  size?: "sm" | "inline" | "lg";
  className?: string;
}) {
  const resolved =
    label ?? (tier ? `Vérifié — ${tier.label}` : "Compte vérifié");
  const icon = tier?.icon ?? "check";
  const shape = tier?.shape ?? "round";
  const hint = tier ? `${tier.label} · ${tier.motto}` : resolved;
  /* L'anneau de l'équipe : posé par `badgeFor`, jamais par la silhouette.
     Un compte d'administration garde donc son palier et gagne un liseré. */
  const official = tier?.admin === true;
  const glyph: IconSize = size === "lg" ? 12 : size === "inline" ? 11 : 9;
  const classes =
    `verify-badge verify-badge-${size} verify-shape-${shape}` +
    (official ? " verify-badge-admin" : "") +
    (className ? ` ${className}` : "");

  return (
    <span
      role="img"
      aria-label={official ? `${resolved}, administration` : resolved}
      title={official ? `${hint} · compte d'administration` : hint}
      className={
        `${classes} verify-badge-3d`
      }
    >
      <Icon name={icon} size={glyph} strokeWidth={3.4} />
    </span>
  );
}
