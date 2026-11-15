/**
 * Le **corpus doré**.
 *
 * ## À quoi il sert
 *
 * Un barème se calibre sur des dépôts réels, pas sur des seuils choisis à
 * la main. Ce corpus est la version vérifiable de cette idée : chaque
 * dépôt porte une **bande de note attendue**, exprimée en intention
 * (« un bon dépôt reste au-dessus de B »), et `scripts/test-scoring.ts`
 * refuse tout correctif qui ferait sortir un dépôt de sa bande.
 *
 * C'est ce qui empêche de « réparer » une mesure en la dégradant ailleurs :
 * une modification qui fait gagner 60 points au dépôt brouillon fait
 * échouer la bande haute ; une modification qui fait perdre 40 points au
 * dépôt propre fait échouer la bande basse.
 *
 * ## Comment il est écrit
 *
 * Les dépôts sont **petits et lisibles** plutôt que réels : un corpus de
 * vingt dépôts de mille fichiers ne serait pas relu, donc pas maintenu.
 * Chacun isole un signal — la fuite de secret, le cycle d'imports, le
 * dossier de workflow vide, le fichier noyé sous les commentaires — pour
 * qu'un échec désigne directement ce qui a bougé.
 *
 * Les bandes sont **larges** volontairement : elles disent « bon »,
 * « moyen », « mauvais », elles ne figent pas un score au point près. Un
 * corpus qui casse à chaque ajustement de seuil ne serait plus exécuté.
 */

import type { FileEntry } from "./score";

export interface CorpusRepo {
  /** Identifiant court, utilisé dans le nom des vérifications. */
  name: string;
  /** Ce que ce dépôt illustre — lu quand sa bande casse. */
  intent: string;
  /** Bande attendue de la **note du dépôt**, sur 1000. */
  expect: { min: number; max: number };
  files: FileEntry[];
}

const f = (path: string, content: string): FileEntry => ({ path, content });

/**
 * Un module de **texte** documenté, volontairement différent du module
 * numérique : deux modules copiés l'un sur l'autre produiraient de la
 * duplication inter-fichiers, et le corpus validerait un barème qui
 * récompense un dépôt dupliqué.
 */
function documentedTextModule(name: string, doc: string): string {
  return `/**
 * ${doc}
 */

/**
 * Transforme un libellé lisible en identifiant.
 *
 * @param value le libellé d'origine
 */
export function slug${name}(value: string): string {
  return value.trim().toLowerCase().split(" ").join("-");
}

/**
 * Coupe un texte à une longueur maximale.
 */
export function truncate${name}(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return value.slice(0, limit);
}
`;
}

/** Un module TypeScript documenté, à fonctions courtes et plates. */
function documentedModule(name: string, doc: string): string {
  return `/**
 * ${doc}
 *
 * Les fonctions sont courtes et ne s'imbriquent pas : c'est le style que le
 * score de structure récompense.
 */

/**
 * Additionne deux nombres.
 *
 * @param a premier opérande
 * @param b second opérande
 */
export function sum${name}(a: number, b: number): number {
  return a + b;
}

/**
 * Renvoie le plus grand des deux.
 */
export function max${name}(a: number, b: number): number {
  if (a > b) {
    return a;
  }
  return b;
}
`;
}

const README_GOOD = `# Projet propre

Un petit module utilitaire qui montre à quoi ressemble un dépôt noté au
dessus de B : fonctions courtes, API exportée documentée, tests, licence,
et un workflow d'intégration continue qui lance réellement quelque chose.

## Installation

Installez les dépendances puis lancez le script de construction :

    npm install
    npm run build

Le paquet ne dépend d'aucune bibliothèque d'exécution.

## Usage

Importez la fonction dont vous avez besoin depuis le module principal :

    import { sumMath } from "./src";

Chaque fonction est pure et ne lève jamais d'exception.

## Licence

MIT.
`;

const LICENSE_MIT = `MIT License

Copyright (c) 2026 DevNet

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software.
`;

const GITIGNORE = "node_modules\n.next\ndist\nbuild\ncoverage\n*.log\n";

const PACKAGE_JSON_GOOD = JSON.stringify(
  {
    name: "projet-propre",
    version: "1.0.0",
    scripts: { build: "tsc", test: "node --test" },
    license: "MIT",
  },
  null,
  2,
);

const CI_GOOD = `name: ci
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
`;

const TEST_GOOD = `import { sumMath, maxMath } from "../src/math";

test("somme", () => {
  expect(sumMath(1, 2)).toBe(3);
});

test("maximum", () => {
  expect(maxMath(1, 2)).toBe(2);
});
`;

