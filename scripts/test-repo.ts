/**
 * Tests du dépôt — le parcours complet, du projet au commit.
 *
 * Exécuter avec :  npx tsx scripts/test-repo.ts
 *
 * `scripts/test-foundation.ts` vérifie le moteur : qu'un sha calculé
 * ressemble à un sha de `git`. Ce fichier vérifie l'autre moitié — que
 * l'**écran** produit ce sha, en partant d'un projet vide et en y
 * écrivant des fichiers.
 *
 * C'est là que se joue la partie qu'un test du moteur ne voit pas : si le
 * parent n'est pas retrouvé, ou si l'instantané n'est pas écrit au bon
 * endroit, les sha restent parfaitement corrects et le dépôt se comporte
 * mal. Un sha juste ne prouve pas un dépôt juste.
 */

import { resetStore } from "../lib/demo/store";
import {
  commitRepo,
  createBranch,
  deleteBranch,
  fetchBranches,
  fetchCommitDiff,
  fetchCommits,
  fetchPendingChanges,
  fetchPostsForProject,
  fetchProjectsByUser,
  fetchProjectsForPosts,
  fetchProjectsWithCounts,
  fetchRepoFiles,
  fetchScoreHistory,
  linkPostToProject,
  saveRepoFile,
  summarizeRepoScores,
} from "../lib/repo";
import {
  branchErrorText,
  canDeleteBranch,
  validateBranchName,
} from "../lib/git/refs";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

const author = { id: "u-koffi", prenom: "Koffi", email: "koffi@devnet.africa" };

