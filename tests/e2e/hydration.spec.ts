import { expect, test } from "@playwright/test";

/**
 * HY-01 — le serveur et la première passe client rendent la même chose.
 *
 * `/login` lit l'état de la sonde avant de choisir entre « Connexion » et
 * « Démonstration ». Si la sonde a déjà répondu quand React hydrate, le
 * texte diverge et l'arbre entier est régénéré côté client. La porte écoute
 * donc les erreurs de console : un écart d'hydratation échoue ici même si
 * le rendu final semble correct.
 */
test("HY-01 : /login s'hydrate sans écart serveur/client", async ({ page }) => {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/hydration|didn't match the client/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (/hydration|didn't match the client/i.test(error.message)) {
      errors.push(error.message);
    }
  });

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: /^(Connexion|Démonstration)$/ }),
  ).toBeVisible();
  await page.waitForTimeout(1_500);

  expect(errors, `écarts d'hydratation :\n${errors.join("\n")}`).toEqual([]);
});
