import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { demoSession } from "./session";

/**
 * AX-01 / AX-03 — `axe` sur les routes P0.
 *
 * On bloque sur les violations **critiques et sérieuses** : un contraste
 * insuffisant ou un contrôle sans nom n'est pas un détail de revue, c'est
 * un écran inutilisable pour une partie des lecteurs.
 *
 * `color-contrast` est mesuré sur le thème sombre par défaut ; le thème
 * clair a ses propres tokens et sa propre passe (à brancher quand le
 * sélecteur de thème sera testable de bout en bout).
 */
const ROUTES = [
  { path: "/login", label: "connexion", session: false },
  { path: "/feed", label: "fil", session: true },
  { path: "/messages", label: "messages", session: true },
  { path: "/profile", label: "profil", session: true },
];

for (const route of ROUTES) {
  test(`aucune violation critique sur ${route.label}`, async ({ page }) => {
    if (route.session) await demoSession(page);
    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_500);

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

    expect(blocking, `violations sur ${route.path} :\n${summary.join("\n")}`).toEqual([]);
  });
}
