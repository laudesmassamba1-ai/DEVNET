import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { demoSession } from "./session";

/**
 * AX-01 — `axe` sur les routes P0, **dans les deux thèmes**.
 *
 * La porte existante (`a11y.spec.ts`) ne mesurait que le thème sombre : un
 * jeton clair mal choisi — un filet à 1,7:1, une encre pâle sur papier —
 * passait la CI sans être vu. Or le thème clair n'est pas une inversion
 * automatique : chaque paire y est décidée.
 *
 * Le thème est posé deux fois, et les deux sont nécessaires. D'abord dans
 * `localStorage` avant le rendu : le script `beforeInteractive` du layout
 * évite ainsi le flash du thème sombre. Ensuite par l'événement
 * `devnet:theme`, après le montage : les profils de démonstration portent
 * `theme: "dark"`, et `ThemeApplier` resynchronise le document avec le
 * profil dès qu'il est résolu. Passer par l'événement, c'est emprunter le
 * chemin réel de l'aperçu des Paramètres — pas forcer un attribut dans le
 * dos de l'application.
 *
 * Le test vérifie ensuite que le document porte bien `data-theme` : sans
 * cette garde, une régression de `ThemeApplier` ferait mesurer deux fois le
 * thème sombre en croyant couvrir les deux.
 *
 * Blocage sur `critical` et `serious` uniquement : c'est le seuil de la
 * porte AX-05, et `moderate` contient des règles de style contestables.
 */
const ROUTES = [
  { path: "/login", label: "connexion", session: false },
  { path: "/feed", label: "fil", session: true },
  { path: "/profile", label: "profil", session: true },
  { path: "/messages", label: "messages", session: true },
];

const THEMES = [
  { id: "dark", label: "sombre" },
  { id: "light", label: "clair" },
] as const;

for (const theme of THEMES) {
  for (const route of ROUTES) {
    test(`axe · ${route.label} · thème ${theme.label}`, async ({ page }) => {
      if (route.session) await demoSession(page);
      await page.addInitScript((value) => {
        localStorage.setItem("devnet:theme", value);
      }, theme.id);

      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2_500);

      /* L'événement est **idempotent** : le renvoyer tant que le document
         n'a pas basculé remplace l'attente fixe qui rendait ce test
         instable. Sur une page lente à compiler, l'écouteur de
         `ThemeApplier` pouvait ne pas être monté dans les 400 ms et
         l'événement se perdait — le profil réappliquait alors son thème
         sombre. La garde sur `data-theme` reste : si l'application ne
         réagit jamais, le test échoue toujours. */
      await expect
        .poll(
          async () => {
            await page.evaluate((value) => {
              window.dispatchEvent(new CustomEvent("devnet:theme", { detail: value }));
            }, theme.id);
            return page.evaluate(
              () => document.documentElement.dataset.theme ?? "absent",
            );
          },
          {
            message: `le thème ${theme.label} n'a pas été appliqué`,
            timeout: 10_000,
            intervals: [250, 500, 1_000, 2_000],
          },
        )
        .toBe(theme.id);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      const blocking = results.violations.filter(
        (violation) => violation.impact === "critical" || violation.impact === "serious",
      );

      const summary = blocking.map(
        (violation) =>
          `${violation.id} (${violation.impact}) × ${violation.nodes.length} : ${violation.help}`,
      );

      expect(
        blocking,
        `violations sur ${route.path} (${theme.label}) :\n${summary.join("\n")}`,
      ).toEqual([]);
    });
  }
}
