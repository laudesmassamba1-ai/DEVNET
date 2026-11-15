/**
 * Moteur d'accessibilité — tests de la règle, pas de l'écran.
 *
 * Ce script vérifie que `lib/a11y/audit.ts` **détecte** ce qu'il prétend
 * détecter et **laisse passer** ce qui est correct. Il tourne sur des pages
 * fabriquées (`setContent`) : aucune dépendance à l'application, donc il
 * échoue pour la bonne raison quand une règle est cassée.
 *
 * Les portes qui mesurent les vrais écrans sont `tests/e2e/a11y*.spec.ts`.
 *
 * Exécuter avec : npm run test:a11y-engine
 */
import { chromium, type Browser, type Page } from "playwright";
import A11yAudit, { RULE_CATALOG } from "../lib/a11y/audit";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Page saine : tout ce que les règles exigent, et rien de plus. */
const GOOD = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Écran de test</title>
  <style>
    body { background: #ffffff; color: #111111; font: 16px/1.5 sans-serif; }
    a, button { color: #111111; }
    h1 { font-size: 28px; }
  </style>
</head>
<body>
  <main>
    <h1>Un écran lisible</h1>
    <p>Le texte est sombre sur fond clair.</p>
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Pixel de test">
    <button type="button">Enregistrer</button>
    <a href="/suite">Continuer</a>
    <label for="nom">Nom</label>
    <input id="nom" name="nom">
  </main>
</body>
</html>`;

type Case = {
  name: string;
  html: string;
  rules: string[];
  tags?: string[];
};

const CASES: Case[] = [
  {
    name: "image sans alternative",
    html: GOOD.replace('alt="Pixel de test"', ""),
    rules: ["image-alt"],
  },
  {
    name: "bouton sans nom",
    html: GOOD.replace("<button type=\"button\">Enregistrer</button>", "<button type=\"button\"><svg width=\"8\" height=\"8\"></svg></button>"),
    rules: ["button-name"],
  },
  {
    name: "lien sans nom",
    html: GOOD.replace('<a href="/suite">Continuer</a>', '<a href="/suite"><span aria-hidden="true">→</span></a>'),
    rules: ["link-name"],
  },
  {
    name: "champ sans étiquette",
    html: GOOD.replace('<label for="nom">Nom</label>', ""),
    rules: ["label"],
  },
  {
    name: "contraste insuffisant",
    html: GOOD.replace("color: #111111; font: 16px", "color: #999999; font: 16px"),
    rules: ["color-contrast"],
  },
  {
    name: "sans langue ni titre",
    html: GOOD.replace('<html lang="fr">', "<html>").replace("<title>Écran de test</title>", ""),
    rules: ["html-has-lang", "document-title"],
  },
  {
    name: "titre sauté",
    html: GOOD.replace("<h1>Un écran lisible</h1>", "<h1>Un écran lisible</h1><h3>Sous-titre</h3>"),
    rules: ["heading-order"],
    tags: ["best-practice"],
  },
  {
    name: "tabindex positif",
    html: GOOD.replace('<a href="/suite">', '<a tabindex="3" href="/suite">'),
    rules: ["tabindex"],
    tags: ["best-practice"],
  },
  {
    name: "aria-hidden focusable",
    html: GOOD.replace("<button type=\"button\">Enregistrer</button>", '<div aria-hidden="true"><button type="button">Caché</button></div>'),
    rules: ["aria-hidden-focus"],
  },
  {
    name: "identifiant dupliqué référencé",
    html: GOOD.replace(
      '<input id="nom" name="nom">',
      '<div id="dup">a</div><div id="dup">b</div><input aria-labelledby="dup" name="dup">',
    ),
    rules: ["duplicate-id-aria"],
  },
  {
    name: "attribut ARIA inconnu",
    html: GOOD.replace("<button type=\"button\">", '<button aria-labl="x" type="button">'),
    rules: ["aria-valid-attr"],
  },
  {
    name: "rôle sans attribut obligatoire",
    html: GOOD.replace(
      "<button type=\"button\">Enregistrer</button>",
      '<div role="checkbox" tabindex="0">Accepter</div>',
    ),
    rules: ["aria-required-attr"],
  },
  {
    name: "zoom désactivé",
    html: GOOD.replace('content="width=device-width, initial-scale=1"', 'content="width=device-width, initial-scale=1, user-scalable=no"'),
    rules: ["meta-viewport"],
  },
  {
    name: "liste mal structurée",
    html: GOOD.replace("<p>Le texte est sombre sur fond clair.</p>", "<ul><div>pas un li</div></ul>"),
    rules: ["list"],
  },
];

async function audit(page: Page, html: string, tags: string[] = TAGS) {
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  return new A11yAudit({ page }).withTags(tags).analyze();
}

async function main(): Promise<void> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    console.error(
      `Chromium indisponible : ${(error as Error).message.split("\n")[0]}\n` +
        "Installer avec : npx playwright install --with-deps chromium",
    );
    process.exit(1);
  }

  try {
    const page = await browser.newPage();

    /* La page saine ne doit rien déclencher : un moteur qui signale tout ne
       vérifie rien. */
    const clean = await audit(page, GOOD);
    check("page saine : aucune violation", clean.violations.length === 0,
      clean.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.length })));

    /* Et elle doit faire *passer* les règles (pas seulement ne rien
       signaler) : c'est la différence entre « pas de règle exécutée » et
       « règle respectée ». */
    check("page saine : règles exécutées", clean.passes.length >= 8, clean.passes.length);

    for (const testCase of CASES) {
      const result = await audit(page, testCase.html, testCase.tags ?? TAGS);
      const found = result.violations.map((violation) => violation.id);
      for (const rule of testCase.rules) {
        check(
          `${testCase.name} : ${rule} détecté`,
          found.includes(rule),
          { attendu: rule, trouvé: found },
        );
      }
      const unexpected = found.filter(
        (id) => !testCase.rules.includes(id) && id !== "color-contrast",
      );
      check(`${testCase.name} : pas de faux positif`, unexpected.length === 0, unexpected);
    }

    /* Le filtrage par étiquettes doit fonctionner comme `axe` : une règle
       `best-practice` ne s'exécute pas sous `wcag2a`. */
    const bestPractice = await audit(
      page,
      GOOD.replace("<h1>Un écran lisible</h1>", "<h1>Un écran lisible</h1><h4>Saut</h4>"),
      ["wcag2a"],
    );
    check(
      "withTags([wcag2a]) ignore heading-order",
      !bestPractice.violations.some((violation) => violation.id === "heading-order"),
      bestPractice.violations.map((violation) => violation.id),
    );

    /* `exclude` retire bien un sous-arbre. */
    const excluded = await audit(
      page,
      GOOD.replace("<main>", '<main><div id="ignore"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>'),
    );
    check("exclude : la règle voit l'image", excluded.violations.some((v) => v.id === "image-alt"));
    await page.setContent(
      GOOD.replace("<main>", '<main><div id="ignore"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>'),
      { waitUntil: "domcontentloaded" },
    );
    const excludedAudit = await new A11yAudit({ page }).withTags(TAGS).exclude("#ignore").analyze();
    check(
      "exclude : image ignorée",
      !excludedAudit.violations.some((v) => v.id === "image-alt"),
      excludedAudit.violations.map((violation) => violation.id),
    );

    check("catalogue de règles non vide", RULE_CATALOG.length >= 20, RULE_CATALOG.length);
    check(
      "chaque règle a une étiquette et un impact",
      RULE_CATALOG.every((rule) => rule.tags.length > 0 && Boolean(rule.impact)),
    );
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`${failures.length} échec(s) :`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`moteur a11y : ${passed} vérifications réussies`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
