"use client";

import { useRouter, useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell, IconButton } from "@/components/AppShell";
import { ApplicationPanel } from "@/components/ApplicationPanel";
import { EmptyState, Loading } from "@/components/Avatar";
import { GithubPanel } from "@/components/GithubPanel";
import { IssuePanel } from "@/components/IssuePanel";
import { PresenceRail } from "@/components/PresenceRail";
import { ProjectWikiPanel } from "@/components/ProjectWikiPanel";
import { ProjectCodeView } from "@/components/ProjectCodeView";
import { ProjectSettingsPanel } from "@/components/ProjectSettingsPanel";
import { PullRequestPanel } from "@/components/PullRequestPanel";
import { ScorePanel } from "@/components/ScorePanel";
import { ProjectRatingPanel } from "@/components/ProjectRatingPanel";
import { ForkTreePanel } from "@/components/ForkTreePanel";
import { TaskBoard } from "@/components/TaskBoard";
import { Icon, asIconName } from "@/components/Icon";
import { Motion } from "@/components/Motion";
import { Sheet } from "@/components/Sheet";
import { StdinBubble } from "@/components/StdinBubble";
import { useToast } from "@/components/Toast";
import { useSession } from "@/hooks/useSession";
import { useGithubLiveSync } from "@/hooks/useGithubLiveSync";
import { fetchOpenIssueCount } from "@/lib/issues";
import {
  fetchPresence,
  heartbeatSession,
  PRESENCE_BEAT_MS,
  type PresenceEntry,
} from "@/lib/presence";
import { fetchOpenPullRequestCount } from "@/lib/pull";
import { loadProjectMembers } from "@/lib/reputation";
import { api } from "@/lib/api/client";
import { type Commit, type FileDiff } from "@/lib/git/history";
import { buildTree, guessLanguage, looksBinary, type FileNode } from "@/lib/git/paths";
import { branchErrorText, DEFAULT_BRANCH, validateBranchName } from "@/lib/git/refs";
import { IDLE, runFile, type RunOutcome } from "@/lib/execution/runner";
import { runtimeForPath, codeReadsStdin } from "@/lib/execution/runtime";
import { wasiDefaultEntry } from "@/lib/execution/wasi";
import { scoreFile, type FileEntry } from "@/lib/scoring";
import {
  commitRepo,
  createBranch,
  deleteBranch,
  fetchBranches,
  fetchCommitDiff,
  fetchCommits,
  fetchPendingChanges,
  fetchProject,
  fetchRepoFiles,
  saveRepoFile,
  type RepoFileState,
} from "@/lib/repo";
import type { GitRef, Project } from "@/lib/types";

/**
 * Le dépôt.
 *
 * Trois choses sur un écran, et c'est deliberément tout ce qu'il y a :
 * **les fichiers**, **ce qui n'est pas enregistré**, et **l'historique**.
 * C'est l'ordre dans lequel on travaille — on lit, on écrit, on
 * enregistre — donc c'est l'ordre dans lequel l'écran les présente.
 *
 * L'historique n'est pas une décoration : c'est la preuve de travail. Un
 * profil DevNet se juge sur ce qu'il a construit et sur ce que son dépôt
 * raconte, pas sur le nombre de publications.
 */
/**
 * Une entrée de l'arborescence, et tout ce qu'elle contient.
 *
 * La récursion vit ici plutôt que dans le JSX de l'écran : un dépôt peut
 * être profond, et une fonction récursive tient en six lignes là où une
 * boucle dans le composant principal aurait fini par mélanger deux
 * niveaux d'indentation.
 *
 * Les répertoires sont des **lignes**, pas des éléments repliables. Un
 * arbre qui se replie cache ce qu'il contient, et un dépôt de dix fichiers
 * n'a rien à replier. Ce qui compte, c'est que la profondeur soit
 * visible d'un coup d'œil.
 */

/**
 * Le premier fichier qu'on peut ouvrir.
 *
 * On parcourt l'**arbre**, pas la liste des chemins : ce qui est en haut
 * de l'arborescence est ce que la personne voit en premier, et c'est
 * donc ce qu'il est naturel de trouver déjà ouvert.
 *
 * Les fichiers binaires sont écartés, parce que `openFile` les refuse.
 * Ouvrir par défaut un fichier que l'écran refuse d'ouvrir produirait un
 * état que l'interface ne sait pas rendre.
 */