/** Le code du « brouillon » : long, imbriqué, recopié, sans un mot. */
const MESSY_MODULE = `export function report(a,b,c,d){
  var t=0;var u=0;var v=0;
  if(a){if(b){if(c){if(d){t=11111;}else{t=22222;}}else{t=33333;}}}else{t=44444;}
  if(a){if(b){if(c){if(d){u=11111;}else{u=22222;}}else{u=33333;}}}else{u=44444;}
  for(var i=0;i<55555;i++){v=v+1;}
  return t+u+v+66666;
}
function other(x){return x*77777+88888;}
var global1=99999;var global2=12345;var global3=54321;
`;

/** Le même bloc recopié six fois : de la duplication franche. */
const DUP_BLOCK = `  const total = price * quantity;
  const discount = total * 0.15;
  const taxed = total * 1.2 - discount;
  const rounded = Math.floor(taxed * 100) / 100;
  return rounded + shipping;
`;

export const CORPUS: CorpusRepo[] = [
  {
    name: "propre",
    intent: "dépôt complet et soigné : doit rester au-dessus de B malgré les évolutions du barème",
    expect: { min: 740, max: 1000 },
    files: [
      f("README.md", README_GOOD),
      f("LICENSE", LICENSE_MIT),
      f(".gitignore", GITIGNORE),
      f("package.json", PACKAGE_JSON_GOOD),
      f("package-lock.json", "{ \"lockfileVersion\": 3 }\n"),
      f(".github/workflows/ci.yml", CI_GOOD),
      f("tsconfig.json", "{ \"compilerOptions\": { \"strict\": true } }\n"),
      f("docs/architecture.md", "# Architecture\n\nDeux modules indépendants, un point d'entrée.\n"),
      f("src/math.ts", documentedModule("Math", "Fonctions arithmétiques de démonstration.")),
      f("src/text.ts", documentedTextModule("Text", "Manipulation de chaînes de caractères.")),
      f(
        "src/index.ts",
        `import { sumMath, maxMath } from "./math";
import { sumText, maxText } from "./text";

/** Point d'entrée : ré-exporte l'API publique. */
export const api = { sumMath, maxMath, sumText, maxText };
`,
      ),
      f("tests/math.test.ts", TEST_GOOD),
    ],
  },
  {
    name: "moyen",
    intent: "code correct mais dépôt inachevé : sans test, la note plafonne à B et ne doit pas descendre sous D",
    expect: { min: 600, max: 839 },
    files: [
      f("README.md", "# Projet\n\nUn essai.\n"),
      f("package.json", JSON.stringify({ name: "moyen", scripts: { start: "node ." } }, null, 2)),
      f("src/a.ts", documentedModule("A", "Fonctions arithmétiques du module A.")),
      f("src/b.ts", documentedTextModule("B", "Manipulation de chaînes du module B.")),
      f("src/index.ts", `import { sumA } from "./a";\nimport { sumB } from "./b";\n\nexport const api = { sumA, sumB };\n`),
    ],
  },
  {
    name: "brouillon",
    intent: "fonctions longues, imbrications profondes, nombres magiques, duplication : doit rester sous C",
    expect: { min: 0, max: 560 },
    files: [
      f("src/report.ts", MESSY_MODULE),
      f("src/billing.ts", `export function invoice(price, quantity, shipping) {\n${DUP_BLOCK}}\n`),
      f("src/shipping.ts", `export function shippingCost(price, quantity, shipping) {\n${DUP_BLOCK}}\n`),
      f("src/index.ts", `import { report } from "./report";\nimport { invoice } from "./billing";\nimport { shippingCost } from "./shipping";\n\nexport { report, invoice, shippingCost };\n`),
      f("package.json", JSON.stringify({ name: "brouillon" }, null, 2)),
    ],
  },
  {
    name: "fuite",
    intent: "code propre mais une clé AWS committée : la note ne peut pas dépasser C",
    expect: { min: 0, max: 739 },
    files: [
      f("README.md", README_GOOD),
      f("LICENSE", LICENSE_MIT),
      f(".gitignore", GITIGNORE),
      f("package.json", PACKAGE_JSON_GOOD),
      f("package-lock.json", "{ \"lockfileVersion\": 3 }\n"),
      f(".github/workflows/ci.yml", CI_GOOD),
      f("tsconfig.json", "{ \"compilerOptions\": { \"strict\": true } }\n"),
      f("src/math.ts", documentedModule("Math", "Fonctions arithmétiques.")),
      f("src/text.ts", documentedTextModule("Text", "Fonctions de texte.")),
      f("src/index.ts", `import { sumMath } from "./math";\nimport { sumText } from "./text";\n\nexport const api = { sumMath, sumText };\n`),
      // La clé est dans un fichier de configuration, pas dans le code métier.
      // Elle ressemble à une vraie clé — et non au `…EXAMPLE` de la
      // documentation AWS, qui est un marqueur et non une fuite.
      f("src/config.ts", `export const aws = {\n  region: "eu-west-3",\n  key: "AKIA3XQ7ZPLMN2VWRTYB",\n};\n`),
      f("tests/math.test.ts", TEST_GOOD),
    ],
  },
  {
    name: "cycle",
    intent: "deux modules qui s'importent mutuellement : le couplage doit le voir et le dire",
    expect: { min: 0, max: 900 },
    files: [
      f("README.md", README_GOOD),
      f("LICENSE", LICENSE_MIT),
      f("package.json", PACKAGE_JSON_GOOD),
      f("package-lock.json", "{ \"lockfileVersion\": 3 }\n"),
      f(".github/workflows/ci.yml", CI_GOOD),
      f("src/a.ts", `import { bValue } from "./b";\n\nexport function aValue(): number {\n  return bValue() + 1;\n}\n`),
      f("src/b.ts", `import { aValue } from "./a";\n\nexport function bValue(): number {\n  return 2;\n}\n\nexport function loop(): number {\n  return aValue();\n}\n`),
      f("src/index.ts", `import { aValue } from "./a";\n\nexport const api = aValue;\n`),
      f("tests/a.test.ts", "import { aValue } from \"../src/a\";\n\ntest(\"a\", () => {\n  expect(aValue()).toBe(3);\n});\n"),
    ],
  },
  {
    name: "workflow-vide",
    intent: "un dossier de CI sans contenu et un LICENSE vide ne valent rien : l'hygiène se vérifie par le contenu",
    expect: { min: 0, max: 800 },
    files: [
      f("README.md", "# Vide\n"),
      f("LICENSE", ""),
      f(".gitignore", "\n"),
      f("package.json", JSON.stringify({ name: "vide" }, null, 2)),
      f(".github/workflows/ci.yml", "name: ci\non: [push]\njobs:\n  x:\n    steps:\n      - uses: actions/checkout@v4\n"),
      f("src/a.ts", documentedModule("A", "Module A.")),
      f("src/index.ts", `import { sumA } from "./a";\n\nexport const api = sumA;\n`),
    ],
  },
  {
    name: "commentaires-gonflés",
    intent: "un fichier noyé sous les commentaires ne doit pas obtenir une documentation parfaite",
    expect: { min: 0, max: 800 },
    files: [
      f("src/a.ts", `// Ce module ne fait rien.
// Il est surtout commenté.
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
// Ligne de commentaire
export function rien(): number {\n  return 0;\n}\n`),
      f("src/index.ts", `import { rien } from "./a";\n\nexport const api = rien;\n`),
      f("package.json", JSON.stringify({ name: "commenté" }, null, 2)),
    ],
  },
  {
    name: "python-documente",
    intent: "les docstrings comptent comme de la documentation, et l'indentation donne l'imbrication",
    expect: { min: 480, max: 1000 },
    files: [
      f("README.md", README_GOOD),
      f("LICENSE", LICENSE_MIT),
      f("package.json", PACKAGE_JSON_GOOD),
      f("package-lock.json", "{ \"lockfileVersion\": 3 }\n"),
      f(".github/workflows/ci.yml", CI_GOOD),
      f("src/math.py", `"""Fonctions arithmétiques."""


def somme(a, b):
    """Additionne deux nombres."""
    return a + b


def maximum(a, b):
    """Renvoie le plus grand des deux."""
    if a > b:
        return a
    return b
`),
      f("src/__init__.py", "from .math import somme, maximum\n"),
      f("tests/test_math.py", "from src.math import somme\n\n\ndef test_somme():\n    assert somme(1, 2) == 3\n"),
    ],
  },
  {
    name: "exclusions",
    intent: "le code généré, les migrations, les ressources et le vendorisé ne sont jamais notés",
    expect: { min: 0, max: 1000 },
    files: [
      f("src/real.ts", documentedModule("Real", "Le seul fichier réellement noté.")),
      f("src/api.d.ts", "declare const x: number;\nexport default x;\n"),
      f("src/bundle.min.js", "!function(){if(a){if(b){if(c){return 1}}}}();\n"),
      f("supabase/migrations/001_init.sql", "create table t (id serial primary key);\n"),
      f("components/ui/button.tsx", "export const Button = () => ({ });\n"),
      f("public/logo.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0\"/></svg>\n"),
    ],
  },
];
