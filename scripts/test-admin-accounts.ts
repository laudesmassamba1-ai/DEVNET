/**
 * Tests de l'administration des comptes — annuaire, rôle, création.
 *
 * Exécuter : `npx tsx scripts/test-admin-accounts.ts`
 *
 * Ce que ces tests surveillent, dans l'ordre :
 *
 *  1. **L'annuaire** lit ce qu'il faut, et rien de plus ;
 *  2. **Le rôle** s'écrit pour un administrateur, et **pas** pour un
 *     membre — c'est la base qui refuse (déclencheur 037, rejoué par la
 *     démo), pas l'écran ;
 *  3. **La promotion d'un compte existant** se voit à la relecture ;
 *  4. **La création d'un compte** produit une ligne complète, avec le
 *     pseudo dérivé et unique d'une part, le rôle et le cachet d'autre
 *     part ;
 *  5. **La connexion** au compte créé vérifie son mot de passe — c'est ce
 *     qui rend la création crédible : un compte qu'on ne peut pas
 *     rejoindre n'est pas un compte.
 */
import { getStore, resetStore } from "../lib/demo/store";
import { saveSessionId } from "../lib/demo/session";
import { demoClient } from "../lib/demo/client";
import {
  createAccount,
  fetchAccounts,
  setAdminRole,
  validateNewAccount,
  type NewAccount,
} from "../lib/admin-accounts";

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

/** Repose le store et ouvre la session sur le compte voulu. */
function asUser(id: string | null): void {
  resetStore();
  saveSessionId(id);
}

const ADMIN = "u-admin-nadia";
const MEMBER = "u-koffi";

function account(id: string) {
  return getStore().users.find((u) => String(u.id) === id);
}

function byEmail(email: string) {
  return getStore().users.find((u) => String(u.email) === email);
}

/* ------------------------------------------------------------------ */
/* 1. L'annuaire                                                      */
/* ------------------------------------------------------------------ */

async function testDirectory() {
  asUser(ADMIN);

  const page = await fetchAccounts();
  check("l'annuaire rend des comptes", page.accounts.length > 5, page.accounts.length);
  check(
    "les administrateurs sont en tête",
    page.accounts.slice(0, 5).every((a) => a.is_admin),
  );
  check(
    "puis les pseudos suivent l'alphabet",
    (() => {
      const rest = page.accounts.slice(5).map((a) => a.pseudo);
      return rest.every((p, i) => i === 0 || rest[i - 1].localeCompare(p) <= 0);
    })(),
  );
  eq("la liste n'est pas plafonnée ici", page.capped, false);

  const koffi = page.accounts.find((a) => a.id === MEMBER);
  check("koffi est dans l'annuaire", koffi !== undefined);
  eq("koffi n'est pas administrateur", koffi?.is_admin, false);
  check("la ligne porte l'email", (koffi?.email ?? "").includes("@"));
  check("la ligne porte le statut de vérification", koffi?.verification_status === "attente");

  // La recherche par mot-clé.
  const found = await fetchAccounts("koffi");
  check("la recherche par pseudo rend koffi", found.accounts.some((a) => a.id === MEMBER));

  const byEmail = await fetchAccounts("aminata@devnet.africa");
  eq("la recherche par email rend une ligne", byEmail.accounts.length, 1);

  const none = await fetchAccounts("zzzz-introuvable");
  eq("une recherche sans résultat rend zéro ligne", none.accounts.length, 0);

  // Une virgule dans le terme casserait la syntaxe `or` de PostgREST :
  // on vérifie que la requête part quand même, et que le terme est
  // nettoyé (« koffi, » cherche « koffi », pas « koffi, »).
  const comma = await fetchAccounts("koffi,");
  check("un terme mal formé ne casse pas la requête", Array.isArray(comma.accounts));
  check("…et la recherche reste juste", comma.accounts.some((a) => a.id === MEMBER));

  const parens = await fetchAccounts("()%");
  eq("un terme entièrement nettoyé rend l'annuaire entier", parens.accounts.length, page.accounts.length);
}

/* ------------------------------------------------------------------ */
/* 2. Le rôle d'administration                                        */
/* ------------------------------------------------------------------ */

async function testRole() {
  // Un administrateur nomme un membre.
  asUser(ADMIN);
  await setAdminRole(MEMBER, true, ADMIN);
  eq("le membre porte le rôle après la promotion", account(MEMBER)?.is_admin, true);

  // …et le retire.
  await setAdminRole(MEMBER, false, ADMIN);
  eq("le rôle est retiré", account(MEMBER)?.is_admin, false);

  // Un membre ne peut pas se nommer lui-même : c'est la base qui refuse.
  asUser(MEMBER);
  await expectThrow("un membre ne peut pas nommer qui que ce soit", () =>
    setAdminRole("u-aminata", true, MEMBER),
  );
  // Les lignes du seed ne portent pas `is_admin: false` : la clé est
  // simplement absente, donc on teste la vérité, pas l'égalité à false.
  check(
    "et la ligne visée n'a pas bougé",
    !account("u-aminata")?.is_admin,
    account("u-aminata")?.is_admin,
  );

  // Un administrateur ne se retire pas son propre rôle : garde-fou de
  // produit, pour que l'administration ne se vide pas par inadvertance.
  asUser(ADMIN);
  await expectThrow("un administrateur ne se rétrograde pas lui-même", () =>
    setAdminRole(ADMIN, false, ADMIN),
  );
  eq("le rôle est toujours là", account(ADMIN)?.is_admin, true);
}

