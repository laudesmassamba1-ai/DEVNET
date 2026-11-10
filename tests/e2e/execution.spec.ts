import { expect, test, type Page } from "@playwright/test";
import { demoSession } from "./session";

/**
 * CR-04 — rien ne s'exécute sans un clic.
 *
 * Le worker d'exécution est le seul endroit où du code fourni par un
 * utilisateur tourne. Il ne doit pas être créé à l'ouverture de l'IDE :
 * ouvrir un projet est une lecture, pas une exécution.
 *
 * On compte les `Worker` réellement construits (Monaco en crée un pour son
 * service de langage : c'est le niveau de référence, pas zéro) et on vérifie
 * qu'aucune sortie d'exécution n'existe avant le geste. Le compteur doit
 * ensuite augmenter **après** le clic — c'est la preuve que le clic est bien
 * la cause, pas une coïncidence de chargement.
 */
async function workerCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __engineWorkers?: number }).__engineWorkers ?? 0,
  );
}

test("CR-04 : aucune exécution avant le clic, une après", async ({ page }) => {
  await demoSession(page);

  // Compteur posé avant tout script de l'application.
  await page.addInitScript(() => {
    const w = window as unknown as { __engineWorkers: number };
    w.__engineWorkers = 0;
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        w.__engineWorkers += 1;
      }
    } as typeof Worker;
  });

  await page.goto("/ide/p-1", { waitUntil: "domcontentloaded" });

  const run = page.getByRole("button", { name: /^exécuter$/i }).first();
  await expect(run).toBeVisible({ timeout: 30_000 });

  const baseline = await workerCount(page);
  await page.waitForTimeout(2_500);

  // Aucun worker supplémentaire, aucune sortie : l'IDE n'a rien lancé.
  expect(await workerCount(page), "un worker a été créé sans clic").toBe(baseline);
  await expect(
    page.getByText(/^terminé$/i).or(page.getByText(/^échec$/i)).or(page.getByText(/interrompue/i)),
  ).toHaveCount(0);

  await run.click();

  await expect
    .poll(() => workerCount(page), {
      message: "le clic sur « exécuter » n'a créé aucun worker",
      timeout: 20_000,
    })
    .toBeGreaterThan(baseline);

  // Une sortie existe : l'exécution a bien eu lieu, et elle est attribuable
  // au clic (elle n'existait pas deux secondes plus tôt).
  await expect(
    page.getByText(/^terminé$/i).or(page.getByText(/^échec$/i)).first(),
  ).toBeVisible({ timeout: 40_000 });
});
