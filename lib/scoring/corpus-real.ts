/**
 * Le corpus **réel** : des dépôts open source que personne n'a écrits pour
 * ce barème.
 *
 * ## Pourquoi il existe, à côté du corpus doré
 *
 * `corpus.ts` est fait de petits dépôts écrits à la main, chacun isolant un
 * signal. Il répond à « ce défaut fait perdre des points » ; il ne répond
 * pas à « un dépôt réel vaut combien ». Ses seuils sont choisis par la même
 * personne qui écrit le barème : c'est un test de cohérence, pas une
 * mesure.
 *
 * Ce fichier apporte la mesure qui manquait — du code écrit par d'autres,
 * avec leurs habitudes, leurs conventions et leurs compromis. Cinq dépôts,
 * choisis pour couvrir le domaine plutôt que pour flatter le barème :
 * un outil mûr et très commenté, une bibliothèque TypeScript moderne, un
 * petit paquet artisanal, une collection de fichiers volontairement
 * ressemblants, et du code d'une génération plus ancienne.
 *
 * ## Pourquoi des paquets npm installés, et pas des dépôts clonés
 *
 * Le corpus doit tourner **hors ligne** et **à l'identique** sur toute
 * machine. `npm ci` rejoue le `package-lock.json` : les octets sont les
 * mêmes pour tout le monde, sans réseau et sans service externe. Cloner
 * cinq dépôts ferait dépendre un test de GitHub, grossirait le dépôt, et
 * donnerait un corpus qui ne se rejoue pas.
 *
 * C'est la raison de la séparation en deux fichiers : **les données pures
 * sont ici** (`lib/`, importable par le navigateur sans `node:fs`), et la
 * **lecture du disque** est dans `scripts/corpus-real.ts`. Un module de
 * `lib/scoring` qui importerait `node:fs` casserait la construction du
 * client.
 *
 * ## Ce qu'un paquet ne dit pas
 *
 * Un paquet npm n'est pas un dépôt : npm n'embarque ni les tests, ni le
 * workflow d'intégration continue, ni le `.gitignore`, ni le fichier de
 * verrouillage. Les dimensions `tests` et `repository` sont donc **basses
 * par construction**, et la note totale plafonne à B. Ce n'est pas une
 * dérive du barème, c'est une limite de la source — écrite ici pour que
 * personne ne « corrige » une bande en croyant le contraire.
 *
 * Ce que ce corpus calibre, ce sont les **dimensions de code** :
 * complexité, structure, duplication, couplage, documentation. Ce sont
 * celles qui se mesurent sur du code écrit sans penser au barème, et ce
 * sont donc elles qui portent les bandes serrées. La note totale, elle,
 * porte une bande large.
 */

import type { ProjectDimension } from "./dimensions";

/**
 * Un dépôt réel, décrit par sa **provenance** et par une **bande**.
 *
 * Le champ `version` n'est pas décoratif : `scripts/corpus-real.ts` lit la
 * version réellement installée et la compare à celle-ci. Un paquet qui
 * change de version change de code, donc de note — la vérification échoue
 * en le disant, au lieu de laisser une bande dériver en silence.
 */
export interface RealRepoSpec {
  /** Nom court, utilisé dans le nom des vérifications. */
  name: string;
  /** Nom du paquet npm, pour le message d'erreur quand il manque. */
  package: string;
  /** Version attendue, telle que figée par `package-lock.json`. */
  version: string;
  /** Licence déclarée par le paquet — lue par le moteur, pas par nous. */
  license: string;
  /** Racine du paquet, relative à la racine du dépôt. */
  dir: string;
  /** Sous-arbres écrits à la main — jamais `dist/` ni un bundle. */
  roots: string[];
  /** Plafond de fichiers notés : le test doit rester court à exécuter. */
  maxFiles: number;
  /** Ce que ce dépôt apporte au corpus, lu quand une bande casse. */
  intent: string;
  /** Bande attendue de la **note du dépôt**, sur 1000. */
  expect: { min: number; max: number };
  /** Bandes attendues des dimensions de code, 0…1. */
  expectCode: Partial<Record<ProjectDimension, { min: number; max: number }>>;
}

