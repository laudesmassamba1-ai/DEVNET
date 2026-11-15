/**
 * Les **bandes** de calibration, et la marge qu'il reste avant de les perdre.
 *
 * ## Pourquoi une marge, et pas seulement un « dedans / dehors »
 *
 * Les bandes du corpus réel sont vérifiées par les tests : chaque paquet doit
 * tomber entre deux bornes. Un test qui dit « dedans » ne dit pas **de
 * combien** — et c'est tout ce qui compte quand on prépare un changement de
 * seuil. Un dépôt à 40 points du bord survivra à un calibrage plus sévère ;
 * un dépôt à 3 points du bord en sortira, et le test échouera sur un dépôt
 * dont personne n'aura touché le code.
 *
 * La marge rend donc la fragilité **visible avant** le changement de seuil :
 * c'est la différence entre un barème calibré et un barème qui se casse
 * silencieusement à chaque retouche.
 *
 * ## Ce que la marge ne dit pas
 *
 * Elle est mesurée contre **une** mesure, dans un sens ou dans l'autre. Une
 * marge confortable ne garantit pas qu'un changement laisse la note en place :
 * un seuil qui touche toutes les dimensions peut faire bouger une note de 200
 * points sans que la marge initiale l'ait laissé deviner. C'est pourquoi le
 * module ne remplace pas une mesure avant/après — il dit seulement où
 * regarder en premier.
 *
 * Le module est pur, et testable sans navigateur ni base.
 */

/** Une bande attendue : les bornes entre lesquelles une mesure doit tomber. */
export interface Band {
  min: number;
  max: number;
}

/** Le verdict d'une mesure contre sa bande. */
export interface BandCheck {
  measured: number;
  band: Band;
  /** Marge avant de sortir par le bas — **négative** si la mesure est dehors. */
  marginLow: number;
  /** Marge avant de sortir par le haut — négative aussi, le cas échéant. */
  marginHigh: number;
  /**
   * La plus petite des deux marges : ce qu'un changement de seuil peut
   * consommer avant que la bande ne soit perdue.
   */
  margin: number;
  inside: boolean;
}

/** Une mesure, sa bande, et l'écart qui reste. */
export function checkBand(measured: number, band: Band): BandCheck {
  // Une mesure non finie n'est jamais « dans la bande » : sans ce cas, un
  // `NaN` se comparerait à tout et à rien, et le tableau de bord
  // afficherait une bande tenue par une note qui n'existe pas.
  const value = Number.isFinite(measured) ? measured : Number.NaN;
  const marginLow = value - band.min;
  const marginHigh = band.max - value;

  return {
    measured: value,
    band,
    marginLow,
    marginHigh,
    margin: Number.isNaN(value) ? Number.NaN : Math.min(marginLow, marginHigh),
    inside: value >= band.min && value <= band.max,
  };
}

/** Une entrée du bilan : une mesure nommée, avec sa bande. */
export interface BandEntry {
  /** Nom lisible — « eslint », « eslint · duplication »… */
  key: string;
  measured: number;
  band: Band;
}

/** De quel côté une mesure est le plus près de sortir. */
export type BandSide = "bas" | "haut";

/** Le bilan d'un corpus : ce qui tient, ce qui ne tient plus, et le plus fragile. */
export interface BandReport {
  checks: { key: string; check: BandCheck }[];
  /** Les entrées sorties de leur bande, dans l'ordre du bilan. */
  outside: string[];
  /** Combien d'entrées sortent de leur bande. */
  outsideCount: number;
  /**
   * Les mesures **posées exactement sur une borne**.
   *
   * Ce n'est pas une fragilité : c'est une valeur tenue par un mécanisme.
   * Une note plafonnée vaut exactement le plafond, une dimension sans
   * duplication vaut exactement 1. Ces mesures ne peuvent bouger que d'un
   * côté, et les compter comme « les plus fragiles » désignerait un danger
   * inexistant — en masquerait un vrai.
   */
  pinned: string[];
  /**
   * L'entrée la plus proche de sortir, parmi celles qui tiennent encore et
   * qui ne sont pas épinglées — donc celle qu'un changement de seuil fera
   * tomber en premier. `null` s'il n'y a rien à surveiller, si tout est déjà
   * dehors, ou si toutes les mesures sont épinglées.
   */
  tightest: { key: string; margin: number; side: BandSide } | null;
}

/** Le bilan d'un ensemble de mesures contre leurs bandes. */
export function bandReport(entries: readonly BandEntry[]): BandReport {
  const checks = entries.map((entry) => ({
    key: entry.key,
    check: checkBand(entry.measured, entry.band),
  }));

  const outside = checks.filter((c) => !c.check.inside).map((c) => c.key);
  const pinned = checks.filter((c) => c.check.inside && c.check.margin === 0).map((c) => c.key);

  // La plus fragile parmi celles qui peuvent bouger des deux côtés. Une
  // mesure épinglée n'est pas un danger : elle est exactement au plafond, ou
  // exactement parfaite, et seule une mesure dégradée la ferait sortir —
  // c'est-à-dire un vrai changement de code, pas un changement de seuil.
  //
  // Une mesure illisible n'a pas de marge : elle est déjà comptée hors bande,
  // et comparer un `NaN` à une marge n'aurait pas de sens ici.
  let tightest: BandReport["tightest"] = null;
  for (const { key, check } of checks) {
    // Déjà dehors : ce n'est plus « celle qui va tomber », c'est une bande
    // perdue, et le bilan la nomme déjà comme telle.
    if (!check.inside) continue;
    // Épinglée : elle ne bouge que d'un côté, et ce côté-là n'est pas un
    // seuil (un plafond, une dimension parfaite).
    if (check.margin === 0) continue;
    const side: BandSide = check.marginLow <= check.marginHigh ? "bas" : "haut";
    if (!tightest || check.margin < tightest.margin) tightest = { key, margin: check.margin, side };
  }

  return { checks, outside, outsideCount: outside.length, pinned, tightest };
}
