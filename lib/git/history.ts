/**
 * Historique — commits, différences, parcours.
 *
 * Ce module ne connaît **ni la base, ni le réseau**. Il raisonne sur un
 * objet `Repo` — l'état courant des fichiers et l'historique — et renvoie
 * un autre `Repo`. Toute la persistance est ailleurs : le moteur est donc
 * testable sans serveur, et la même logique sert le mode démo et Postgres.
 *
 * ## Ce qu'on ne fait pas
 *
 * Pas de fusion automatique. Dans un projet de groupe, deux personnes qui
 * modifient le même fichier en même temps doivent **le voir** : une fusion
 * silencieuse qui choisit un camp donne l'illusion que tout va bien alors
 * qu'une modification est perdue. La stratégie est la fusion explicite :
 * commits empilés, conflit affiché, décision confiée aux personnes.
 */

import { hashBlob, hashCommit, hashTree, type TreeEntry } from "./objects";
import { sortPaths, type FileEntry } from "./paths";

export type RepoFile = FileEntry & { blob_sha?: string };

export interface Commit {
  sha: string;
  parent_sha: string;
  author_id: string;
  author_name: string;
  message: string;
  /** sha de l'arbre à ce commit. */
  tree: string;
  files_changed: number;
  insertions: number;
  deletions: number;
  source: "internal" | "github";
  created_at: string;
}

export interface Ref {
  name: string;
  kind: "branch" | "tag";
  sha: string;
}

/**
 * sha de l'arbre vide — la valeur que git utilise pour un répertoire sans
 * fichier. Elle est constante dans toutes les implémentations, donc on peut
 * l'écrire en dur plutôt que de la recalculer.
 */
export const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Le dépôt, tel que le moteur le manipule : fichiers courants + historique. */
export interface Repo {
  files: RepoFile[];
  commits: Commit[];
}

/**
 * Construit l'arbre racine d'un ensemble de fichiers.
 *
 * Le parcours est descendant puis remontant : on descend la hiérarchie en
 * feeders d'abord, et le sha d'un répertoire ne peut être calculé qu'après
 * ceux de ses enfants — d'où la seconde passe. Les répertoires vides
 * n'existent pas : un dossier naît parce qu'un fichier est dessous, ce qui
 * est exactement la règle de git.
 */
export function buildTree(files: RepoFile[]): TreeEntry[] {
  interface Node {
    files: Map<string, string>;
    dirs: Map<string, Node>;
  }

  const root: Node = { files: new Map(), dirs: new Map() };

  for (const f of files) {
    const parts = f.path.split("/");
    const name = parts.pop();
    if (!name) continue;

    let node = root;
    for (const segment of parts) {
      let next = node.dirs.get(segment);
      if (!next) {
        next = { files: new Map(), dirs: new Map() };
        node.dirs.set(segment, next);
      }
      node = next;
    }
    node.files.set(name, f.blob_sha ?? hashBlob(f.content));
  }

  const shaOf = (node: Node): string => {
    const entries: TreeEntry[] = [
      ...[...node.files].map(([name, sha]) => ({ mode: "100644", name, sha })),
      ...[...node.dirs].map(([name, child]) => ({ mode: "40000", name, sha: shaOf(child) })),
    ];
    // Un répertoire sans fichier a le sha de l'arbre vide, pas celui d'une
    // liste vide : sinon un dossier réellement vidé aurait un sha inconnu.
    return entries.length ? hashTree(entries) : EMPTY_TREE_SHA;
  };

  return [
    ...[...root.files].map(([name, sha]) => ({ mode: "100644", name, sha })),
    ...[...root.dirs].map(([name, child]) => ({ mode: "40000", name, sha: shaOf(child) })),
  ];
}

export interface DiffLine {
  kind: "contexte" | "ajout" | "suppression";
  text: string;
  /** N° de ligne dans l'ancien fichier, si elle existe encore. */
  oldLine?: number;
  /** N° de ligne dans le nouveau fichier, si elle existe. */
  newLine?: number;
}

