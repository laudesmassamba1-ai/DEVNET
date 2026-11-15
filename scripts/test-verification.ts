/**
 * Tests de la vérification — le badge, la demande et la file.
 *
 * Exécuter avec :  npx tsx scripts/test-verification.ts
 *
 * Deux moitiés, comme dans `test-repo.ts` :
 *
 *  1. le module pur `lib/verification.ts` — les onze formes du badge,
 *     leur calage sur `LEVELS`, les bornes, les états ;
 *  2. le flux réel — la demande, la file, la décision — rejoué sur le
 *     backend de démonstration, **avec les garde-fous de la migration
 *     037** : ce qui échoue en production doit échouer ici, et pour la
 *     même raison.
 */

import { resetStore, getStore } from "../lib/demo/store";
import { demoFrom } from "../lib/demo/query";
import { saveSessionId } from "../lib/demo/session";
import { updateProfile } from "../lib/api/profile";
import { LEVELS, levelFor } from "../lib/gamification";
import {
  ALL_VERIFY_BADGES, VERIFY_BASE, VERIFY_TIERS, VERIFY_STATUS_LABEL,
  asVerificationStatus, badgeFor, badgeForLevel, badgeForXp,
  VERIFY_OFFICIAL,
  verificationErrorMessage,
} from "../lib/verification";
import { DEMO_ADMINS, DEMO_USERS } from "../lib/demo/data";
import {
  decideVerification,
  fetchVerificationQueue,
  requestVerification,
  revokeVerification,
  withdrawVerification,
} from "../lib/verification-data";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
  } else {
    failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, { actual, expected });
}

/** Attend un échec — et dit clairement quand l'écriture passe sans bruit. */
async function expectThrow(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    check(name, false, "aucune erreur levée");
  } catch {
    check(name, true);
  }
}

/* ------------------------------------------------------------------ */
/* 1. Les onze formes du badge                                        */
/* ------------------------------------------------------------------ */

function testShapes() {
  eq("11 formes au total (base + 10 paliers)", ALL_VERIFY_BADGES.length, 11);
  eq("le cache de base porte l'index 0", VERIFY_BASE.index, 0);
  eq("le cache de base est de forme ronde", VERIFY_BASE.shape, "round");
  eq("le cache de base porte le sceau check", VERIFY_BASE.icon, "check");
  eq("10 variantes de palier", VERIFY_TIERS.length, 10);

  // Les titres viennent de LEVELS : c'est la promesse du module, et la
  // seule chose qu'un renommage de palier doit pouvoir casser.
  VERIFY_TIERS.forEach((tier, i) => {
    eq(`palier ${i + 1} = niveau ${i + 1}`, tier.index, i + 1);
    eq(`palier ${i + 1} reprend le titre de LEVELS`, tier.label, LEVELS[i].title);
    eq(`palier ${i + 1} reprend le motto de LEVELS`, tier.motto, LEVELS[i].motto);
  });

  // La citation du docstring : « Bâtisseur » au 5, « Ambassadeur » au 9.
  eq("palier 5 = Bâtisseur", VERIFY_TIERS[4].label, "Bâtisseur");
  eq("palier 9 = Ambassadeur", VERIFY_TIERS[8].label, "Ambassadeur");
  eq("palier 10 = Légende", VERIFY_TIERS[9].label, "Légende");

  // Étiquettes et clés : jamais deux badges qui se ressemblent.
  const labels = ALL_VERIFY_BADGES.map((b) => b.label);
  eq("11 étiquettes distinctes", new Set(labels).size, 11);

  const keys = ALL_VERIFY_BADGES.map((b) => b.key);
  eq("11 clés distinctes", new Set(keys).size, 11);
  check(
    "clés ASCII (elles servent de nom de classe CSS)",
    keys.every((k) => /^[a-z0-9-]+$/.test(k)),
    keys,
  );

  // Dix icônes différentes : c'est ce qui distingue deux badges de même
  // taille dans un fil, avant même la couleur.
  const icons = VERIFY_TIERS.map((b) => b.icon);
  eq("10 emblèmes distincts", new Set(icons).size, 10);

  // La silhouette est la marque du palier : deux cachets de même taille
  // dans un fil se confondent par la teinte, jamais par la découpe.
  const shapes = ALL_VERIFY_BADGES.map((b) => b.shape);
  eq("11 silhouettes distinctes", new Set(shapes).size, 11);
  check(
    "silhouettes ASCII (elles servent de nom de classe CSS)",
    shapes.every((s) => /^[a-z0-9]+$/.test(s)),
    shapes,
  );
  eq("le cachet de base est rond", VERIFY_BASE.shape, "round");
  eq("la Légende porte le sceau", VERIFY_TIERS[9].shape, "seal");
  eq("le Gardien porte le bouclier", VERIFY_TIERS[7].shape, "shield");
}

