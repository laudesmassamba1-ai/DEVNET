/**
 * Tests des rôles de groupe — migration 020.
 *
 * Exécuter avec :  npx tsx scripts/test-roles.ts
 *
 * Depuis la 005, `group_members.role` existe et est contraint, mais
 * **aucune politique RLS ne le lisait** : un modérateur ne pouvait
 * strictement rien. La 020 donne au rôle ses pouvoirs :
 *
 *  · l'équipe (owner | moderator) supprime les messages du groupe ;
 *  · l'équipe retire un **membre simple** — jamais un pair, jamais le
 *    propriétaire ;
 *  · le créateur seul règle les rôles ;
 *  · l'équipe voit (et classe) les signalements de son groupe.
 *
 * Chaque test porte sur un invariant qui doit être vrai dans les deux
 * modes : côté démo, une règle de suppression qui manquerait laisserait
 * l'écran afficher un bouton que la base refusera au premier jour de la
 * bascule — le défaut exact que la 020 a été écrite pour éviter.
 */

import { demoFrom } from "../lib/demo/query";
import { saveSessionId } from "../lib/demo/session";
import { getStore, resetStore } from "../lib/demo/store";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

async function main() {
  resetStore();

  // Le seed nomme koffi **modérateur** de g-1 (« Python Afrique », créé
  // par aminata) : le cas qui doit être visible — des pouvoirs de
  // modération sans en être le créateur.
  const seedRole = getStore().group_members.find(
    (m) => m.group_id === "g-1" && m.user_id === "u-koffi",
  );
  check("le seed pose koffi modérateur de g-1", seedRole?.role === "moderator", seedRole);

  /* ── Suppression de messages ─────────────────────────────────── */

  // Un message de g-1 écrit par quelqu'un d'autre que koffi.
  const cible = getStore().group_messages.find(
    (m) => m.group_id === "g-1" && m.author_id !== "u-koffi",
  );
  check("le jeu contient un message d'autrui dans g-1", cible !== undefined);

  saveSessionId("u-koffi");
  const mod = await demoFrom("group_messages")
    .delete().eq("id", cible!.id).select("id");
  check("le modérateur supprime le message d'un autre",
    (mod.data as { id: string }[] | null)?.length === 1, mod);
  check("le message a disparu du store",
    !getStore().group_messages.some((m) => m.id === cible!.id));

  // Un membre simple n'a pas ce pouvoir : Postgres ignore la ligne en
  // silence — l'opération réussit, la ligne reste.
  saveSessionId("u-thabo");
  const autre = getStore().group_messages.find(
    (m) => m.group_id === "g-1" && m.author_id !== "u-thabo",
  );
  const plaine = await demoFrom("group_messages")
    .delete().eq("id", autre!.id).select("id");
  check("un membre simple ne supprime pas le message d'un autre",
    (plaine.data as { id: string }[] | null)?.length === 0, plaine);
  check("le message visé est toujours là",
    getStore().group_messages.some((m) => m.id === autre!.id));

  // L'auteur supprime toujours le sien — pouvoir d'origine (005).
  const sien = await demoFrom("group_messages")
    .insert({ group_id: "g-1", channel_id: autre!.channel_id, author_id: "u-thabo",
      author_name: "Thabo", author_color: "av-lime", text: "mon message", is_code: false });
  check("le membre écrit un message", sien.error === null, sien.error);
  const own = await demoFrom("group_messages")
    .delete().eq("id", (sien.data as { id: string }[])[0].id).select("id");
  check("l'auteur supprime son propre message",
    (own.data as { id: string }[] | null)?.length === 1, own);

  // Hors de son groupe, même le modérateur n'est personne : koffi n'est
  // rien dans g-3 (propriétaire : thabo).
  saveSessionId("u-koffi");
  const ailleurs = getStore().group_messages.find((m) => m.group_id === "g-3");
  const etranger = await demoFrom("group_messages")
    .delete().eq("id", ailleurs!.id).select("id");
  check("le modérateur d'un groupe ne modère pas un autre",
    (etranger.data as { id: string }[] | null)?.length === 0, etranger);

  // Le propriétaire garde tous les droits de la 005, étendus en 020.
  saveSessionId("u-aminata");
  const proprio = await demoFrom("group_messages")
    .delete().eq("id", autre!.id).select("id");
  check("la propriétaire supprime n'importe quel message de son groupe",
    (proprio.data as { id: string }[] | null)?.length === 1, proprio);

  /* ── Retrait de membres ──────────────────────────────────────── */

  // L'équipe retire un membre simple.
  saveSessionId("u-koffi");
  const kick = await demoFrom("group_members")
    .delete().eq("group_id", "g-1").eq("user_id", "u-thabo").select("user_id");
  check("le modérateur retire un membre simple",
    (kick.data as { user_id: string }[] | null)?.length === 1, kick);
  check("le membre retiré a quitté le store",
    !getStore().group_members.some((m) => m.group_id === "g-1" && m.user_id === "u-thabo"));

  // La propriétaire nomme chioma modérateur — seul le créateur règle
  // les rôles, c'est le test suivant qui le prouve aussi en négatif.
  saveSessionId("u-aminata");
  const promote = await demoFrom("group_members")
    .update({ role: "moderator" })
    .eq("group_id", "g-1").eq("user_id", "u-chioma");
  check("la propriétaire nomme une modératrice", promote.error === null, promote.error);
  check("le rôle est relu modérateur",
    getStore().group_members.find((m) => m.group_id === "g-1" && m.user_id === "u-chioma")
      ?.role === "moderator");

  // Un modérateur ne purge pas l'équipe : ni un autre modérateur,
  // ni le propriétaire. La clause `role = 'member'` porte sur la ligne.
  saveSessionId("u-koffi");
  const purgePair = await demoFrom("group_members")
    .delete().eq("group_id", "g-1").eq("user_id", "u-chioma").select("user_id");
  check("un modérateur ne retire pas un autre modérateur",
    (purgePair.data as { user_id: string }[] | null)?.length === 0, purgePair);
  const purgeProprio = await demoFrom("group_members")
    .delete().eq("group_id", "g-1").eq("user_id", "u-aminata").select("user_id");
  check("un modérateur ne retire pas le propriétaire",
    (purgeProprio.data as { user_id: string }[] | null)?.length === 0, purgeProprio);
  check("l'équipe visée est toujours membre",
    getStore().group_members.filter(
      (m) => m.group_id === "g-1" && (m.user_id === "u-chioma" || m.user_id === "u-aminata"),
    ).length === 2);

  // Partir soi-même reste le geste le plus simple — et réadhérer
  // ensuite, puisqu'on est reparti.
  saveSessionId("u-thabo");
  const retour = await demoFrom("group_members")
    .insert({ group_id: "g-1", user_id: "u-thabo", role: "member" });
  check("un membre peut réadhérer", retour.error === null, retour.error);
  const partir = await demoFrom("group_members")
    .delete().eq("group_id", "g-1").eq("user_id", "u-thabo").select("user_id");
  check("partir soi-même sans erreur",
    (partir.data as { user_id: string }[] | null)?.length === 1, partir);

  // Un membre simple ne peut pas virer qui que ce soit.
  saveSessionId("u-thabo");
  const ret = await demoFrom("group_members")
    .insert({ group_id: "g-1", user_id: "u-thabo", role: "member" });
  check("thabo est revenu", ret.error === null, ret.error);
  const cible2 = getStore().group_members.find(
    (m) => m.group_id === "g-1" && m.user_id === "u-chioma",
  );
  const abuse = await demoFrom("group_members")
    .delete().eq("group_id", "g-1").eq("user_id", cible2!.user_id).select("user_id");
  check("un membre simple ne retire personne",
    (abuse.data as { user_id: string }[] | null)?.length === 0, abuse);

  // Le créateur, lui, retire qui il veut — droit d'origine (005).
  saveSessionId("u-aminata");
  const revoquer = await demoFrom("group_members")
    .update({ role: "member" })
    .eq("group_id", "g-1").eq("user_id", "u-chioma");
  check("la propriétaire révoque le rôle", revoquer.error === null, revoquer.error);
  const kickProprio = await demoFrom("group_members")
    .delete().eq("group_id", "g-1").eq("user_id", "u-chioma").select("user_id");
  check("la propriétaire retire une modératrice",
    (kickProprio.data as { user_id: string }[] | null)?.length === 1, kickProprio);

  /* ── Le changement de rôle ───────────────────────────────────── */

  // Le créateur seul règle les rôles : c'est `group_members_update`
  // (005, réécrite en 020). Un update hors de sa portée est ignoré en
  // silence — comme en base, la ligne non visible pour `update` ne
  // lève rien. L'écran, lui, relit après écriture (voir
  // `changeRole`), donc un refus se voit, il ne se devine pas.
  saveSessionId("u-thabo");
  const avant = getStore().group_members.find(
    (m) => m.group_id === "g-1" && m.user_id === "u-zainab",
  );
  const abuseRole = await demoFrom("group_members")
    .update({ role: "moderator" })
    .eq("group_id", "g-1").eq("user_id", "u-zainab");
  check("un membre simple ne change pas les rôles", abuseRole.error === null, abuseRole.error);
  check("la tentative n'a rien changé",
    getStore().group_members.find(
      (m) => m.group_id === "g-1" && m.user_id === "u-zainab",
    )?.role === avant?.role);

  // Le modérateur non plus : modérer un contenu n'est pas nommer des
  // modérateurs.
  saveSessionId("u-koffi");
  const roleModo = await demoFrom("group_members")
    .update({ role: "member" })
    .eq("group_id", "g-1").eq("user_id", "u-zainab");
  check("le modérateur ne règle pas les rôles", roleModo.error === null, roleModo.error);
  check("la tentative du modérateur n'a rien changé",
    getStore().group_members.find(
      (m) => m.group_id === "g-1" && m.user_id === "u-zainab",
    )?.role === avant?.role);

  // Et le créateur d'un autre groupe n'a pas de pouvoir ici : aminata
  // règle les rôles de g-1, pas ailleurs.
  const iciSeulement = await demoFrom("group_members")
    .update({ role: "moderator" })
    .eq("group_id", "g-3").eq("user_id", "u-youssef");
  check("la propriétaire de g-1 ne règle pas les rôles de g-3",
    (iciSeulement.data as { role: string }[] | null)?.length === 0, iciSeulement);

  /* ── L'adhésion ──────────────────────────────────────────────── */

  // On ne rejoint un groupe qu'en tant que `member`, et sur sa propre
  // ligne (`auth.uid() = user_id`).
  saveSessionId("u-youssef");
  const auto = await demoFrom("group_members")
    .insert({ group_id: "g-3", user_id: "u-youssef", role: "moderator" });
  check("s'auto-nommer modérateur est refusé", auto.error !== null, auto);
  check("le refus parle de RLS, comme Postgres",
    /row-level security|42501/i.test(auto.error?.message ?? ""), auto.error?.message);

  // Youssef est déjà membre de g-3 dans le seed : il en part d'abord,
  // pour que l'adhésion testée soit une vraie adhésion et pas une clé
  // déjà prise.
  const depart = await demoFrom("group_members")
    .delete().eq("group_id", "g-3").eq("user_id", "u-youssef").select("user_id");
  check("partir d'un groupe dont on est membre",
    (depart.data as { user_id: string }[] | null)?.length === 1, depart);

  const bon = await demoFrom("group_members")
    .insert({ group_id: "g-3", user_id: "u-youssef", role: "member" });
  check("adhérer comme membre sans erreur", bon.error === null, bon.error);
  check("l'adhésion est datée par `joined_at`",
    typeof getStore().group_members.find(
      (m) => m.group_id === "g-3" && m.user_id === "u-youssef",
    )?.joined_at === "string");

  // Écrire l'adhésion de quelqu'un d'autre est refusé, même en tant
  // que `member` : l'adhésion est un geste personnel.
  saveSessionId("u-koffi");
  const pourAutrui = await demoFrom("group_members")
    .insert({ group_id: "g-3", user_id: "u-thabo", role: "member" });
  check("on n'inscrit pas quelqu'un d'autre", pourAutrui.error !== null, pourAutrui);

  // Le créateur, en revanche, pose une ligne d'un autre rôle sur
  // lui-même — c'est ainsi qu'il (ré)intègre son groupe en tant que
  // propriétaire, geste que l'écran n'emprunte jamais mais que la
  // politique autorise pour les mêmes raisons que la 005.
  saveSessionId("u-koffi");
  const quitte = await demoFrom("group_members")
    .delete().eq("group_id", "g-2").eq("user_id", "u-koffi").select("user_id");
  check("le créateur quitte son groupe (pour le test)",
    (quitte.data as { user_id: string }[] | null)?.length === 1, quitte);
  const revient = await demoFrom("group_members")
    .insert({ group_id: "g-2", user_id: "u-koffi", role: "owner" });
  check("le créateur réintègre son groupe comme owner",
    revient.error === null, revient.error);

  /* ── Les signalements suivent les pouvoirs ───────────────────── */

  // Un signalement sur un message de g-1 : koffi, modérateur, doit le
  // voir et pouvoir le classer — même raison que le créateur (011) :
  // il a désormais le droit de supprimer ce message.
  saveSessionId("u-thabo");
  const msg = getStore().group_messages.find((m) => m.group_id === "g-1");
  const signal = await demoFrom("reports").insert({
    reporter_id: "u-thabo",
    message_id: msg!.id,
    reason: "spam",
    details: "message répété",
  });
  check("un membre signale un message de groupe", signal.error === null, signal.error);

  saveSessionId("u-koffi");
  const vuParModo = await demoFrom("reports")
    .select("id, status").eq("message_id", msg!.id);
  check("le modérateur voit le signalement de son groupe",
    (vuParModo.data as { id: string }[] | null)?.length === 1, vuParModo.data);

  const classe = await demoFrom("reports")
    .update({ status: "resolved" }).eq("message_id", msg!.id);
  check("le modérateur classe le signalement",
    (classe.data as { status: string }[] | null)?.length === 1, classe.data);
  check("la date de résolution est dérivée, pas écrite",
    typeof getStore().reports.find((r) => r.message_id === msg!.id)?.resolved_at
      === "string");

  // Un membre simple du même groupe ne le voit pas : le pouvoir
  // s'arrête où commence la lecture de la ligne.
  saveSessionId("u-thabo");
  const vuParAuteur = await demoFrom("reports")
    .select("id").eq("message_id", msg!.id);
  check("le signalateur voit son propre signalement",
    (vuParAuteur.data as { id: string }[] | null)?.length === 1);

  saveSessionId("u-zainab");
  const invisible = await demoFrom("reports")
    .select("id").eq("message_id", msg!.id);
  check("un membre simple du groupe ne voit pas le signalement",
    (invisible.data as { id: string }[] | null)?.length === 0, invisible.data);

  // Et le signalement ne se supprime jamais : c'est la trace d'un fait.
  saveSessionId("u-koffi");
  const effacer = await demoFrom("reports")
    .delete().eq("message_id", msg!.id).select("id");
  check("personne ne supprime un signalement",
    (effacer.data as { id: string }[] | null)?.length === 0, effacer);

  /* ── Rapport ─────────────────────────────────────────────────── */

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ Les rôles de groupe sont des pouvoirs, pas des étiquettes\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