/**
 * Diff ligne à ligne.
 *
 * Algorithme de Myers dégénéré en un parcours linéaire : tant que les
 * lignes courante coïncident, on avance ; sinon on cherche si la ligne
 * d'après se trouve plus loin dans l'ancien, ce qui signifie « des lignes
 * ont été insérées » et non « une ligne a été remplacée ».
 *
 * C'est suffisant pour de l'affichage, et surtout c'est **déterministe** :
 * deux clients affichent la même différence. Une vraie optimisation de
 * Myers donnerait un résultat différent — mais uniquement sur des cas
 * ambigus, où les deux diffs sont corrects.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = toLines(before);
  const b = toLines(after);

  const out: DiffLine[] = [];

  const push = (
    kind: DiffLine["kind"],
    text: string,
    oldLine?: number,
    newLine?: number,
  ) => {
    const last = out[out.length - 1];
    // Le regroupement des lignes consécutives de même nature rend le
    // changement lisible ; sans lui, un remplacement de dix lignes affiche
    // vingt lignes isolées.
    if (last && last.kind === kind && last.oldLine === oldLine && last.newLine === newLine) {
      out[out.length - 1] = { ...last, text: `${last.text}\n${text}` };
      return;
    }
    out.push({ kind, text, oldLine, newLine });
  };

  // Préfixe et suffixe communs d'abord. C'est ce qui distingue « on a
  // inséré une ligne en tête » d'« on a remplacé la première ligne » :
  // sans cette étape, un ajout en début de fichier s'affiche comme une
  // suppression suivie d'un ajout — illisible, et qui laisse croire à un conflit
  // là où il n'y en a pas.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  for (let k = 0; k < start; k++) push("contexte", a[k], k + 1, k + 1);
  for (let k = start; k < endA; k++) push("suppression", a[k], k + 1, undefined);
  for (let k = start; k < endB; k++) push("ajout", b[k], undefined, k + 1);
  for (let k = 0; k < a.length - endA; k++) {
    push("contexte", a[endA + k], endA + k + 1, endB + k + 1);
  }

  return out;
}

/**
 * Découpe un fichier en lignes.
 *
 * Le saut de ligne final termine la dernière ligne, il n'en introduit pas
 * une nouvelle : `"a\n"` est **une** ligne, pas deux dont une vide. Sans
 * cette précision, ajouter une ligne à un fichier se lit comme une
 * suppression suivie d'un ajout — un faux positif sur chaque fichier du
 * dépôt.
 */
function toLines(text: string): string[] {
  if (text === "") return [];
  return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
}

export type ChangeStatus = "ajout" | "suppression" | "modification";

export interface FileDiff {
  path: string;
  status: ChangeStatus;
  before: string;
  after: string;
  insertions: number;
  deletions: number;
  lines: DiffLine[];
}

/**
 * Diff de deux états du dépôt, fichier par fichier.
 *
 * L'ordre vient de `sortPaths` : deux clients qui ont le même contenu
 * doivent produire la même liste, sinon la question « est-ce que quelque
 * chose a changé ? » reçoit une réponse différente selon qui la pose.
 */
export function diffTrees(before: RepoFile[], after: RepoFile[]): FileDiff[] {
  const oldMap = new Map(before.map((f) => [f.path, f.content]));
  const newMap = new Map(after.map((f) => [f.path, f.content]));

  const out: FileDiff[] = [];

  for (const path of sortPaths([...new Set([...oldMap.keys(), ...newMap.keys()])])) {
    const a = oldMap.get(path);
    const b = newMap.get(path);
    if (a === b) continue;

    const lines = diffLines(a ?? "", b ?? "");

    out.push({
      path,
      status: a === undefined ? "ajout" : b === undefined ? "suppression" : "modification",
      before: a ?? "",
      after: b ?? "",
      insertions: lines.filter((l) => l.kind === "ajout").length,
      deletions: lines.filter((l) => l.kind === "suppression").length,
      lines,
    });
  }

  return out;
}

/** Y a-t-il quelque chose à committer ? */
export function isDirty(repo: Repo, files: RepoFile[]): boolean {
  return diffTrees(repo.files, files).length > 0;
}

