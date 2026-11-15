/**
 * Sonde de débordement horizontal sur un iPhone X (WebKit, 375×812).
 * Lancement : BASE=http://localhost:4123 PATHS=/login,/ node scripts/probe-mobile-overflow.mjs
 * Sortie : pour chaque chemin, la largeur de défilement et les éléments qui
 * dépassent le viewport. Un défilement horizontal réel = scrollX > 0 après scrollTo.
 */
import { chromium, webkit, devices } from "@playwright/test";
const engine = process.env.ENGINE === "webkit" ? webkit : chromium;

const base = process.env.BASE ?? "http://localhost:4123";
const paths = (process.env.PATHS ?? "/login,/register,/").split(",");
const browser = await engine.launch(process.env.WEBKIT_EXEC ? { executablePath: process.env.WEBKIT_EXEC } : {});
const context = await browser.newContext({ ...devices["iPhone X"] });
const page = await context.newPage();
let failed = false;
for (const path of paths) {
  await page.goto(base + path, { waitUntil: "networkidle" }).catch((error) => console.log("goto", path, error.message));
  await page.waitForTimeout(800);
  const report = await page.evaluate(() => {
    const vw = window.innerWidth;
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        const id = el.id ? `#${el.id}` : "";
        const cls = typeof el.className === "string" ? el.className.split(" ").slice(0, 3).join(".") : "";
        offenders.push(`${el.tagName.toLowerCase()}${id}.${cls} L=${Math.round(r.left)} R=${Math.round(r.right)}`);
      }
    }
    window.scrollTo(200, 0);
    return {
      vw,
      htmlScrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      scrolledX: window.scrollX,
      overflowingCount: offenders.length,
      offenders: offenders.slice(0, 8),
    };
  });
  if (report.scrolledX > 0) failed = true;
  console.log(path, JSON.stringify(report));
}
await browser.close();
process.exitCode = failed ? 1 : 0;
