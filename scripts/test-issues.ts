/**
 * Tests des issues.
 *
 * Exécuter avec :  npx tsx scripts/test-issues.ts
 *
 * Le point que ces tests gardent est presque toujours le même dans ce
 * projet : **ce qui est calculé ne doit pas être écrit par le client**.
 * Le numéro d'une issue vient d'un déclencheur, la date de fermeture
 * aussi. Un mode démo qui ne rejoue pas ces déclencheurs affiche des
 * issues « #null » non fermées — et l'écran paraît casser alors que le
 * code est juste.
 */

import { resetStore } from "../lib/demo/store";
import {
  addIssueComment,
  createIssue,
  deleteIssue,
  fetchIssueComments,
  fetchIssues,
  fetchOpenIssueCount,
  setIssueStatus,
} from "../lib/issues";
import { timeAgo } from "../lib/utils";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

const author = { id: "u-koffi" };
const project = "p-1";

async function main() {
  resetStore();

  /* ── Le jeu de démonstration ──────────────────────────────────── */

  const issues = await fetchIssues(project);

  check("le dépôt de démonstration a des issues", issues.length === 3, issues.length);
  check("les issues ont un numéro", issues.every((i) => typeof i.number === "number"),
    issues.map((i) => i.number));
  check("aucune issue n'est numérotée nulle", !issues.some((i) => i.number === null || i.number === undefined),
    issues.map((i) => i.number));

  // Le jeu n'a aucun intérêt sans discussion : une issue sans réponse ne
  // prouve rien du fonctionnement de la discussion.
  const withComments = await fetchIssueComments(issues[0].id);
  check("la première issue est discutée", withComments.length === 3, withComments.length);
  check("les commentaires ont un auteur résolu",
    withComments.every((c) => c.author?.pseudo !== undefined),
    withComments.map((c) => c.author?.pseudo));

  /* ── Le compteur ──────────────────────────────────────────────── */

  // Le compteur venait de `.select("id", { count: "exact", head: true })`,
  // que le moteur de démonstration ne comprenait pas : il renvoyait zéro.
  // L'en-tête affichait « Issues 0 » pendant que la liste en montrait
  // trois. Le compte est pris **sur les lignes filtrées**.
  const ouvertes = await fetchOpenIssueCount(project);
  check("le compteur d'issues ouvertes est juste",
    ouvertes === issues.filter((i) => i.status === "open").length,
    { compteur: ouvertes, reel: issues.filter((i) => i.status === "open").length });
  check("le compteur n'est jamais nul quand la liste est pleine", ouvertes > 0, ouvertes);

  /* ── La numérotation ─────────────────────────────────────────── */

  const dejaPrise = issues.map((i) => i.number);
  const creee = await createIssue({
    projectId: project,
    authorId: author.id,
    title: "Le total affiche une livre en trop",
    body: "Sur la tournée de mardi, le total est supérieur de 1 kg à la somme des livraisons.",
  });

  check("une issue se crée sans erreur", creee.error === null, creee.error);
  check("la nouvelle issue reçoit un numéro",
    typeof creee.issue?.number === "number" && creee.issue.number > 0, creee.issue?.number);

  // Le numéro doit suivre le plus grand existant, pas le nombre de
  // lignes : un numéro déjà pris s'affiche deux fois, et la discussion
  // que les gens ont eue à son sujet se retrouve dispersée.
  check("le numéro ne répète aucun numéro existant",
    !dejaPrise.includes(creee.issue!.number),
    { nouveau: creee.issue!.number, existants: dejaPrise });

  // Le client n'envoie pas de numéro : le déclencheur le calcule. S'il
  // l'envoyait, la condition du déclencheur (`si new.number is null`)
  // serait fausse et l'issue naîtrait sans numéro.
  const sansNumero = await createIssue({
    projectId: project,
    authorId: author.id,
    title: "Une deuxième issue",
  });
  check("deux issues consécutives ont des numéros distincts",
    sansNumero.issue!.number === creee.issue!.number + 1,
    { premier: creee.issue!.number, second: sansNumero.issue!.number });

  /* ── Un titre trop court ─────────────────────────────────────── */

  const tropCourt = await createIssue({
    projectId: project,
    authorId: author.id,
    title: "x",
  });
  check("un titre trop court est refusé", tropCourt.error !== null, tropCourt.error);
  check("un titre trop court ne crée rien", tropCourt.issue === null);

  const tropLong = await createIssue({
    projectId: project,
    authorId: author.id,
    title: "a".repeat(200),
  });
  check("un titre trop long est refusé", tropLong.error !== null, tropLong.error);

  /* ── La discussion ───────────────────────────────────────────── */

  const vide = await addIssueComment({ issueId: creee.issue!.id, authorId: author.id, body: "   " });
  check("un commentaire vide est refusé", vide.error !== null, vide.error);

  const reponse = await addIssueComment({
    issueId: creee.issue!.id,
    authorId: "u-zainab",
    body: "Je reproduis : c'est la conversion kg → livres qui arrondit.",
  });
  check("un commentaire s'écrit sans erreur", reponse.error === null, reponse.error);

  const apres = await fetchIssueComments(creee.issue!.id);
  check("le commentaire est relu", apres.length === 1, apres.length);
  check("le commentaire garde son auteur", apres[0].author?.id === "u-zainab", apres[0].author);

  // L'ordre est celui du fil : la réponse arrive après la question. Un tri
  // inverse ferait lire une objection avant ce qui la déclenche.
  check("les commentaires sont dans l'ordre du fil",
    apres[0].created_at <= new Date().toISOString(), apres[0].created_at);

  /* ── Fermer et rouvrir ────────────────────────────────────────── */

  // Le compte est relu **ici**, et non depuis le début : deux issues ont
  // été créées entre les deux, et c'est la seule façon que l'écart
  // mesuré soit l'écart réel. Un test qui compare à une valeur prise
  // dix étapes plus tôt échoue pour une raison qui n'a rien à voir avec
  // ce qu'il vérifie — et on le corrige alors en relâchant l'assertion.
  const avantFermeture = await fetchOpenIssueCount(project);

  const fermeture = await setIssueStatus(creee.issue!.id, "closed");
  check("une issue se ferme sans erreur", fermeture.error === null, fermeture.error);

  const fermee = (await fetchIssues(project)).find((i) => i.id === creee.issue!.id);
  check("l'issue est fermée", fermee?.status === "closed", fermee?.status);

  // La date est **dérivée**. Le client n'en envoie pas : une date
  // écrite par lui serait fausse, et la contrainte SQL
  // `issues_closure_dated` la refuserait en base alors que la démo
  // l'accepterait.
  check("une issue fermée porte une date de fermeture",
    fermee?.closed_at !== null && fermee?.closed_at !== undefined, fermee?.closed_at);

  const ouvertesApres = await fetchOpenIssueCount(project);
  check("le compteur baisse d'exactement un après fermeture",
    ouvertesApres === avantFermeture - 1,
    { avant: avantFermeture, apres: ouvertesApres });

  // On écrit sur une issue fermée : la question « et ensuite ? » se pose
  // trois mois plus tard, et sa réponse doit rester sous la question.
  const surFermee = await addIssueComment({
    issueId: creee.issue!.id,
    authorId: "u-thabo",
    body: "Confirmé, c'est l'arrondi. Je corrige la conversion.",
  });
  check("on peut répondre sur une issue fermée", surFermee.error === null, surFermee.error);

  const reouverture = await setIssueStatus(creee.issue!.id, "open");
  check("une issue se rouvre sans erreur", reouverture.error === null, reouverture.error);

  const rouverte = (await fetchIssues(project)).find((i) => i.id === creee.issue!.id);
  check("l'issue est rouverte", rouverte?.status === "open", rouverte?.status);
  check("une issue rouverte n'a plus de date de fermeture",
    rouverte?.closed_at === null, rouverte?.closed_at);

  /* ── La suppression ──────────────────────────────────────────── */

  const jetable = await createIssue({
    projectId: project,
    authorId: author.id,
    title: "Une issue qu'on va retirer",
  });

  await addIssueComment({
    issueId: jetable.issue!.id,
    authorId: author.id,
    body: "Message qui part avec elle.",
  });

  const avant = (await fetchIssues(project)).length;
  const retrait = await deleteIssue(jetable.issue!.id);
  check("une issue se supprime sans erreur", retrait.error === null, retrait.error);
  check("l'issue disparaît de la liste",
    (await fetchIssues(project)).length === avant - 1, avant);

  // Les commentaires partent **avec** l'issue, en cascade. Une discussion
  // orpheline n'appartient à rien et ne s'affiche nulle part.
  check("les commentaires partent avec leur issue",
    (await fetchIssueComments(jetable.issue!.id)).length === 0);

  /* ── Le temps relatif, vu par les issues ─────────────────────── */

  // Deux bugs d'affichage se sont rencontrés ici : `timeAgo` divisait par
  // 864800 au lieu de 86400, et une issue de deux jours affichait « il y a
  // 0 j ». Le test vérifie que l'écran ne ment plus sur l'ancienneté.
  const hier = (await fetchIssues(project))[0];
  check("l'ancienneté affichée est plausible",
    !timeAgo(hier.created_at).includes("0 j"),
    { cree: hier.created_at, affiche: timeAgo(hier.created_at) });

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ Les issues se numérotent, se discutent et se ferment\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});