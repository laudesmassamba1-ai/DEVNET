import { expect, test } from "@playwright/test";
import { demoSession } from "./session";

/**
 * FT-02 — les états qui ne sont pas le chemin heureux.
 *
 * Trois écrans qu'on oublie parce qu'ils ne se produisent pas en démo :
 * une recherche sans résultat, un profil inexistant, un écran en attente.
 * Les deux premiers sont déterministes et bloquent. L'attente est vérifiée
 * sur une navigation réelle : le repli doit être un `role="status"` nommé,
 * pas un écran blanc.
 */
test("FT-02 : recherche sans résultat → état vide nommé", async ({ page }) => {
  await demoSession(page);
  await page.goto("/search?q=zzzzyyyxxxintrouvable", { waitUntil: "domcontentloaded" });

  // L'onglet par défaut est « Personnes » : on demande explicitement les
  // publications, sinon on ne teste pas l'état vide des posts.
  await page.getByRole("tab", { name: /posts/i }).click();

  const empty = page.getByRole("status").filter({ hasText: /aucune publication/i }).first();
  await expect(empty).toBeVisible({ timeout: 25_000 });
  await expect(empty).toContainText(/ne contient/i);
});

test("FT-02 : profil inexistant → état « introuvable », pas une page blanche", async ({
  page,
}) => {
  await demoSession(page);
  await page.goto("/u/ce-pseudo-nexiste-pas-2026", { waitUntil: "domcontentloaded" });

  await expect(page.getByText(/profil introuvable/i).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(/aucun compte/i).first()).toBeVisible();
});

test("FT-02 : navigation en attente → repli nommé, puis contenu", async ({ page }) => {
  await demoSession(page);

  // Ralentit la requête de navigation App Router pour rendre le repli
  // observable. Sans cela, la démo répond en quelques millisecondes et le
  // test ne mesurerait que sa propre course. Les préchargements du lien sont
  // refusés : sinon la réponse est déjà en cache et il n'y a aucun repli.
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.headers()["next-router-prefetch"]) {
      await route.abort();
      return;
    }
    if (request.url().includes("_rsc=")) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    await route.continue();
  });

  await page.goto("/feed", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /publier une publication/i })).toBeVisible({
    timeout: 25_000,
  });

  const messages = page.getByRole("link", { name: /^messages$/i }).first();
  await messages.click();

  // Le statut du bandeau réseau existe en permanence : on exige le repli de
  // chargement lui-même, nommé « Chargement… ».
  const status = page.getByRole("status", { name: /chargement/i }).first();
  await expect(status).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/aucun message/i).or(page.getByRole("heading", { name: /messages/i })).first()).toBeVisible({
    timeout: 25_000,
  });
});
