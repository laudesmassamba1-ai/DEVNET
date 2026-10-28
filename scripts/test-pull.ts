/**
 * Tests des pull requests.
 *
 * Exécuter avec :  npx tsx scripts/test-pull.ts
 *
 * Trois choses sont gardées ici, et ce sont les trois où une erreur ne
 * produirait **aucun message** :
 *
 * 1. **Le moteur pur** (`lib/git/pull.ts`) : « peut-on fusionner ? » est
 *    une décision, et une décision fausse ne casse rien — elle fusionne
 *    ou refuse à tort. C'est le genre de code qui se teste sans base ni
 *    navigateur, et qui ne se relit pas à l'œil.
 * 2. **La parité démo / base** : le numéro et la date de fusion viennent
 *    de déclencheurs. Une démo qui ne les rejoue pas affiche des demandes
 *    « #null » sans date — et l'écran paraît cassé alors qu'il est juste.
 * 3. **La fusion elle-même** : la destination reçoit le contenu de la
 *    source, et **rien d'autre**. Une fusion qui écrase la destination
 *    ferait perdre le travail de ceux qui n'ont pas fusionné.
 */

import { resetStore } from "../lib/demo/store";
import { createCommit, type Commit, type RepoFile } from "../lib/git/history";
import { hashBlob } from "../lib/git/objects";
import {
  apportDeLaBranche,
  appliquerBranche,
  baseDeFusion,
  commitsAbsentsDe,
  messageFusion,
  resumePullRequest,
  verifierFusion,
} from "../lib/git/pull";
import {
  createPullRequest,
  fetchOpenPullRequestCount,
  fetchOpenPullRequestForBranch,
  fetchPullRequestDiff,
  fetchPullRequests,
  judgePullRequest,
  mergePullRequest,
  setPullRequestStatus,
} from "../lib/pull";
import { fetchBranches, fetchRepoFiles } from "../lib/repo";

let passed = 0;
const failures: string[] = [];

