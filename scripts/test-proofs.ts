/**
 * Tests du moteur de preuves et du rapprochement.
 *
 * Exécuter avec :  npx tsx scripts/test-proofs.ts
 *
 * Deux modules purs, donc testables sans navigateur ni base :
 *
 *  · `lib/proofs.ts` — empreinte, rejeu, réputation par langage, séries ;
 *  · `lib/match.ts`  — stades, rôles, compatibilité, filtres.
 *
 * Ce qui est vérifié ici est exactement ce que la base doit produire :
 * la **forme canonique** est un contrat entre le SQL (`023_proofs.sql`),
 * le TypeScript et le rejeu. Si elle bouge, ces tests tombent — c'est
 * leur rôle.
 */

import {
  PROOF_KINDS, PROOF_KIND_LIST, canonicalForm, fingerprintOf, kindBreakdown,
  makeProof, proofStreak, proofsForProject, proofsOf, replayAll, replayProof,
  reputationByLanguage, reputationSummary, reputationWeight,
  type Proof, type ProofKind,
} from "../lib/proofs";
import {
  ACTIVITY_FULL, EMPTY_FILTERS, LANGUAGE_CONFIDENT_WEIGHT, PROJECT_STAGES,
  SEEKING_ROLES, activeFilterCount, applyFilters, compatibility, isValidRole,
  roleLabel, sortByCompatibility, sourceWeight, stageRank, stageSpec, verdictFor,
  type Candidate, type FilterableProject, type ProjectDemand,
} from "../lib/match";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, { actual, expected });
}

function near(name: string, actual: number, expected: number, tol = 1e-9): void {
  check(name, Math.abs(actual - expected) <= tol, { actual, expected });
}

const ISO = "2026-10-09T12:00:00.000Z";
const USER = "11111111-1111-4111-8111-111111111111";
const PROJ = "22222222-2222-4222-8222-222222222222";

function proof(over: Partial<Proof> & { kind: ProofKind; id: string }): Proof {
  const base = {
    user_id: USER,
    language: "Rust",
    project_id: null,
    subject: `sujet:${over.id}`,
    summary: "un résumé",
    created_at: ISO,
  };
  const merged = { ...base, ...over };
  return { ...merged, fingerprint: fingerprintOf(merged) };
}

/* ------------------------------------------------------------------ */
/* 1. Empreinte et forme canonique                                     */
/* ------------------------------------------------------------------ */

