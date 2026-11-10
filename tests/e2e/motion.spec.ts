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