function check(nom: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${nom}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

const projet = "p-1";
const moi = {
  id: "u-koffi",
  prenom: "Koffi",
  email: "koffi@devnet.africa",
};

/* ── Le moteur pur, sans base ──────────────────────────────────── */

/** Un fichier de dépôt, avec son sha de blob. */
function fichier(chemin: string, contenu: string): RepoFile {
  return { path: chemin, content: contenu, blob_sha: hashBlob(contenu) };
}

/** Un commit de test, à l'heure fixée, donc reproductible. */
function commit(options: {
  files: RepoFile[];
  parent?: Commit | null;
  parentFiles?: RepoFile[];
  message: string;
  when: number;
}): Commit {
  const c = createCommit({
    files: options.files,
    parent: options.parent ?? null,
    parentFiles: options.parentFiles,
    authorId: "u-test",
    authorName: "Test",
    authorEmail: "test@devnet.africa",
    message: options.message,
    when: options.when,
  });

  if (!c) throw new Error("commit nul : le message est vide ?");
  return c;
}

function moteurPur(): void {
  const base: RepoFile[] = [
    fichier("registre.py", "a\nb\n"),
    fichier("lecteur.py", "x\n"),
  ];

  const depart = commit({ files: base, message: "départ", when: 1_000 });

  // La branche de travail modifie `registre.py` et ajoute `journal.py`.
  // Elle ne touche **pas** `lecteur.py`.
  const sourceFiles: RepoFile[] = [
    fichier("registre.py", "a\nb\nc\n"),
    fichier("lecteur.py", "x\n"),
    fichier("journal.py", "j\n"),
  ];

  const source = commit({
    files: sourceFiles,
    parent: depart,
    parentFiles: base,
    message: "travail",
    when: 2_000,
  });

  // La destination n'a pas bougé depuis le départ de la branche.
  check(
    "une destination immobile est fusionnable",
    verifierFusion({
      source: { nom: "travail", fichiers: sourceFiles, sommet: source.sha },
      cible: { nom: "main", fichiers: base, sommet: depart.sha },
      base,
      commits: [source, depart],
      cheminsCibles: [],
    }).fusionnable === true,
  );

  // La destination a reçu un commit qui ne touche **pas** les fichiers de
  // la branche : c'est le cas le plus fréquent en équipe, et la
  // fusion doit rester possible.
  const apres = commit({
    files: [fichier("registre.py", "a\nb\n"), fichier("lecteur.py", "x\ny\n")],
    parent: depart,
    parentFiles: base,
    message: "autre travail",
    when: 3_000,
  });

  const cibleApres: RepoFile[] = [
    fichier("registre.py", "a\nb\n"),
    fichier("lecteur.py", "x\ny\n"),
  ];

  const disjoint = verifierFusion({
    source: { nom: "travail", fichiers: sourceFiles, sommet: source.sha },
    cible: { nom: "main", fichiers: cibleApres, sommet: apres.sha },
    base,
    commits: [source, apres, depart],
    cheminsCibles: ["lecteur.py"],
  });

  check("une destination qui a bougé ailleurs reste fusionnable", disjoint.fusionnable === true, disjoint.raison);
  check("un verdict favorable ne nomme aucun fichier", disjoint.fichiers.length === 0, disjoint.fichiers);

  // La destination a touché le **même** fichier que la branche :
  // conflit, nommé.
  const conflit = verifierFusion({
    source: { nom: "travail", fichiers: sourceFiles, sommet: source.sha },
    cible: {
      nom: "main",
      fichiers: [fichier("registre.py", "a\nb\nc\nd\n"), fichier("lecteur.py", "x\ny\n")],
      sommet: apres.sha,
    },
    base,
    commits: [source, apres, depart],
    cheminsCibles: ["registre.py", "lecteur.py"],
  });

  check("un fichier touché des deux côtés est un conflit", conflit.fusionnable === false, conflit.raison);
  check("le conflit nomme le fichier en cause",
    conflit.fichiers.length === 1 && conflit.fichiers[0] === "registre.py", conflit.fichiers);

  // Sans savoir quels fichiers la destination a touchés, on refuse.
  const aveugle = verifierFusion({
    source: { nom: "travail", fichiers: sourceFiles, sommet: source.sha },
    cible: { nom: "main", fichiers: cibleApres, sommet: apres.sha },
    base,
    commits: [source, apres, depart],
    cheminsCibles: null,
  });

  check("une destination illisible fait refuser la fusion", aveugle.fusionnable === false, aveugle.raison);

  // Base introuvable : refus, et non diff entre deux sommets.
  const sansBase = verifierFusion({
    source: { nom: "travail", fichiers: sourceFiles, sommet: source.sha },
    cible: { nom: "main", fichiers: cibleApres, sommet: apres.sha },
    base: null,
    commits: [source, apres, depart],
    cheminsCibles: ["lecteur.py"],
  });

  check("une base introuvable fait refuser la fusion", sansBase.fusionnable === false, sansBase.raison);

  // Deux branches au même contenu : rien à faire.
  const identique = verifierFusion({
    source: { nom: "copie", fichiers: base, sommet: depart.sha },
    cible: { nom: "main", fichiers: base, sommet: depart.sha },
    base,
    commits: [depart],
    cheminsCibles: [],
  });

  check("une branche qui n'apporte rien ne se fusionne pas", identique.fusionnable === false, identique.raison);

  // Une branche dans elle-même.
  const soiMeme = verifierFusion({
    source: { nom: "main", fichiers: sourceFiles, sommet: source.sha },
    cible: { nom: "main", fichiers: base, sommet: depart.sha },
    base,
    commits: [source, depart],
    cheminsCibles: [],
  });

  check("une branche ne se fusionne pas dans elle-même", soiMeme.fusionnable === false, soiMeme.raison);

  /* ── La base de fusion ──────────────────────────────────────── */

  check("la base est le départ quand la destination n'a pas bougé",
    baseDeFusion([source, depart], depart.sha, source.sha) === depart.sha,
    baseDeFusion([source, depart], depart.sha, source.sha));

  check("la base est le sommet quand la destination a progressé",
    baseDeFusion([source, apres, depart], apres.sha, source.sha) === depart.sha,
    baseDeFusion([source, apres, depart], apres.sha, source.sha));

  check("la destination a un commit propre quand elle a bougé",
    commitsAbsentsDe([source, apres, depart], apres.sha, source.sha).length === 1);

  check("la destination n'a rien en propre quand elle n'a pas bougé",
    commitsAbsentsDe([source, depart], depart.sha, source.sha).length === 0);

  // Un cycle ne doit pas faire boucler la traversée.
  const boucle: Commit[] = [
    { ...depart, parent_sha: apres.sha },
    { ...apres, parent_sha: depart.sha },
  ];
  check("une chaîne de parents circulaire se termine",
    commitsAbsentsDe(boucle, depart.sha, source.sha).length <= 2);

  /* ── L'application de la branche ─────────────────────────────── */

  // C'est ici que se joue le vrai risque : la destination a modifié
  // `lecteur.py` après le départ de la branche. Appliquer le contenu
  // entier de la source l'effacerait, et ce travail disparaîtrait sans
  // qu'aucune ligne ne le dise.
  const fusionne = appliquerBranche({ base, cible: cibleApres, source: sourceFiles });

  check("la fusion applique les changements de la branche",
    fusionne.find((f) => f.path === "registre.py")?.content === "a\nb\nc\n",
    fusionne.find((f) => f.path === "registre.py")?.content);

  check("la fusion laisse le travail de la destination intact",
    fusionne.find((f) => f.path === "lecteur.py")?.content === "x\ny\n",
    fusionne.find((f) => f.path === "lecteur.py")?.content);

  check("la fusion ajoute le fichier nouveau de la branche",
    fusionne.some((f) => f.path === "journal.py"));

  // Une suppression demandée par la branche est une suppression.
  const cibleAvecTrop: RepoFile[] = [...cibleApres, fichier("obsolete.py", "vieux\n")];
  const apresSuppression = appliquerBranche({
    base: [...base, fichier("obsolete.py", "vieux\n")],
    cible: cibleAvecTrop,
    source: sourceFiles,
  });
  check("la fusion supprime ce que la branche a supprimé",
    !apresSuppression.some((f) => f.path === "obsolete.py"));

  // Deux fois la même opération donne deux fois le même résultat : c'est
  // ce qui permet à deux écrans de montrer la même liste.
  check("l'application est déterministe",
    JSON.stringify(fusionne) ===
      JSON.stringify(appliquerBranche({ base, cible: cibleApres, source: sourceFiles })));

  // L'apport d'une branche : ce que l'onglet de la demande montre. Il
  // compte les changements de la branche, **pas** la différence entre
  // les deux sommets — sinon il afficherait comme suppressions tout ce que
  // la destination a fait depuis le départ.
  const apport = apportDeLaBranche(base, sourceFiles);
  check("l'apport de la branche ne compte que ses propres fichiers",
    apport.length === 2 && apport.every((d) => d.status !== "suppression"),
    apport.map((d) => `${d.path}:${d.status}`));

  check("une base absente donne un apport vide plutôt qu'un diff faux",
    apportDeLaBranche(null, sourceFiles).length === 0);

  /* ── Les messages ────────────────────────────────────────────── */

  check("le message de fusion nomme la demande et son titre",
    messageFusion(7, "Journal d'audit") === "Fusion de la pull request #7 — Journal d'audit",
    messageFusion(7, "Journal d'audit"));

  const resume = resumePullRequest({
    numero: 2,
    titre: "Valider le code-barres",
    source: "lecture-code-barres",
    cible: "main",
    changements: [{ path: "lecteur.py", insertions: 6, deletions: 1 } as never],
  });

  check("le résumé annonce le numéro, les branches et les nombres",
    resume.includes("#2") && resume.includes("lecture-code-barres → main") && resume.includes("+6 −1"),
    resume);

  check("le résumé ne parle pas de relecture alors qu'il n'y en a pas",
    !resume.includes("revue"), resume);
}

async function donnees(): Promise<void> {
  resetStore();

  /* ── Le jeu de démonstration ─────────────────────────────────── */

  const demandes = await fetchPullRequests(projet);

  check("le dépôt de démonstration a des demandes", demandes.length === 2, demandes.length);
  check("les demandes sont numérotées",
    demandes.every((d) => typeof d.number === "number"),
    demandes.map((d) => d.number));
  check("les demandes ont un auteur résolu",
    demandes.every((d) => d.author?.pseudo !== undefined),
    demandes.map((d) => d.author?.pseudo));

  const fusionnee = demandes.find((d) => d.status === "fusionnee");
  const ouverte = demandes.find((d) => d.status === "ouverte");

  check("une demande est ouverte et une autre fusionnée",
    Boolean(fusionnee && ouverte), demandes.map((d) => d.status));

  // La date de fusion vient du déclencheur : une demande fusionnée sans
  // date est un état que la base rend impossible.
  check("la demande fusionnée porte une date", Boolean(fusionnee?.merged_at), fusionnee?.merged_at);
  check("la demande fusionnée porte un auteur de fusion",
    Boolean(fusionnee?.merged_by), fusionnee?.merged_by);
  check("la demande ouverte n'a ni date ni auteur de fusion",
    ouverte?.merged_at === null && ouverte?.merged_by === null,
    { merged_at: ouverte?.merged_at, merged_by: ouverte?.merged_by });

  const compteur = await fetchOpenPullRequestCount(projet);
  check("le compteur de demandes ouvertes est juste",
    compteur === demandes.filter((d) => d.status === "ouverte").length,
    { compteur, reel: demandes.filter((d) => d.status === "ouverte").length });

  /* ── Le diff d'une demande ouverte ───────────────────────────── */

  const diff = await fetchPullRequestDiff(projet, ouverte!);

  check("la demande ouverte a des changements à montrer", diff.length > 0, diff.length);
  check("le diff ne montre que ce que la source apporte",
    diff.every((d) => d.status === "ajout" || d.status === "modification"),
    diff.map((d) => `${d.path}:${d.status}`));
  check("le diff porte des lignes à afficher",
    diff.every((d) => d.lines.length > 0));

  // La demande fusionnée : la branche a disparu, et les deux branches
  // ont désormais le même contenu. Le panneau doit le dire, pas planter.
  const diffFusionnee = await fetchPullRequestDiff(projet, fusionnee!);
  check("une demande dont la branche a disparu ne plante pas",
    Array.isArray(diffFusionnee), diffFusionnee.length);

  const verdictFusionnee = await judgePullRequest(projet, fusionnee!);
  check("une demande déjà intégrée n'est pas fusionnable",
    verdictFusionnee.fusionnable === false, verdictFusionnee.raison);

  /* ── Le verdict d'une demande ouverte ────────────────────────── */

  const verdict = await judgePullRequest(projet, ouverte!);

  // Dans le jeu de démonstration, `main` a reçu un commit de fusion
  // depuis que la branche est partie : le verdict doit le dire, et il
  // doit refuser si les fichiers se croisent.
  check("le verdict d'une demande ouverte est motivé",
    verdict.raison.length > 0, verdict.raison);
  check("le verdict n'est pas favorable sans raison",
    verdict.fusionnable === false || verdict.raison.length > 0);

  /* ── L'ouverture ─────────────────────────────────────────────── */

  const doublon = await createPullRequest({
    projectId: projet,
    authorId: "u-zainab",
    sourceBranch: ouverte!.source_branch,
    targetBranch: ouverte!.target_branch,
    title: "Encore la même branche",
  });

  // L'index unique partiel doit refuser, et l'écran doit pouvoir dire
  // pourquoi — pas renvoyer « duplicate key value… ».
  check("une seconde demande pour la même branche est refusée",
    doublon.pull === null && doublon.error !== null, doublon);
  check("le refus de doublon est compréhensible",
    (doublon.error ?? "").includes(libelleBranche(ouverte!.source_branch)),
    doublon.error);

  const soiMeme = await createPullRequest({
    projectId: projet,
    authorId: "u-koffi",
    sourceBranch: "main",
    targetBranch: "main",
    title: "Intégrer main dans main",
  });

  check("une branche ne demande pas sa propre intégration",
    soiMeme.pull === null, soiMeme.error);

  const titreCourt = await createPullRequest({
    projectId: projet,
    authorId: "u-koffi",
    sourceBranch: "nouvelle-branche",
    targetBranch: "main",
    title: "ab",
  });

  check("un titre trop court est refusé avant la base",
    titreCourt.pull === null && (titreCourt.error ?? "").includes("3 caractères"),
    titreCourt.error);

  /* ── La fusion qui aboutit ───────────────────────────────────── */

  // Une demande dont la destination n'a pas bougé : c'est le seul cas
  // où la fusion est possible, et il doit se passer exactement ça.
  resetStore();

  const avant = await fetchBranches(projet);
  const brancheDemo = avant.find((b) => b.name === "lecture-code-barres");
  check("la démonstration a une branche de travail",
    Boolean(brancheDemo), avant.map((b) => b.name));

  const cibleAvant = await fetchRepoFiles(projet, "main");
  const sourceAvant = await fetchRepoFiles(projet, "lecture-code-barres");

  check("les deux branches ont des contenus différents",
    JSON.stringify(cibleAvant.map((f) => f.content)) !==
      JSON.stringify(sourceAvant.map((f) => f.content)));

  const demande = (await fetchOpenPullRequestForBranch(
    projet,
    "lecture-code-barres",
    "main",
  ))!;

  const judgement = await judgePullRequest(projet, demande);
  check("la demande de démonstration est fusionnable", judgement.fusionnable === true, judgement.raison);

  const fusion = await mergePullRequest({
    projectId: projet,
    pull: demande,
    author: moi,
  });

  check("la fusion aboutit", fusion.error === null, fusion.error);
  check("la fusion produit un commit", Boolean(fusion.commit?.sha), fusion.commit);

  const cibleApres = await fetchRepoFiles(projet, "main");
  const lecteurApres = cibleApres.find((f) => f.path === "lecteur.py");

  check("la destination a reçu le fichier de la source",
    Boolean(lecteurApres?.content.includes("CODE_BARRE")),
    lecteurApres?.content?.slice(0, 60));
  check("la destination a gardé ses autres fichiers",
    cibleApres.some((f) => f.path === "registre.py") &&
      cibleApres.some((f) => f.path === "tests/test_registre.py"),
    cibleApres.map((f) => f.path));
  check("la destination a le même nombre de fichiers qu'avant",
    cibleApres.length === cibleAvant.length,
    { avant: cibleAvant.length, apres: cibleApres.length });

  // Le message du commit est écrit par le moteur, pas par l'écran : deux
  // personnes qui fusionnent doivent produire le même commit.
  check("le commit porte le message de la demande",
    fusion.commit?.message === messageFusion(demande.number, demande.title),
    fusion.commit?.message);

  const apres = (await fetchPullRequests(projet)).find((d) => d.id === demande.id);
  check("la demande est marquée fusionnée", apres?.status === "fusionnee", apres?.status);
  check("la date de fusion est dérivée, pas reçue",
    Boolean(apres?.merged_at), apres?.merged_at);

  // Une demande déjà fusionnée ne se fusionne pas deux fois.
  const encore = await mergePullRequest({
    projectId: projet,
    pull: { ...demande, status: "fusionnee" },
    author: moi,
  });
  check("une demande déjà intégrée ne se fusionne pas deux fois",
    encore.commit === null && encore.error !== null, encore.error);

  /* ── Fermer ──────────────────────────────────────────────────── */

  const aFermer = await createPullRequest({
    projectId: projet,
    authorId: "u-koffi",
    sourceBranch: "correction-typographie",
    targetBranch: "main",
    title: "Accents dans les messages d'erreur",
  });

  check("une demande s'ouvre", aFermer.pull !== null, aFermer.error);

  if (aFermer.pull) {
    const fermeture = await setPullRequestStatus(aFermer.pull.id, "fermee");
    check("une demande se ferme sans erreur", fermeture.error === null, fermeture.error);

    const relue = (await fetchPullRequests(projet)).find((d) => d.id === aFermer.pull!.id);
    check("la demande fermée n'est plus comptée comme ouverte",
      relue?.status === "fermee" && relue.closed_at !== null,
      { status: relue?.status, closed_at: relue?.closed_at });
  }
}

/** Le libellé d'une branche, pour comparer sans le réécrire dans le test. */
function libelleBranche(nom: string): string {
  return `« ${nom} »`;
}

async function main(): Promise<void> {
  moteurPur();
  await donnees();
}

main()
  .then(() => {
    console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
    if (failures.length) {
      for (const f of failures) console.log(`  ✗ ${f}`);
      process.exit(1);
    }
    console.log("  ✓ Les demandes se numérotent, se comparent, et ne fusionnent que si\n    la destination ne touche pas aux mêmes fichiers\n");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });