/**
 * Tests des signalements — migration 011.
 *
 * Exécuter avec :  npx tsx scripts/test-reports.ts
 *
 * Le signalement est la première table du projet où **la RLS porte sur
 * la lecture d'une information qui n'est pas la sienne**. Partout
 * ailleurs, une politique dit « cette ligne est à toi ». Ici elle dit
 * « cette ligne te concerne parce que tu es l'auteur de ce qu'elle
 * vise » — donc elle dépend d'une **autre** table, et il faut la
 * remonter à chaque fois.
 *
 * C'est le genre de règle qu'un moteur de démonstration peut simplifier
 * sans qu'on s'en aperçoive. Il faut donc tester les deux côtés, et pas
 * seulement « ça marche chez moi » :
 *
 *  · ce qui doit être **refusé** — hors session, deux cibles, zéro
 *    cible, s'auto-signaler, signaler deux fois, un motif hors
 *    énumération, classer son propre signalement, réécrire
 *    `reporter_id` ;
 *  · ce qui doit être **visible** — ses propres signalements et ceux
 *    visant son contenu, **pas** ceux des autres.
 *
 * Le second point est celui qui compte. Une RLS trop permissive ne se
 * voit à rien : l'écran affiche juste plus de lignes que prévu, et
 * personne ne peut dire si c'est normal.
 *
 * **Les tests n'emportent aucun avis sur le jeu de démonstration.**
 * Chaque cible est résolue par un auteur connu à partir du store, et
 * chaque couple signaleur/cible est choisi pour ne pas tomber sur une
 * ligne déjà présente. Le jour où le seed gagne un signalement, ces
 * tests ne doivent pas devenir faux — ils portent sur les règles, pas
 * sur les données.
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

/** L'auteur d'une publication de démonstration, résolu au moment de l'emploi. */
const authorOfPost = (postId: string): string =>
  String(getStore().posts.find((p) => p.id === postId)?.author_id ?? "");

/** L'auteur d'un commentaire de démonstration. */
const authorOfComment = (commentId: string): string =>
  String(getStore().comments.find((c) => c.id === commentId)?.author_id ?? "");

/** Un compte de démonstration qui n'a rien signalé. */
function bystander(): string {
  const busy = new Set(
    getStore().reports.map((r) => String(r.reporter_id)),
  );
  const author = new Set(getStore().posts.map((p) => String(p.author_id)));

  // Quelqu'un qui ne soit ni déjà signaleur ni l'auteur du contenu visé :
  // les deux rôles confondus produiraient un test qui passe pour la
  // mauvaise raison.
  const found = getStore().users.find(
    (u) => !busy.has(String(u.id)) && !author.has(String(u.id)),
  );
  return String(found?.id ?? "u-youssef");
}

