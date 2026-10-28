/**
 * Pages de wiki de démonstration.
 *
 * Un dépôt dont l'onglet « Doc » est vide donne exactement l'impression
 * d'un dépôt sans documentation. Le jeu sert donc deux choses : montrer le
 * sommaire tel qu'il sera, et fournir des pages **réellement écrites** —
 * une page d'une ligne ne prouve rien de la lecture d'une page.
 *
 * Comme pour les issues, `created_at`/`updated_at` sont écrits ici : une
 * ligne insérée à la main dans un jeu de données est une ligne qui existe
 * déjà, et le déclencheur de date ne s'exerce qu'à l'écriture.
 */

const DAY = 86_400_000;

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

export const DEMO_PROJECT_PAGES = [
  {
    id: "pg-1",
    project_id: "p-1",
    author_id: "u-koffi",
    title: "Démarrage",
    position: 0,
    body:
      "# Démarrage\n\n" +
      "Le registre tourne sans installation. Il lit un fichier CSV de livraisons\n" +
      "et produit le relevé du jour.\n\n" +
      "```bash\npython lecteur.py livraisons.csv\n```\n\n" +
      "- `lecteur.py` — lecture et validation des lignes\n" +
      "- `registre.py` — écriture du relevé\n" +
      "- `journal.py` — trace des opérations de la journée\n",
    created_at: ago(40 * DAY),
    updated_at: ago(12 * DAY),
  },
  {
    id: "pg-2",
    project_id: "p-1",
    author_id: "u-thabo",
    title: "Architecture",
    position: 1,
    body:
      "## Architecture\n\n" +
      "Trois modules, une direction : les données ne se transforment qu'une fois.\n\n" +
      "1. `lecteur.py` normalise une ligne brute et refuse ce qui est illisible ;\n" +
      "2. `registre.py` écrit un relevé à partir de lignes déjà valides ;\n" +
      "3. `journal.py` note ce qui a été fait, sans jamais réécrire le passé.\n\n" +
      "**Pourquoi le journal ne se réécrit pas.** Un relevé qu'on corrige sans\n" +
      "laisser de trace n'est plus un relevé, c'est une affirmation.\n",
    created_at: ago(30 * DAY),
    updated_at: ago(6 * DAY),
  },
  {
    id: "pg-3",
    project_id: "p-1",
    author_id: "u-zainab",
    title: "Conventions de code",
    position: 2,
    body:
      "## Conventions\n\n" +
      "- les noms de coopératives sont normalisés (Unicode) avant comparaison ;\n" +
      "- aucune fonction ne lit un fichier sans recevoir son chemin ;\n" +
      "- une erreur est une phrase, jamais un code.\n\n" +
      "> Écrire « Épicerie » et « epicerie » comme deux entités a déjà coûté\n" +
      "> une tournée de livraisons.\n",
    created_at: ago(20 * DAY),
    updated_at: ago(3 * DAY),
  },
];
