import { expect, test } from "@playwright/test";
import { demoSession } from "./session";

/**
 * Porte de non-régression du contrat mobile.
 *
 * Trois largeurs réelles (iPhone SE, Android courant, iPhone 14), huit écrans.
 * Le test échoue si :
 *  - la largeur du document dépasse le viewport (débordement de page) ;
 *  - un élément visible sort du viewport hors conteneur de défilement ;
 *  - un texte essentiel est rendu sous 12 px.
 *
 * Les seules exceptions sont explicites dans le DOM (`data-allow-tiny`) :
 * la navigation repasse à 11 px sous 340 px pour tenir six onglets, et la
 * ligne d'état terminal est décorative. Les liens inline ne sont pas testés
 * comme cibles tactiles (WCAG 2.5.8).
 */
const ROUTES = [
  "/feed",
  "/messages",
  "/profile",
  "/settings",
  "/projects",
  "/groups",
  "/communities",
  "/projects/p-1",
];
const WIDTHS = [320, 360, 390];

const SCAN = () => {
  const vw = window.innerWidth;
  const issues: {
    scrollWidth: number;
    overflow: { tag: string; text: string; right: number; width: number }[];
    tiny: { tag: string; text: string; fontSize: number }[];
  } = { scrollWidth: document.documentElement.scrollWidth, overflow: [], tiny: [] };

  const visible = (el: Element) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return (
      s.display !== "none" &&
      s.visibility !== "hidden" &&
      Number(s.opacity) > 0.01 &&
      r.width > 0 &&
      r.height > 0
    );
  };
  const textOf = (el: Element) =>
    (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 70);

  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    if (el.closest("svg, nextjs-portal, [aria-hidden='true']")) continue;
    const r = el.getBoundingClientRect();

    if (
      (r.right > vw + 1 || r.left < -1) &&
      !el.closest("[class*='overflow-x-auto'], [class*='overflow-auto'], [data-overflow-ok]")
    ) {
      issues.overflow.push({
        tag: el.tagName.toLowerCase(),
        text: textOf(el),
        right: Math.round(r.right),
        width: Math.round(r.width),
      });
    }

    const hasOwnText = Array.from(el.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 1,
    );
    if (!hasOwnText || el.closest("[data-allow-tiny], .sr-only, option")) continue;
    const fontSize = parseFloat(getComputedStyle(el).fontSize);
    const text = (el.textContent ?? "").trim();
    if (text.length > 1 && fontSize < 12) {
      issues.tiny.push({ tag: el.tagName.toLowerCase(), text: text.slice(0, 50), fontSize });
    }
  }
  return issues;
};

for (const width of WIDTHS) {
  test(`aucun débordement ni texte < 12 px à ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await demoSession(page);

    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => document.body.innerText.trim().length > 120,
        undefined,
        { timeout: 30_000 },
      );
      await page.waitForTimeout(1_000);

      const quit = page.getByRole("button", { name: "Quitter" });
      if (await quit.count()) await quit.first().click().catch(() => {});

      const issues = await page.evaluate(SCAN);
      expect(
        issues.scrollWidth,
        `${route} (${width}px) : largeur ${issues.scrollWidth} > ${width}`,
      ).toBeLessThanOrEqual(width + 1);
      expect(
        issues.overflow,
        `${route} (${width}px) : éléments hors viewport\n${JSON.stringify(issues.overflow, null, 2)}`,
      ).toEqual([]);
      expect(
        issues.tiny,
        `${route} (${width}px) : textes < 12 px\n${JSON.stringify(issues.tiny, null, 2)}`,
      ).toEqual([]);
    }
  });
}
