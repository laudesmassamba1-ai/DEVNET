/**
 * Tests de la règle d'extraction des hashtags.
 *
 * Exécuter avec :  npx tsx scripts/test-search.ts
 *
 * Cette règle est écrite **deux fois** : en SQL (`extract_tags`,
 * migration 007) et ici. Deux implémentations d'une même règle, c'est
 * deux occasions de diverger — et la divergence ne se verrait qu'en
 * production, sur un hashtag qu'un seul des deux modes indexe.
 *
 * Ces tests fixent donc le comportement de référence. Si la fonction SQL
 * doit changer, c'est elle qu'on aligne sur ce fichier, jamais l'inverse.
 */

import { extractTags, splitTags } from "../lib/tags";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

const tags = (s: string | null) => extractTags(s).sort();

function main() {
  /* ── Le cas nominal ──────────────────────────────────────────── */

  check("aucun hashtag → liste vide", extractTags("bonjour tout le monde").length === 0);
  check("un hashtag isolé", tags("jeudi #python") .join() === "python");
  check("deux hashtags", tags("#python et #sql").join() === "python,sql");

  /* ── Normalisation ───────────────────────────────────────────── */

  check("la casse est normalisée", tags("#Python").join() === "python");
  check("mélange de casse", tags("#PyThOn").join() === "python");
  check("les doublons de casse ne comptent qu'une fois",
    tags("#python #Python #PYTHON").join() === "python",
    extractTags("#python #Python #PYTHON"));

  /* ── Les cas qui séparent cette règle d'un découpage naïf ───── */

  // Le plus important : C# et F# sont des langages, pas des hashtags.
  // Un `#` suivi d'un séparateur ne doit rien produire.
  check("C# ne produit pas de hashtag", extractTags("Je code en C# tous les jours").length === 0,
    extractTags("Je code en C# tous les jours"));
  check("F# ne produit pas de hashtag", extractTags("F# functional").length === 0);
  check("un # seul ne produit rien", extractTags("a # b").length === 0);
  check("un # final ne produit rien", extractTags("fin #").length === 0);

  // Un numéro n'est pas un hashtag : `issue #42` ne doit pas créer un tag
  // « 42 », qui n'aurait aucun sens et polluerait la recherche.
  check("un numéro seul n'est pas un hashtag", tags("voir issue #42").length === 0,
    extractTags("voir issue #42"));
  check("un nombre suivi de lettres reste un hashtag",
    tags("#42bornes").join() === "42bornes", extractTags("#42bornes"));

  // L'underscore fait partie du tag : c'est la convention des hashtags
  // compounds, et couper dessus donnerait `#machine` et `#learning`.
  check("l'underscore ne sépare pas", tags("#machine_learning").join() === "machine_learning");
  check("underscore et casse", tags("#Machine_Learning").join() === "machine_learning");

  /* ── Ponctuation ─────────────────────────────────────────────── */

  check("un hashtag suivi d'une virgule", tags("tags:#python,#sql").join() === "python,sql");
  check("un hashtag entre parenthèses", tags("(voir #debogage)").join() === "debogage");
  check("le point final n'est pas inclus", tags("fin#ici.").join() === "ici");
  check("le point final après un mot est exclu", tags("#python.").join() === "python");

  // Un mot accentué est **refusé**, pas tronqué : sans cette règle,
  // `#référence` produirait le tag « r », qui n'a aucun sens et se
  // retrouverait dans la recherche.
  check("un hashtag accentué n'est pas un hashtag",
    tags("#référence").length === 0, extractTags("#référence"));
  check("le mot accentué reste dans le texte",
    splitTags("voir #référence").map((s) => s.text).join("") === "voir #référence");
  check("un mot accentué ne rend rien de cliquable",
    splitTags("#référence").every((s) => s.tag === undefined));
  check("un tag valide reste valide à côté d'un mot accentué",
    tags("#python #référence").join() === "python", extractTags("#python #référence"));

  /* ── Valeurs nulles ──────────────────────────────────────────── */

  check("null ne plante pas", extractTags(null).length === 0);
  check("chaîne vide", extractTags("").length === 0);
  check("undefined ne plante pas", extractTags(undefined).length === 0);

  /* ── Cohérence avec le rendu ─────────────────────────────────── */

  // Le texte affiché doit rester **identique** au texte d'origine, et
  // chaque segment hashtag doit correspondre à un tag indexé. Un tag
  // surlignable qui ne serait pas indexé serait visible immédiatement.
  const samples = [
    "rien ici",
    "#python et #sql",
    "C# et F# ensemble",
    "issue #42 puis #42bornes",
    "#machine_learning avant #ML",
    "fin#ici. et (voir #debogage)",
    "voir #référence et #python",
  ];

  let roundTrip = true;
  let agrees = true;

  for (const sample of samples) {
    const segments = splitTags(sample);
    const rebuilt = segments.map((s) => s.text).join("");
    if (rebuilt !== sample) roundTrip = false;

    const cliquable = segments.filter((s) => s.tag).map((s) => s.tag as string).sort();
    if (cliquable.join(",") !== extractTags(sample).sort().join(",")) agrees = false;
  }

  check("le découpage ne perd ni caractère ni espace", roundTrip);
  check("les hashtags cliquables sont exactement les hashtags indexés", agrees);
  check("un texte sans hashtag donne un seul segment",
    splitTags("rien ici").length === 1);

  /* ── Rapport ────────────────────────────────────────────────── */

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ La règle d'extraction des hashtags est cohérente\n");
}

main();