function testFingerprint() {
  const form = canonicalForm({
    user_id: USER, kind: "commit", language: "Rust", project_id: null,
    subject: "commit:abc", summary: "fix", created_at: ISO,
  });

  eq("sept champs séparés par des retours à la ligne", form.split("\n").length, 7);
  eq("le premier champ est la nature", form.split("\n")[0], "commit");
  eq("un projet nul devient une chaîne vide", form.split("\n")[3], "");

  const fp = fingerprintOf({
    user_id: USER, kind: "commit", language: "Rust", project_id: null,
    subject: "commit:abc", summary: "fix", created_at: ISO,
  });
  eq("l'empreinte fait 40 caractères", fp.length, 40);
  check("l'empreinte est hexadécimale", /^[0-9a-f]{40}$/.test(fp), fp);
  eq("l'empreinte est déterministe", fp, fingerprintOf({
    user_id: USER, kind: "commit", language: "Rust", project_id: null,
    subject: "commit:abc", summary: "fix", created_at: ISO,
  }));

  // Chaque champ doit compter : sinon on pourrait modifier une preuve
  // sans que le rejeu s'en aperçoive.
  const variants: [string, Parameters<typeof fingerprintOf>[0]][] = [
    ["nature", { user_id: USER, kind: "github", language: "Rust", project_id: null, subject: "commit:abc", summary: "fix", created_at: ISO }],
    ["utilisateur", { user_id: "33333333-3333-4333-8333-333333333333", kind: "commit", language: "Rust", project_id: null, subject: "commit:abc", summary: "fix", created_at: ISO }],
    ["langage", { user_id: USER, kind: "commit", language: "Go", project_id: null, subject: "commit:abc", summary: "fix", created_at: ISO }],
    ["projet", { user_id: USER, kind: "commit", language: "Rust", project_id: PROJ, subject: "commit:abc", summary: "fix", created_at: ISO }],
    ["sujet", { user_id: USER, kind: "commit", language: "Rust", project_id: null, subject: "commit:def", summary: "fix", created_at: ISO }],
    ["résumé", { user_id: USER, kind: "commit", language: "Rust", project_id: null, subject: "commit:abc", summary: "autre", created_at: ISO }],
    ["date", { user_id: USER, kind: "commit", language: "Rust", project_id: null, subject: "commit:abc", summary: "fix", created_at: "2020-01-01T00:00:00.000Z" }],
  ];
  for (const [label, v] of variants) {
    check(`changer le champ « ${label} » change l'empreinte`, fingerprintOf(v) !== fp);
  }

  // `makeProof` calcule l'empreinte : elle ne peut pas être fournie.
  const made = makeProof({ id: "p1", user_id: USER, kind: "execution", subject: "run:1" });
  eq("makeProof calcule l'empreinte", made.fingerprint.length, 40);
  eq("langage par défaut vide", made.language, "");
  eq("projet par défaut nul", made.project_id, null);
  check("la date est renseignée", made.created_at.length > 0);
}

/* ------------------------------------------------------------------ */
/* 2. Rejeu                                                            */
/* ------------------------------------------------------------------ */

function testReplay() {
  const good = proof({ id: "a", kind: "commit" });
  check("une preuve intacte se rejoue", replayProof(good).ok);

  const tampered: Proof = { ...good, subject: "autre" };
  check("modifier une preuve casse le rejeu", !replayProof(tampered).ok);
  eq("l'empreinte recalculée est rendue", replayProof(tampered).recomputed.length, 40);

  const report = replayAll([good, tampered, proof({ id: "c", kind: "snippet" })]);
  eq("3 preuves examinées", report.total, 3);
  eq("2 vérifiées", report.verified, 2);
  eq("1 cassée", report.broken.length, 1);
  eq("le rapport n'est pas bon", report.allVerified, false);

  eq("un lot vide est vérifié", replayAll([]).allVerified, true);
  eq("un lot sain est vérifié", replayAll([good]).allVerified, true);
}

/* ------------------------------------------------------------------ */
/* 3. Barème                                                           */
/* ------------------------------------------------------------------ */

function testWeights() {
  eq("sept natures de preuve", PROOF_KIND_LIST.length, 7);
  check("l'ordre suit le poids décroissant", PROOF_KIND_LIST.every((k, i, list) =>
    i === 0 || PROOF_KINDS[list[i - 1]].weight >= PROOF_KINDS[k].weight));

  eq("aider vaut plus qu'écrire", PROOF_KINDS.review.weight > PROOF_KINDS.commit.weight, true);
  eq("exécuter est le seuil minimal", PROOF_KINDS.execution.weight, 1);
  check("chaque nature est documentée",
    PROOF_KIND_LIST.every((k) => PROOF_KINDS[k].label.length > 0 && PROOF_KINDS[k].certifies.length > 0));

  eq("le poids d'une source vient du barème", sourceWeight("correction_acceptee"), PROOF_KINDS.review.weight);
  eq("commit enregistré", sourceWeight("commit_enregistre"), PROOF_KINDS.commit.weight);
}

/* ------------------------------------------------------------------ */
/* 4. Réputation par langage                                           */
/* ------------------------------------------------------------------ */