/* ------------------------------------------------------------------ */
/* 2. Bornes                                                           */
/* ------------------------------------------------------------------ */

function testBounds() {
  eq("palier 0 borné à 1", badgeForLevel(0).index, 1);
  eq("palier 99 borné à 10", badgeForLevel(99).index, 10);
  eq("palier NaN borné à 1", badgeForLevel(Number.NaN).index, 1);
  eq("palier 5 exact", badgeForLevel(5).index, 5);

  eq("0 XP → palier 1", badgeForXp(0).index, 1);
  eq("XP max → palier 10", badgeForXp(10 ** 12).index, 10);
  eq("XP négatif → palier 1", badgeForXp(-1).index, 1);

  // L'XP et le palier se lisent à la même table : un badge qui suivrait
  // une autre règle affirmerait un palier que le profil dément.
  const xp = LEVELS[6].min;
  eq(
    "badgeForXp et levelFor partagent le palier",
    badgeForXp(xp).index,
    levelFor(xp).level,
  );

  // Monotonie : plus d'XP, jamais un palier moins élevé.
  let previous = 0;
  let monotone = true;
  for (const lvl of LEVELS) {
    const index = badgeForXp(lvl.min).index;
    if (index < previous) monotone = false;
    previous = index;
  }
  check("l'XP croissant ne descend jamais de palier", monotone);
}

/* ------------------------------------------------------------------ */
/* 3. Le badge d'un compte                                             */
/* ------------------------------------------------------------------ */

function testBadgeFor() {
  eq("profil absent → rien", badgeFor(null), null);
  eq("non vérifié → rien", badgeFor({ verified: false }, 10 ** 12), null);
  eq("sans champ verified → rien", badgeFor({}), null);

  eq("vérifié sans XP → palier 1", badgeFor({ verified: true }, 0)?.index, 1);

  // L'administrateur garde son palier : le remplacer par le cachet de
  // base recouvrait le sceau d'un compte de Légende. La distinction
  // officielle est l'anneau (`admin`), pas un cachet de substitution.
  const legendAdmin = badgeFor({ verified: true, is_admin: true }, 10 ** 6);
  eq("administrateur de haut palier → son palier", legendAdmin?.index, 10);
  eq("…avec le sceau de Légende", legendAdmin?.shape, "seal");
  eq("…et l'anneau officiel", legendAdmin?.admin, true);
  eq(
    "administrateur sans XP → palier 1, pas le cachet de base",
    badgeFor({ verified: true, is_admin: true }, 0)?.index,
    1,
  );
  eq(
    "un membre n'a jamais l'anneau",
    badgeFor({ verified: true }, 10 ** 6)?.admin,
    undefined,
  );
  check(
    "le cachet de base ne sort plus de `badgeFor`",
    [0, 10, 1000, 10 ** 6].every((xp) => badgeFor({ verified: true }, xp)?.index !== 0),
  );

  // Les écrans d'administration, eux, n'ont pas l'XP sous la main : ils
  // affichent le rond de base, anneau compris.
  eq("le cachet officiel est le rond de base", VERIFY_OFFICIAL.shape, "round");
  eq("…et il porte l'anneau", VERIFY_OFFICIAL.admin, true);
  eq("le cachet de base, lui, n'a pas d'anneau", VERIFY_BASE.admin, undefined);
  check(
    "aucun palier ne porte l'étiquette du cachet de base",
    VERIFY_TIERS.every((t) => t.label !== VERIFY_BASE.label),
  );
}

