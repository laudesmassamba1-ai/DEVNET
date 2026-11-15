import { ALL_VERIFY_BADGES } from "@/lib/verification";
import { VerifiedBadge } from "./VerifiedBadge";

/**
 * Les onze cachets, côte à côte — la seule façon de les voir tous.
 *
 * Un membre ne porte qu'un cachet : sans cette planche, l'échelle des
 * paliers resterait invisible jusqu'au jour où on l'atteint. Le cachet
 * obtenu est le seul rendu en taille `inline` (un cran au-dessus), ce
 * qui marque la position sans ajouter une couleur ni un contour — un
 * anneau serait rogné par la découpe.
 */
export function BadgeGallery({
  earned = -1,
  className = "",
}: {
  /** L'index du cachet obtenu (`0` = base) ; `-1` si le compte n'en porte pas. */
  earned?: number;
  className?: string;
}) {
  return (
    <ul className={`flex flex-wrap items-center gap-2 ${className}`}>
      {ALL_VERIFY_BADGES.map((badge) => (
        <li key={badge.key} className="flex items-center">
          <VerifiedBadge
            tier={badge}
            size={badge.index === earned ? "inline" : "sm"}
          />
        </li>
      ))}
    </ul>
  );
}
