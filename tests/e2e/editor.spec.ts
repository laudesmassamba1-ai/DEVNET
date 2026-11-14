/**
 * Éditeur de projet — parcours réel en mode démonstration.
 *
 * Vérifie qu’un fichier s’ouvre, que Monaco expose ses actions et que les
 * contrôles de sauvegarde/commit sont présents dans l’état attendu. Le
 * parcours d’exécution (aucun worker avant le clic) reste couvert par
 * `execution.spec.ts`.
 */
import { expect, test } from "@playwright/test";
import { demoSession } from "./session";

test.describe("éditeur", () => {
  test("ouvre un fichier et expose sauvegarde et commit", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await demoSession(page);

    await page.goto("/ide/p-1", { waitUntil: "domcontentloaded" });

    await expect(page.getByLabel("Branche")).toBeVisible({ timeout: 30_000 });

    // L’arborescence rend des boutons dont le nom est le chemin du fichier.
    const file = page
      .getByRole("button", { name: /\.(py|ts|tsx|js|jsx|json|md|css|yaml|yml|toml|sql)$/ })
      .first();
    await expect(file).toBeVisible({ timeout: 30_000 });
    await file.click();

    // Monaco est chargé dynamiquement : on attend une action qu’il porte.
    await expect(page.getByLabel("Copier le code")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "écrire" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "commit" })).toBeEnabled();

    await page.screenshot({ path: "test-results/editor-desktop.png" });
  });
});