/* ------------------------------------------------------------------ */
/* 4. Les états de demande                                             */
/* ------------------------------------------------------------------ */

function testStatuses() {
  eq("attente conserve", asVerificationStatus("attente"), "attente");
  eq("acceptée conserve", asVerificationStatus("acceptee"), "acceptee");
  eq("refusée conserve", asVerificationStatus("refusee"), "refusee");

  eq("null → none", asVerificationStatus(null), "none");
  eq("undefined → none", asVerificationStatus(undefined), "none");
  eq("chaîne vide → none", asVerificationStatus(""), "none");
  eq("valeur inconnue → none", asVerificationStatus("valide"), "none");

  const labels = Object.values(VERIFY_STATUS_LABEL);
  eq("4 libellés", labels.length, 4);
  eq("4 libellés distincts", new Set(labels).size, 4);
  check(
    "tous les libellés sont affichables",
    labels.every((l) => l.length > 0),
    labels,
  );
}

/* ------------------------------------------------------------------ */
/* 5. Les comptes de démonstration                                     */
/* ------------------------------------------------------------------ */

function testDemoAccounts() {
  eq("cinq comptes d'administration", DEMO_ADMINS.length, 5);
  eq(
    "cinq identifiants distincts",
    new Set(DEMO_ADMINS.map((a) => a.id)).size,
    5,
  );
  check(
    "tous administrateurs, vérifiés, statut acceptee",
    DEMO_ADMINS.every(
      (a) => a.is_admin === true && a.verified === true && a.verification_status === "acceptee",
    ),
  );

  // Un compte vérifié dont la file dirait « non vérifiée » afficherait
  // deux vérités différentes sur le même écran.
  const incoherent = DEMO_USERS.filter(
    (u) => u.verified === true && u.verification_status !== "acceptee",
  );
  check("aucun vérifié sans statut acceptee", incoherent.length === 0, incoherent);

  // La file n'est jamais vide à la démonstration, et l'état refusé s'y
  // voit aussi — les deux états que l'écran sait montrer.
  eq(
    "au moins une demande en attente",
    DEMO_USERS.filter((u) => u.verification_status === "attente").length >= 1,
    true,
  );
  eq(
    "au moins un dossier refusé",
    DEMO_USERS.filter((u) => u.verification_status === "refusee").length >= 1,
    true,
  );

  check(
    "aucun administrateur ne demande la vérification",
    DEMO_ADMINS.every((a) => a.verification_status !== "attente"),
  );
}

/* ------------------------------------------------------------------ */
/* 6. Le garde-fou de la migration 037, rejoué                          */
/* ------------------------------------------------------------------ */

