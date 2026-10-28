/**
 * Issues de démonstration.
 *
 * Un dépôt dont l'onglet des issues est vide donne exactement la même
 * impression qu'un dépôt qui n'a pas d'onglet des issues. Le jeu sert
 * donc deux choses : montrer l'écran tel qu'il sera, et fournir des
 * issues **réellement discussion** — une issue sans réponse ne prouve
 * rien du fonctionnement de la discussion.
 *
 * Les numéros sont écrits ici, pas calculés : le déclencheur ne s'exerce
 * qu'à l'insertion. C'est la seule entorse à la règle « la base
 * calcule », et elle est sans conséquence — une ligne insérée à la main
 * dans un jeu de données est une ligne qui existe déjà.
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

export const DEMO_ISSUES = [
  {
    id: "i-1",
    project_id: "p-1",
    author_id: "u-zainab",
    number: 1,
    title: "Le registre écrase les livraisons de la veille",
    body:
      "Quand deux coopératives livrent le même jour, la seconde écrase la première.\n\n" +
      "Repéré sur la tournée de mardi : la coopérative Diallo a livré à 9h, " +
      "puis Sekou à 11h. Le registre n'a gardé que Sekou.\n\n" +
      "Il faudrait garder les deux lignes, ou au moins dire que la première a été remplacée.",
    status: "open",
    closed_at: null,
    closed_by: null,
    created_at: ago(2 * DAY),
    updated_at: ago(2 * DAY),
  },
  {
    id: "i-2",
    project_id: "p-1",
    author_id: "u-thabo",
    number: 2,
    title: "Ajouter la lecture des codes-barres",
    body:
      "À la _MANIFESTE_, on scanne le code du colis à la main. C'est le poste le plus lent de l'entrepôt.\n\n" +
      "Le format du code est déjà sur les étiquettes — il n'y a que la lecture à écrire.",
    status: "open",
    closed_at: null,
    closed_by: null,
    created_at: ago(5 * DAY),
    updated_at: ago(5 * DAY),
  },
  {
    id: "i-3",
    project_id: "p-1",
    author_id: "u-koffi",
    number: 3,
    title: "La lecture du registre ne gère pas les accents",
    body:
      "« Épicerie » et « epicerie » comptaient comme deux coopératives.\n\n" +
      "Corrigé par une normalisation avant comparaison.",
    status: "closed",
    closed_at: ago(3 * DAY),
    closed_by: "u-koffi",
    created_at: ago(9 * DAY),
    updated_at: ago(3 * DAY),
  },
];

export const DEMO_ISSUE_COMMENTS = [
  {
    id: "ic-1",
    issue_id: "i-1",
    author_id: "u-thabo",
    body:
      "Confirmé. Le code fait `dict[livraison] = ...` au lieu d'ajouter à une liste.\n" +
      "C'est deux lignes à changer — mais il faut aussi un test, sinon ça revient.",
    created_at: ago(2 * DAY - HOUR),
  },
  {
    id: "ic-2",
    issue_id: "i-1",
    author_id: "u-zainab",
    body:
      "Et l'affichage ? Si on garde les deux lignes, l'écran va montrer deux livraisons identiques à l'heure près.",
    created_at: ago(2 * DAY - 2 * HOUR),
  },
  {
    id: "ic-3",
    issue_id: "i-1",
    author_id: "u-koffi",
    body:
      "Je propose : on garde les deux lignes, et la plus récente porte un « remplace » vers la précédente. " +
      "On voit alors ce qui s'est passé au lieu de le deviner.",
    created_at: ago(DAY),
  },
  {
    id: "ic-4",
    issue_id: "i-3",
    author_id: "u-thabo",
    body: "Bien vu, j'ai le même cas sur les noms de rue.",
    created_at: ago(8 * DAY),
  },
  {
    id: "ic-5",
    issue_id: "i-3",
    author_id: "u-koffi",
    body:
      "Corrigé sur `main` : normalisation Unicode avant comparaison, plus un test sur « Épicerie » / « epicerie ».",
    created_at: ago(3 * DAY),
  },
];