function testReputation() {
  eq("aucune preuve → aucune réputation", reputationByLanguage([]).length, 0);

  const proofs: Proof[] = [
    proof({ id: "1", kind: "commit", language: "Rust" }),
    proof({ id: "2", kind: "commit", language: "Rust" }),
    proof({ id: "3", kind: "review", language: "Rust" }),
    proof({ id: "4", kind: "commit", language: "Go" }),
    proof({ id: "5", kind: "task", language: "" }),
  ];

  const rep = reputationByLanguage(proofs);
  eq("deux langages (le vide est ignoré)", rep.length, 2);
  eq("Rust en tête", rep[0].language, "Rust");
  eq("3 preuves Rust", rep[0].count, 3);
  eq("poids Rust = 5+5+8", rep[0].weight, 18);
  eq("poids Go = 5", rep[1].weight, 5);
  eq("Rust détaille ses natures", rep[0].kinds.length, 2);
  eq("le commit domine numériquement",
    rep[0].kinds.find((k) => k.kind === "commit")!.count, 2);

  eq("poids total", reputationWeight(proofs), 18 + 5 + 3);
  eq("détail par nature trié par poids",
    kindBreakdown(proofs)[0].kind, "review");

  eq("le résumé nomme les langages",
    reputationSummary(rep), "3 en Rust, 1 en Go");

  const many = reputationByLanguage(
    ["A", "B", "C", "D", "E"].map((l, i) =>
      [1, 2, 3, 4, 5].slice(0, 5 - i).map((n) =>
        proof({ id: `${l}${n}`, kind: "commit", language: l, subject: `${l}:${n}` }),
      ),
    ).flat(),
  );
  check("le résumé tronque proprement", reputationSummary(many, 2).includes("autres"), reputationSummary(many, 2));
  eq("aucune preuve → résumé explicite", reputationSummary([]), "aucune preuve encore");
}

/* ------------------------------------------------------------------ */
/* 5. Séries et filtres de preuves                                     */
/* ------------------------------------------------------------------ */

function testStreakAndFilters() {
  const days = ["2026-10-07", "2026-10-08", "2026-10-09"].map((d, i) =>
    proof({ id: `s${i}`, kind: "commit", subject: `s${i}`, created_at: `${d}T10:00:00.000Z` }),
  );
  eq("trois jours consécutifs", proofStreak(days, "2026-10-09"), 3);
  eq("la chaîne compte depuis hier si aujourd'hui est vide",
    proofStreak(days.slice(0, 2), "2026-10-09"), 2);
  eq("un trou casse la série",
    proofStreak([days[0], days[2]], "2026-10-09"), 1);
  eq("aucune preuve → série nulle", proofStreak([], "2026-10-09"), 0);
  eq("une preuve ancienne → série nulle",
    proofStreak([proof({ id: "v", kind: "commit", created_at: "2020-01-01T00:00:00.000Z" })], "2026-10-09"), 0);

  const other = proof({ id: "o", kind: "commit", user_id: "99999999-9999-4999-8999-999999999999" });
  eq("le filtre par utilisateur ne garde que lui", proofsOf([...days, other], USER).length, 3);
  eq("les plus récentes d'abord", proofsOf(days, USER)[0].created_at.slice(0, 10), "2026-10-09");

  const inProject = proof({ id: "pp", kind: "task", project_id: PROJ });
  eq("filtre par projet", proofsForProject([...days, inProject], PROJ).length, 1);
}

/* ------------------------------------------------------------------ */
/* 6. Stades et rôles                                                  */
/* ------------------------------------------------------------------ */

