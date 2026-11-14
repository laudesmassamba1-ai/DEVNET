/**
 * Remplace `autoFocus` (déconseillé par l'accessibilité) : passé en `ref`,
 * il donne le focus au champ au montage. Référence stable, donc appelé une seule fois.
 * À réserver à un champ ouvert par l'utilisateur (feuille, panneau, recherche).
 */
export function focusOnMount(element: HTMLElement | null) {
  element?.focus();
}
