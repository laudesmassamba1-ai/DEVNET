/**
 * Marque DevNet — version « CEL SHADING » statique.
 *
 * Le même symbole que la version animée (fenêtre, chevron `>`, curseur) —
 * c'est la cellule **finale** du récit, celle où la construction se pose.
 * Aucune animation : le logo décrit doit rester immobile en 26 px dans la
 * barre d'en-tête comme en 58 px au-dessus d'un formulaire.
 *
 * Cel shading = pas de dégradé, des aplats plats à bords durs :
 * - l'encre franche `#200F04` dessine le contour et fait lire le dessin ;
 * - la bande d'ombre `#150B04` couvre la moitié droite de la vitre —
 *   la lumière vient du haut-gauche, une seule source, jamais d'ombre
 *   portée à l'aveugle ;
 * - le cadre orange garde sa face droite `#B8541C` et son rim light
 *   `#FFC68E` en haut-gauche (deux tons, bords durs) ;
 * - le chevron `#FF8A3D` reçoit la même ombre sur sa moitié droite ;
 * - le curseur phosphor `#8FFF5C` a sa face `#5CA83A` et sa tranche
 *   `#D8FFB4` — la cellule « posée » du curseur qui cligne en boucle
 *   dans la version animée.
 *
 * PourquoixeRetry ce dessin-là plutôt qu'un monogramme abstrait : à 26 px
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
        <rect x="5.4" y="9.4" width="53.2" height="45.2" fill="#221610" />
        <rect x="33.6" y="9.4" width="25" height="45.2" fill="#150C07" />
        <rect x="5.4" y="9.4" width="53.2" height="4.2" fill="#2E1E12" />
      </g>

      {/* Barre de titre : aplat mi-hauteur + ombre dure assombrie */}
      <g clipPath="url(#logo-win)">
        <line x1="5.4" y1="19" x2="58.6" y2="19" stroke="#FF8A3D" strokeWidth="2.2" />
        <g clipPath="url(#logo-shade)">
          <line x1="5.4" y1="19" x2="58.6" y2="19" stroke="#B8541C" strokeWidth="2.2" />
        </g>
      </g>

      {/* Cadre : encre, aplat orange, face droite à l'ombre, rim light */}
      <g fill="none" strokeLinejoin="miter">
        <rect x="3" y="7" width="58" height="50" rx="2" stroke="#200F04" strokeWidth="5.2" />
        <rect x="3" y="7" width="58" height="50" rx="2" stroke="#FF8A3D" strokeWidth="3.2" />
        <g clipPath="url(#logo-shade)">
          <rect x="3" y="7" width="58" height="50" rx="2" stroke="#B8541C" strokeWidth="3.2" />
        </g>
        <g clipPath="url(#logo-rim)">
          <rect x="3" y="7" width="58" height="50" rx="2" stroke="#FFC68E" strokeWidth="1.2" />
        </g>
      </g>

      {/* Pastilles de la barre de titre : trois déciles d'opacité, _translate
         une étincelle en haut-gauche qui les lit comme des boutons */}
      {[{ x: 9, o: 1 }, { x: 16, o: .72 }, { x: 23, o: .45 }].map((d, i) => (
        <g key={i}>
          <rect x={d.x} y="11" width="4.4" height="4.4" fill="#FF8A3D" opacity={d.o} />
          <rect x={d.x} y="11" width="1.7" height="1.7" fill="#FFD2B0" opacity={d.o} />
        </g>
      ))}

      {/* Le chevron `>` : encre, aplat, face droite à l'ombre, rim fin */}
      <g fill="none" strokeLinecap="butt" strokeLinejoin="miter">
        <path d="M14.6 28.6 L26.4 38 L14.6 47.4" stroke="#200F04" strokeWidth="7.4" />
        <path d="M14.6 28.6 L26.4 38 L14.6 47.4" stroke="#FF8A3D" strokeWidth="4.6" />
        <g clipPath="url(#logo-shade)">
          <path d="M14.6 28.6 L26.4 38 L14.6 47.4" stroke="#B8541C" strokeWidth="4.6" />
        </g>
      </g>

      {/* Curseur bloc phosphor : la présence de quelqu'un, là, maintenant.
         La face droite à l'ombre et la tranche claire font la matière. */}
      <g>
        <rect x="32" y="42.6" width="14" height="5.6" fill="#8FFF5C" />
        <rect x="39" y="42.6" width="7" height="5.6" fill="#5CA83A" />
        <rect x="32" y="42.6" width="14" height="1.7" fill="#D8FFB4" />
      </g>
    </svg>
  );
}