/* ------------------------------------------------------------------ */
/* 3. La création d'un compte                                         */
/* ------------------------------------------------------------------ */

const NEW: NewAccount = {
  email: "Fatou@Devnet.Africa",
  prenom: "Fatou",
  pseudo: "",
  password: "brousse2026",
  account_type: "professional",
  is_admin: true,
};

async function testCreate() {
  asUser(ADMIN);

  // Forme refusée avant l'écriture.
  eq(
    "un email invalide est refusé",
    validateNewAccount({ ...NEW, email: "fatou" }),
    "adresse email invalide",
  );
  eq(
    "un mot de passe trop court est refusé",
    validateNewAccount({ ...NEW, password: "123" }),
    "mot de passe : six caractères au moins",
  );
  eq(
    "un prénom vide est refusé",
    validateNewAccount({ ...NEW, prenom: "  " }),
    "le prénom est requis",
  );

  const before = getStore().users.length;
  const short = await createAccount({ ...NEW, password: "123" });
  eq("la création invalide rend l'erreur de forme", short.error, "mot de passe : six caractères au moins");
  eq("et n'écrit rien", getStore().users.length, before);

  // Création réelle.
  const ok = await createAccount(NEW);
  eq("la création passe", ok.error, null);
  eq("une ligne de plus", getStore().users.length, before + 1);

  const created = byEmail("fatou@devnet.africa");
  check("l'adresse est rangée en minuscules", created !== undefined);
  eq("le prénom est posé", created?.prenom, "Fatou");
  eq("le pseudo est dérivé du prénom", created?.pseudo, "fatou");
  eq("le rôle est posé", created?.is_admin, true);
  eq("le cachet suit le rôle", created?.verified, true);
  eq("le statut de vérification suit", created?.verification_status, "acceptee");
  eq("le type de compte est respecté", created?.account_type, "professional");
  eq("le compteur d'abonnés part de zéro", created?.followers, 0);

  // Doublon d'adresse : refusé, comme le fera `auth.users` en mode réel.
  const dup = await createAccount({ ...NEW, prenom: "Fatou bis" });
  eq("un doublon d'adresse est refusé", dup.error, "un compte existe déjà avec cette adresse");
  eq("et n'ajoute pas de ligne", getStore().users.length, before + 1);

  // Un pseudo déjà pris est suffixé, pas dupliqué.
  const clash = await createAccount({
    ...NEW,
    email: "autre@devnet.africa",
    prenom: "Koffi",
    is_admin: false,
  });
  eq("la seconde création passe", clash.error, null);
  const second = byEmail("autre@devnet.africa");
  eq("le pseudo entré en collision est suffixé", second?.pseudo, "koffi1");
  eq("le compte non administrateur ne porte pas le rôle", second?.is_admin, false);
  eq("…ni le cachet", second?.verified, false);
  eq("…ni de statut de vérification", second?.verification_status, "none");
}

/* ------------------------------------------------------------------ */
/* 4. Rejoindre le compte créé                                        */
/* ------------------------------------------------------------------ */

async function testSignIn() {
  asUser(ADMIN);
  await createAccount({ ...NEW, email: "chef@devnet.africa", password: "brousse2026" });

  saveSessionId(null);

  // Le mot de passe du compte créé compte vraiment.
  const wrong = await demoClient.auth.signInWithPassword({
    email: "chef@devnet.africa",
    password: "mauvais",
  });
  check("un mauvais mot de passe est refusé", wrong.error !== null);

  const right = await demoClient.auth.signInWithPassword({
    email: "chef@devnet.africa",
    password: "brousse2026",
  });
  eq("le bon mot de passe ouvre la session", right.error, null);
  eq(
    "la session porte le bon compte",
    String(right.data.user?.id),
    String(byEmail("chef@devnet.africa")?.id),
  );

  // Une adresse inconnue est refusée : avant, elle ouvrait la session sur
  // le compte de démo — on entrait avec l'adresse d'un autre et on
  // atterrissait sur le profil de Koffi sans un mot.
  const unknown = await demoClient.auth.signInWithPassword({
    email: "personne@nulle-part.tld",
    password: "peu importe",
  });
  check("une adresse inconnue est refusée", unknown.error !== null);
  saveSessionId(null);

  // Les comptes de démonstration, eux, n'ont pas de mot de passe : ils
  // s'ouvrent avec n'importe quoi — c'est le confort voulu de la démo.
  const demo = await demoClient.auth.signInWithPassword({
    email: "aminata@devnet.africa",
    password: "n'importe quoi",
  });
  eq("un compte de démonstration s'ouvre sans mot de passe", demo.error, null);
  saveSessionId(null);
}

/* ------------------------------------------------------------------ */

async function main() {
  try {
    await testDirectory();
    await testRole();
    await testCreate();
    await testSignIn();
  } catch (err) {
    console.error("✗ erreur non prévue :", err);
    process.exitCode = 1;
    return;
  }

  saveSessionId(null);
  resetStore();

  if (failures.length === 0) {
    console.log(`✓ ${passed} vérifications d'administration des comptes`);
    return;
  }

  console.error(`✗ ${failures.length} échec(s) sur ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}

void main();
