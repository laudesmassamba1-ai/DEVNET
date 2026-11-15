/**
 * Marque DevNet — version « CEL SHADING » statique.
 *
 * Le même symbole que la version animée (fenêtre, chevron `>`, curseur) —
 * c'est la cellule **finale** du récit, celle où la construction se pose.
 * Aucune animation : le logo décrit doit rester immobile en 26 px dans la
 * barre d'en-tête comme en 58 px au-dessus d'un formulaire.
 *
 * Les couleurs viennent des jetons du thème : le cadre et le chevron
 * reprennent le signal menthe, tandis que le curseur marque la présence.
 *
 * Pourquoi ce dessin plutôt qu'un monogramme abstrait : à 26 px
 * dans une barre de titre, la seule chose qui fonctionne est un symbole
 * déjà appris par des millions d'écran. Les bandes de cel shading restent
 * lisibles à cette taille : deux tons franchement distincts, jamais une
 * grille de dégradé que l'écran ne peut pas rendre.
 */
export function Logo({
  size = 32,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        {/* Vitre : l'intérieur de la fenêtre, hors épaisseur de l'encre */}
        <clipPath id="logo-win">
          <rect x="5.4" y="9.4" width="53.2" height="45.2" />
        </clipPath>
        {/* Bande d'ombre : moitié droite du plan (lumière haut-gauche) */}
        <clipPath id="logo-shade">
          <rect x="32" y="0" width="32" height="64" />
        </clipPath>
        {/* Rim light : contourn haut-gauche du cadre */}
        <clipPath id="logo-rim">
          <path d="M0 0 H64 V10 H10 V64 H0 Z" />
        </clipPath>
      </defs>

      {/* Vitre : aplat sombre + bande d'ombre dure + lumière du plafond */}
      <g clipPath="url(#logo-win)">
        <rect x="5.4" y="9.4" width="53.2" height="45.2" fill="var(--color-page-end)" />
        <rect x="33.6" y="9.4" width="25" height="45.2" fill="var(--color-page)" />
        <rect x="5.4" y="9.4" width="53.2" height="4.2" fill="var(--color-surface-2)" />
      </g>

      {/* Barre de titre : aplat mi-hauteur + ombre dure assombrie */}
      <g clipPath="url(#logo-win)">
        <line x1="5.4" y1="19" x2="58.6" y2="19" stroke="var(--color-signal)" strokeWidth="2.2" />
        <g clipPath="url(#logo-shade)">
          <line x1="5.4" y1="19" x2="58.6" y2="19" stroke="var(--color-signal-d)" strokeWidth="2.2" />
        </g>
      </g>

      {/* Cadre : encre, aplat orange, face droite à l'ombre, rim light */}
      <g fill="none" strokeLinejoin="miter">
        <rect x="3" y="7" width="58" height="50" rx="7" stroke="var(--color-void)" strokeWidth="5.2" />
        <rect x="3" y="7" width="58" height="50" rx="7" stroke="var(--color-signal)" strokeWidth="3.2" />
        <g clipPath="url(#logo-shade)">
          <rect x="3" y="7" width="58" height="50" rx="7" stroke="var(--color-signal-d)" strokeWidth="3.2" />
        </g>
        <g clipPath="url(#logo-rim)">
          <rect x="3" y="7" width="58" height="50" rx="7" stroke="var(--color-chalk)" strokeWidth="1.2" />
        </g>
      </g>

      {/* Pastilles de la barre de titre : trois déciles d'opacité, _translate
         une étincelle en haut-gauche qui les lit comme des boutons */}
      {[{ x: 9, o: 1 }, { x: 16, o: .72 }, { x: 23, o: .45 }].map((d, i) => (
        <g key={i}>
          <rect x={d.x} y="11" width="4.4" height="4.4" fill="var(--color-signal)" opacity={d.o} />
          <rect x={d.x} y="11" width="1.7" height="1.7" fill="var(--color-chalk)" opacity={d.o} />
        </g>
      ))}

      {/* Le chevron `>` : encre, aplat, face droite à l'ombre, rim fin */}
      <g fill="none" strokeLinecap="butt" strokeLinejoin="miter">
        <path d="M14.6 28.6 L26.4 38 L14.6 47.4" stroke="var(--color-void)" strokeWidth="7.4" />
        <path d="M14.6 28.6 L26.4 38 L14.6 47.4" stroke="var(--color-signal)" strokeWidth="4.6" />
        <g clipPath="url(#logo-shade)">
          <path d="M14.6 28.6 L26.4 38 L14.6 47.4" stroke="var(--color-signal-d)" strokeWidth="4.6" />
        </g>
      </g>

      {/* Curseur bloc phosphor : la présence de quelqu'un, là, maintenant.
         La face droite à l'ombre et la tranche claire font la matière. */}
      <g>
        <rect x="32" y="42.6" width="14" height="5.6" fill="var(--color-phosphor)" />
        <rect x="39" y="42.6" width="7" height="5.6" fill="var(--color-phosphor-d)" />
        <rect x="32" y="42.6" width="14" height="1.7" fill="var(--color-chalk)" />
      </g>
    </svg>
  );
}