async function main() {
  resetStore();

  const project = "p-1";

  /* ── L'état de travail ──────────────────────────────────────── */

  const initial = await fetchRepoFiles(project);
  check("le dépôt de démonstration a des fichiers", initial.length > 0, initial.length);

  const before = await fetchPendingChanges({ projectId: project });
  check("un dépôt propre n'a rien à enregistrer", before.changes.length === 0,
    before.changes.map((c) => c.path));

  /* ── Écrire un fichier ─────────────────────────────────────── */

  const write = await saveRepoFile({
    projectId: project,
    path: "src/note.txt",
    content: "première version\n",
    userId: author.id,
  });
  check("écriture sans erreur", write.error === null, write.error);

  const files = await fetchRepoFiles(project);
  check("le fichier écrit est dans l'état de travail",
    files.some((f) => f.path === "src/note.txt"), files.map((f) => f.path));
  // L'ordre est celui d'un explorateur : répertoires d'abord, puis les
  // fichiers du dépôt, chaque groupe par nom. Ce n'est pas l'ordre
  // alphabétique brut, et il ne doit pas le devenir — c'est celui qui
  // rend l'arborescence lisible.
  // `journal.py` entre dans la liste : le jeu de démonstration intègre
  // maintenant la fusion d'une demande, qui ajoute ce fichier à `main`.
  check("l'état de travail est trié par explorateur",
    files.map((f) => f.path).join() ===
      "src/note.txt,tests/test_registre.py,journal.py,lecteur.py,registre.py",
    files.map((f) => f.path));

  const saved = files.find((f) => f.path === "src/note.txt")!;
  check("le fichier a un blob sha", saved.blob_sha.length === 40, saved.blob_sha);

  /* ── Chemins refusés ───────────────────────────────────────── */

  // Un chemin qui sort de la racine ne doit jamais atteindre la base.
  for (const bad of ["../evade.txt", "/etc/passwd", "src/../../out.txt", "C:\\win.txt"]) {
    const rejected = await saveRepoFile({
      projectId: project,
      path: bad,
      content: "nope",
      userId: author.id,
    });
    check(`chemin refusé : ${bad}`, rejected.error !== null, rejected);
  }

  const stillThere = await fetchRepoFiles(project);
  check("aucun fichier parasite après les refus",
    !stillThere.some((f) => f.path.includes("evade") || f.path.includes("out.txt")));

  /* ── Les modifications en attente ──────────────────────────── */

  const dirty = await fetchPendingChanges({ projectId: project });
  check("une écriture crée une modification en attente", dirty.changes.length === 1,
    dirty.changes.map((c) => `${c.status} ${c.path}`));
  check("le statut est « ajout » pour un fichier nouveau",
    dirty.changes[0]?.status === "ajout", dirty.changes[0]?.status);
  check("les insertions sont comptées",
    dirty.changes[0]?.insertions === 1, dirty.changes[0]);

  /* ── Enregistrer ───────────────────────────────────────────── */

  const commit = await commitRepo({
    projectId: project,
    message: "ajoute une note",
    author,
  });
  check("le commit est créé", commit.commit !== null, commit.error);
  check("le sha fait 40 caractères",
    (commit.commit?.sha.length ?? 0) === 40, commit.commit?.sha);
  check("le commit a un parent — il y en avait un avant",
    (commit.commit?.parent_sha.length ?? 0) === 40, commit.commit?.parent_sha);
  check("le commit compte un fichier modifié",
    commit.commit?.files_changed === 1, commit.commit?.files_changed);

  const clean = await fetchPendingChanges({ projectId: project });
  check("après le commit, il ne reste rien à enregistrer",
    clean.changes.length === 0, clean.changes.map((c) => c.path));

  /* ── Le même contenu ne produit pas de commit ──────────────── */

  // C'est le défaut le plus grave d'un dépôt mal branché : un historique
  // rempli d'entrées vides.
  const again = await commitRepo({
    projectId: project,
    message: "rien n'a changé",
    author,
  });
  check("committer sans changement ne crée pas de révision",
    again.commit === null, again);
  check("et le dit clairement", again.error !== null, again.error);

  /* ── Un message vide est refusé ────────────────────────────── */

  const empty = await commitRepo({
    projectId: project,
    message: "   ",
    author,
  });
  check("un message vide ne crée pas de révision", empty.commit === null, empty);

  /* ── Modifier un fichier ───────────────────────────────────── */

  await saveRepoFile({
    projectId: project,
    path: "src/note.txt",
    content: "première version\ndeuxième ligne\n",
    userId: author.id,
  });

  const modified = await fetchPendingChanges({ projectId: project });
  check("une modification d'un fichier existant est détectée",
    modified.changes.length === 1 && modified.changes[0].status === "modification",
    modified.changes.map((c) => `${c.status} ${c.path}`));
  check("une ligne ajoutée compte une insertion",
    modified.changes[0].insertions === 1, modified.changes[0]);

  const second = await commitRepo({ projectId: project, message: "ajoute une ligne", author });
  check("le second commit est créé", second.commit !== null, second.error);

  /* ── L'historique ──────────────────────────────────────────── */

  const history = await fetchCommits(project);
  check("l'historique contient au moins deux révisions",
    history.length >= 2, history.length);
  check("l'historique va du plus récent au plus ancien",
    history[0].created_at >= history[1].created_at,
    [history[0]?.created_at, history[1]?.created_at]);
  check("chaque sha fait 40 caractères",
    history.every((c) => c.sha.length === 40), history.map((c) => c.sha.length));

  /* ── Le diff entre deux commits ────────────────────────────── */

  const diff = await fetchCommitDiff({
    projectId: project,
    from: second.commit!.parent_sha,
    to: second.commit!.sha,
  });
  check("le diff porte sur un seul fichier", diff.length === 1, diff.map((d) => d.path));
  check("le diff est une modification, pas un ajout",
    diff[0]?.status === "modification", diff[0]?.status);
  check("le diff montre la ligne ajoutée",
    diff[0]?.lines.some((l) => l.kind === "ajout" && l.text.includes("deuxième")),
    diff[0]?.lines);

  // La chaîne des parents doit être continue : c'est elle qui fait
  // l'historique.
  check("les révisions s'enchaînent sans trou",
    second.commit!.parent_sha === commit.commit!.sha,
    { parent: second.commit!.parent_sha, attendu: commit.commit!.sha });

  /* ── Publication rattachée à un projet ───────────────────────── */

  // Le lien post↔projet est ce qui rend le produit tenable : sans lui, un
  // recruteur voit des phrases et doit deviner s'il y a un dépôt derrière.

  const linked = await linkPostToProject("p-11", project);
  check("publication rattachée sans erreur", linked.error === null, linked);

  const cards = await fetchProjectsWithCounts("u-koffi");

  // On cherche le projet **par identifiant** plutôt qu'en supposant qu'il
  // est seul dans la liste : le jeu de démonstration contient maintenant
  // plusieurs projets, dont certains où `u-koffi` est simple membre. Le
  // test vérifie donc ce qu'il annonce — que *ce* projet apparaît — sans
  // dépendre du nombre total de projets du jeu.
  const card = cards.find((c) => c.id === project);
  check("le projet apparaît pour son propriétaire", card !== undefined, cards.map((c) => c.id));

  if (!card) throw new Error("le projet créé n'est pas revenu par fetchProjectsWithCounts");
  check("la carte compte ses publications", card.postCount === 2, card.postCount);
  // Huit : les six révisions du jeu de démonstration — les trois de
  // `main`, plus les deux de branche et le commit de fusion que la
  // migration 014 rend nécessaires — et les deux créées plus haut dans ce
  // même parcours.
  check("la carte compte ses révisions", card.commitCount === 8, card.commitCount);
  check("la carte nomme la branche", card.branch === "main", card.branch);
  // La dernière révision est celle de la **tête de branche**, lue par la
  // chaîne des parents — pas par horodatage, qui ne distingue pas deux
  // commits tombés dans la même seconde.
  check("la carte reprend la révision de tête de branche",
    card.lastCommitMessage === "ajoute une ligne", card.lastCommitMessage);

  // Une publication appartient à **un seul** projet : changer d'avis ne
  // doit pas laisser deux liens, sinon la carte affiche le premier trouvé
  // et l'auteur ne sait plus ce qu'il a choisi.
  await linkPostToProject("p-11", "p-inexistant");
  const afterSwitch = await fetchProjectsForPosts(["p-11"]);
  check("changer de projet remplace le lien, ne l'ajoute pas",
    afterSwitch.has("p-11") === false, [...afterSwitch.keys()]);

  await linkPostToProject("p-11", project);

  const postsOfProject = await fetchPostsForProject(project);
  check("les publications du projet sont relues",
    postsOfProject.some((p) => p.id === "p-11"), postsOfProject.map((p) => p.id));
  check("leur auteur est résolu par jointure",
    postsOfProject.every((p) => p.author?.pseudo !== undefined),
    postsOfProject.map((p) => p.author?.pseudo));

  const noneLinked = await fetchProjectsForPosts(["p-1", "p-2"]);
  check("une publication sans projet ne renvoie rien",
    noneLinked.size === 0, [...noneLinked.keys()]);

  /* ── La règle des noms de branche ────────────────────────────── */

  // Elle est pure, donc testable seule. Mais elle n'est pas décorative :
  // le nom d'une branche entre dans une clé, et `feat/../main`
  // désignerait `main` sans jamais l'avoir écrit.

  const nomsOk = ["amelioration", "feat/ocr", "correction-2024", "a/b/c", "x"];
  for (const nom of nomsOk) {
    const r = validateBranchName(nom);
    check(`« ${nom} » est un nom de branche valide`, r.ok, r.ok ? "" : branchErrorText(r.reason));
  }

  const nomsRefuses = ["feat/../main", "@", "a~1", "a:b", "a b", "x/", "/x", "a.", ".cache", "main.lock"];
  for (const nom of nomsRefuses) {
    check(`« ${nom} » est refusé`, validateBranchName(nom).ok === false);
  }

  // Les espaces de bord sont rognés **avant** d'être jugés : on colle
  // souvent une branche depuis un autre écran, et refuser la saisie
  // serait plus sévère que nécessaire alors que la rognature ne change
  // pas ce qu'elle veut dire.
  const rogné = validateBranchName("  amelioration  ");
  check("les espaces de bord sont rognés",
    rogné.ok && rogné.name === "amelioration", rogné);

  // Un tiret est le caractère le plus courant d'un nom de branche
  // (`correction-2024`). Le motif de contrôle a déjà été écrit en classe
  // **négée** — il rejetait alors tous les noms qui en contenaient un,
  // sans lever la moindre erreur.
  check("un tiret ne fait pas refuser un nom",
    validateBranchName("correction-2024").ok === true);

  check("la branche par défaut ne peut pas être supprimée",
    canDeleteBranch({ name: "main", defaultBranch: "main", remaining: 3 }).ok === false);
  check("une branche ordinaire peut être supprimée",
    canDeleteBranch({ name: "feat", defaultBranch: "main", remaining: 3 }).ok === true);
  check("la dernière branche restante est protégée",
    canDeleteBranch({ name: "feat", defaultBranch: "main", remaining: 1 }).ok === false);

  /* ── Les branches ────────────────────────────────────────────── */

  // C'est ce que la migration 012 a rendu possible. Le test le plus
  // important est le dernier : deux branches doivent avoir des fichiers
  // **différents**, sans quoi une pull request n'a rien à comparer et
  // « travailler sur une branche » ne veut rien dire.

  const branchesAvant = await fetchBranches(project);
  check("le dépôt a une branche", branchesAvant.length >= 1, branchesAvant.length);

  const creation = await createBranch({ projectId: project, name: "amelioration", from: "main" });
  check("une branche se crée sans erreur", creation.error === null, creation.error);

  const refs = await fetchBranches(project);
  check("la branche apparaît dans la liste",
    refs.some((b) => b.name === "amelioration"), refs.map((b) => b.name));

  // Une branche naît **copiée** de celle dont elle part. Sans la copie,
  // elle existerait en graphiques et serait vide à l'écran — on
  // verrait un dépôt sans fichier, ce qui semble fonctionner.
  const copie = await fetchRepoFiles(project, "amelioration");
  const principal = await fetchRepoFiles(project, "main");
  check("la branche reçoit une copie des fichiers",
    copie.length === principal.length && copie.length > 0,
    { branche: copie.length, main: principal.length });

  // La branche démarre sur le commit de tête de `main` : c'est ce qui
  // en fait une branche et non un projet.
  const teteMain = refs.find((b) => b.name === "main")?.sha ?? "";
  const teteBranche = refs.find((b) => b.name === "amelioration")?.sha ?? "";
  check("la branche part du même commit que main",
    teteBranche === teteMain && teteBranche.length === 40, { teteMain, teteBranche });

  // Un nom déjà pris n'est pas dupliqué — sinon deux écritures
  // désignent la même branche, et laquelle est « la bonne » ?
  const doublon = await createBranch({ projectId: project, name: "amelioration", from: "main" });
  check("un nom déjà pris est refusé",
    doublon.error !== null, doublon.error);
  check("un nom invalide est refusé avant toute écriture",
    (await createBranch({ projectId: project, name: "feat/../main", from: "main" })).error !== null);

  // ── L'isolation : le cœur du lot ──

  await saveRepoFile({
    projectId: project,
    path: "src/note.txt",
    content: "version de la branche\n",
    userId: author.id,
    branch: "amelioration",
  });

  const surBranche = await fetchRepoFiles(project, "amelioration");
  const surPrincipale = await fetchRepoFiles(project, "main");
  check("un fichier écrit sur une branche n'apparaît pas sur l'autre",
    surBranche.find((f) => f.path === "src/note.txt")?.content === "version de la branche\n" &&
    surPrincipale.find((f) => f.path === "src/note.txt")?.content !== "version de la branche\n",
    {
      branche: surBranche.find((f) => f.path === "src/note.txt")?.content,
      main: surPrincipale.find((f) => f.path === "src/note.txt")?.content,
    });

  // Un même chemin sur deux branches est **deux** fichiers. Avec une clé
  // d'unicité à deux colonnes, le second écrasait le premier et le dépôt
  // perdait un fichier — en silence, et sans le moindre avertissement.
  check("le même chemin existe bien sur les deux branches",
    surBranche.some((f) => f.path === "src/note.txt") &&
    surPrincipale.some((f) => f.path === "src/note.txt"),
    { branche: surBranche.length, main: surPrincipale.length });

  // Les modifications en attente sont celles de **la branche** : comparer
  // l'état de `main` à la tête de `amelioration` afficherait comme
  // « modifiés » des fichiers que personne n'a touchés.
  const attenteBranche = await fetchPendingChanges({
    projectId: project,
    branch: "amelioration",
  });
  check("les modifications en attente sont celles de la branche",
    attenteBranche.changes.length === 1 &&
    attenteBranche.changes[0].path === "src/note.txt",
    attenteBranche.changes.map((c) => c.path));

  const attentePrincipale = await fetchPendingChanges({
    projectId: project,
    branch: "main",
  });
  check("main n'a rien à enregistrer pendant que la branche travaille",
    attentePrincipale.changes.length === 0,
    attentePrincipale.changes.map((c) => c.path));

  // L'historique suit la branche. Avant, il affichait toutes les
  // révisions du projet : dès qu'un dépôt en a deux, on y lisait le
  // travail de l'autre.
  const histoBranche = await fetchCommits(project, "amelioration");
  check("l'historique d'une brancheissue d'une autre la contient",
    histoBranche.length === (await fetchCommits(project, "main")).length,
    { branche: histoBranche.length, main: (await fetchCommits(project, "main")).length });

  const commitBranche = await commitRepo({
    projectId: project,
    branch: "amelioration",
    message: "travail sur la branche",
    author,
  });
  check("la branche peut enregistrer sa propre révision",
    commitBranche.commit !== null, commitBranche.error);

  const apresCommitBranche = await fetchCommits(project, "amelioration");
  const apresCommitMain = await fetchCommits(project, "main");
  check("la révision appartient à une seule branche",
    apresCommitBranche.length === apresCommitMain.length + 1,
    { branche: apresCommitBranche.length, main: apresCommitMain.length });
  check("main ne voit pas la révision de la branche",
    !apresCommitMain.some((c) => c.message === "travail sur la branche"),
    apresCommitMain.map((c) => c.message));

  // Et surtout : la différence entre les deux branches est réelle. C'est
  // ce que comparera une pull request — sans cela, le dépôt n'a qu'un
  // seul état, quelle que soit la branche affichée.
  const ecart = await fetchCommitDiff({
    projectId: project,
    from: apresCommitMain[0].sha,
    to: apresCommitBranche[0].sha,
  });
  check("les deux branches ont un écart réel",
    ecart.length === 1 && ecart[0].path === "src/note.txt",
    ecart.map((d) => d.path));

  // ── Suppression ──

  const garde = await deleteBranch({
    projectId: project,
    name: "main",
    defaultBranch: "main",
    remaining: 2,
  });
  check("la branche par défaut est protégée",
    garde.error !== null, garde.error);

  const avant = (await fetchBranches(project)).length;
  const suppression = await deleteBranch({
    projectId: project,
    name: "amelioration",
    defaultBranch: "main",
    remaining: avant,
  });
  check("une branche se supprime sans erreur", suppression.error === null, suppression.error);
  check("la branche disparaît de la liste",
    !(await fetchBranches(project)).some((b) => b.name === "amelioration"),
    (await fetchBranches(project)).map((b) => b.name));
  check("ses fichiers disparaissent avec elle",
    (await fetchRepoFiles(project, "amelioration")).length === 0,
    (await fetchRepoFiles(project, "amelioration")).map((f) => f.path));

  /* ── La courbe du score, commit par commit ──────────────────── */

  const courbe = await fetchScoreHistory({ projectId: project, branch: "main" });
  check("l'historique du score a des points", courbe.points.length >= 2, courbe.points.length);
  check("aucune révision de main n'est ignorée", courbe.skipped === 0, courbe.skipped);
  check("les points sont dans l'ordre chronologique",
    courbe.points.every((p, i) => i === 0 || courbe.points[i - 1].at <= p.at),
    courbe.points.map((p) => p.at));
  check("le dernier point est le sommet de la branche",
    courbe.points[courbe.points.length - 1].sha === (await fetchCommits(project, "main"))[0].sha,
    courbe.points[courbe.points.length - 1].sha);
  check("chaque point porte une note bornée",
    courbe.points.every((p) => p.score >= 0 && p.score <= 1000),
    courbe.points.map((p) => p.score));
  check("chaque point dit combien de fichiers ont changé",
    courbe.points.every((p) => p.changedFiles > 0),
    courbe.points.map((p) => p.changedFiles));
  // Le cache par SHA de blob est ce qui rend la courbe praticable : un
  // fichier identique entre deux révisions n'est pas analysé deux fois.
  check("des fichiers inchangés ont été réutilisés depuis le cache", courbe.reused > 0, courbe.reused);

  // La limite compte : vingt points font une courbe, deux cents font une
  // requête par commit pour un dessin que personne ne lit.
  const courte = await fetchScoreHistory({ projectId: project, branch: "main", limit: 2 });
  check("la limite est respectée", courte.points.length === 2, courte.points.length);
  check("la limite garde les révisions les plus récentes",
    courte.points[1].sha === courbe.points[courbe.points.length - 1].sha,
    courte.points.map((p) => p.sha));
  check("le total reste celui de la branche", courte.total === courbe.total, courte.total);

  /* ── L'histoire doit aller dans le sens du temps ─────────────── */

  // Invariant de **données de démonstration**, pas du moteur : git tolère
  // des dates désordonnées (horloge déréglée, rebase), mais une histoire
  // qui remonte le temps à l'écran se lit comme un dépôt cassé. C'est en
  // traçant la courbe que ce défaut a été vu — la fusion, sommet de
  // `main`, était datée six jours **avant** son propre parent.
  const chaine = await fetchCommits(project, "main");
  const parSha = new Map(chaine.map((c) => [c.sha, c]));
  const inversions = chaine.filter((c) => {
    const parent = c.parent_sha ? parSha.get(c.parent_sha) : undefined;
    // Un enfant daté **avant** son parent : l'histoire remonte le temps.
    return parent ? c.created_at < parent.created_at : false;
  });
  check("aucune révision n'est datée avant son parent",
    inversions.length === 0,
    inversions.map((c) => `${c.sha.slice(0, 7)} ${c.created_at}`));

  /* ── Rapport ────────────────────────────────────────────────── */

  /* ── La trajectoire des dépôts ─────────────────────────────── */

  // La synthèse qui alimente le profil et la liste des projets : la
  // moyenne, le meilleur, et la trajectoire. Ce sont les mêmes chiffres
  // partout, donc c'est ici qu'ils se vérifient — une incohérence entre
  // trois écrans ne se verrait qu'en comparant trois captures d'écran.
  const cartes = await fetchProjectsByUser("u-koffi");
  const synthese = await summarizeRepoScores(cartes);

  check("la série porte exactement les dépôts analysables",
    synthese.series.length === synthese.count,
    { series: synthese.series.length, count: synthese.count });
  check("la série ne contient que des dépôts notés",
    synthese.series.every((score) => score > 0),
    synthese.series);
  check("la moyenne est celle de la série",
    synthese.average === Math.round(synthese.series.reduce((a, b) => a + b, 0) / synthese.series.length),
    { average: synthese.average, series: synthese.series });
  check("le meilleur est le maximum de la série",
    synthese.best === Math.max(...synthese.series), synthese.best);
  check("la trajectoire lit la série",
    synthese.trajectory.count === synthese.series.length, synthese.trajectory.count);

  // Le tri ne doit pas dépendre de l'ordre d'entrée : c'est la date de
  // dernière activité qui décide, pas la requête. Une trajectoire qui
  // s'inverserait selon la page qui l'appelle serait un dessin menteur.
  const renverse = await summarizeRepoScores([...cartes].reverse());
  check("la trajectoire ne dépend pas de l'ordre d'entrée",
    renverse.series.join(",") === synthese.series.join(","),
    { normal: synthese.series, renverse: renverse.series });

  // Un dépôt vide ne prouve rien, mais il ne **régresse** pas non plus :
  // l'inclure à zéro ferait dire à la courbe qu'un travail a été perdu.
  const avecVide = await summarizeRepoScores([
    ...cartes,
    { id: "p-3", default_branch: "main", lastCommitAt: new Date().toISOString() },
  ]);
  check("un dépôt sans contenu ne change ni la série ni la moyenne",
    avecVide.series.join(",") === synthese.series.join(",") && avecVide.average === synthese.average,
    { avant: synthese.series, apres: avecVide.series });

  // Un seul dépôt n'a pas de trajectoire : l'écart à lui-même vaut zéro, et
  // la carte ne s'affiche d'ailleurs qu'à partir de deux.
  const uneSeule = await summarizeRepoScores(cartes.slice(0, 1));
  check("un seul dépôt donne une trajectoire plate",
    uneSeule.trajectory.trend === "stable" && uneSeule.trajectory.delta === 0,
    uneSeule.trajectory);

  /* ── Rapport ───────────────────────────────────────────────── */

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ Le dépôt produit de vraies révisions, de l'écriture au diff\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});