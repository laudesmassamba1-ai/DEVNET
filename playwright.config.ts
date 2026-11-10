import { defineConfig, devices } from "@playwright/test";

/**
 * Portes navigateur du contrat d'expérience.
 *
 * Le serveur est lancé en **mode démonstration forcé** : les portes doivent
 * tourner sans base, comme la CI. `reuseExistingServer` évite de démarrer un
 * second Next quand un `npm run dev` écoute déjà : deux serveurs sur le même
 * port produisent des 500 trompeurs.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "NEXT_PUBLIC_FORCE_DEMO=true npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