function firstOpenable(nodes: FileNode[]): string | null {
  for (const node of nodes) {
    if (node.dir) {
      const found = firstOpenable(node.children);
      if (found) return found;
    } else if (!looksBinary(node.path)) {
      return node.path;
    }
  }
  return null;
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useSession();
  const router = useRouter();
  const toast = useToast();

  /** L'identifiant de la personne connectée, ou `null` en cours de résolution. */
  const profileId = profile?.id ?? null;

  const [project, setProject] = useState<Project | null>(null);
  /**
   * L'appelant peut-il trancher les candidatures (§6) ?
   *
   * Propriétaire ou mainteneur, comme la RLS le décide. On le lit plutôt
   * que de le supposer : la file « à décider » ne doit pas apparaître
   * devant un simple membre — il verrait des boutons que la base
   * refuserait.
   */
  const [canDecide, setCanDecide] = useState(false);
  const [missing, setMissing] = useState(false);
  const [branch, setBranch] = useState(DEFAULT_BRANCH);
  const [mobileFilesOpen, setMobileFilesOpen] = useState(false);
  const [branches, setBranches] = useState<GitRef[]>([]);
  /**
   * La branche n'est initialisée depuis le projet qu'une seule fois.
   *
   * `load` dépend de `branch` — il relit les fichiers et l'historique de
   * la branche courante — donc réaffecter `branch` à l'intérieur le
   * ramenait à la branche par défaut **à chaque changement**. Le
   * sélecteur affichait bien une autre branche, puis l'écran y
   * repartait : le changement était undone immédiatement après avoir été
   * fait, sans aucune erreur.
   *
   * Une référence, et non un état : il ne faut pas provoquer un rendu
   * pour signaler une initialisation qui n'a d'effet qu'une fois.
   */
  const branchReady = useRef(false);

  /**
   * La dernière valeur de `branch` et de `open`, lues par l'écoute du
   * temps réel.
   *
   * Un canal se réabonne à chaque changement de ses dépendances ; on ne
   * veut pas d'un désabonnement par clic sur un fichier. Les références
   * donnent au gestionnaire la valeur courante sans que l'abonnement
   * bouge.
   */
  const openRef = useRef<string | null>(null);
  const branchRef = useRef(branch);
  /** Feuille « nouvelle branche ». */
  const [namingBranch, setNamingBranch] = useState(false);
  const [branchName, setBranchName] = useState("");
  /** La branche que l'on supprime — pour ne pas demander un simple « oui ». */
  const [dropping, setDropping] = useState<string | null>(null);
  const [files, setFiles] = useState<RepoFileState[] | null>(null);
  const [pending, setPending] = useState<FileDiff[]>([]);
  const [commits, setCommits] = useState<Commit[] | null>(null);

  /**
 * Ce que l'écran montre : le code, les issues, ou les demandes.
 *
 * Un dépôt a trois publics — on **écrit** du code, on **discute** de ce
 * qui manque, on **relit** ce qui a été fait — et les tenir dans un même
 * écran les fait se gêner : l'éditeur occupe la moitié basse d'un
 * téléphone, et la relecture occupe celle où l'on lit. Trois vues, un
 * onglet chacune.
 *
 * Les issues et les demandes ne sont **pas** chargées à l'ouverture de
 * l'écran : on lit le compteur pour l'onglet, et la liste seulement quand
 * la vue est ouverte. Un profil ouvert surtout pour lire le code ne paie
 * pas une requête qu'il ne consomme pas.
 */
const [view, setView] = useState<"code" | "issues" | "demandes" | "taches" | "candidatures" | "doc" | "score" | "github" | "reglages">("code");
const [openIssues, setOpenIssues] = useState(0);
const [openPulls, setOpenPulls] = useState(0);

  /** Fichier ouvert dans l'éditeur. */
  const [open, setOpen] = useState<string | null>(null);
  /** Contenu en cours d'édition — distinct du contenu enregistré. */
  // `null` = « pas encore touché », et non « vidé ». Un `""` confondrait
  // les deux : on ne pourrait pas effacer tout le contenu d'un fichier,
  // puisque `draft || fichier` retomberait sur la version enregistrée dès
  // que le brouillon est vide — le bug que la version précédente portait.
  const [draft, setDraft] = useState<string | null>(null);
  /** Nouveaux fichiers, pas encore écrits. */
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState("");

  /**
   * Qui d'autre travaille sur ce dépôt, et sur quel fichier.
   *
   * Lu au montage, à chaque battement, et à chaque événement de présence
   * reçu en temps réel.
   */
  const [presence, setPresence] = useState<PresenceEntry[]>([]);

  /**
   * Le fichier ouvert a-t-il changé **sous** nous ?
   *
   * Ce n'est pas la même chose qu'un pair présent sur le même fichier :
   * ici, une écriture a eu lieu, et la prochaine est refusée par la garde
   * de `saveRepoFile`. On garde le chemin et l'auteur pour pouvoir le
   * dire sans le deviner.
   */
  const [remote, setRemote] = useState<{ path: string; by: string } | null>(null);

  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  /** Commit dont on regarde le diff. */
  const [diffSha, setDiffSha] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff[] | null>(null);

  /**
   * L'exécution du fichier ouvert.
   *
   * Un seul état pour le résultat, pas un par étape : `status` décrit la
   * phase, et tout le reste — sortie, erreur, durée — vient avec. Deux
   * états séparés finiraient par se contredire : une sortie affichée à
   * côté d'un état « en cours », c'est le défaut classique du compteur
   * affiché à part.
   */
  const [run, setRun] = useState<RunOutcome>(IDLE);
  /** Une exécution est-elle en cours ? Empêche les doubles clics. */
  const [busyRunning, setBusyRunning] = useState(false);
  /**
   * L'entrée standard, une valeur par ligne.
   *
   * Python lit avec `input()`, mais un navigateur n'a pas de terminal à
   * interrompre : on ne peut pas mettre le programme « en pause » pour
   * attendre une frappe. On demande donc les valeurs **avant** de lancer,
   * et `input()` les consomme dans l'ordre. C'est la seule façon honnête
   * de faire tourner un exercice qui saisit des données sans faire
   * semblant.
   */
  const [stdin, setStdin] = useState("");
  /**
   * La bulle de saisie est-elle ouverte ?
   *
   * Elle ne s'ouvre qu'au lancement d'un programme qui lit son entrée :
   * c'est le seul moment où l'on sait qu'une saisie est attendue, et le
   * seul moyen de la réclamer **avant** que le worker ne démarre — un
   * navigateur ne peut pas suspendre un programme en cours.
   */
  const [askInput, setAskInput] = useState(false);
  /**
   * L'exécution en attente de la saisie.
   *
   * On ne lance rien tant que la bulle est ouverte ; c'est « Exécuter »
   * dans la bulle qui reprend ici, avec les valeurs saisies.
   */
  const pendingRun = useRef<((input: string) => void) | null>(null);
  /**
   * Le contrôleur de l'exécution en cours.
   *
   * Il n'existe que pour une chose : permettre à la personne d'**arrêter**
   * un code qui boucle. Le délai (`LIMITS.timeoutMs`) finit par le faire,
   * mais dix secondes devant un écran figé paraissent une panne — et rien
   * n'oblige à les attendre quand on sait déjà que le code est faux.
   */
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!id) return;

    const found = await fetchProject(id);
    if (!found) {
      setMissing(true);
      return;
    }

    setProject(found);

    // La branche courante est résolue **avant** toute lecture, et n'est
    // réaffectée qu'au tout premier chargement — voir `branchReady`.
    const current = branchReady.current
      ? branch
      : found.default_branch || DEFAULT_BRANCH;

    if (!branchReady.current) {
      setBranch(current);
      branchReady.current = true;
    }

    const [nextFiles, nextCommits, nextBranches] = await Promise.all([
      fetchRepoFiles(id, current),
      fetchCommits(id, current),
      fetchBranches(id),
    ]);

    const { changes } = await fetchPendingChanges({ projectId: id, branch: current });

    setFiles(nextFiles);
    setCommits(nextCommits);
    setBranches(nextBranches);
    setPending(changes);
    setOpenIssues(await fetchOpenIssueCount(id));
    setOpenPulls(await fetchOpenPullRequestCount(id));

    // Un dépôt sans fichier n'a rien à ouvrir : on ne sélectionne rien,
    // et l'écran propose d'en créer un plutôt que d'ouvrir un vide.
    //
    // Un dépôt **qui en a** s'ouvre sur le premier. C'est la règle que
    // la session « ça ne marche pas » a payée cher : une fonctionnalité
    // qu'on ne voit pas à l'ouverture ressemble à une fonctionnalité
    // absente. Un dépôt plein présenté sur un tampon vide laisse croire
    // que le dépôt est vide — et c'est l'axe différenciant du produit
    // qui disparaît, pas un détail d'interface.
    setOpen((current) => {
      if (current && nextFiles.some((f) => f.path === current)) return current;
      return firstOpenable(buildTree(nextFiles.map((f) => f.path)));
    });
  }, [id, branch]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  /** La tête de la branche affichée : ce que la synchro live compare. */
  const localHead = useMemo(
    () => branches.find((b) => b.name === branch)?.sha ?? "",
    [branches, branch],
  );

  /**
   * La synchro GitHub « live » (polling), quand le projet y est lié et que
   * le mode l'autorise. Elle vit sur **la page**, pas dans l'onglet
   * GitHub, pour continuer même quand on regarde le code.
   */
  const githubLive = useGithubLiveSync({
    projectId: id,
    localHead,
    onChanged: () => void load(),
  });

  /**
   * Le droit de décider, lu une fois par projet et par personne.
   *
   * `owner | maintainer` : ce sont les deux rôles qui modèrent un dépôt.
   * Un `editor` écrit du code, il n'admet personne — c'est la même
   * frontière que celle des politiques de `project_applications`.
   */
  useEffect(() => {
    if (!id || !profileId) {
    // eslint-disable-next-line react-hooks/set-state-in-effect
      setCanDecide(false);
      return;
    }
    let alive = true;
    void loadProjectMembers(id).then((members) => {
      if (!alive) return;
      const me = members.find((m) => m.user_id === profileId);
      setCanDecide(me?.role === "owner" || me?.role === "maintainer");
    });
    return () => {
      alive = false;
    };
  }, [id, profileId]);

  /**
   * La sortie appartient au fichier qui l'a produite.
   *
   * Changer de fichier doit donc l'effacer — y compris quand le
   * changement ne vient pas d'un clic mais du chargement : changer de
   * branche en ouvre un autre, et l'historique garde l'ordre. `openFile`
   * le fait déjà pour un clic ; cet effet couvre le chemin du chargement,
   * que le clic ne peut pas atteindre.
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRun(IDLE);
  }, [open]);

  /**
   * Les présences vivantes du projet, la mienne exclue.
   *
   * C'est la relecture du **filet** : les événements temps réel couvrent
   * l'arrivée d'un pair, celle-ci couvre son départ — qu'aucun événement
   * n'annonce, puisqu'il n'y a rien à observer quand quelqu'un ferme son
   * écran.
   */
  const refreshPresence = useCallback(async () => {
    if (!id || !profileId) return;
    setPresence(await fetchPresence(id, profileId));
  }, [id, profileId]);

  /**
   * Mon battement : « je travaille ici ».
   *
   * Il repart à chaque changement de fichier, et pas seulement à
   * intervalle : attendre le prochain battement laisserait, trente
   * secondes durant, une présence qui désigne le fichier d'avant — et
   * c'est précisément le moment où quelqu'un regarde l'écran pour savoir
   * qui est où.
   */
  useEffect(() => {
    if (!id || !profileId) return;
    openRef.current = open;

    void heartbeatSession({
      projectId: id,
      userId: profileId,
      filePath: open ?? "",
      color: profile?.avatar_color,
    });
  }, [open, id, profileId, profile?.avatar_color]);

  /** Le filet : on redemande la liste à intervalle régulier. */
  useEffect(() => {
    if (!id || !profileId) return;

    let alive = true;
    const tick = async () => {
      const live = await fetchPresence(id, profileId);
      if (alive) setPresence(live);
    };

    void tick();
    const timer = setInterval(() => void tick(), PRESENCE_BEAT_MS);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, profileId]);

  /** La branche courante, pour l'écoute du temps réel. */
  useEffect(() => {
    branchRef.current = branch;
  }, [branch]);

  /**
   * L'écoute du temps réel.
   *
   * Deux flux, deux besoins. La **présence** se rafraîchit à chaque
   * battement reçu, ce qui fait apparaître un pair sans attendre les
   * trente secondes du filet. Les **fichiers**, eux, signalent une
   * écriture concurrente sur le fichier qu'on a ouvert : c'est la
   * divergence, et elle doit se voir avant qu'on ait cliqué sur
   * « écrire », pas après.
   */
  useEffect(() => {
    if (!id || !profileId) return;

    const refresh = () => void refreshPresence();

    const channel = api
      .channel(`projet-${id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "project_sessions",
          filter: `project_id=eq.${id}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "project_sessions",
          filter: `project_id=eq.${id}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "git_files",
          filter: `project_id=eq.${id}`,
        },
        ({ new: row }: { new: { path?: string; branch?: string; updated_by?: string } }) => {
          const changed = row;
          if (!changed.path || changed.path !== openRef.current) return;
          if (changed.branch && changed.branch !== branchRef.current) return;
          // Ma propre écriture ne me fait pas diverger de moi-même.
          if (changed.updated_by === profileId) return;

          setRemote({ path: changed.path, by: String(changed.updated_by ?? "") });
        },
      )
      .subscribe();

    return () => {
      void api.removeChannel(channel);
    };
  }, [id, profileId, refreshPresence]);

  const current = useMemo(
    () => files?.find((f) => f.path === open) ?? null,
    [files, open],
  );

  /** Le contenu affiché est le brouillon s'il y en a un, sinon le fichier. */
  const content = draft ?? current?.content ?? "";

  /** Le fichier a-t-il été modifié depuis le dernier enregistrement ? */
  const dirty = Boolean(current) && content !== (current?.content ?? "");

  /**
   * Les fichiers donnés au moteur de score : chemin + contenu enregistré.
   *
   * On mémorise la forme pour que `scoreRepo` ne recalcule pas à chaque
   * rendu : `files` ne change qu'après un chargement ou un commit, pas
   * quand on tape dans l'éditeur.
   */
  const scoreFiles = useMemo<FileEntry[]>(
    () => (files ?? []).map((f) => ({ path: f.path, content: f.content })),
    [files],
  );

  /**
   * La note du fichier **affiché**, brouillon compris.
   *
   * Elle suit `content` et non la version enregistrée : la note sert à
   * écrire, donc elle doit réagir à ce qu'on est en train d'écrire.
   */
  const currentScore = useMemo(
    () => (open ? scoreFile(open, content) : null),
    [open, content],
  );

  /** Y a-t-il quelque chose à enregistrer ? */
  const hasSomethingToCommit = pending.length > 0;

  /** Le dépôt a-t-il des changements pas encore écrits dans un fichier ? */
  const unsaved = dirty;

  /** Un pair a le même fichier ouvert : la divergence est possible. */
  const peerOnMyFile = useMemo(
    () => (open ? (presence.find((p) => p.file_path === open) ?? null) : null),
    [presence, open],
  );

  /**
   * Le verdict sur le nom de branche en cours de saisie.
   *
   * Il est calculé **une fois**, hors du JSX, pour deux raisons : on ne
   * valide pas trois fois la même chaîne à chaque rendu, et surtout on ne
   * peut pas « deviner » le motif du résultat dans le balisage — ce
   * genre de transtypage est exactement ce qui fait qu'un écran affiche
   * « undefined » à la place d'un message.
   *
   * `null` quand le champ est vide : il n'y a alors rien à dire, et un
   * refus pour un champ vide serait un reproche à une saisie en cours.
   */
  const branchCheck =
    branchName.trim().length > 0 ? validateBranchName(branchName) : null;

  async function openFile(path: string) {
    const file = files?.find((f) => f.path === path);
    if (!file) return;

    // Un fichier binaire n'a pas d'éditeur de texte : l'ouvrir dans un
    // `<textarea>` afficherait des octets illisibles et inviterait à les
    // sauvegarder, ce qui les corromprait.
    if (looksBinary(path)) {
      toast("Fichier binaire — pas d'éditeur texte.", "err");
      return;
    }

    setOpen(path);
    setDraft(null);
    // La sortie d'exécution appartient au fichier qui l'a produite :
    // l'afficher sous un autre fichier ferait croire qu'il vient de
    // tourner.
    setRun(IDLE);
  }

  /**
   * Le dépôt entier, tel qu'on le donne au moteur : chemin → contenu.
   *
   * Le brouillon du fichier ouvert l'emporte sur sa version enregistrée :
   * on exécute ce qu'on voit. Les fichiers binaires sont écartés — un
   * `.png` monté dans un système de fichiers WASI ne serait qu'un octet
   * de plus, et le moteur n'a rien à en faire.
   */
  function projectFiles(): Record<string, string> {
    const project: Record<string, string> = {};
    for (const file of files ?? []) {
      if (looksBinary(file.path)) continue;
      project[file.path] = file.content;
    }
    if (current) project[current.path] = content;
    return project;
  }

  /** Lance une exécution et tient l'état « en cours » pendant ce temps. */
  async function runWith(
    path: string,
    code: string,
    project: Record<string, string>,
    input: string,
  ) {
    const controller = new AbortController();
    setAbortController(controller);
    setBusyRunning(true);
    try {
      await runFile(path, code, setRun, project, input, controller.signal);
    } finally {
      setAbortController(null);
      setBusyRunning(false);
    }
  }

  /**
   * Exécute le fichier ouvert.
   *
   * On exécute le **contenu affiché**, pas la version enregistrée : c'est
   * ce que la personne voit dans l'éditeur, et exécuter une autre version
   * donnerait un résultat qui ne correspond pas à ce qu'elle croit avoir
   * écrit. Le dépôt entier est monté (voir `projectFiles`), donc un
   * fichier peut importer un voisin.
   *
   * Le fichier est-il modifié ? On le dit, mais on n'empêche pas
   * l'exécution : on teste souvent avant d'enregistrer.
   */
  async function execute() {
    if (!current || busyRunning) return;
    // Le programme lit-il son entrée ? Alors on ne peut pas lancer tout de
    // suite : la bulle réclame les valeurs, et « Exécuter » reprend la
    // suite. Un programme qui ne lit rien part directement.
    if (codeReadsStdin(runtimeForPath(current.path), content)) {
      pendingRun.current = (input) => {
        void runWith(current.path, content, projectFiles(), input);
      };
      setAskInput(true);
      return;
    }
    // Tout le dépôt est monté, et le fichier ouvert est le point d'entrée :
    // un fichier peut donc importer un voisin, comme dans un vrai dépôt.
    await runWith(current.path, content, projectFiles(), stdin);
  }

  /**
   * Exécute **le projet** : on ne lance pas le fichier ouvert, mais le
   * point d'entrée du dépôt.
   *
   * C'est ce qui manque quand on regarde un en-tête (`aide.h`) ou un
   * module : « exécuter » l'en-tête échouerait, alors que le projet a un
   * `main` bien vivant à côté. On choisit le langage du fichier ouvert
   * s'il en a un, sinon le premier fichier exécutable du dépôt, puis son
   * entrée (main.*, index.*, …).
   */
  async function executeProject() {
    if (busyRunning) return;
    const project = projectFiles();
    const paths = Object.keys(project).sort();

    const spec =
      (current ? runtimeForPath(current.path) : null) ??
      paths.map((p) => runtimeForPath(p)).find((s) => s !== null) ??
      null;
    if (spec === null) return;

    const preferred = wasiDefaultEntry(project, spec.entry);
    // `wasiDefaultEntry` retombe, en dernier recours, sur le premier
    // fichier du langage. Pour « le projet », on ne veut un point d'entrée
    // que s'il est canonique (main.*, index.*) : sinon on lance le fichier
    // ouvert, comme « exécuter ». Un dépôt sans main ne doit pas se mettre
    // à lancer un module au hasard.
    const isCanonical =
      preferred === spec.entry || preferred === `index.${spec.extension}`;
    const entry =
      isCanonical && project[preferred] !== undefined
        ? preferred
        : (current?.path ?? preferred);
    const code = project[entry] ?? "";
    // Même règle que « exécuter » : le point d'entrée qui lit son entrée
    // passe par la bulle avant de partir.
    if (codeReadsStdin(spec, code)) {
      pendingRun.current = (input) => {
        void runWith(entry, code, project, input);
      };
      setAskInput(true);
      return;
    }
    await runWith(entry, code, project, stdin);
  }

  /** « Exécuter » dans la bulle : on reprend l'exécution avec les valeurs. */
  function confirmInput() {
    const run = pendingRun.current;
    pendingRun.current = null;
    setAskInput(false);
    run?.(stdin);
  }

  /** « Annuler » / Échap : rien ne part. */
  function cancelInput() {
    pendingRun.current = null;
    setAskInput(false);
  }

  /** Arrête l'exécution en cours en terminant le worker. */
  function stopExecution() {
    abortController?.abort();
  }

  async function persist() {
    if (!current || !profile) return;

    setBusy(true);
    const { error, diverged } = await saveRepoFile({
      projectId: id,
      path: current.path,
      content,
      userId: profile.id,
      branch,
      // Ce qu'on avait lu. Si le dépôt a bougé entre-temps, l'écriture
      // est refusée au lieu d'écraser le travail de quelqu'un d'autre.
      expectedSha: current.blob_sha,
    });
    setBusy(false);

    // La divergence se dit **avant** l'erreur : le message générique
    // « erreur » ferait chercher une panne là où il n'y a qu'un
    // rendez-vous manqué.
    if (diverged) {
      setRemote({ path: current.path, by: "" });
      return toast("Le fichier a changé sous vous — relisez-le avant d'écrire.", "err");
    }
    if (error) return toast(`Erreur : ${error}`, "err");

    setDraft(null);
    setRemote(null);
    await load();
    toast("Fichier enregistré");
  }

  /**
   * Relit le dépôt après une écriture concurrente.
   *
   * On jette le brouillon : il a été écrit contre une version qui n'est
   * plus celle du dépôt, et le garder laisserait croire qu'on peut encore
   * l'enregistrer. Rien n'est fusionné — c'est la règle du dépôt, et la
   * seule honnête.
   */
  function reloadFile() {
    setDraft(null);
    setRemote(null);
    void load();
  }

  async function createFile() {
    const path = newPath.trim();
    if (!path || !profile) return;

    setBusy(true);
    const { error, diverged } = await saveRepoFile({
      projectId: id,
      path,
      content: "",
      userId: profile.id,
      branch,
      // `null` = « je crois que ce fichier n'existe pas ». Si la place est
      // prise entre-temps, on refuse plutôt que d'écraser.
      expectedSha: null,
    });
    setBusy(false);

    if (diverged) return toast("Un fichier porte déjà ce chemin — relisez le dépôt.", "err");
    if (error) return toast(error, "err");

    setCreating(false);
    setNewPath("");
    await load();
    setOpen(path);
  }

  async function commit() {
    if (!profile || !message.trim()) return;

    setBusy(true);
    const { commit: made, error } = await commitRepo({
      projectId: id,
      branch,
      message,
      author: profile,
    });
    setBusy(false);

    if (error) {
      // « Rien à enregistrer » n'est pas une panne : c'est une
      // information, et le message le dit déjà.
      toast(error, "err");
      return;
    }

    if (made) {
      setMessage("");
      toast(`Révision ${made.sha.slice(0, 7)}`);
    }
    await load();
  }

  /**
 * Crée une branche et s'y place.
 *
 * On se place dessus à la création, comme le fait un `git checkout -b` :
 * une branche qu'on crée et qu'on ne regarde pas n'est jamais utilisée,
 * et une liste de branches qui grossit sans qu'on la visite ressemble à
 * un dépôt que personne ne comprend.
 *
 * Le nom est validé **avant** l'appel : la règle de `lib/git/refs.ts` est
 * l'autorité, et la base n'en a qu'un filet grossier. Écrire d'abord et
 * valider ensuite donnerait une erreur de base — incompréhensible,
 * puisque le filet SQL ne connaît que trois des dix règles.
 */
async function createNewBranch() {
  const check = validateBranchName(branchName);
  if (!check.ok) return toast(branchErrorText(check.reason), "err");

  setBusy(true);
  const { error } = await createBranch({
    projectId: id,
    name: check.name,
    from: branch,
  });
  setBusy(false);

  if (error) return toast(error, "err");

  setNamingBranch(false);
  setBranchName("");
  setBranch(check.name);
  setOpen(null);
  await load();
  toast(`Branche ${check.name} créée`);
}

/**
 * Supprime une branche et revient à celle du projet.
 *
 * On revient systématiquement à la branche par défaut : l'écran affiche
 * la branche courante, et afficher une branche qui n'existe plus
 * laisserait un dépôt vide sans explication.
 */
async function removeBranch(name: string) {
  setBusy(true);
  const { error } = await deleteBranch({
    projectId: id,
    name,
    defaultBranch: project?.default_branch || DEFAULT_BRANCH,
    remaining: branches.length,
  });
  setBusy(false);
  setDropping(null);

  if (error) return toast(error, "err");

  setBranch(project?.default_branch || DEFAULT_BRANCH);
  setOpen(null);
  await load();
  toast(`Branche ${name} supprimée`);
}

async function showDiff(sha: string) {
    if (!commits || commits.length < 2) {
      toast("Il faut au moins deux révisions pour comparer.", "err");
      return;
    }

    const target = commits.find((c) => c.sha === sha);
    if (!target?.parent_sha) return;

    setDiffSha(sha);
    setDiff(await fetchCommitDiff({ projectId: id, from: target.parent_sha, to: sha }));
  }

  if (missing) {
    return (
      <AppShell path="~/projets">
        <EmptyState
          title="Projet introuvable"
          action={
            <button
              type="button"
              onClick={() => router.push("/projects")}
              className="mo-press inline-flex h-(--h-tap) items-center rounded-(--radius-input)
                border border-line-3 px-4 text-[13px] font-bold text-chalk-2
                hover:border-signal hover:text-signal"
            >
              Retour aux projets
            </button>
          }
        />
      </AppShell>
    );
  }

  // L'onglet Réglages s'ouvre à ceux qui administrent : propriétaire et
  // mainteneurs. Le créateur y a droit même si sa ligne de membre manquait
  // (projet ancien, import) — sinon il ne pourrait plus jamais le régler.
  const canAdmin = canDecide || (project !== null && profileId !== null && project.created_by === profileId);

  return (
    <AppShell
      title={project?.name ?? "Projet"}
      path={`~/projets/${project?.slug ?? "—"}`}
      wide
      immersive={view === "code"}
      action={
        <div className="flex items-center gap-1">
          {project && (
            <IconButton
              label="Ouvrir dans l’IDE"
              name="terminal"
              onClick={() => router.push(`/ide/${project.id}`)}
            />
          )}
          <IconButton label="Tous les projets" name="grid" onClick={() => router.push("/projects")} />
        </div>
      }
    >
      <div
        className={
          view === "code"
            ? "flex h-full min-h-0 flex-col overflow-hidden px-(--gutter) pt-3"
            : "px-(--gutter) pt-3"
        }
      >
        {project === null && <Loading label="Ouverture du dépôt" />}

        {project && (
          <>
            {/* ── En-tête : le dépôt, sa branche, son dernier commit ──
                La branche et la révision sont dans le bandeau et non dans
                le corps : ce sont des repères, pas du contenu, et ils
                doivent rester visibles quelle que soit la partie de
                l'écran qu'on regarde. */}
            {view !== "code" && project && profileId !== null && (
              <Motion role="slide" delay={40}>
                <div className="mb-3">
                  <ProjectRatingPanel
                    project={project}
                    branch={branch || DEFAULT_BRANCH}
                    me={profile}
                    isOwner={project.created_by === profileId}
                  />
                </div>
              </Motion>
            )}

            {/* La lignée s'affiche à la même hauteur que le bandeau : le
                parent au-dessus des enfants, sans récursion — la racine
                de tout l'arbre est portée par la ligne d'origine. */}
            {view !== "code" && project && (
              <Motion role="slide" delay={60} className="mb-3">
                <ForkTreePanel projectId={project.id} />
              </Motion>
            )}

            <Motion role="slide" delay={0}>
              <header className={`border-b border-line-2 ${view === "code" ? "mb-2 pb-2" : "mb-3 pb-3"}`}>
                <div className="flex items-start gap-3">
                  {view !== "code" && (
                    <>
                      <span
                        aria-hidden="true"
                        className="flex size-11 shrink-0 items-center justify-center
                          border border-line-2 bg-surface-2 text-signal-d"
                      >
                        <Icon name={asIconName(project.emoji, "layers")} size={20} strokeWidth={1.7} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h1 className="font-display text-[1.3rem] font-bold tracking-[-0.02em] text-chalk">
                          {project.name}
                        </h1>
                        {project.description && (
                          <p className="mt-0.5 text-sm leading-snug text-chalk-3">
                            {project.description}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <div className={`${view === "code" ? "mt-0" : "mt-3"} flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-12 text-chalk-4`}>
                  <div className="inline-flex min-w-0 max-w-full items-center gap-1">
                    <label className="inline-flex h-(--h-tap) min-w-0 max-w-[190px] items-center gap-1.5">
                      <Icon name="branch" size={11} className="text-signal" />
                      <select
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        aria-label="Branche"
                        className="h-(--h-tap) min-w-0 max-w-full cursor-pointer truncate bg-transparent
                          text-chalk-2"
                      >
                        {branches.length === 0 && <option value={branch}>{branch}</option>}
                        {branches.map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    {/* Les deux actions vivent à côté du sélecteur et nulle
                        part ailleurs : une branche se crée et se supprime
                        depuis l'endroit où l'on choisit laquelle on
                        travaille. Un menu « … » les aurait cachées
                        derrière un clic de plus pour un geste qui, lui,
                        est rare. */}
                    <button
                      type="button"
                      onClick={() => setNamingBranch(true)}
                      aria-label="Nouvelle branche"
                      title="Nouvelle branche"
                      className="flex size-(--h-tap) items-center justify-center
                        rounded-(--radius-chip) text-chalk-4
                        transition-colors hover:text-signal"
                    >
                      <Icon name="plus" size={12} strokeWidth={2} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setDropping(branch)}
                      aria-label="Supprimer la branche"
                      title="Supprimer la branche"
                      disabled={branch === (project?.default_branch || DEFAULT_BRANCH)}
                      className="flex size-(--h-tap) items-center justify-center
                        rounded-(--radius-chip) text-chalk-4
                        transition-colors hover:text-danger disabled:opacity-25
                        disabled:hover:text-chalk-4"
                    >
                      <Icon name="trash" size={12} strokeWidth={1.8} />
                    </button>
                  </div>

                  {view !== "code" && commits?.[0] && (
                    <span className="tnum inline-flex items-center gap-1.5">
                      <Icon name="command" size={11} />
                      {commits[0].sha.slice(0, 7)}
                      <span className="text-chalk-3">· {commits[0].message}</span>
                    </span>
                  )}
                </div>
              </header>
            </Motion>

            {view !== "code" && <PresenceRail entries={presence} openPath={open} />}

            {/* ── Vue ──
                Le même `tab-underline` que les autres écrans : un dépôt
                qui aurait son propre style d'onglet serait le seul
                endroit du produit où les onglets ne ressemblent à rien.
                Le compteur d'issues ouvertes est annoncé dans le nom de
                l'onglet — sans lui, on ne sait pas s'il y a quelque
                chose à lire de l'autre côté. */}
            <div
              role="tablist"
              aria-label="Vue du dépôt"
              className={`${view === "code" ? "mb-2" : "mb-3"} flex gap-0 overflow-x-auto border-b border-line-2`}
            >
              {([
                ["code", "Code"],
                ["issues", `Issues${openIssues > 0 ? ` ${openIssues}` : ""}`],
                ["demandes", `Demandes${openPulls > 0 ? ` ${openPulls}` : ""}`],
                ["taches", "Tâches"],
                ["candidatures", "Candidatures"],
                ["doc", "Doc"],
                ["score", "Score"],
                ["github", "GitHub"],
                ...(canAdmin ? [["reglages", "Réglages"] as const] : []),
              ] as ["code" | "issues" | "demandes" | "taches" | "candidatures" | "doc" | "score" | "github" | "reglages", string][]).map(([value, label]) => (
                <button
                  key={value}
                  role="tab"
                  type="button"
                  aria-selected={view === value}
                  onClick={() => setView(value)}
                  className={`-mb-0.5 flex min-h-(--h-tap) shrink-0 items-center tab-underline px-3 py-2 font-mono text-12
                    font-bold tracking-[0.12em] uppercase transition-colors
                    duration-(--d-fast)
                    ${view === value ? "text-signal" : "text-chalk-4 hover:text-chalk-2"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {view === "issues" && <IssuePanel projectId={id} />}

            {view === "doc" && <ProjectWikiPanel projectId={id} />}

            {/* Le tableau de l'équipe. Les tâches sont ancrées au projet,
                pas au groupe : c'est le travail qui se découpe, et un
                projet peut vivre sans groupe. La colonne « Fait » crée
                une preuve pour qui termine — le tableau nourrit donc le
                profil, au lieu d'être une liste qui ne va nulle part. */}
            {view === "taches" && (
              <TaskBoard
                projectId={id}
                meId={profileId}
                meName={profile?.prenom || profile?.pseudo}
              />
            )}

            {/* Les candidatures (§6) : une file de décision pour l'équipe,
                l'état de sa propre candidature pour tout autre. Le panneau
                n'est monté qu'à l'ouverture de l'onglet, donc il ne coûte
                rien tant qu'on lit du code. */}
            {view === "candidatures" && (
              <ApplicationPanel
                projectId={id}
                meId={profileId ?? ""}
                canDecide={canDecide}
              />
            )}

            {/* Le score est calculé à partir des fichiers déjà chargés :
                changer d'onglet ne déclenche aucune requête, et le panneau
                suit le brouillon du fichier ouvert. */}
            {view === "score" && (
              <ScorePanel
                files={scoreFiles}
                projectId={id}
                branch={branch}
                openPath={open}
                openContent={content}
                onOpenFile={(path) => {
                  void openFile(path);
                  setView("code");
                }}
              />
            )}

            {view === "github" && (
              <GithubPanel
                projectId={id}
                branch={branch || DEFAULT_BRANCH}
                live={githubLive}
              />
            )}

            {view === "reglages" && project && (
              <ProjectSettingsPanel
                project={project}
                me={profile}
                canAdmin={canAdmin}
                onChanged={(next) => setProject(next)}
                onDeleted={() => router.replace("/projects")}
              />
            )}

            {/* La demande part de la **branche affichée**, pas d'un
                sélecteur supplémentaire : c'est la branche sur laquelle on
                travaille à cet instant, et c'est celle-là dont on veut
                demander l'intégration. Un sélecteur de branche dans la
                feuille de demande ferait choisir ce qu'on est en train de
                faire, ce qui est toujours faux. */}
            {view === "demandes" && (
              <PullRequestPanel
                projectId={id}
                branches={branches.map((b) => b.name)}
                brancheCourante={branch}
                brancheParDefaut={project?.default_branch || DEFAULT_BRANCH}
                onChange={() => {
                  // La fusion vient d'écrire dans la branche de
                  // destination : l'écran du dépôt doit se relire. Sans
                  // cela, revenir à l'onglet Code après une fusion montre
                  // l'état d'avant — un dépôt qui ment sur son propre
                  // contenu, et la pire des fautes pour un dépôt.
                  void load();
                }}
              />
            )}

            {view === "code" && (
              <ProjectCodeView
                files={files}
                open={open}
                openFile={openFile}
                setCreating={setCreating}
                current={current}
                currentScore={currentScore}
                dirty={dirty}
                content={content}
                setDraft={setDraft}
                persist={persist}
                busy={busy}
                execute={execute}
                executeProject={executeProject}
                stopExecution={stopExecution}
                busyRunning={busyRunning}
                run={run}
                remote={remote}
                reloadFile={reloadFile}
                peerOnMyFile={peerOnMyFile}
                mobileFilesOpen={mobileFilesOpen}
                setMobileFilesOpen={setMobileFilesOpen}
                hasSomethingToCommit={hasSomethingToCommit}
                pending={pending}
                message={message}
                setMessage={setMessage}
                commit={commit}
                unsaved={unsaved}
                commits={commits}
                diffSha={diffSha}
                setDiffSha={setDiffSha}
                diff={diff}
                showDiff={showDiff}
              />
            )}
          </>
        )}
      </div>

      {/* ── Nouveau fichier ──
          Un champ de chemin et rien d'autre : le fichier naît vide. On
          n'écrit pas son contenu à la création — c'est l'éditeur qui
          s'en charge, et le séparer évite de valider un fichier vide
          qu'on voulait remplir. */}
      {/* ── Nouvelle branche ──
          Une seule saisie. La branche part de celle qu'on regarde, donc
          le nom de départ est écrit sous le champ : quelqu'un qui écrit
          `correction` doit voir qu'elle naît de `main`, sans avoir à le
          retenir. */}
      <Sheet
        open={namingBranch}
        onClose={() => setNamingBranch(false)}
        title="Nouvelle branche"
      >
        <label htmlFor="branch-name" className="prompt-label mb-1.5 block text-chalk-2">
          nom de la branche
        </label>
        <input
          id="branch-name"
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
          placeholder="amelioration-registre"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") void createNewBranch();
          }}
          className="mb-2 h-(--h-input) w-full rounded-(--radius-input)
            border border-line-3 bg-surface px-3.5 font-mono text-[13px] shadow-sh-1
             transition-[transform,box-shadow] placeholder:text-chalk-4
            focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_var(--color-signal)]"
        />

        {branchCheck && (
          branchCheck.ok ? (
            <p className="mb-5 font-mono text-12 text-ok">
              part de <span className="text-chalk-3">{branch}</span>
            </p>
          ) : (
            <p className="mb-5 font-mono text-12 text-danger">
              {branchErrorText(branchCheck.reason)}
            </p>
          )
        )}

        {branchCheck === null && (
          <p className="mb-5 font-mono text-12 text-chalk-4">
            Les accents et « / » sont acceptés ; les espaces ne le sont pas.
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setNamingBranch(false)}
            className="mo-press h-(--h-tap) flex-1 rounded-(--radius-input)
              border border-transparent text-[13px] font-bold text-chalk-2
              hover:bg-surface-2 hover:text-chalk"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={createNewBranch}
            disabled={busy || branchCheck === null || !branchCheck.ok}
            className="mo-press flex h-(--h-tap) flex-1 items-center justify-center gap-2
              rounded-(--radius-input) border border-signal bg-signal
              text-[13px] font-bold text-void shadow-sh-2 disabled:opacity-40"
          >
            <Icon name="branch" size={12} strokeWidth={2} />
            Créer
          </button>
        </div>
      </Sheet>

      {/* ── Supprimer une branche ──
          Une confirmation, parce que la suppression est irréversible et
          porte sur le travail de quelqu'un d'autre. Elle nomme la
          branche — « vraiment ? » ne dit pas sur quoi. */}
      <Sheet
        open={dropping !== null}
        onClose={() => setDropping(null)}
        title="Supprimer la branche"
      >
        <p className="mb-4 text-[13px] leading-relaxed text-chalk-2">
          La branche{" "}
          <span className="font-mono text-signal">{dropping}</span> et ses
          fichiers seront supprimés. Les révisions restent dans
          l&apos;historique.
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDropping(null)}
            className="mo-press h-(--h-tap) flex-1 rounded-(--radius-input)
              border border-transparent text-[13px] font-bold text-chalk-2
              hover:bg-surface-2 hover:text-chalk"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => dropping && void removeBranch(dropping)}
            disabled={busy}
            className="mo-press flex h-(--h-tap) flex-1 items-center justify-center gap-2
              rounded-(--radius-input) border border-danger bg-danger
              text-[13px] font-bold text-void shadow-sh-2 disabled:opacity-40"
          >
            <Icon name="trash" size={12} strokeWidth={2} />
            Supprimer
          </button>
        </div>
      </Sheet>

      <Sheet open={creating} onClose={() => setCreating(false)} title="Nouveau fichier">
        {/* Le libellé nomme le champ, il ne le devine pas : « chemin »
            seul est ambigu dès qu'un autre champ de la page existe, et
            c'est le nom accessible qui relie le libellé à son champ. */}
        <label htmlFor="new-path" className="prompt-label mb-1.5 block text-chalk-2">
          chemin du fichier
        </label>
        <input
          id="new-path"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          placeholder="src/registre.py"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") void createFile();
          }}
          className="mb-2 h-(--h-input) w-full rounded-(--radius-input)
            border border-line-3 bg-surface px-3.5 font-mono text-[13px] shadow-sh-1
             transition-[transform,box-shadow] placeholder:text-chalk-4
            focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_var(--color-signal)]"
        />
        <p className="mb-5 font-mono text-12 text-chalk-4">
          langage détecté : {newPath.trim() ? guessLanguage(newPath.trim()) || "aucun" : "—"}
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="mo-press h-(--h-tap) flex-1 rounded-(--radius-input)
              border border-transparent text-[13px] font-bold text-chalk-2
              hover:bg-surface-2 hover:text-chalk"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={createFile}
            disabled={busy || !newPath.trim()}
            className="mo-press flex h-(--h-tap) flex-1 items-center justify-center gap-2
              rounded-(--radius-input) border border-signal bg-signal
              text-[13px] font-bold text-void shadow-sh-2 disabled:opacity-40"
          >
            Créer
          </button>
        </div>
      </Sheet>

      <StdinBubble
        open={askInput}
        value={stdin}
        onChange={setStdin}
        onRun={confirmInput}
        onClose={cancelInput}
      />
    </AppShell>
  );
}