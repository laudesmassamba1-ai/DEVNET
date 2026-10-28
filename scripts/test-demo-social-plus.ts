/**
 * Tests du miroir démo pour le fork et la notation par les pairs
 * (`lib/demo/*`, tables `project_forks` et `project_ratings`).
 *
 * Exécuter avec :  npx tsx scripts/test-demo-social-plus.ts
 *
 * Ce que la 025 a ajouté au backend local doit se comporter comme la
 * base : clé (projet, votant) unique, racine de l'arbre déduite à
 * l'insertion, preuve `fork` dérivée au rejeu, cascade sur suppression
 * de projet. Ce sont quatre invariants — le seed ne les fournit pas,
 * donc tout provient du moteur démo lui-même.
 */

import { demoFrom } from "../lib/demo/query";
import { getStore, resetStore, save } from "../lib/demo/store";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, { actual, expected });
}

resetStore();

interface Rowish { [k: string]: unknown }

async function main(): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* 1. Notation : une voix par votant                                 */
  /* ---------------------------------------------------------------- */

  const v1 = await demoFrom("project_ratings").insert({
    project_id: "p-1", voter_id: "u-koffi", stars: 4, voter_lang: "Python",
  });
  check("un vote s'insère", !v1.error, v1.error?.message);

  const dupe = await demoFrom("project_ratings").insert({
    project_id: "p-1", voter_id: "u-koffi", stars: 5, voter_lang: "Python",
  });
  check("doublon refusé (duplicate key)", dupe.error?.message.includes("duplicate key") === true, dupe.error?.message);

  const autre = await demoFrom("project_ratings").insert({
    project_id: "p-1", voter_id: "u-aminata", stars: 5, voter_lang: "Rust",
  });
  check("un autre votant passe", !autre.error, autre.error?.message);

  const lus = await demoFrom("project_ratings")
    .select("stars, voter_lang")
    .eq("project_id", "p-1");
  eq("deux lignes lues", lus.data?.length, 2);

  // upsert : changer d'avis est légitime, une nouvelle ligne ne l'est pas
  const maj = await demoFrom("project_ratings").upsert(
    { project_id: "p-1", voter_id: "u-koffi", stars: 3, voter_lang: "Python" },
    { onConflict: "project_id,voter_id" },
  );
  check("upsert remplace le vote", !maj.error, maj.error?.message);
  const relus = await demoFrom("project_ratings").eq("project_id", "p-1").select("stars, voter_id");
  const koffi = (relus.data as Rowish[]).find((r) => r.voter_id === "u-koffi");
  eq("le vote remis vaut 3", koffi?.stars, 3);
  eq("toujours deux votes", relus.data?.length, 2);

  /* ---------------------------------------------------------------- */
  /* 2. Fork : racine déduite, preuve dérivée                          */
  /* ---------------------------------------------------------------- */

  const fork1 = await demoFrom("project_forks").insert({
    fork_id: "p-9", source_id: "p-1", forked_by: "u-thabo",
  });
  check("fork direct inséré", !fork1.error, fork1.error?.message);
  const row1 = (fork1.data as Rowish[])[0];
  eq("root = source quand la source n'est pas un fork", row1?.root_project_id, "p-1");
  eq("branche par défaut", row1?.source_branch, "main");

  // Un fork du fork : la racine est le sommet, pas le parent.
  await demoFrom("project_forks").insert({
    fork_id: "p-10", source_id: "p-9", forked_by: "u-chioma",
    root_project_id: "p-1",
  });
  const proof = getStore().proofs.find(
    (p) => p.kind === "fork" && p.subject === "fork:p-10",
  );
  check("preuve fork dérivée au rejeu", proof !== undefined);

  // Une rejeu idempotent : reset du cache sans recréer les lignes.
  save(getStore());
  const proofsFork = getStore().proofs.filter((p) => p.kind === "fork");
  eq("rejeu idempotent — un fork = une preuve", proofsFork.length, 2);

  /* ---------------------------------------------------------------- */
  /* 3. Cascade : supprimer la source emporte les forks                */
  /* ---------------------------------------------------------------- */

  await demoFrom("projects").delete().eq("id", "p-1");
  const children = await demoFrom("project_forks").select("fork_id").in("source_id", ["p-1"]);
  eq("cascade sur project_forks.source_id", children.data?.length, 0);
  const notes = await demoFrom("project_ratings").select("stars").eq("project_id", "p-1");
  eq("cascade sur project_ratings", notes.data?.length, 0);

  /* ---------------------------------------------------------------- */
  /* Bilan                                                             */
  /* ---------------------------------------------------------------- */

  console.log(`${passed} vérification(s) passée(s), ${failures.length} échec(s)`);
  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  }
  resetStore();
}

void main();