async function testColumnGuard() {
  resetStore();

  // --- le compte lui-même ne se vérifie jamais ---
  saveSessionId("u-koffi");

  const selfVerified = await demoFrom("users")
    .update({ verified: true })
    .eq("id", "u-koffi");
  check(
    "un compte ne peut pas écrire verified sur sa propre ligne",
    selfVerified.error !== null,
    selfVerified.error,
  );
  // Le rejeu doit dire **exactement** ce que Postgres dirait : un message
  // différent en démo et en production ferait chercher au mauvais endroit.
  check(
    "…avec le message du déclencheur SQL",
    String(selfVerified.error?.message ?? "").includes('column "verified" (42501)'),
    selfVerified.error,
  );
  eq(
    "…et la colonne n'a pas bougé",
    getStore().users.find((u) => u.id === "u-koffi")?.verified,
    false,
  );

  const selfStatus = await demoFrom("users")
    .update({ verification_status: "acceptee" })
    .eq("id", "u-koffi");
  check(
    "un compte ne peut pas se déclarer accepté",
    selfStatus.error !== null,
    selfStatus.error,
  );
  check(
    "…avec le message du déclencheur SQL",
    String(selfStatus.error?.message ?? "").includes('"verification_status" (42501)'),
    selfStatus.error,
  );

  const selfAdmin = await demoFrom("users")
    .update({ is_admin: true })
    .eq("id", "u-koffi");
  check(
    "un compte ne peut pas se nommer administrateur",
    selfAdmin.error !== null,
    selfAdmin.error,
  );
  check(
    "…avec le message du déclencheur SQL",
    String(selfAdmin.error?.message ?? "").includes('column "is_admin" (42501)'),
    selfAdmin.error,
  );

  // Les deux états de demande restent à portée : ils ne sont qu'une
  // demande, pas une décision.
  const ask = await demoFrom("users")
    .update({ verification_status: "attente", verification_note: "nom réel" })
    .eq("id", "u-koffi");
  eq("un compte peut déposer sa demande", ask.error, null);
  eq(
    "…qui est bien en attente",
    getStore().users.find((u) => u.id === "u-koffi")?.verification_status,
    "attente",
  );

  const withdraw = await demoFrom("users")
    .update({ verification_status: "none", verification_note: "" })
    .eq("id", "u-koffi");
  eq("un compte peut retirer sa demande", withdraw.error, null);

  // --- la ligne d'autrui reste verrouillée aussi sans décision ---
  //
  // La politique de ligne ne **refuse pas** l'opération : elle retire la
  // ligne des lignes atteignables, exactement comme Postgres — l'écriture
  // ne tombe sur rien et revient sans erreur. Ce qui compte, c'est donc
  // la valeur après coup, pas le code retour.
  const otherBefore = getStore().users.find((u) => u.id === "u-thabo")?.verification_note;
  const otherRow = await demoFrom("users")
    .update({ verification_note: "pièce" })
    .eq("id", "u-thabo");
  eq("un compte n'atteint pas la ligne d'un autre (aucune ligne)", (otherRow.data as unknown[] | null)?.length ?? 0, 0);
  eq(
    "…et la note d'autrui est intacte",
    getStore().users.find((u) => u.id === "u-thabo")?.verification_note,
    otherBefore,
  );

  // --- sans session, rien : auth.uid() est nul ---
  saveSessionId(null);
  const anonymous = await demoFrom("users")
    .update({ verification_status: "attente" })
    .eq("id", "u-koffi");
  check(
    "hors session, users ne s'écrit pas",
    anonymous.error !== null || ((anonymous.data as unknown[] | null)?.length ?? 0) === 0,
    anonymous,
  );
  eq(
    "…la ligne est intacte hors session",
    getStore().users.find((u) => u.id === "u-koffi")?.verification_status,
    "none",
  );

  // --- l'administration, elle, décide ---
  saveSessionId("u-admin-nadia");
  const accepted = await demoFrom("users")
    .update({ verified: true, verification_status: "acceptee" })
    .eq("id", "u-thabo");
  eq("l'administration peut accepter", accepted.error, null);
  eq(
    "…le cachet est posé",
    getStore().users.find((u) => u.id === "u-thabo")?.verified,
    true,
  );

  const refused = await demoFrom("users")
    .update({ verification_status: "refusee" })
    .eq("id", "u-zainab");
  eq("l'administration peut refuser", refused.error, null);
  eq(
    "…sans toucher au cachet d'un déjà vérifié",
    getStore().users.find((u) => u.id === "u-chioma")?.verified,
    true,
  );

  saveSessionId(null);
}

/* ------------------------------------------------------------------ */
/* 7. Le flux complet : demande → file → décision                       */
/* ------------------------------------------------------------------ */

