/**
 * Moteur de score DevNet — surface publique.
 *
 * Les modules se lisent **dans l'ordre des couches**, et cette séparation
 * est la correction principale de structure : la version précédente
 * mesurait, calibrait et expliquait dans les mêmes fonctions, ce qui
 * rendait impossible de dire d'où venait une note — et facile de compter
 * deux fois le même défaut.
 *
 * 1. `lex` — masque commentaires et chaînes, classe les lignes, mesure
 *    l'imbrication. Un tokeniseur pour la famille C, une heuristique pour
 *    le reste ; `confidence` dit lequel a servi ;
 * 2. `stats` — maximum, minimum, moyenne, **médiane**, écart-type, centile :
 *    les primitives qui n'étalent jamais un tableau en arguments, et qui
 *    écartent les valeurs non finies au lieu de les propager ;
 * 3. `metrics` — les **faits** : Halstead, McCabe, complexité cognitive,
 *    fonctions, duplication, Halstead par fonction ;
 * 4. `coupling` — le **graphe** d'imports : cycles, instabilité, orphelins ;
 * 5. `files` — la politique : quel fichier est du code, lequel est un test ;
 * 6. `dimensions` — la **calibration** : des faits vers des scores 0…1,
 *    un signal par dimension ;
 * 7. `score` — l'**agrégation** et l'**explication** : moyenne pondérée,
 *    plafonds nommés, actions classées par gain ;
 * 8. `cache` — le score par SHA de blob, et son évolution commit par commit ;
 * 9. `trend` — la **lecture** d'une suite de scores : moyenne, médiane,
 *    écart-type, pente robuste (Theil–Sen) et verdict comparé au bruit des
 *    pas. Un « +40 points » ne dit pas si l'effort est régulier ni si la
 *    série dérive ou tremble ;
 * 10. `curve` — la géométrie des graphes (courbe, repères moyenne/médiane,
 *    histogramme), pure, pour qu'elle se vérifie en Node et pas à l'œil sur
 *    un petit dessin ;
 * 11. `bands` — la **marge** qui reste avant de sortir d'une bande de
 *    calibration. Un test dit « dedans » ; la marge dit « à 3 points du
 *    bord », c'est-à-dire quel dépôt tombera au prochain changement de
 *    seuil.
 *
 * Deux corpus l'accompagnent, et ils ne mesurent pas la même chose :
 * `corpus` est écrit à la main et isole un signal par dépôt ; `corpus-real`
 * est fait de paquets npm réels et dit ce que vaut du code que personne n'a
 * écrit pour le barème. Le second est ce qui a fait tomber la duplication
 * comparable sur du texte masqué.
 *
 * Le tout est pur et sans dépendance nouvelle : `scripts/test-scoring.ts`
 * le vérifie en Node, sans navigateur.
 */

export * from "./lex";
export * from "./stats";
export * from "./metrics";
export * from "./coupling";
export * from "./files";
export * from "./dimensions";
export * from "./score";
export * from "./cache";
export * from "./trend";
export * from "./curve";
export * from "./bands";
export * from "./corpus";
export * from "./corpus-real";
