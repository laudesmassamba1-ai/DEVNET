/**
 * Statuts — les parcours réels, en mode démonstration.
 *
 * Ce que ces portes regardent : le rail ouvre une série, le lecteur s'affiche
 * avec ses gestes essentiels (navigation clavier, fermeture) et la liste des
 * vues reste une affaire d'auteur. Aucune de ces portes ne simule une
 * action : elles cliquent ce qu'une personne cliquerait.
 */
import { test, expect, type Page } from "@playwright/test";
import { demoSession } from "./session";

/**
 * La visite guidée se mémorise **par compte** : la clé du helper ne suffit
 * plus, et son voile intercepterait chaque clic.
 */
async function quietTour(page: Page): Promise<void> {
  await demoSession(page);
  await page.addInitScript(() => {
    localStorage.setItem("devnet.tour.v1:u-koffi", "done");
  });
}

test.describe("statuts", () => {
  test("le rail ouvre la série et le lecteur se referme", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await quietTour(page);
    await page.goto("/feed");

    // Le rail se remplit après le chargement des séries : « vous » n'existe
    // qu'une fois la story personnelle connue. Cliquer « Votre story »
    // avant ouvrirait le studio, pas le lecteur.
    const mine = page.getByRole("button", { name: /^vous/ });
    await expect(mine).toBeVisible();
    await mine.click();

    const reader = page.getByRole("dialog", { name: /^Story de / });
    await expect(reader).toBeVisible();
    // L'état des interactions arrive après le premier rendu : la capture
    // attend qu'il soit posé, sinon elle photographie un chargement.
    await expect(reader.getByText("Chargement des interactions…")).toHaveCount(0);
    await page.screenshot({ path: "test-results/stories-mobile.png" });

    // La porte des vues n'apparaît que sur sa propre story.
    await expect(
      reader.getByRole("button", { name: "Voir qui a regardé ce statut" }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(reader).toHaveCount(0);
  });

  test("l'anneau passe de neuf à vu après la lecture", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await quietTour(page);
    await page.goto("/feed");

    // Une story d'autrui, encore neuve sur cet appareil.
    const fresh = page.getByRole("button", { name: /statuts?, non vu$/ }).first();
    await expect(fresh).toBeVisible();
    await page.screenshot({ path: "test-results/stories-rail-mobile.png" });
    await fresh.click();

    const reader = page.getByRole("dialog", { name: /^Story de / });
    await expect(reader).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByRole("button", { name: /statuts?, déjà vu$/ }).first()).toBeVisible();
  });

  test("un GIF se choisit et se publie en statut", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await quietTour(page);
    await page.goto("/feed");

    await page.getByLabel("Publier une nouvelle story").click();
    const composer = page.getByRole("dialog", { name: "Éditeur de statut" });
    await expect(composer).toBeVisible();

    await composer.getByRole("button", { name: "GIF", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Choisir un GIF" });
    await expect(picker).toBeVisible();

    // Le champ n'est atteignable que si la feuille est **au-dessus** de
    // l'éditeur : c'est précisément le défaut qui rendait les GIF
    // impossibles — la feuille s'ouvrait derrière un écran opaque. Un
    // clic intercepté ferait échouer cette étape.
    const gifUrl = "https://media.giphy.com/media/devnet/giphy.gif";
    await picker.getByLabel("Adresse directe du GIF").fill(gifUrl);
    await picker.getByRole("button", { name: "Utiliser" }).click();
    await expect(picker).toHaveCount(0);

    // Le GIF reste un lien : c'est le fournisseur qui sert l'animation.
    await expect(composer.locator(`img[src="${gifUrl}"]`)).toHaveCount(1);
    await composer.getByRole("button", { name: "Publier", exact: true }).click();
    await expect(composer).toHaveCount(0);

    const publie = await page.evaluate((url) => {
      const key = Object.keys(localStorage).find((k) => /^devnet\.demo\.v\d+$/.test(k));
      const data = key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
      return (data?.stories ?? []).some(
        (story: { media_url?: string }) => story.media_url === url,
      );
    }, gifUrl);
    expect(publie).toBe(true);
  });

  test("le studio publie une story réservée aux abonnés", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await quietTour(page);
    await page.goto("/feed");

    await page.getByLabel("Publier une nouvelle story").click();
    const composer = page.getByRole("dialog", { name: "Éditeur de statut" });
    await expect(composer).toBeVisible();

    await composer.getByRole("radio", { name: "Abonnés" }).click();
    await expect(composer.getByRole("radio", { name: "Abonnés" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Choisir l'audience retire le focus du champ : l'éditeur repasse en
    // mode « texte placé ». On rouvre le champ depuis la barre d'outils.
    await composer.getByRole("button", { name: "Texte", exact: true }).click();
    const caption = `audience-abonnes-${Date.now()}`;
    await composer.getByRole("textbox", { name: "Texte du statut" }).fill(caption);
    await composer.getByRole("button", { name: "Publier", exact: true }).click();
    await expect(composer).toHaveCount(0);

    const audience = await page.evaluate((text) => {
      const key = Object.keys(localStorage).find((k) => /^devnet\.demo\.v\d+$/.test(k));
      const data = key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
      return (data?.stories ?? []).find(
        (story: { caption?: string }) => story.caption === text,
      )?.audience;
    }, caption);
    expect(audience).toBe("followers");
  });

  test("le lecteur suit le clavier et ouvre la liste des vues", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await quietTour(page);
    await page.goto("/feed");

    const mine = page.getByRole("button", { name: "vous", exact: true });
    await expect(mine).toBeVisible();
    await mine.click();

    const reader = page.getByRole("dialog", { name: /^Story de / });
    await expect(reader).toBeVisible();
    await expect(reader).toContainText("Koffi");
    // Le panneau des vues se photographie une fois l’état posé.
    await expect(reader.getByText("Chargement des interactions…")).toHaveCount(0);

    const views = reader.getByRole("button", { name: "Voir qui a regardé ce statut" });
    await views.click();
    const sheet = page.getByRole("dialog", { name: "Personnes ayant vu ce statut" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Chargement…")).toHaveCount(0);
    await page.screenshot({ path: "test-results/stories-vues-desktop.png" });
    await sheet.getByRole("button", { name: "Fermer la liste des vues" }).click();
    await expect(sheet).toHaveCount(0);

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Escape");
    await expect(reader).toHaveCount(0);
  });
});