/**
 * Les cinq dépôts, et ce que chacun mesure.
 *
 * Tous sont des dépendances du projet (`package.json`), donc présents après
 * un `npm ci` — le corpus n'ajoute pas une seule dépendance.
 */
export const REAL_CORPUS: RealRepoSpec[] = [
  {
    name: "eslint",
    package: "eslint",
    version: "9.39.5",
    license: "MIT",
    dir: "node_modules/eslint",
    roots: ["lib"],
    maxFiles: 48,
    intent:
      "un outil mûr, maintenu depuis 2013, avec une convention de commentaires stricte : " +
      "il doit sortir en haut de la complexité et de la documentation (mesuré : 701, complexité 77 %, " +
      "documentation 98 %). Une archive npm n'embarque pas ses tests : son plafond dur est donc B.",
    expect: { min: 620, max: 839 },
    expectCode: {
      complexity: { min: 0.6, max: 1 },
      documentation: { min: 0.8, max: 1 },
      duplication: { min: 0.8, max: 1 },
    },
  },
  {
    name: "zod",
    package: "zod",
    version: "4.6.7",
    license: "MIT",
    dir: "node_modules/zod",
    roots: ["src"],
    maxFiles: 48,
    intent:
      "TypeScript moderne, types denses et fonctions courtes : mesure la structure et la complexité " +
      "sur du TypeScript idiomatique (mesuré : 731, structure 90 %). C'est le seul paquet du corpus qui " +
      "embarque des tests dans son archive — il échappe donc au plafond « aucun test ».",
    expect: { min: 650, max: 900 },
    expectCode: {
      complexity: { min: 0.55, max: 1 },
      structure: { min: 0.75, max: 1 },
      duplication: { min: 0.6, max: 1 },
    },
  },
  {
    name: "postcss",
    package: "postcss",
    version: "8.5.28",
    license: "MIT",
    dir: "node_modules/postcss",
    roots: ["lib"],
    maxFiles: 48,
    intent:
      "un petit paquet artisanal, sans monorepo ni génération : sa duplication doit être nulle (mesuré : " +
      "566, duplication 100 %). Sa complexité est plus basse (49 %) parce qu'il assume un style à classes " +
      "— c'est un cas où la note basse n'est pas une faute, et la bande le dit.",
    expect: { min: 480, max: 839 },
    expectCode: {
      complexity: { min: 0.35, max: 0.8 },
      duplication: { min: 0.9, max: 1 },
      structure: { min: 0.75, max: 1 },
    },
  },
  {
    name: "highlight.js",
    package: "highlight.js",
    version: "10.7.3",
    license: "BSD-3-Clause",
    dir: "node_modules/highlight.js",
    roots: ["lib"],
    maxFiles: 48,
    intent:
      "près de deux cents grammaires de langages très ressemblantes : c'est le seul dépôt du corpus " +
      "dont une part de ressemblance est **normale**, et le barème ne doit pas le traiter comme un dépôt " +
      "fautif (mesuré : 728, duplication 89 %, complexité 90 %).",
    expect: { min: 650, max: 839 },
    expectCode: {
      complexity: { min: 0.75, max: 1 },
      duplication: { min: 0.6, max: 1 },
    },
  },
  {
    name: "ajv",
    package: "ajv",
    version: "6.15.0",
    license: "MIT",
    dir: "node_modules/ajv",
    roots: ["lib"],
    maxFiles: 48,
    intent:
      "du JavaScript d'une génération antérieure, dense et peu commenté, publié par un projet sérieux : " +
      "il mesure ce que le barème fait du code ancien qui n'est pas du mauvais code (mesuré : 497). C'est " +
      "le point bas du corpus, et il **doit** le rester : une bande qui remonterait signalerait que le " +
      "barème a cessé de voir la densité. Ajv écrit aussi un générateur de code, d'où sa duplication de " +
      "25 % — réelle, et documentée plutôt que corrigée.",
    expect: { min: 420, max: 839 },
    expectCode: {
      complexity: { min: 0.1, max: 0.6 },
      structure: { min: 0.8, max: 1 },
      duplication: { min: 0.05, max: 0.6 },
      documentation: { min: 0.3, max: 1 },
    },
  },
];
