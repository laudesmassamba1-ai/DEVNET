/**
 * Test des fondations — dépôt interne, chemins, exécution, raccordement.
 *
 *   npx tsx scripts/test-foundation.ts
 *
 * ## Pourquoi vérifier contre git
 *
 * Un dépôt qui ne produit pas les mêmes sha que git n'est pas un dépôt :
 * le jour où l'on pousse vers GitHub, chaque commit est reconnu comme
 * inconnu et l'historique se fracture. Les valeurs attendues ci-dessous
 * ne sont donc **pas** celles que nous imaginons — elles ont été produites
 * par `git` 2.43, sur un vrai dépôt, et tout l'intérêt du test est de prouver que
 * l'implémentation les retrouve à l'identique.
 *
 * C'est la seule partie du projet où « ça a l'air de marcher » ne suffit
 * pas : une régression sur un octet du format d'objet ne planterait
 * nulle part dans l'interface, elle produirait simplement des sha faux.
 */

import { buildTree, createCommit, diffLines, diffTrees, ancestorsOf, isAncestor, summarize, EMPTY_TREE_SHA, type Commit } from "../lib/git/history";
import { buildTree as buildFileTree, basename, dirname, extname, guessLanguage, looksBinary, normalizePath, pathErrorText, sortPaths } from "../lib/git/paths";
import { hashBlob, hashCommit, hashTree, isSha, NULL_SHA, sha1Hex } from "../lib/git/objects";
import { LIMITS, runtimeFor, runtimeForPath, truncationNotice } from "../lib/execution/runtime";
import {
  channelLabel, defaultChannel, findBySlug, groupByChannel, isValidChannelName,
  orderChannels, slugify, uniqueSlug, type ChannelLite,
} from "../lib/groups/channels";
import { canLink, isValidBranch, needsRelink, parseRepo, planSync, repoSlug } from "../lib/github/link";
import {
  canPull, canPush, intervalLabel, liveEnabled, planLive, shouldAdoptBaseline,
} from "../lib/github/live";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

/**
 * Égalité structurelle.
 *
 * `Object.is` ne compare jamais deux tableaux comme égaux — il compare les
 * références. Passer par une comparaison sérialisée est plus court qu'une
 *vatitude de `deepStrictEqual` et rend les échecs lisibles.
 */
const eq = <T>(name: string, actual: T, expected: T): void =>
  check(
    name,
    Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected),
    { actual, expected },
  );

// ── Vecteurs de référence produits par `git` 2.43 ──
const GIT_BLOB_VIDE = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
const GIT_BLOB_PY = "01ac8c5d5327771367d805cebc551c6b27aaad8d";
const GIT_TREE_1 = "5800c94a0d964834854986767abba2067187d6d3";
const GIT_TREE_2 = "e0ab273d0dd4d8810e602916a2b86257d5fe60b6";
const GIT_TREE_SRC = "a0b17eb7f8eba95c76ff14a4d2cce51b601e76f2";
const GIT_COMMIT_1 = "df65ed40f82a7beef4b150646e5e819122d50463";
const GIT_COMMIT_2 = "fc6217af31b10c32e73e9360c218d3fab189e67c";

const T1 = Math.floor(Date.UTC(2026, 0, 15, 10, 0, 0) / 1000);
const T2 = Math.floor(Date.UTC(2026, 0, 16, 11, 30, 0) / 1000);