async function testFlow() {
  resetStore();

  const target = "u-zainab";

  // --- déposer ---
  saveSessionId(target);
  await requestVerification(target, "Nom réel, GitHub, communauté portée.");

  const row = () => getStore().users.find((u) => u.id === target);
  eq("la demande passe en attente", row()?.verification_status, "attente");
  eq("la note est écrite", row()?.verification_note, "Nom réel, GitHub, communauté portée.");
  eq("le cachet n'est pas posé", row()?.verified, false);

  // Une demande en remplace une autre : la colonne ne porte pas deux dossiers.
  await requestVerification(target, "Seconde formulation.");
  eq(
    "la demande est remplacée, pas dupliquée",
    row()?.verification_note,
    "Seconde formulation.",
  );

  // --- la file ---
  const queue = await fetchVerificationQueue();
  check(
    "la file contient la demande",
    queue.some((r) => r.id === target),
    queue.map((r) => r.id),
  );
  check(
    "la file ne contient que des demandes en attente",
    queue.every((r) => r.verification_status === "attente"),
  );
  check(
    "la file porte la note à lire",
    queue.every((r) => r.verification_note.length > 0),
  );

  // --- refuser de décider soi-même ---
  let denied = false;
  try {
    await decideVerification(target, true);
  } catch {
    denied = true;
  }
  check("le titulaire ne peut pas s'accepter soi-même", denied);
  eq("…le cachet n'a pas bougé", row()?.verified, false);

  // --- l'administration tranche ---
  saveSessionId("u-admin-elom");
  await decideVerification(target, true);

  eq("la décision pose le cachet", row()?.verified, true);
  eq("…et le statut, d'une seule écriture", row()?.verification_status, "acceptee");

  const after = await fetchVerificationQueue();
  check(
    "le compte sort de la file",
    !after.some((r) => r.id === target),
    after.map((r) => r.id),
  );

  // --- refuser ne retire jamais un cachet déjà posé ---
  await decideVerification("u-chioma", false);
  eq(
    "un refus laisse le cachet en place",
    getStore().users.find((u) => u.id === "u-chioma")?.verified,
    true,
  );
  eq(
    "…mais trace le refus",
    getStore().users.find((u) => u.id === "u-chioma")?.verification_status,
    "refusee",
  );

  // --- le retrait de cachet est une sanction distincte ---
  await revokeVerification(target);
  eq("le retrait retire le cachet", row()?.verified, false);
  eq("…et remet l'état à none", row()?.verification_status, "none");

  // --- retirer sa propre demande ---
  saveSessionId(target);
  await requestVerification(target, "à retirer");
  await withdrawVerification(target);
  eq("le retrait de demande remet none", row()?.verification_status, "none");
  eq("…et vide la note", row()?.verification_note, "");

  saveSessionId(null);
}

/* ------------------------------------------------------------------ */
/* 7. Une écriture qui ne touche rien n'est pas un succès               */
/* ------------------------------------------------------------------ */

/**
 * Le point le plus facile à rater du flux.
 *
 * Une politique de ligne ne **refuse** pas une écriture hors de sa portée :
 * elle retire la ligne des lignes atteignables, et Postgres (comme son
 * rejeu) revient alors sans erreur, avec zéro ligne touchée. Un
 * `withdrawVerification` qui se contenterait de regarder `error` rendrait
 * donc la main comme si tout allait bien — et l'écran annoncerait un
 * retrait qui n'a rien retiré. Il faut compter les lignes rendues.
 */
async function testTouched() {
  resetStore();

  const status = (id: string) =>
    getStore().users.find((u) => u.id === id)?.verification_status;
  const note = (id: string) =>
    getStore().users.find((u) => u.id === id)?.verification_note;

  saveSessionId("u-koffi");

  // La ligne d'autrui n'est pas atteignable : la demande doit échouer,
  // pas disparaître dans le vide.
  await expectThrow("une demande sur la ligne d'autrui échoue", () =>
    requestVerification("u-thabo", "je demande pour quelqu'un d'autre"),
  );
  eq("…et le dossier d'autrui n'a pas bougé", status("u-thabo"), "refusee");

  await expectThrow("un retrait sur la ligne d'autrui échoue", () =>
    withdrawVerification("u-thabo"),
  );
  eq("…et la note d'autrui est intacte", note("u-thabo"), "Le pseudo ne dit pas le nom ; une pièce le dirait.");

  await expectThrow("une décision par un non-administrateur échoue", () =>
    decideVerification("u-thabo", true),
  );

  // Sans session, aucune ligne de `users` n'est atteignable : c'est un
  // échec, pas un succès silencieux.
  saveSessionId(null);
  await expectThrow("une demande sans session échoue", () =>
    requestVerification("u-koffi", "sans session"),
  );
  eq("…et la demande en attente est intacte", status("u-koffi"), "attente");

  // Et le chemin normal, lui, doit continuer de passer : un garde-fou qui
  // refuse tout ne protégerait rien, il casserait simplement l'application.
  saveSessionId("u-zainab");
  await requestVerification("u-zainab", "Nom réel et dépôt GitHub dans le profil.");
  eq("une demande sur sa propre ligne passe", status("u-zainab"), "attente");
  eq(
    "…avec sa note",
    note("u-zainab"),
    "Nom réel et dépôt GitHub dans le profil.",
  );

  await withdrawVerification("u-zainab");
  eq("un retrait sur sa propre ligne passe", status("u-zainab"), "none");

  saveSessionId(null);
}