async function main() {
  resetStore();

  // Deux publications de démontrateurs distincts, pour tester les deux
  // côtés d'une RLS : celle que je suis visé, et celle que je ne le suis pas.
  const MINE = "p-1";
  const THEIRS = "p-2";
  const authorMine = authorOfPost(MINE);
  const authorTheirs = authorOfPost(THEIRS);
  const third = bystander();

  /* ── Insertion : hors session d'abord ──────────────────────────── */

  // La politique exige une session. Sans elle, il n'y a pas d'appelant :
  // la ligne aurait `reporter_id = null`, et la base refuse avant même
  // d'atteindre la contrainte de clé étrangère.
  const anonymous = await demoFrom("reports").insert({
    reporter_id: "u-koffi",
    post_id: MINE,
    reason: "spam",
  });
  check("signaler hors session est refusé", anonymous.error !== null, anonymous);

  /* ── Insertion : la forme de la ligne ──────────────────────────── */

  saveSessionId(third);

  const ok = await demoFrom("reports").insert({
    reporter_id: third,
    post_id: MINE,
    reason: "spam",
    details: "Deuxième envoi identique aujourd'hui.",
  });
  check("un signalement avec une seule cible est accepté",
    ok.error === null, ok.error);

  const stored = (await demoFrom("reports")
    .select("id, target_type, status, resolved_at")
    .eq("post_id", MINE)
    .eq("reporter_id", third)).data as Record<string, unknown>[];
  const reportId = String(stored[0]?.id ?? "");
  check("la ligne est bien écrite", stored.length === 1, stored.length);

  // `target_type` est une colonne **générée** : elle se déduit, elle ne se
  // saisit pas. Si le moteur laissait le client la remplir, un écran
  // pourrait afficher « commentaire » à côté d'une publication.
  check("`target_type` est déduit de la cible",
    stored[0]?.target_type === "post", stored[0]?.target_type);
  check("un signalement naît ouvert, sans date de résolution",
    stored[0]?.status === "open" && stored[0]?.resolved_at === null, stored[0]);

  // ── Exactement une cible ─────────────────────────────────────────

  const twoTargets = await demoFrom("reports").insert({
    reporter_id: third,
    post_id: MINE,
    comment_id: "c-1",
    reason: "spam",
  });
  check("deux cibles sur une ligne sont refusées",
    twoTargets.error !== null, twoTargets);
  check("le refus cite la contrainte",
    /reports_one_target|23514/i.test(twoTargets.error?.message ?? ""),
    twoTargets.error?.message);

  const noTarget = await demoFrom("reports").insert({
    reporter_id: third,
    reason: "spam",
  });
  check("une ligne sans cible est refusée", noTarget.error !== null, noTarget);

  // ── On ne se signale pas soi-même ────────────────────────────────

  saveSessionId(authorMine);
  const selfPost = await demoFrom("reports").insert({
    reporter_id: authorMine,
    post_id: MINE,
    reason: "spam",
  });
  check("signaler sa propre publication est refusé",
    selfPost.error !== null, selfPost);

  const selfUser = await demoFrom("reports").insert({
    reporter_id: authorMine,
    reported_user: authorMine,
    reason: "other",
  });
  check("se signaler soi-même est refusé", selfUser.error !== null, selfUser);

  // ── Un seul signalement par personne et par cible ────────────────

  saveSessionId(third);
  const dupe = await demoFrom("reports").insert({
    reporter_id: third,
    post_id: MINE,
    reason: "spam",
  });
  check("signaler deux fois la même cible est refusé",
    dupe.error !== null, dupe);
  check("le refus ressemble à une violation d'unicité",
    /duplicate key|23505/i.test(dupe.error?.message ?? ""), dupe.error?.message);

  // ── Le motif est une énumération fermée ──────────────────────────

  const badReason = await demoFrom("reports").insert({
    reporter_id: third,
    post_id: THEIRS,
    reason: "pas_un_motif",
  });
  check("un motif hors énumération est refusé", badReason.error !== null, badReason);

  /* ── Lecture : la RLS ──────────────────────────────────────────── */

  // L'auteur du contenu visé voit le signalement — c'est le cœur du
  // dispositif : l'auto-modération n'existe que s'il est prévenu.
  saveSessionId(authorMine);
  const seenByAuthor = (await demoFrom("reports").select("id, post_id")).data as {
    post_id: string;
  }[];
  check("l'auteur voit le signalement visant sa publication",
    seenByAuthor.some((r) => r.post_id === MINE), seenByAuthor);

  // Et il ne voit pas celui qui vise la publication d'un autre : c'est
  // le test qui compte, car une RLS trop permissive ne se remarque pas.
  saveSessionId(third);
  await demoFrom("reports").insert({
    reporter_id: third,
    post_id: THEIRS,
    reason: "spam",
  });

  // Les deux moitiés du même test : chacun voit le signalement qui vise
  // **son** contenu, et pas celui qui vise celui du voisin. Vérifier le
  // second point seul suffirait à prouver que la RLS restreint ; vérifier
  // le premier seul prouverait qu'elle ne bloque pas tout. C'est le
  // couple qui prouve qu'elle restreint *juste*.
  saveSessionId(authorTheirs);
  const seenByTheirs = (await demoFrom("reports").select("post_id")).data as {
    post_id: string;
  }[];
  check("l'auteur voit le signalement visant sa propre publication",
    seenByTheirs.some((r) => r.post_id === THEIRS), seenByTheirs);

  saveSessionId(authorMine);
  const isolated = (await demoFrom("reports").select("post_id")).data as { post_id: string }[];
  check("l'auteur ne voit pas le signalement du post d'un autre",
    !isolated.some((r) => r.post_id === THEIRS),
    isolated.map((r) => r.post_id));

  // ── La jointure du signaleur ─────────────────────────────────────
  //
  // Le moteur résout les jointures en cherchant `user_id`, puis
  // `author_id`, puis `actor_id`. Une ligne de signalement n'a aucune des
  // trois : sans `reporter_id` dans cette liste, la jointure trouverait
  // `null` et l'écran afficherait « un compte supprimé » à côté d'un
  // signalement que quelqu'un a pourtant fait.
  const joined = (await demoFrom("reports")
    .select("*, reporter:users(id, pseudo)")
    .eq("reporter_id", third)).data as Record<string, unknown>[];
  const reporter = joined[0]?.reporter as { pseudo?: string } | null;
  check("la jointure du signaleur résout le compte",
    reporter?.pseudo !== undefined, reporter);

  /* ── Classement ────────────────────────────────────────────────── */

  // Le signaleur ne classe pas son propre signalement. Sans ce refus,
  // signaler puis classer ferait disparaître la trace sans qu'elle
  // existe ailleurs.
  saveSessionId(third);
  const selfClassify = await demoFrom("reports")
    .update({ status: "dismissed" })
    .eq("id", reportId);
  check("on ne classe pas son propre signalement",
    selfClassify.error !== null, selfClassify);
  check("le refus est bien un refus de RLS",
    /row-level security|42501/i.test(selfClassify.error?.message ?? ""),
    selfClassify.error?.message);

  // L'auteur visé classe le signalement qu'il a reçu.
  saveSessionId(authorMine);
  const classified = await demoFrom("reports")
    .update({ status: "resolved" })
    .eq("id", reportId)
    .select("id, status, resolved_at")
    .maybeSingle();
  check("l'auteur visé classe le signalement",
    classified.error === null && classified.data !== null, classified);

  const row = classified.data as { status: string; resolved_at: string | null } | null;
  check("le classement est écrit", row?.status === "resolved", row);

  // `resolved_at` est **dérivé** : c'est le trigger qui l'écrit, pas le
  // client. Si le moteur le laissait vide, l'écran afficherait un
  // signalement traité sans date — et la contrainte
  // `reports_resolution_dated` n'aurait plus rien à vérifier.
  check("la date de résolution est posée par le trigger",
    typeof row?.resolved_at === "string" && row.resolved_at !== "",
    row?.resolved_at);

  // Reclasser ne doit pas dater le traitement d'aujourd'hui : sinon
  // l'historique ment sur le moment où l'on a vraiment regardé.
  const reclassified = (await demoFrom("reports")
    .update({ status: "dismissed" })
    .eq("id", reportId)
    .select("status, resolved_at")
    .maybeSingle()).data as { status: string; resolved_at: string } | null;
  check("le reclassement est bien appliqué",
    reclassified?.status === "dismissed", reclassified);
  check("reclasser conserve la date initiale",
    reclassified?.resolved_at === row?.resolved_at,
    { premiere: row?.resolved_at, apres: reclassified?.resolved_at });

  // ── Les colonnes d'un fait ne sont pas modifiables ───────────────

  // C'est la faille qu'une RLS seule ne peut pas fermer : une politique
  // raisonne en lignes, jamais en colonnes. Sans cette protection, on
  // réécrirait `reporter_id` et le signalement deviendrait invisible à
  // celui qui l'a fait.
  const rewrite = await demoFrom("reports")
    .update({ reporter_id: "u-marcus" })
    .eq("id", reportId);
  check("réécrire le signaleant est refusé", rewrite.error !== null, rewrite);
  check("le refus nomme la colonne",
    /reporter_id/.test(rewrite.error?.message ?? ""), rewrite.error?.message);

  const retarget = await demoFrom("reports")
    .update({ post_id: "p-3" })
    .eq("id", reportId);
  check("changer la cible d'un signalement est refusé",
    retarget.error !== null, retarget);

  const handDate = await demoFrom("reports")
    .update({ resolved_at: "2000-01-01T00:00:00.000Z" })
    .eq("id", reportId);
  check("écrire la date de résolution à la main est refusé",
    handDate.error !== null, handDate);

  // ── Un commentaire se signale comme une publication ──────────────

  // La cible change, la règle ne bouge pas : exactement une cible, pas
  // son propre commentaire, l'auteur concerné voit le signalement. Sans
  // ce test, une erreur sur `comment_id` passerait inaperçue — c'est une
  // colonne de plus dans la même contrainte.
  const aComment = String(getStore().comments[0]?.id ?? "");
  const commentAuthor = authorOfComment(aComment);
  check("le jeu de démonstration contient un commentaire à cibler",
    aComment !== "" && commentAuthor !== "", { aComment, commentAuthor });

  saveSessionId(third);
  const onComment = await demoFrom("reports").insert({
    reporter_id: third,
    comment_id: aComment,
    reason: "harassment",
  });
  check("un commentaire se signale", onComment.error === null, onComment);

  const commentReport = (await demoFrom("reports")
    .select("target_type")
    .eq("comment_id", aComment)).data as Record<string, unknown>[];
  check("la cible déduite dit bien « comment »",
    commentReport[0]?.target_type === "comment", commentReport);

  saveSessionId(commentAuthor);
  const seenByCommentAuthor = (await demoFrom("reports")
    .select("comment_id")).data as { comment_id: string }[];
  check("l'auteur du commentaire voit son signalement",
    seenByCommentAuthor.some((r) => r.comment_id === aComment),
    seenByCommentAuthor);

  /* ── Rapport ──────────────────────────────────────────────────── */

  saveSessionId(null);
  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ Le signalement tient ses invariants en démonstration\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});