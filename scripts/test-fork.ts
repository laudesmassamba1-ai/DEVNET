/**
 * Tests du moteur de fork (`lib/fork.ts`).
 *
 * Exécuter avec :  npx tsx scripts/test-fork.ts
 *
 * Le fork lui-même exige un backend — ici on teste ce qui est **pur ou
 * vérifiable sans base** : la numérotation des noms, le genre de preuve,
 * le barème, et le schéma SQL (025) par lecture du fichier — le contrat
 * des tables doit rester en phase avec le code TypeScript.
 */

import { FORK_SUFFIX, forkName } from "../lib/fork";
import { PROOF_KINDS } from "../lib/proofs";
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, { actual, expected });
}

/* ------------------------------------------------------------------ */
/* 1. Noms de fork                                                    */
/* ------------------------------------------------------------------ */

eq("nom de fork = source + suffixe", forkName("MonProjet", () => false), `MonProjet ${FORK_SUFFIX}`);
check("suffixe est « (greffe) »", FORK_SUFFIX === "(greffe)");
check("nom pris → numéroté", forkName("X", (n) => n === "X (greffe)") === "X (greffe) 2", forkName("X", (n) => n === "X (greffe)"));
check("nom déjà numéroté → suivant", forkName("X", (n) => n.startsWith("X (greffe)") && n.length < 12) !== "X (greffe)", true);
check("tout pris → fallback horodaté unique", (() => {
  const fallback = forkName("Y", () => true);
  return fallback.includes("Y (greffe)") && fallback !== "Y (greffe) 2";
})());
check("nom vide protégé par le trim_source", forkName("   X  ", () => false) === "X (greffe)");

/* ------------------------------------------------------------------ */
/* 2. Preuve de fork                                                  */
/* ------------------------------------------------------------------ */

check("fork est un kind de preuve", "fork" in PROOF_KINDS, Object.keys(PROOF_KINDS));
check("poids du fork entre snippet et commit", PROOF_KINDS.fork.weight > 2 && PROOF_KINDS.fork.weight < 5, PROOF_KINDS.fork.weight);
check("icône du fork = fork", PROOF_KINDS.fork.icon === "fork");

/* ------------------------------------------------------------------ */
/* 3. Le contrat SQL (025_forks.sql)                                  */
/* ------------------------------------------------------------------ */

const sql = readFileSync(new URL("../supabase/025_forks.sql", import.meta.url), "utf8");
check("la table project_forks existe", sql.includes("create table if not exists public.project_forks"));
check("fork_id unique", sql.includes("fork_id         uuid not null unique"));
check("RLS activé", sql.includes("enable row level security"));
check("lecture publique", sql.includes('create policy "forks_read" on public.project_forks'));
check("écriture réservée au forkage", sql.includes("auth.uid() = forked_by"));
check("la preuve de fork passée dans les kinds SQL", sql.includes("'fork'"));
check(".projects.forked_from existe", sql.includes("add column if not exists forked_from"));
check("racine = root_project_id", sql.includes("root_project_id"));

/* ------------------------------------------------------------------ */
/* Bilan                                                              */
/* ------------------------------------------------------------------ */

console.log(`${passed} vérification(s) passée(s), ${failures.length} échec(s)`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
