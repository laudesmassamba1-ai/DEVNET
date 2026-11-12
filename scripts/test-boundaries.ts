/**
 * Test des frontières — les règles de couches, vérifiées au lieu d'être
 * seulement écrites.
 *
 * Exécuter avec :  npx tsx scripts/test-boundaries.ts
 *
 * Une architecture en couches qui n'est pas vérifiée ne survit pas à trois
 * semaines de livraison : un import de confort suffit à faire entrer un
 * adaptateur dans un composant, et plus rien ne le signale — le build passe,
 * l'écran marche, et la frontière est morte.
 *
 * Ce script lit le code, il ne l'exécute pas. Il vérifie trois choses :
 *
 *  1. **Aucune dépendance SDK externe.** Plus aucun fichier n'importe
 *     `@api/*` : le client maison est l'unique porte.
 *  2. **L'UI ne connaît pas les adaptateurs.** Une page ou un composant ne
 *     doit jamais importer `modules/*\/infrastructure` : il passerait
 *     au-dessus du port, donc au-dessus du contrat testable.
 *  3. **Les modules ne regardent pas en arrière.** Un module n'importe ni
 *     `@/app`, ni `@/components`, ni un autre module par son infrastructure.
 *
 * Ce que ce test ne fait pas : il ne juge pas la qualité d'un import
 * autorisé. Il fixe la frontière, pas le style.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative } from "node:path";

const ROOT = process.cwd();

/** Le SDK externe a été retiré : plus aucune exception. */
const SDK_ALLOWED = new Set<string>();

/** Dossiers lus : le produit. Scripts et documentation sont hors périmètre. */
const SOURCE_DIRS = ["app", "components", "hooks", "lib", "modules", "platform", "plugins", "shared"];

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    return;
  }
  failures.push(`${name}${detail ? ` → ${detail}` : ""}`);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const files = SOURCE_DIRS.flatMap(walk);