export interface CommitRequest {
  /** État courant des fichiers, déjà validé par `normalizePath`. */
  files: RepoFile[];
  parent?: Commit | null;
  /**
   * Fichiers tels qu'ils étaient au commit parent.
   *
   * Un commit ne porte que son arbre, pas son contenu — c'est ce que fait
   * git. Pour dire s'il y a quelque chose à committer, le moteur a besoin de
   * l'état précédent, qu'il ne peut pas retrouver seul : il ne connaît que
   * l'état courant et l'historique. C'est donc l'appelant, qui sait lire
   * la base, qui le fournit. Sans lui, un commit inchangé passe pour une
   * modification — c'est-à-dire un historique rempli de faux changements.
   */
  parentFiles?: RepoFile[];
  authorId: string;
  authorName: string;
  authorEmail: string;
  message: string;
  /** Horodatage en secondes — injectable pour des tests reproductibles. */
  when?: number;
  now?: () => string;
}

/**
 * Commite l'état courant.
 *
 * Renvoie `null` quand il n'y a rien à dire : pas de message, ou aucune
 * différence avec le parent. C'est le comportement de `git commit` sans
 * `-a`, et c'est important — un historique où chaque clic « Enregistrer »
 * ajoute une entrée vide devient illisible en une semaine.
 */
export function createCommit(req: CommitRequest): Commit | null {
  const message = req.message.trim();
  if (!message) return null;

  const parent = req.parent ?? null;
  const changes = diffTrees(parent ? (req.parentFiles ?? []) : [], req.files);

  if (parent && changes.length === 0) return null;

  const when = req.when ?? Math.floor(Date.now() / 1000);
  const now = req.now ?? (() => new Date(when * 1000).toISOString());

  const tree = hashTree(buildTree(req.files));
  const sha = hashCommit({
    tree,
    parents: parent ? [parent.sha] : [],
    authorName: req.authorName,
    authorEmail: req.authorEmail,
    when,
    message,
  });

  return {
    sha,
    parent_sha: parent?.sha ?? "",
    author_id: req.authorId,
    author_name: req.authorName,
    message,
    tree,
    files_changed: changes.length,
    insertions: changes.reduce((n, c) => n + c.insertions, 0),
    deletions: changes.reduce((n, c) => n + c.deletions, 0),
    source: "internal",
    created_at: now(),
  };
}

/**
 * Ancêtres d'un commit, du plus proche au plus lointain.
 *
 * `limit` évite qu'un dépôt long ne bloque le rendu : l'historique affiché
 * n'a jamais besoin des mille premiers commits. La protection contre les
 * cycles est indispensable — une fusion mal saisie pourrait créer une
 * boucle, et une boucle dans une traversée est infinie.
 */
export function ancestorsOf(commits: Commit[], sha: string, limit = 200): Commit[] {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const out: Commit[] = [];
  const seen = new Set<string>();
  let cursor = bySha.get(sha);

  while (cursor && out.length < limit && !seen.has(cursor.sha)) {
    seen.add(cursor.sha);
    out.push(cursor);
    cursor = cursor.parent_sha ? bySha.get(cursor.parent_sha) : undefined;
  }

  return out;
}

/** Un commit est-il déjà dans l'historique de `sha` ? */
export function isAncestor(commits: Commit[], candidate: string, sha: string): boolean {
  return ancestorsOf(commits, sha).some((c) => c.sha === candidate);
}

/**
 * Dernier commit ayant touché un chemin.
 *
 * On s'appuie sur `files_changed`, pas sur un inventaire par commit :
 * garder l'inventaire complet ferait exploser la taille de l'historique
 * pour une information que la page « activité » seule consomme.
 */
export function lastCommitTouching(commits: Commit[]): Commit | undefined {
  return commits.find((c) => c.files_changed > 0);
}

/** Résumé d'une liste de modifications, tel qu'affiché dans une ligne. */
export function summarize(changes: FileDiff[]): string {
  if (changes.length === 0) return "aucun changement";
  const ins = changes.reduce((n, c) => n + c.insertions, 0);
  const del = changes.reduce((n, c) => n + c.deletions, 0);
  const files = changes.length === 1 ? "1 fichier" : `${changes.length} fichiers`;
  return `${files} · +${ins} −${del}`;
}