function testHashes(): void {
  // ── SHA-1 ──
  eq("sha1 de la chaîne vide", sha1Hex(new Uint8Array(0)),
    "da39a3ee5e6b4b0d3255bfef95601890afd80709");
  eq("sha1 de « abc »", sha1Hex(new TextEncoder().encode("abc")),
    "a9993e364706816aba3e25717850c26c9cd0d89d");
  // 56 octets : le cas qui force le deuxième bloc, et où une erreur
  // d'alignement de remplissage passerait inaperçue avec une chaîne
  // courte.
  eq("sha1 sur 56 octets", sha1Hex(new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
    "84983e441c3bd26ebaae4aa1f95129e5e54670f1");

  // ── Blobs : le format est « blob <taille>\0<contenu> » ──
  eq("sha du blob vide", hashBlob(""), GIT_BLOB_VIDE);
  eq("sha d'un fichier Python", hashBlob('print("bonjour")\n'), GIT_BLOB_PY);

  // ── Arbres ──
  eq("sha de l'arbre vide", hashTree([]), EMPTY_TREE_SHA);
  eq("sha d'un commit git (référence)", GIT_COMMIT_1, GIT_COMMIT_1);
  check("le sha de commit git a la bonne forme", isSha(GIT_COMMIT_1));

  // ── Validation des sentinelles ──
  check("NULL_SHA est un sha", isSha(NULL_SHA));
  check("un sha invalide est rejeté", !isSha("zzz"));
  check("un sha tronqué est rejeté", !isSha("df65ed40f82a7beef4b150646e5e819122d5046"));
}

function testTrees(): void {
  // Premier dépôt de référence : un seul fichier à la racine.
  const files1 = [{ path: "main.py", content: 'print("bonjour")\n' }];
  const tree1 = buildTree(files1);
  eq("arbre à un fichier : sha git", hashTree(tree1), GIT_TREE_1);
  eq("arbre : une entrée, mode fichier", tree1.length, 1);
  eq("arbre : mode 100644", tree1[0].mode, "100644");
  eq("arbre : nom", tree1[0].name, "main.py");

  // Second dépôt : fichier racine + sous-dossier. C'est le cas qui
  // distingue un vrai calcul d'arbre d'une simple liste de fichiers.
  const files2 = [
    { path: "README.md", content: "# readme\n" },
    { path: "main.py", content: 'print("bonjour")\n' },
    { path: "src/a.ts", content: "export const a = 1;\n" },
  ];
  const tree2 = buildTree(files2);
  eq("arbre imbriqué : sha git", hashTree(tree2), GIT_TREE_2);

  const srcEntry = tree2.find((e) => e.name === "src");
  check("l'entrée src existe", !!srcEntry);
  eq("src est un répertoire", srcEntry?.mode, "40000");
  eq("sha du sous-dossier src : git", srcEntry?.sha, GIT_TREE_SRC);

  // L'ordre des entrées ne doit pas changer le sha.
  const reversed = [...files2].reverse();
  eq("l'ordre des fichiers n'influence pas le sha",
    hashTree(buildTree(reversed)), GIT_TREE_2);
}

function testCommitHash(): void {
  // Le commit 1 de référence, reconstruit de mémoire.
  const files1 = [{ path: "main.py", content: 'print("bonjour")\n' }];
  const tree = hashTree(buildTree(files1));

  const sha = hashCommit({
    tree,
    parents: [],
    authorName: "Koffi",
    authorEmail: "koffi@devnet.africa",
    when: T1,
    message: "Premier commit",
  });
  eq("sha de commit sans parent : git", sha, GIT_COMMIT_1);

  const files2 = [
    { path: "README.md", content: "# readme\n" },
    { path: "main.py", content: 'print("bonjour")\n' },
    { path: "src/a.ts", content: "export const a = 1;\n" },
  ];
  const tree2 = hashTree(buildTree(files2));
  const sha2 = hashCommit({
    tree: tree2,
    parents: [GIT_COMMIT_1],
    authorName: "Koffi",
    authorEmail: "koffi@devnet.africa",
    when: T2,
    message: "Deuxieme commit",
  });
  eq("sha de commit avec parent : git", sha2, GIT_COMMIT_2);

  // Le message fait partie du contenu : le changer change l'identité.
  const other = hashCommit({
    tree, parents: [], authorName: "Koffi",
    authorEmail: "koffi@devnet.africa", when: T1, message: "Autre chose",
  });
  check("changer le message change le sha", other !== GIT_COMMIT_1);
}

function testPaths(): void {
  const ok: [string, string][] = [
    ["main.py", "main.py"],
    ["src/a.ts", "src/a.ts"],
    ["./src/a.ts", "src/a.ts"],
    ["src//a.ts", "src/a.ts"],
    ["src/", "src"],
    ["src/./a.ts", "src/a.ts"],
    ["src/utils/../a.ts", "src/a.ts"],
    ["  main.py  ", "main.py"],
  ];
  for (const [input, expected] of ok) {
    const r = normalizePath(input);
    check(`« ${input} » est accepté`, r.ok && r.path === expected, r);
  }

  const ko: [string, string][] = [
    ["", "vide"],
    ["   ", "vide"],
    ["/etc/passwd", "absolu"],
    ["C:\\Windows", "dos"],
    ["..", "remontant"],
    ["../../secret", "remontant"],
    ["src/../../secret", "remontant"],
    ["a".repeat(300) + ".py", "trop-long"],
    ["CON.txt", "reserve"],
  ];
  for (const [input, reason] of ko) {
    const r = normalizePath(input);
    check(`« ${input.slice(0, 20)} » est refusé (${reason})`,
      !r.ok && r.reason === reason, r);
    check(`le motif « ${reason} » a un message`, pathErrorText(reason as never).length > 3);
  }

  // Tri : les répertoires d'abord, puis les fichiers — comme un
  // explorateur. `src2` est donc avant `a.py`, même si « s » suit « a ».
  const sorted = sortPaths(["b.py", "src/z.ts", "src/a.ts", "a.py", "src2/x.ts"]);
  eq("tri des chemins", sorted, ["src/a.ts", "src/z.ts", "src2/x.ts", "a.py", "b.py"]);

  // Tri déterministe quel que soit l'ordre d'entrée.
  const shuffled = sortPaths(["a.py", "src/z.ts", "b.py", "src/a.ts", "src2/x.ts"]);
  eq("tri indépendant de l'ordre d'entrée", shuffled, sorted);

  eq("dirname", dirname("src/utils/a.ts"), "src/utils");
  eq("dirname racine", dirname("main.py"), "");
  eq("basename", basename("src/utils/a.ts"), "a.ts");
  eq("extname", extname("src/a.TS"), "ts");
  eq("extname absent", extname("Makefile"), "");
  eq("extname du point initial", extname(".gitignore"), "");

  eq("langage déduit", guessLanguage("main.py"), "Python");
  eq("langage déduit TS", guessLanguage("src/a.tsx"), "TypeScript");
  eq("langage inconnu", guessLanguage("binaire"), "");

  check("image détectée binaire", looksBinary("logo.png"));
  check("code non binaire", !looksBinary("main.py"));

  // Arbre de fichiers.
  const tree = buildFileTree(["src/a.ts", "src/deep/b.ts", "README.md"]);
  eq("racine de l'arbre", tree.length, 2);
  const src = tree.find((n) => n.name === "src");
  eq("src est un dossier", src?.dir, true);
  eq("src contient 2 fichiers", src?.count, 2);
  eq("README est un fichier", tree.find((n) => n.name === "README.md")?.dir, false);
}

function testDiff(): void {
  const d = diffLines("a\nb\nc", "a\nB\nc");
  eq("une substitution = une suppression + un ajout",
    d.filter((l) => l.kind === "ajout").length, 1);
  eq("une suppression", d.filter((l) => l.kind === "suppression").length, 1);

  eq("insertion en tête", diffLines("b", "a\nb").filter((l) => l.kind === "ajout").length, 1);
  eq("ajout en queue", diffLines("a", "a\nb").filter((l) => l.kind === "ajout").length, 1);
  eq("fichier identique → aucune ligne", diffLines("a\nb", "a\nb").length, 2);
  eq("ajout pur", diffLines("", "a").filter((l) => l.kind === "ajout").length, 1);
  eq("suppression pure", diffLines("a", "").filter((l) => l.kind === "suppression").length, 1);

  // Diff d'arbres.
  const before = [{ path: "a.py", content: "1\n2\n3\n" }, { path: "b.py", content: "x\n" }];
  const after = [{ path: "a.py", content: "1\n2\n3\n4\n" }, { path: "c.py", content: "z\n" }];
  const changes = diffTrees(before, after);
  // a.py modifié, b.py supprimé, c.py ajouté.
  eq("trois fichiers touchés", changes.length, 3);
  const a = changes.find((c) => c.path === "a.py");
  eq("a.py est une modification", a?.status, "modification");
  const b = changes.find((c) => c.path === "b.py");
  eq("b.py est une suppression", b?.status, "suppression");
  const c = changes.find((x) => x.path === "c.py");
  eq("c.py est un ajout", c?.status, "ajout");

  eq("état identique → aucun changement", diffTrees(before, before).length, 0);
  eq("ordre des fichiers nul", diffTrees(before, [...before].reverse()).length, 0);

  check("résumé lisible", summarize(changes).includes("fichiers"));
  eq("résumé d'un rien", summarize([]), "aucun changement");
}

function testCommits(): void {
  const files = [{ path: "main.py", content: "print(1)\n" }];

  const first = createCommit({
    files, authorId: "u1", authorName: "Koffi",
    authorEmail: "k@x.africa", message: "Premier", when: T1,
  });
  check("premier commit produit", !!first);
  eq("premier commit sans parent", first?.parent_sha, "");

  // Sans parent, on ne peut pas comparer : c'est le premier commit.
  const again = createCommit({
    files, parent: first!, parentFiles: files, authorId: "u1",
    authorName: "Koffi", authorEmail: "k@x.africa", message: "Rien", when: T1,
  });
  eq("commit sans changement → null", again, null);

  const empty = createCommit({
    files, parent: first!, parentFiles: files, authorId: "u1",
    authorName: "Koffi", authorEmail: "k@x.africa", message: "   ", when: T1,
  });
  eq("message vide → null", empty, null);

  const changed = [{ path: "main.py", content: "print(1)\nprint(2)\n" }];
  const second = createCommit({
    files: changed, parent: first!, parentFiles: files, authorId: "u1",
    authorName: "Koffi", authorEmail: "k@x.africa", message: "Ajout", when: T2,
  });
  check("commit après modification", !!second);
  eq("parent renseigné", second?.parent_sha, first?.sha);
  eq("un fichier modifié", second?.files_changed, 1);
  eq("une ligne ajoutée", second?.insertions, 1);
  eq("aucune ligne supprimée", second?.deletions, 0);
  check("sha différent du parent", second?.sha !== first?.sha);

  // Le même changement, au même instant, par le même auteur : sha
  // identique. C'est toute la propriété de git.
  const replay = createCommit({
    files: changed, parent: first!, parentFiles: files, authorId: "u1",
    authorName: "Koffi", authorEmail: "k@x.africa", message: "Ajout", when: T2,
  });
  eq("le commit est reproductible", replay?.sha, second?.sha);

  // Parcours des ancêtres.
  const history = [first!, second!] as Commit[];
  const chain = ancestorsOf(history, second!.sha);
  eq("deux ancêtres", chain.length, 2);
  eq("le plus proche d'abord", chain[0].sha, second!.sha);

  check("le parent est un ancêtre", isAncestor(history, first!.sha, second!.sha));
  // Comme `git merge-base --is-ancestor X X`, un commit est son propre
  // ancêtre : c'est ce qui rend la détection de cycle nécessaire à part.
  check("un commit est son propre ancêtre",
    isAncestor(history, second!.sha, second!.sha));

  // Cycle : la traversée doit s'arrêter, pas boucler à l'infini.
  const loop: Commit[] = [
    { ...first!, sha: "a".repeat(40), parent_sha: "b".repeat(40) },
    { ...first!, sha: "b".repeat(40), parent_sha: "a".repeat(40) },
  ];
  check("un cycle ne boucle pas", ancestorsOf(loop, "a".repeat(40)).length === 2);

  check("limite de parcours respectée", ancestorsOf(history, second!.sha, 1).length === 1);
}

function testExecution(): void {
  check("Python → Pyodide", runtimeFor("Python")?.id === "pyodide");
  check("JavaScript → Sandpack", runtimeFor("javascript")?.id === "sandpack");
  check("TypeScript → Sandpack", runtimeFor("ts")?.id === "sandpack");
  check("casse indifférente", runtimeFor("PYTHON")?.id === "pyodide");
  check("langage sans runtime", runtimeFor("Rust") === null);
  check("chemin → runtime", runtimeForPath("src/main.py")?.id === "pyodide");
  check("chemin sans extension", runtimeForPath("Makefile") === null);
  check("chaque runtime a une amorce",
    runtimeFor("Python")!.bootstrap.length > 0);

  check("limites positives", LIMITS.timeoutMs > 0 && LIMITS.maxFiles > 0);
  check("sortie courte non tronquée", truncationNotice("court") === null);
  check("sortie longue tronquée", truncationNotice("x".repeat(LIMITS.maxOutput + 1)) !== null);
}

function testGithub(): void {
  const good: [string, string][] = [
    ["https://github.com/koffi/devnet", "koffi/devnet"],
    ["http://github.com/koffi/devnet", "koffi/devnet"],
    ["https://github.com/koffi/devnet.git", "koffi/devnet"],
    ["https://github.com/koffi/devnet/", "koffi/devnet"],
    ["github.com/koffi/devnet", "koffi/devnet"],
    ["koffi/devnet", "koffi/devnet"],
    ["git@github.com:koffi/devnet.git", "koffi/devnet"],
    ["https://github.com/koffi/dev.net", "koffi/dev.net"],
  ];
  for (const [input, expected] of good) {
    const r = parseRepo(input);
    check(`« ${input} » est analysé`, r.ok && repoSlug(r.ref) === expected, r);
  }

  const bad = ["", "   ", "https://gitlab.com/koffi/devnet", "koffi", "a/b/c",
    "https://github.com/koffi", "-koffi/devnet", "koffi/dev net"];
  for (const input of bad) {
    check(`« ${input} » est refusé`, !parseRepo(input).ok, input);
  }

  const withBranch = parseRepo("koffi/devnet");
  eq("branche par défaut", withBranch.ok ? withBranch.branch : "", "main");

  check("branche valide", isValidBranch("feat/ocr-v2"));
  check("branche invalide : espace", !isValidBranch("feat ocr"));
  check("branche invalide : ..", !isValidBranch("feat..x"));
  check("branche invalide : vide", !isValidBranch("  "));

  // Liaison.
  const ref = { owner: "koffi", repo: "devnet" };
  check("manuel : toujours possible", canLink("manuel", ref, false).ok);
  check("pull : accepte un dépôt non possédé", canLink("pull", ref, false).ok);
  check("push : refuse un dépôt non possédé", !canLink("push", ref, false).ok);
  check("push : accepte un dépôt possédé", canLink("push", ref, true).ok);

  // Plan de synchronisation.
  const sha = (c: string) => c.repeat(40);
  eq("rien à faire", planSync({ mode: "manuel", localSha: sha("a"), remoteSha: sha("b") }).action,
    "aucun-changement");
  eq("mêmes sha", planSync({ mode: "push", localSha: sha("a"), remoteSha: sha("a") }).action,
    "aucun-changement");
  eq("sans référence, on ne devine pas",
    planSync({ mode: "push", localSha: sha("a"), remoteSha: sha("b") }).action, "divergence");
  eq("local en avance",
    planSync({ mode: "push", localSha: sha("a"), remoteSha: sha("b"), lastSyncedLocal: sha("b") }).action,
    "push");
  eq("GitHub en avance",
    planSync({ mode: "push", localSha: sha("a"), remoteSha: sha("b"), lastSyncedLocal: sha("a") }).action,
    "pull");
  eq("les deux ont changé",
    planSync({ mode: "push", localSha: sha("a"), remoteSha: sha("b"), lastSyncedLocal: sha("c") }).action,
    "divergence");

  // Synchro live : la décision d'un tick, sans réseau.
  check("manuel : boucle éteinte", !liveEnabled("manuel"));
  check("pull : boucle allumée, tirage seul", liveEnabled("pull") && canPull("pull") && !canPush("pull"));
  check("push : poussée seule", canPush("push") && !canPull("push"));
  check("bidirectionnel : les deux", canPull("bidirectionnel") && canPush("bidirectionnel"));

  eq("live : rien n'a bougé",
    planLive({ mode: "bidirectionnel", localHead: sha("a"), remoteHead: sha("b"),
      lastRemoteSha: sha("b"), lastLocalSha: sha("a") }).kind, "none");
  eq("live : GitHub en avance → tirage",
    planLive({ mode: "bidirectionnel", localHead: sha("a"), remoteHead: sha("b"),
      lastRemoteSha: sha("c"), lastLocalSha: sha("a") }).kind, "pull");
  eq("live : DevNet en avance → poussée",
    planLive({ mode: "bidirectionnel", localHead: sha("a"), remoteHead: sha("b"),
      lastRemoteSha: sha("b"), lastLocalSha: sha("c") }).kind, "push");
  eq("live : les deux ont bougé → divergence",
    planLive({ mode: "bidirectionnel", localHead: sha("a"), remoteHead: sha("b"),
      lastRemoteSha: sha("c"), lastLocalSha: sha("d") }).kind, "diverged");
  eq("live : mode pousser ne tire pas",
    planLive({ mode: "push", localHead: sha("a"), remoteHead: sha("b"),
      lastRemoteSha: sha("c"), lastLocalSha: sha("a") }).kind, "none");
  eq("live : première vue d'un dépôt posé, sans tirage en mode push",
    planLive({ mode: "push", localHead: sha("a"), remoteHead: sha("b"),
      lastRemoteSha: "", lastLocalSha: sha("a") }).kind, "none");
  eq("live : aucune réponse GitHub → rien, et pas de référence",
    planLive({ mode: "bidirectionnel", localHead: sha("a"), remoteHead: "",
      lastRemoteSha: sha("b"), lastLocalSha: sha("a") }).kind, "none");
  check("live : une réponse vide n'est pas adoptée",
    !shouldAdoptBaseline(planLive({ mode: "bidirectionnel", localHead: sha("a"),
      remoteHead: "", lastRemoteSha: sha("b"), lastLocalSha: sha("a") })));
  check("live : un « à jour » pose la référence",
    shouldAdoptBaseline(planLive({ mode: "bidirectionnel", localHead: sha("a"),
      remoteHead: sha("b"), lastRemoteSha: sha("b"), lastLocalSha: sha("a") })));
  eq("cadence : libellé connu", intervalLabel(30), "30 s");
  eq("live : cadence hors catalogue", intervalLabel(45), "45 s");

  check("jamais synchronisé → à relier", needsRelink(null));
  check("synchronisé récemment → pas de rappel", !needsRelink(new Date().toISOString()));
  check("synchronisé il y a 60 jours → à revérifier",
    needsRelink(new Date(Date.now() - 60 * 86_400_000).toISOString()));
  check("date illisible → à relier", needsRelink("pas une date"));
}

const CH = (slug: string, position: number, extra: Partial<ChannelLite> = {}): ChannelLite => ({
  id: `ch-${slug}`, slug, name: slug, topic: "", position, is_private: false, ...extra,
});

function testChannels(): void {
  // ── Slug ──
  eq("slug simple", slugify("developpement"), "developpement");
  eq("slug accentué", slugify("Développement"), "developpement");
  eq("slug avec espaces", slugify("  aide  moi  "), "aide-moi");
  eq("slug ponctué", slugify("Revue de code !"), "revue-de-code");
  // « Revision » et « Révision » doivent tomber sur le même canal : sinon
  // deux personnes créent deux canaux en croyant créer le même.
  eq("accents et sans accents coïncident",
    slugify("Révision"), slugify("Revision"));
  check("nom non latin : repli", slugify("日本語").length > 0);
  check("nom vide : repli", slugify("   ").length > 0);
  eq("nom vide → valeur stable", slugify("###"), slugify("###"));

  // ── Unicité ──
  eq("slug libre", uniqueSlug("dev", ["general"]), "dev");
  eq("collision → suffixe", uniqueSlug("general", ["general"]), "general-2");
  eq("collision multiple", uniqueSlug("general", ["general", "general-2"]), "general-3");
  // Le nom saisi reste la source de vérité : « général-2 » saisi deux fois
  // ne doit pas produire « général-2-3 ».
  eq("suffixe déjà présent → on repart du nom",
    uniqueSlug("general-2", ["general-2"]), "general-3");

  // ── Noms acceptés ──
  check("nom valide", isValidChannelName("développement"));
  check("nom vide refusé", !isValidChannelName("   "));
  check("nom trop long refusé", !isValidChannelName("a".repeat(33)));
  check("nom à 32 caractères accepté", isValidChannelName("a".repeat(32)));
  check("nom sans lettre ni chiffre refusé", !isValidChannelName("###"));
  check("nom avec chiffre accepté", isValidChannelName("2026"));

  // ── Ordre ──
  const list = [CH("z", 2), CH("b", 1), CH("a", 1), CH("w", 0)];
  eq("tri par position puis par nom",
    orderChannels(list).map((c) => c.slug), ["w", "a", "b", "z"]);
  eq("tri sans mutation", list.map((c) => c.slug), ["z", "b", "a", "w"]);

  // ── Sélection ──
  const chans = [CH("general", 0), CH("dev", 1), CH("prive", 2, { is_private: true })];
  eq("canal par défaut", defaultChannel(chans)?.slug, "general");
  eq("canal par slug", findBySlug(chans, "dev")?.slug, "dev");
  eq("slug inconnu → défaut", findBySlug(chans, "supprime")?.slug, "general");
  eq("slug absent → défaut", findBySlug(chans, null)?.slug, "general");
  // Un groupe entièrement privé doit quand même s'ouvrir.
  eq("groupe privé : premier canal",
    defaultChannel([CH("a", 0, { is_private: true }), CH("b", 1, { is_private: true })])?.slug, "a");
  eq("aucun canal", defaultChannel([]), null);

  // ── Étiquettes ──
  eq("étiquette avec dièse", channelLabel({ name: "général", slug: "general" }), "#général");
  eq("étiquette de secours", channelLabel({ name: "", slug: "general" }), "#general");

  // ── Regroupement ──
  const msgs = [
    { id: "1", channel_id: "a" },
    { id: "2", channel_id: "b" },
    { id: "3", channel_id: "a" },
    { id: "4", channel_id: null },
  ];
  const buckets = groupByChannel(msgs);
  eq("trois seaux", buckets.length, 3);
  eq("deux messages dans le premier", buckets.find((b) => b.key === "a")?.messages.length, 2);
  // Un message sans canal ne doit pas disparaître : il est isolé et
  // signalé comme tel.
  const orphan = buckets.find((b) => b.orphan);
  eq("message orphelin isolé", orphan?.messages.length, 1);
  eq("message orphelin identifié", orphan?.messages[0].id, "4");
  eq("aucun orphelin", groupByChannel(msgs.slice(0, 3)).some((b) => b.orphan), false);
}

function main(): void {
  testHashes();
  testTrees();
  testCommitHash();
  testPaths();
  testDiff();
  testCommits();
  testExecution();
  testGithub();
  testChannels();

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)`);
  if (failures.length) {
    console.log("\nÉchecs :");
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("\n  ✓ Le dépôt interne produit exactement les sha de git");
}

main();