/** Un import nu, sans commentaire de doc trompeur : on lit la ligne réelle. */
function imports(file: string): string[] {
  const text = readFileSync(join(ROOT, file), "utf8");
  return [...text.matchAll(/(?:from\s+|import\s*\()["']([^"']+)["']/g)].map(
    (m) => m[1],
  );
}

// ── 1. La porte unique vers le fournisseur ────────────────────────────────
const sdkUsers = files.filter((file) =>
  imports(file).some((spec) => spec.startsWith("@api/")),
);

for (const file of sdkUsers) {
  check(
    `accès SDK direct autorisé : ${file}`,
    SDK_ALLOWED.has(relative(ROOT, join(ROOT, file))),
    "le SDK externe est interdit",
  );
}
check(
  "aucun accès SDK externe",
  sdkUsers.length === 0,
  `${sdkUsers.length} fichiers importent le SDK`,
);

// ── 1bis. Les façades portées ne parlent plus au client maison ────────────
//
// Une façade qui garderait ses requêtes rendrait le port décoratif : le
// domaine existerait à côté du code réel, et le prochain appelant écrirait
// dans la façade. On vérifie donc qu'elles ont bien perdu leur accès direct.
const PORTED_FACADES = ["lib/messages.ts", "lib/reports.ts"];

for (const file of PORTED_FACADES) {
  const legacyClient = imports(file).filter(
    (spec) => spec === "@/lib/api/client",
  );
  check(
    `façade portée sans client direct : ${file}`,
    legacyClient.length === 0,
    "la façade porte encore des requêtes",
  );
}

// ── 2. L'UI passe par les ports, jamais par l'infrastructure ──────────────
const uiFiles = files.filter((f) => f.startsWith("app/") || f.startsWith("components/"));

for (const file of uiFiles) {
  const deep = imports(file).filter(
    (spec) =>
      spec.includes("modules/") &&
      (spec.includes("/infrastructure/") || spec.includes("/application/")),
  );
  check(
    `UI sans accès aux adaptateurs : ${file}`,
    deep.length === 0,
    deep.join(", "),
  );
}

// ── 3. Les modules ne dépendent ni de l'app, ni des composants ────────────
const moduleFiles = files.filter((f) => f.startsWith("modules/") || f.startsWith("platform/"));

for (const file of moduleFiles) {
  const back = imports(file).filter(
    (spec) =>
      spec.startsWith("@/app") ||
      spec.startsWith("@/components") ||
      spec.startsWith("@/platform"),
  );
  check(
    `module sans retour vers l'UI : ${file}`,
    back.length === 0,
    back.join(", "),
  );
}

// ── 3bis. Un plugin ne parle qu'au SDK ────────────────────────────────────
//
// Un plugin est du code de confiance, mais sa **surface** reste étroite : il
// n'importe ni l'intérieur d'un module, ni un adaptateur, ni l'UI du cœur. Le
// SDK est sa seule porte vers le reste.
const pluginFiles = files.filter((f) => f.startsWith("plugins/"));

for (const file of pluginFiles) {
  const pluginRoot = file.split("/").slice(0, 2).join("/");
  for (const spec of imports(file)) {
    if (spec === "@devnet/plugin-sdk") continue;
    if (spec.startsWith(".")) {
      const resolved = posix.normalize(posix.join(posix.dirname(file), spec));
      check(
        `plugin sans sortie de son dossier : ${file}`,
        resolved === pluginRoot || resolved.startsWith(`${pluginRoot}/`),
        spec,
      );
      continue;
    }
    check(
      `plugin importe uniquement le SDK : ${file}`,
      false,
      spec,
    );
  }
}

// ── 3ter. Le SDK reste indépendant de tout fournisseur ────────────────────
const sdkFiles = files.filter((f) => f.startsWith("shared/plugin-sdk/"));

for (const file of sdkFiles) {
  const external = imports(file).filter(
    (spec) =>
      spec.startsWith("@/")
      || spec.startsWith("@api/")
      || spec === "pg"
      || spec.startsWith("@vercel/")
      || spec.startsWith("next/"),
  );
  check(
    `SDK sans dépendance fournisseur : ${file}`,
    external.length === 0,
    external.join(", "),
  );
}

// ── 3quater. Le driver PostgreSQL reste dans l'infrastructure ─────────────
const pgUsers = files.filter((file) =>
  imports(file).some((spec) => spec === "pg" || spec.startsWith("pg/")),
);

for (const file of pgUsers) {
  check(
    `pg confiné à l'infrastructure : ${file}`,
    file.includes("/infrastructure/"),
    "import de pg hors infrastructure",
  );
}

// ── 4. Le conteneur est le seul à composer un adaptateur concret ──────────
const COMPOSERS = new Set([
  "platform/auth-container.ts",
  "platform/container.ts",
  "platform/server-container.ts",
]);
const composers = files.filter((file) =>
  imports(file).some(
    (spec) =>
      /modules\/[^/]+\/infrastructure\//.test(spec) &&
      !file.startsWith("modules/") &&
      !COMPOSERS.has(file),
  ),
);

for (const file of composers) {
  check(
    `composition centralisée : ${file}`,
    false,
    "un adaptateur est instancié hors de platform/container.ts",
  );
}

// ── 4bis. Le conteneur serveur n'entre jamais dans le bundle client ────────
const serverContainerUsers = files.filter((file) =>
  imports(file).includes("@/platform/server-container"),
);

for (const file of serverContainerUsers) {
  check(
    `conteneur serveur réservé aux routes : ${file}`,
    file.startsWith("app/api/") || file.startsWith("lib/server/"),
    "import depuis une page, un composant ou un hook",
  );
}

if (failures.length > 0) {
  console.error("\n✗ Frontières cassées :");
  for (const failure of failures) console.error(`  · ${failure}`);
  console.error(`\n${passed} vérifications passées, ${failures.length} en échec.\n`);
  process.exit(1);
}

console.log(`✓ Frontières tenues — ${passed} vérifications.`);
