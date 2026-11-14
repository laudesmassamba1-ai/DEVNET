/**
 * Norme d'expérience — vérification mécanique.
 *
 * `docs/ui/experience-standard.md` est contraignante ; ce script vérifie ce
 * qui peut l'être sans navigateur : jetons, durées, couleurs en dur, motifs
 * interdits, chemin de lecture, et présence des sections de la norme.
 *
 * Ce qu'il ne vérifie pas, et qu'il ne faut pas lui faire dire : le rendu, le
 * contraste réel, le clavier, `axe`, Lighthouse. Ces vérifications se font à
 * la main et se notent dans `docs/ui/coverage.md`.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const ROOT_DIR = fileURLToPath(ROOT);
const read = (path: string): string => readFileSync(new URL(path, ROOT), "utf8");

/** Liste récursive des composants d'interface (`.tsx`). */
function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(ROOT_DIR, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) tsxFiles(relative, out);
    else if (entry.name.endsWith(".tsx")) out.push(relative);
  }
  return out;
}

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

/* ── 1. La norme existe et reste complète ────────────────────────── */

const STANDARD = "docs/ui/experience-standard.md";
let standard = "";
try {
  standard = read(STANDARD);
} catch {
  check("norme présente", false, STANDARD);
}

check("norme : sections 1 à 10", standard.length > 0, STANDARD);
for (const section of [
  "## 1. Doctrine",
  "## 2. Stories",
  "## 3. Stickers",
  "## 4. Compression, latence, mémoire",
  "## 5. Code exécuté dans le fil",
  "## 6. Parité et complémentarité",
  "## 7. Identité visuelle et mouvement",
  "## 8. Pages, fenêtres, navigation",
  "## 9. Accessibilité et langues",
  "## 10. Portes et définition",
]) {
  check(`norme : « ${section} »`, standard.includes(section));
}
for (const subject of ["sticker", "story", "compression", "bac à sable"]) {
  check(`norme : parle de « ${subject} »`, standard.toLowerCase().includes(subject));
}

/* ── 2. Jetons : aucune valeur de thème en dur ───────────────────── */

const css = read("app/globals.css");
for (const token of [
  "--color-signal",
  "--color-void",
  "--color-surface",
  "--ease-entrance",
  "--ease-spring",
  "--d-instant",
  "--d-fast",
  "--d-base",
  "--d-slow",
  "--radius-card",
  "--shadow-sh-1",
]) {
  check(`jeton ${token}`, css.includes(`${token}:`));
}

/* ── 3. Mouvement : durées bornées, réduction respectée ──────────── */

/** Durées longues légitimes : elles ne concernent jamais une surface. */
const LONG_LIVED = new Set(["--d-story", "--d-caret", "--d-orbit"]);

const durations = [...css.matchAll(/--(d-[a-z0-9-]+)\s*:\s*(\d+)ms;/g)];
check("durées : jetons trouvés", durations.length >= 8, durations.length);
for (const [, name, value] of durations) {
  const token = `--${name}`;
  if (LONG_LIVED.has(token)) continue;
  const ms = Number(value);
  check(`durée ${token} ≤ 300 ms`, ms >= 60 && ms <= 300, ms);
}

check("mouvement : prefers-reduced-motion traité", css.includes("prefers-reduced-motion"));
const reducedBlock = css.slice(css.lastIndexOf("prefers-reduced-motion"));
check(
  "mouvement : les classes .mo- sont neutralisées",
  /\.mo-[a-z]/.test(reducedBlock),
  reducedBlock.slice(0, 120),
);

const motion = read("components/Motion.tsx");
check("mouvement : rôles déclarés", motion.includes("type MotionRole"));
check("mouvement : réduction exposée au JS", motion.includes("usePrefersReducedMotion"));
check("mouvement : cascades plafonnées", motion.includes("maxDelay"));

const transitionAll = ["app/globals.css", "components/Motion.tsx"].filter((file) =>
  /transition:\s*all/.test(read(file)),
);
check("mouvement : aucun « transition: all »", transitionAll.length === 0, transitionAll);

/* ── 4. Couleurs en dur : seule la marque y a droit ──────────────── */

const BRAND_ALLOWED = new Set([
  "app/layout.tsx",
  "components/DevScene.tsx",   // l'illustration-scénario : identité visuelle fixe, comme le logo
  "components/AnimatedLogo.tsx",
  "components/SplashScreen.tsx",
  "components/LoadingLogo.tsx",
  "components/BrandIcons.tsx",
]);

const HEX = /#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?(?:[0-9A-Fa-f]{2})?\b/;
const filesWithHex = [...tsxFiles("app"), ...tsxFiles("components")].filter((file) =>
  HEX.test(read(file)),
);
const colorOffenders = filesWithHex.filter((file) => !BRAND_ALLOWED.has(file));
check("couleurs en dur : uniquement les fichiers de marque", colorOffenders.length === 0, colorOffenders);

/* ── 5. Motifs interdits ─────────────────────────────────────────── */

for (const file of ["app/feed/page.tsx", "components/PostCard.tsx"]) {
  const source = read(file);
  check(`${file} : pas de dangerouslySetInnerHTML`, !source.includes("dangerouslySetInnerHTML"));
}

/* ── 6. Chemin de lecture : le navigateur ne lit pas la base ─────── */

const social = read("lib/social.ts");
check("lecture du fil : passe par le conteneur", social.includes("fetchFeedPageFromContainer"));
check("lecture du fil : adaptateur HTTP", social.includes("/api/feed/hydration"));

const feedRoute = read("app/api/feed/route.ts");
check("route /api/feed : compose le serveur", feedRoute.includes("getServerFeedRepository"));
check("route /api/feed : pas de client navigateur", !feedRoute.includes("@/lib/api/client"));

const hydrationRoute = read("app/api/feed/hydration/route.ts");
check("route hydratation : valide les identifiants", hydrationRoute.includes("readHydrationQuery"));
check("route hydratation : compose le serveur", hydrationRoute.includes("getServerFeedHydrationRepository"));

const container = read("platform/server-container.ts");
check("composition : fil PostgreSQL", container.includes("getServerFeedRepository"));
check("composition : hydratation PostgreSQL", container.includes("getServerFeedHydrationRepository"));
check("composition : pool jamais dans le navigateur", !read("platform/container.ts").includes("postgres/pool"));

/* ── 7. Stories : échéance en base, pas dans l'écran ─────────────── */

const stories = read("lib/stories.ts");
check("stories : TTL de 24 h exposé", stories.includes("STORY_HOURS = 24"));
check("stories : échéance lue en base", stories.includes("expires_at"));
const storyMigration = read("db/migrations/018_social_depth.sql");
check("stories : échéance en base (018)", storyMigration.includes("expires_at"));

/* ── 8. Documentation vivante ────────────────────────────────────── */

check("inventaire UI présent", read("docs/ui/inventory.md").length > 1000);
check("feuille de route UI présente", read("docs/ui/coverage.md").length > 100);

/* ── Bilan ───────────────────────────────────────────────────────── */

if (failures.length > 0) {
  console.error("\n✗ Norme d'expérience :");
  for (const failure of failures) console.error(`  · ${failure}`);
  console.error(`\n${passed} vérifications passées, ${failures.length} en échec.\n`);
  process.exitCode = 1;
} else {
  console.log(`✓ Norme d'expérience — ${passed} vérifications réussies.`);
}