function testStages() {
  eq("cinq stades", PROJECT_STAGES.length, 5);
  eq("le premier est l'idée", PROJECT_STAGES[0].id, "idea");
  eq("rang de l'idée", stageRank("idea"), 0);
  eq("rang de la production", stageRank("production"), 3);
  eq("un stade inconnu retombe à 0", stageRank("zzz" as never), 0);
  eq("le stade est décrit", stageSpec("mvp").label, "MVP");
  eq("le stade inconnu retombe sur le premier", stageSpec("zzz" as never).id, "idea");

  eq("neuf rôles", SEEKING_ROLES.length, 9);
  check("les rôles sont uniques", new Set(SEEKING_ROLES.map((r) => r.id)).size === SEEKING_ROLES.length);
  eq("un rôle valide", isValidRole("backend"), true);
  eq("un rôle inconnu", isValidRole("astronaute"), false);
  eq("le rôle est traduit", roleLabel("qualite"), "Qualité");
  eq("un rôle inconnu s'affiche tel quel", roleLabel("astronaute"), "astronaute");
}

/* ------------------------------------------------------------------ */
/* 7. Compatibilité                                                    */
/* ------------------------------------------------------------------ */

const DEMAND: ProjectDemand = {
  stage: "mvp",
  languages: ["Rust", "Go"],
  roles: ["backend"],
  seeking: true,
};

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    reputation: [], languages: [], totalProofs: 0, roles: [], hasBio: false,
    ...over,
  };
}

function testCompatibility() {
  // Un projet qui ne cherche personne : personne n'y est incompatible.
  const closed = compatibility(candidate(), { ...DEMAND, seeking: false });
  eq("projet fermé : 100", closed.score, 100);
  eq("projet fermé : verdict clair", closed.verdict.label, "ouvert à tous");

  // Profil idéal : les deux langages au niveau « acquis », beaucoup de
  // preuves, le bon rôle, une bio.
  const ideal = compatibility(candidate({
    reputation: [
      { language: "Rust", weight: LANGUAGE_CONFIDENT_WEIGHT },
      { language: "Go", weight: LANGUAGE_CONFIDENT_WEIGHT + 20 },
    ],
    languages: ["Rust", "Go"],
    totalProofs: ACTIVITY_FULL,
    roles: ["backend"],
    hasBio: true,
  }), DEMAND);
  eq("profil idéal : 100", ideal.score, 100);
  eq("profil idéal : verdict", ideal.verdict.label, "très compatible");
  eq("les trois parts valent 1", ideal.parts.language === 1 && ideal.parts.activity === 1 && ideal.parts.identity === 1, true);

  // Un seul langage prouvé sur deux : la part technique est divisée.
  const half = compatibility(candidate({
    reputation: [{ language: "Rust", weight: 10 }],
    languages: ["Rust"],
    totalProofs: 5,
  }), DEMAND);
  near("langage : 1 sur 2 demandés", half.parts.language, 0.5);
  near("activité : 5 sur 30", half.parts.activity, 5 / 30);
  near("identité : langages déclarés seulement", half.parts.identity, 0.3);
  near("score composé", half.score, Math.round(100 * (0.55 * 0.5 + 0.3 * (5 / 30) + 0.15 * 0.3)));
  eq("le verdict suit le score", half.verdict.label, verdictFor(half.score).label);

  // Profil vide : incompatible, et on le dit sans détour.
  const none = compatibility(candidate(), DEMAND);
  eq("profil vide : 0", none.score, 0);
  eq("profil vide : verdict", none.verdict.tone, "danger");

  // La présence ne suffit pas : mieux vaut 5 preuves que 1 sur le même langage.
  const one = compatibility(candidate({ reputation: [{ language: "Rust", weight: 5 }, { language: "Go", weight: 5 }] }), DEMAND);
  const ten = compatibility(candidate({ reputation: [{ language: "Rust", weight: 10 }, { language: "Go", weight: 10 }] }), DEMAND);
  check("le poids des preuves fait la différence", ten.parts.language > one.parts.language, {
    un: one.parts.language, dix: ten.parts.language,
  });

  // Aucune contrainte technique déclarée : la part langage est acquise.
  const noLang = compatibility(candidate({ totalProofs: 30 }), { ...DEMAND, languages: [] });
  eq("aucun langage demandé : part technique pleine", noLang.parts.language, 1);

  // Les bornes tiennent même avec des valeurs absurdes.
  const wild = compatibility(candidate({
    reputation: [{ language: "Rust", weight: 1e6 }],
    totalProofs: 1e6,
    languages: ["a", "b"],
    roles: ["backend"],
    hasBio: true,
  }), DEMAND);
  check("le score reste dans 0…100", wild.score >= 0 && wild.score <= 100, wild.score);

  // Le seuil est bien celui du barème.
  const atThreshold = compatibility(candidate({ reputation: [{ language: "Rust", weight: LANGUAGE_CONFIDENT_WEIGHT }] }), { ...DEMAND, languages: ["Rust"], roles: [] });
  eq("poids exactement au seuil : part pleine", atThreshold.parts.language, 1);
}

