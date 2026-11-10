#!/usr/bin/env node
/**
 * motion-check — cohérence entre le code et `docs/ui/motion.md` (MO-06).
 *
 * Tout rôle de `Motion` et tout utilitaire `mo-*` doit être décrit dans le
 * catalogue, avec son but. Une animation qui n'y figure pas est une
 * animation dont personne ne sait pourquoi elle existe.
 */
import { readFileSync } from "node:fs";

const ROOT = process.cwd();
const doc = readFileSync(`${ROOT}/docs/ui/motion.md`, "utf8");
const motion = readFileSync(`${ROOT}/components/Motion.tsx`, "utf8");
const css = readFileSync(`${ROOT}/app/globals.css`, "utf8");

const roles = new Set(
  [...motion.matchAll(/^  \| "([a-z-]+)"/gm)].map((m) => m[1]),
);
const utilities = new Set(
  [...css.matchAll(/^@utility (mo-[a-z-]+)/gm)].map((m) => m[1]),
);

const missing = [];
for (const role of roles) {
  if (role === "none") continue;
  if (!doc.includes(`\`${role}\``)) missing.push(`rôle ${role}`);
}
for (const utility of utilities) {
  if (!doc.includes(`\`${utility}\``)) missing.push(`utilitaire ${utility}`);
}

if (missing.length > 0) {
  console.error(`motion-check : ${missing.length} animation(s) sans but documenté :`);
  for (const item of missing) console.error(`  - ${item}`);
  process.exit(1);
}

console.log(
  `motion-check : ${roles.size - 1} rôles et ${utilities.size} utilitaires documentés.`,
);
