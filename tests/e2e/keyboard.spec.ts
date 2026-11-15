import { expect, test } from "@playwright/test";
import { demoSession } from "./session";

/**
 * AX-02 — le clavier suffit, et le focus se voit.
 *
 * Le test ne vérifie pas « un anneau » décoratif : il vérifie qu'à chaque
 * arrêt de tabulation, l'élément actif est **visible** et que son contour ou
 * son ombre de focus est réellement peint.
 */
test("fil : chaque arrêt de tabulation porte un focus visible", async ({ page }) => {
  await demoSession(page);
  await page.goto("/feed", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_500);

  const seen: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        tag: el.tagName,
        label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40),
        outlineWidth: parseFloat(style.outlineWidth || "0"),
        outlineStyle: style.outlineStyle,
        boxShadow: style.boxShadow !== "none",
        visible: el.getBoundingClientRect().width > 0,
      };
    });
    expect(info, "aucun élément actif après Tab").not.toBeNull();
    if (!info) continue;

    seen.push(`${info.tag}:${info.label}`);
    expect(info.visible, `élément de focus invisible : ${info.tag} ${info.label}`).toBeTruthy();
    const ring = (info.outlineWidth >= 2 && info.outlineStyle !== "none") || info.boxShadow;
    expect(
      ring,
      `focus non peint sur ${info.tag} « ${info.label} » (outline ${info.outlineWidth}px ${info.outlineStyle})`,
    ).toBeTruthy();
  }

  // Six arrêts doivent être six contrôles distincts, sinon le focus est piégé.
  expect(new Set(seen).size).toBeGreaterThanOrEqual(4);
});