/* ------------------------------------------------------------------ */
/* 8. Filtres et tri                                                   */
/* ------------------------------------------------------------------ */

const A: FilterableProject = { language: "Rust", stage: "production", seeking: true, demandLanguages: ["Go"], demandRoles: ["backend"] };
const B: FilterableProject = { language: "Go", stage: "prototype", seeking: false, demandLanguages: [], demandRoles: [] };
const C: FilterableProject = { language: "TypeScript", stage: "idea", seeking: true, demandLanguages: ["Rust"], demandRoles: ["frontend"] };
const ALL = [A, B, C];

function testFilters() {
  eq("aucun filtre : tout passe", applyFilters(ALL, EMPTY_FILTERS).length, 3);
  eq("aucun filtre actif", activeFilterCount(EMPTY_FILTERS), 0);

  // « Rust » montre le projet écrit en Rust **et** celui qui recrute en Rust.
  const rust = applyFilters(ALL, { ...EMPTY_FILTERS, language: "Rust" });
  eq("deux résultats pour Rust", rust.length, 2);
  eq("le projet Go est exclu", rust.includes(B), false);
  eq("insensible à la casse", applyFilters(ALL, { ...EMPTY_FILTERS, language: "rust" }).length, 2);

  // Le stade est un seuil, pas une égalité.
  const proto = applyFilters(ALL, { ...EMPTY_FILTERS, stage: "prototype" });
  eq("prototype et au-delà", proto.length, 2);
  eq("l'idée est exclue", proto.includes(C), false);
  eq("tout depuis une idée", applyFilters(ALL, { ...EMPTY_FILTERS, stage: "idea" }).length, 3);

  eq("filtre par rôle", applyFilters(ALL, { ...EMPTY_FILTERS, role: "backend" }).length, 1);
  eq("filtre « recrute »", applyFilters(ALL, { ...EMPTY_FILTERS, seekingOnly: true }).length, 2);

  const combined = applyFilters(ALL, { ...EMPTY_FILTERS, language: "Rust", seekingOnly: true, role: "backend" });
  eq("filtres combinés", combined.length, 1);
  eq("c'est bien le projet A", combined[0], A);
  eq("trois filtres actifs", activeFilterCount({ ...EMPTY_FILTERS, language: "Rust", seekingOnly: true, role: "backend" }), 3);
  eq("aucun résultat possible", applyFilters(ALL, { ...EMPTY_FILTERS, language: "COBOL" }).length, 0);

  const sorted = sortByCompatibility(
    [{ n: "a", s: 50 }, { n: "b", s: 90 }, { n: "c", s: 50 }],
    (x) => x.s,
    (x) => x.n,
  );
  eq("le tri décroche", sorted[0].n, "b");
  eq("l'égalité est départagée par le nom", sorted[1].n, "a");
}

/* ------------------------------------------------------------------ */

function main() {
  testFingerprint();
  testReplay();
  testWeights();
  testReputation();
  testStreakAndFilters();
  testStages();
  testCompatibility();
  testFilters();

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ Les preuves se calculent, se rejouent et se mesurent\n");
}

main();
