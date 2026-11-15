import type { Page } from "@playwright/test";

/**
 * Ouvre une session de démonstration sans passer par le formulaire.
 *
 * Les portes doivent tester les écrans derrière la session, pas le login.
 * `devnet.tour.v1` ferme la visite guidée : un voile de prise en main
 * intercepterait les clics et ferait échouer des tests sains.
 *
 * La visite se mémorise **par compte** (`devnet.tour.v1:<id>`) ; la clé
 * globale seule ne suffit plus depuis ce changement, et le voile revenait
 * intercepter chaque clic.
 */
export async function demoSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("devnet.demo.session", "u-koffi");
    localStorage.setItem("devnet.tour.v1", "done");
    localStorage.setItem("devnet.tour.v1:u-koffi", "done");
  });
}
