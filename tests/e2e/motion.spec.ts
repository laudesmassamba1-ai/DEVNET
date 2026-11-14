import { expect, test } from "@playwright/test";
import { demoSession } from "./session";

/**
 * MO-03 — le mouvement réduit coupe le superflu.
 *
 * On interroge les animations **réellement en cours** (`getAnimations()`),
 * pas les classes CSS : une classe posée sans animation ne compte pas, et
 * une animation héritée d'un composant tiers doit être vue.
 *
 * Sont tolérées sous mouvement réduit : les indicateurs de chargement
 * (rotation, pulsation) — une information « ça travaille » — et rien
 * d'autre de bouclé.
 */
test("mouvement réduit : aucune animation décorative en boucle", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await demoSession(page);
  await page.goto("/feed", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_500);

  const looping = await page.evaluate(() => {
    const animations = document.getAnimations();
    return animations
      .filter((animation) => {
        const timing = animation.effect?.getTiming();
        if (timing?.iterations !== Infinity) return false;
        const target = (animation.effect as KeyframeEffect | null)?.target as Element | null;
        const label = `${target?.className ?? ""} ${target?.getAttribute?.("aria-label") ?? ""}`;
        // Indicateurs de chargement assumés.
        return !/spin|pulse|scan|breathe|loading|skeleton|caret/i.test(label);
      })
      .map((animation) => {
        const effect = animation.effect as KeyframeEffect | null;
        return String(effect?.target?.className ?? "?");
      });
  });

  expect(looping, `animations décoratives en boucle : ${looping.join(", ")}`).toEqual([]);
});

test("mouvement réduit : les transitions restent courtes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await demoSession(page);
  await page.goto("/feed", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);

  const longOnes = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => {
        const timing = animation.effect?.getTiming();
        const duration = typeof timing?.duration === "number" ? timing.duration : 0;
        return duration > 400;
      })
      .map((animation) => Number(animation.effect?.getTiming().duration)),
  );

  expect(longOnes, `durées > 400 ms sous mouvement réduit : ${longOnes.join(", ")}`).toEqual([]);
});

test("mouvement réduit : les entrées restent visibles (mo-pre levé)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await demoSession(page);
  await page.goto("/feed", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);

  // Une carte pré-entrée (`mo-pre`, opacity 0) ne doit jamais rester
  // invisible sous mouvement réduit : le contenu vaut l'animation perdue.
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll(".mo-pre")]
      .map((el) => getComputedStyle(el).opacity)
      .filter((opacity) => Number(opacity) < 0.99).length,
  );

  expect(hidden, "cartes invisibles sous mouvement réduit").toBe(0);
});

test("niveau essentiel : l'ambiance continue est coupée, le chargement reste", async ({ page }) => {
  await demoSession(page);
  await page.addInitScript(() => {
    localStorage.setItem("devnet:motion-level", "essentiel");
  });
  await page.goto("/decouvrir", { waitUntil: "domcontentloaded" });
  // La session démo peut se poser après la première garde de coque :
  // un renvoi vers /login est alors possible. On attend la vraie
  // surface (le sonar), et on repart une fois si nécessaire.
  try {
    await page.waitForSelector(".sonar-sweep", { timeout: 6_000 });
  } catch {
    await page.goto("/decouvrir", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".sonar-sweep", { timeout: 6_000 });
  }
  await page.waitForTimeout(1_500);

  const state = await page.evaluate(() => {
    const root = document.documentElement;
    const looping = document
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations === Infinity)
      .map((animation) => {
        const effect = animation.effect as KeyframeEffect | null;
        return String(effect?.target?.className ?? "?");
      });
    // Le sonar est l'ambiance continue de Découvrir : coupée au niveau
    // « essentiel ». Tout autre boucle non autorisée est une régression.
    const sonarStill = looping.some((label) => /sonar-sweep/.test(label));
    const disallowed = looping.filter(
      (label) => !/sonar-sweep|spin|pulse|scan|skeleton|shimmer|loading|caret/i.test(label),
    );
    return { level: root.dataset.motionLevel, sonarStill, disallowed };
  });

  expect(state.level).toBe("essentiel");
  expect(state.sonarStill, "le sonar tourne encore au niveau essentiel").toBe(false);
  expect(state.disallowed, `boucles non autorisées : ${state.disallowed.join(", ")}`).toEqual([]);
});