/* ------------------------------------------------------------------ */
/* 8. La même règle ailleurs : l'édition de profil                      */
/* ------------------------------------------------------------------ */

/**
 * `updateProfile` (`lib/api/profile.ts`) écrit la même table, avec
 * la même politique de ligne — il porte donc le même contrôle de lignes
 * touchées. On le vérifie ici, au même endroit que la règle : c'est la
 * même erreur, et elle ne doit pas revenir par une autre porte.
 */
async function testProfileWrite() {
  resetStore();
  saveSessionId("u-koffi");

  const written = await updateProfile("u-koffi", { bio: "Bio réécrite." });
  eq("éditer son propre profil passe", written.error, null);
  eq(
    "…et le texte est bien écrit",
    getStore().users.find((u) => u.id === "u-koffi")?.bio,
    "Bio réécrite.",
  );

  const ghost = await updateProfile("u-inexistant", { bio: "x" });
  check(
    "éditer une ligne injoignable est une erreur, pas un succès muet",
    ghost.error !== null,
    ghost.error,
  );

  saveSessionId(null);
}

/* ------------------------------------------------------------------ */
/* 9. Dire *pourquoi* l'écriture a échoué                              */
/* ------------------------------------------------------------------ */

/**
 * Quatre échecs distincts, quatre phrases distinctes.
 *
 * C'est la leçon du bug « Demande impossible » : le flux avalait
 * l'erreur, et un `42703` (base sans la migration 037) ressemblait
 * exactement à une panne réseau. Une base incomplète et un refus de rôle
 * ne se réparent pas au même endroit — l'écran doit le dire.
 */
function testErrorMessages() {
  const missing = verificationErrorMessage({
    code: "42703",
    message: 'column "verification_status" does not exist',
  });
  check("une colonne absente nomme la migration 037", /037/.test(missing), missing);

  const denied = verificationErrorMessage({
    code: "42501",
    message:
      "permission denied for column \"verified\" (42501) — seule l'administration vérifie un compte",
  });
  check("un refus de rôle se dit comme un refus", /rôle/.test(denied), denied);
  check("…et pas comme une base cassée", !/037/.test(denied), denied);

  const offline = verificationErrorMessage(new TypeError("Failed to fetch"));
  check("un serveur injoignable se dit injoignable", /injoignable/.test(offline), offline);

  const unknown = verificationErrorMessage(new Error("boom"));
  check("l'inconnu est montré, pas inventé", /boom/.test(unknown), unknown);
  check(
    "une erreur vide rend quand même une phrase",
    verificationErrorMessage(null).length > 0,
    verificationErrorMessage(null),
  );
}

async function main() {
  testShapes();
  testBounds();
  testBadgeFor();
  testStatuses();
  testDemoAccounts();
  await testColumnGuard();
  await testFlow();
  await testTouched();
  await testProfileWrite();
  testErrorMessages();

  if (failures.length > 0) {
    console.log(`\n✗ ${failures.length} échec(s) sur ${passed + failures.length} :`);
    for (const f of failures) console.log(`  · ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ ${passed} vérifications de vérification`);
}

void main();
