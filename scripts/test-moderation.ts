/**
 * Tests de la modération de texte.
 *
 * Le module est pur : aucun réseau, aucune base, aucune horloge. Ce que ces
 * tests protègent, c'est la propriété qui compte le plus — **ne pas bloquer
 * un mot légitime** — et celle qui compte tout autant — **reconnaître un
 * contournement**.
 */
import assert from "node:assert/strict";
import { moderateText, normalizeText } from "../lib/moderation/text";

let checks = 0;

function verdict(text: string): string {
  checks += 1;
  return moderateText(text).verdict;
}

function expectAllow(text: string): void {
  assert.equal(verdict(text), "allow", `« ${text} » ne doit pas être bloqué`);
}

function expectBlocked(text: string): void {
  assert.equal(verdict(text), "block", `« ${text} » doit être bloqué`);
}

function expectFlagged(text: string): void {
  assert.equal(verdict(text), "flag", `« ${text} » doit être mis en file`);
}

/* ── 1. Insultes directes ───────────────────────────────────── */
expectBlocked("espèce de connard");
expectBlocked("salope");
expectBlocked("espèce de débile");
expectBlocked("ferme ta gueule");
console.log("✓ 1. insultes directes bloquées");

/* ── 2. Contournements ──────────────────────────────────────── */
expectBlocked("c0nn4rd");
expectBlocked("c.o.n.n.a.r.d");
expectBlocked("connnnard");
expectBlocked("c o n n a r d");
assert.equal(normalizeText("C0NN4RD"), "connard", "la normalisation doit réduire le leetspeak");
checks += 1;
console.log("✓ 2. leetspeak, séparateurs et lettres répétées reconnus");

/* ── 3. Faux positifs interdits ─────────────────────────────── */
expectAllow("la connaissance et la députation");
expectAllow("un assassin dans mon roman");
expectAllow("Scunthorpe est une ville");
expectAllow("mon analyse de données");
expectAllow("ce passage est passionnant");
expectAllow("je cherche un stage en data science");
expectAllow("le colis a du retard");
expectAllow("commande cp sous Linux");
expectAllow("le haras élève des chevaux de race");
expectAllow("une salopette et un litre de bordeaux");
expectAllow("un match bordelais");
console.log("✓ 3. mots légitimes épargnés");

/* ── 4. Catégories graves ───────────────────────────────────── */
expectBlocked("nigger");
expectBlocked("je vais te tuer");
expectBlocked("pédopornographie");
console.log("✓ 4. haine, menaces et contenu sexuel bloqués");

/* ── 5. File de relecture ───────────────────────────────────── */
expectFlagged("crypto gratuit, doublez votre argent");
expectFlagged("je veux mourir");
const flagged = moderateText("investissement garanti et argent facile");
checks += 1;
assert.equal(flagged.severity, "warning");
assert.ok(flagged.matches.some((match) => match.category === "scam"));
console.log("✓ 5. arnaques et détresse signalées, pas supprimées");

/* ── 6. Un texte vide n'est pas un problème ─────────────────── */
expectAllow("");
expectAllow("   ");
console.log("✓ 6. texte vide accepté");

/* ── 7. La liste administrable suit la même normalisation ───── */
const custom = moderateText("zorglub", [
  { term: "Zörglüb", category: "custom", severity: "warning" },
]);
checks += 1;
assert.notEqual(custom.verdict, "allow", "un terme accentué doit matcher sans accent");
console.log("✓ 7. termes administrables normalisés");

console.log(`\n✓ modération de texte — ${checks} vérifications`);
