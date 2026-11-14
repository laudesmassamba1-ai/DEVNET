/**
 * La vue « code » d'un dépôt : fichiers, brouillon, historique.
 *
 * ## Pourquoi elle est dans son propre fichier
 *
 * C'était le corps de `ProjectPage` : environ 460 lignes de JSX et la plus
 * grande partie de sa complexité cyclomatique — 143 branches et une
 * complexité cognitive de 258, mesurées par le moteur de score de ce
 * dépôt. Cette logique de **rendu** répondait à une seule question, « que
 * montre-t-on quand on regarde le code ? », et n'avait besoin que des
 * valeurs qu'on lui passe.
 *
 * Les **actions** restent dans la page : ouvrir, écrire, exécuter et
 * committer modifient l'état du dépôt et enchaînent des requêtes ; ce
 * composant ne fait que les appeler. C'est la séparation que le reste du
 * projet suit : les panneaux reçoivent des données et des callbacks, ils
 * n'interrogent pas eux-mêmes le dépôt.
 *
 * Les noms des propriétés sont ceux des identifiants de la page
 * d'origine : le déplacement reste lisible ligne à ligne dans un diff, et
 * un branchement oublié devient une erreur de type, pas un écran vide.
 */

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { EmptyState, Loading, Spinner } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { MonacoCodeEditor } from "@/components/MonacoCodeEditor";
import { Motion } from "@/components/Motion";
import { RunOutput } from "@/components/RunOutput";
import { diffLines, type Commit, type FileDiff } from "@/lib/git/history";
import { buildTree, type FileNode } from "@/lib/git/paths";
import { refusalReason, type RunOutcome } from "@/lib/execution/runner";
import { runtimeForPath } from "@/lib/execution/runtime";
import type { PresenceEntry } from "@/lib/presence";
import { scoreFile } from "@/lib/scoring";
import type { RepoFileState } from "@/lib/repo";
import { timeAgo } from "@/lib/utils";

/**
 * Ce que la page transmet à la vue code.
 *
 * Trente-deux propriétés, et c'est le signe du découpage : ce composant
 * **rend**, il ne décide pas. Chaque nom est exactement celui qui était
 * lu dans la page, ce qui rend le déplacement vérifiable ligne à ligne.
 */
export interface ProjectCodeViewProps {
  /** Tous les fichiers de la branche. */
  files: RepoFileState[] | null;
  /** Fichier ouvert dans l'éditeur. */
  open: string | null;
  /** Ouvre un fichier de l'arborescence. */
  openFile: (path: string) => void;
  /** Ouvre le dialogue de nouveau fichier. */
  setCreating: (value: boolean) => void;
  /** Fichier courant, ou `null`. */
  current: RepoFileState | null;
  /** Note du fichier affiché, brouillon compris. */
  currentScore: ReturnType<typeof scoreFile> | null;
  /** Le brouillon diffère de la version enregistrée. */
  dirty: boolean;
  /** Contenu affiché : le brouillon s'il y en a un. */
  content: string;
  /** Écriture du brouillon par l'éditeur. */
  setDraft: (value: string) => void;
  /** Enregistre le fichier courant. */
  persist: () => Promise<void>;
  /** Une écriture est en cours. */
  busy: boolean;
  /** Lance le fichier courant. */
  execute: () => Promise<void>;
  /** Lance le point d'entrée du projet (main.*, index.*, …). */
  executeProject: () => Promise<void>;
  /** Interrompt l'exécution en cours. */
  stopExecution: () => void;
  /** Une exécution est en cours. */
  busyRunning: boolean;
  /** Sortie de l'exécution en cours. */
  run: RunOutcome;
  /** Fichier modifié sous nous. */
  remote: { path: string; by: string } | null;
  /** Relit le dépôt après une écriture concurrente. */
  reloadFile: () => void;
  /** Un pair a le même fichier ouvert. */
  peerOnMyFile: PresenceEntry | null;
  /** L'arborescence est visible sur mobile. */
  mobileFilesOpen: boolean;
  /** Bascule l'arborescence mobile. */
  setMobileFilesOpen: Dispatch<SetStateAction<boolean>>;
  /** Il y a quelque chose à enregistrer. */
  hasSomethingToCommit: boolean;
  /** Changements pas encore enregistrés. */
  pending: FileDiff[];
  /** Message de la révision en cours de saisie. */
  message: string;
  /** Écriture du message de révision. */
  setMessage: (value: string) => void;
  /** Enregistre la révision. */
  commit: () => Promise<void>;
  /** Le fichier ouvert n'est pas enregistré. */
  unsaved: boolean;
  /** Historique de la branche, `null` en cours de lecture. */
  commits: Commit[] | null;
  /** Révision dont on affiche la différence. */
  diffSha: string | null;
  /** Ouvre ou ferme une différence. */
  setDiffSha: (sha: string | null) => void;
  /** Différence chargée, `null` en cours de lecture. */
  diff: FileDiff[] | null;
  /** Charge la différence d'une révision. */
  showDiff: (sha: string) => Promise<void>;
}

function TreeNode({
  node,
  open,
  onOpen,
  depth,
}: {
  node: FileNode;
  open: string | null;
  onOpen: (path: string) => void;
  depth: number;
}) {
  const pad = { paddingLeft: `${0.35 + depth * 0.7}rem` };

  if (node.dir) {
    return (
      <li>
        <span
          className="flex items-center gap-1.5 py-1 font-mono text-12 text-chalk-4"
          style={pad}
        >
          <Icon name="layers" size={11} className="shrink-0" />
          <span className="truncate">{node.name}/</span>
          <span className="tnum ml-auto text-12 text-chalk-4">{node.count}</span>
        </span>
        <ul>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              open={open}
              onOpen={onOpen}
              depth={depth + 1}
            />
          ))}
        </ul>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(node.path)}
        aria-current={open === node.path ? "true" : undefined}
        style={pad}
        className={`flex w-full items-center gap-1.5 py-1 text-left font-mono text-12
          transition-colors duration-(--d-fast)
          ${open === node.path
            ? "bg-surface-2 text-signal"
            : "text-chalk-3 hover:bg-surface-2/60 hover:text-chalk"}`}
      >
        <Icon name="file" size={11} className="shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  );
}

export function ProjectCodeView({
  files,
  open,
  openFile,
  setCreating,
  current,
  currentScore,
  dirty,
  content,
  setDraft,
  persist,
  busy,
  execute,
  executeProject,
  stopExecution,
  busyRunning,
  run,
  remote,
  reloadFile,
  peerOnMyFile,
  mobileFilesOpen,
  setMobileFilesOpen,
  hasSomethingToCommit,
  pending,
  message,
  setMessage,
  commit,
  unsaved,
  commits,
  diffSha,
  setDiffSha,
  diff,
  showDiff
}: ProjectCodeViewProps) {
  // « Exécuter le projet » n'a de sens que sur un vrai dépôt : un fichier
  // seul se lance par « exécuter », et proposer les deux embrouille.
  const projectRunnable =
    (files?.length ?? 0) > 1 &&
    (files ?? []).some((f) => runtimeForPath(f.path) !== null);

  /* ── L'écran suit la sortie ──
     On lance depuis l'éditeur, en haut ; la sortie apparaît plus bas. Sur
     un téléphone — ou avec un fichier long — elle naît hors champ : on
     croit que rien ne s'est passé. L'effet amène donc le regard sur la
     sortie dès qu'une exécution démarre, puis de nouveau à son terme (le
     résultat grandit, la ligne d'arrivée a bougé).

     On lit la position via `getBoundingClientRect` plutôt que `offsetTop` :
     `offsetTop` se compte depuis l'`offsetParent`, qui n'est pas la zone
     défilante ici — le calcul atterrirait à côté. */
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const runStatus = run.status;
  const runOutputLength = run.output.length;

  useEffect(() => {
    if (runStatus === "idle") return;
    const scroller = scrollerRef.current;
    const output = outputRef.current;
    if (!scroller || !output) return;

    // Une passe de rendu avant de mesurer : sinon on lit la géométrie de
    // l'instant précédent et on s'arrête une ligne trop haut.
    const id = requestAnimationFrame(() => {
      // Aucune zone défilante interne (écran large, contenu qui tient) :
      // c'est alors la fenêtre qui défile, et c'est elle qu'il faut viser.
      if (scroller.scrollHeight - scroller.clientHeight <= 1) {
        output.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      const o = output.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      // La sortie tient-elle dans la zone ? Si oui, on l'amène en haut —
      // on la voit entière. Sinon elle est plus haute que l'écran, et on
      // va à sa **fin** : c'est là qu'est le résultat, le début d'un long
      // journal n'étant pas ce qu'on vient lire.
      const taller = output.offsetHeight > scroller.clientHeight;
      const delta = taller ? o.bottom - s.bottom + 16 : o.top - s.top - 12;
      scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [runStatus, runOutputLength]);

  return (
      <div
        className={`grid min-h-0 flex-1 gap-2 overflow-hidden
          ${mobileFilesOpen ? "grid-rows-[auto_minmax(0,1fr)]" : "grid-rows-[minmax(0,1fr)]"}
          lg:grid-cols-[210px_1fr] lg:grid-rows-1`}
      >
      {/* ── Arborescence ──
          Le dépôt est un dossier : on le parcourt comme un
          dossier. Les répertoires sont des lignes pleines, pas des
          éléments repliables — un arbre qui se replie cache les
          fichiers, et un dépôt de dix fichiers n'a rien à
          replier. */}
      <nav
        id="project-file-tree"
        aria-label="Fichiers"
        className={`${mobileFilesOpen ? "block" : "hidden"} lg:block lg:border-r-2 lg:border-line-2 lg:pr-3`}
      >
        <p className="label prompt-label mb-2 flex items-center justify-between text-chalk-3">
          fichiers
          <button
            type="button"
            onClick={() => setCreating(true)}
            aria-label="Nouveau fichier"
            title="Nouveau fichier"
            className="-mr-2 flex size-(--h-tap) items-center justify-center
              text-chalk-4 transition-colors hover:text-signal"
          >
            <Icon name="plus" size={12} strokeWidth={2} />
          </button>
        </p>

        {files?.length === 0 && (
          <p className="px-1 font-mono text-12 text-chalk-4">
            aucun fichier — créez-en un.
          </p>
        )}

        <ul className="max-h-22 overflow-y-auto lg:max-h-105">
          {buildTree((files ?? []).map((f) => f.path)).map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              open={open}
              onOpen={openFile}
              depth={0}
            />
          ))}
        </ul>
      </nav>

      <div ref={scrollerRef} className="flex min-h-0 min-w-0 flex-col overflow-y-auto">
        {/* ── Divergence ──
            Deux bandeaux, deux gravités. Un pair sur le même
            fichier est une **information** : il faut le savoir
            avant d'écrire, mais rien n'est encore cassé. Un
            fichier qui a bougé sous nous est un **état** : la
            garde refusera l'écriture, et relire est la seule
            suite possible. Aucun des deux ne fusionne quoi que
            ce soit — c'est la règle du dépôt, décidée en
            section 9 du MEMO et pas rouverte ici. */}
        {remote && (
          <div
            role="alert"
            className="mb-2 flex items-start gap-2.5 border border-danger bg-surface px-3 py-2.5"
          >
            <Icon
              name="info"
              size={14}
              strokeWidth={2}
              className="mt-0.5 shrink-0 text-danger"
            />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-12 text-danger">
                {remote.path} a changé pendant que vous l&apos;éditiez.
              </p>
              <p className="mt-0.5 text-12 leading-snug text-chalk-3">
                Rien n&apos;est écrasé : relisez le fichier avant
                d&apos;écrire.
              </p>
            </div>
            <button
              type="button"
              onClick={reloadFile}
              className="mo-press inline-flex h-11 shrink-0 items-center gap-1.5
                rounded-(--radius-chip) border border-danger px-2.5
                font-mono text-12 font-bold uppercase tracking-[0.12em]
                text-danger"
            >
              <Icon name="eye" size={11} strokeWidth={2} />
              relire
            </button>
          </div>
        )}

        {!remote && peerOnMyFile && (
          <div className="mb-2 flex items-start gap-2.5 border border-warn/60 bg-surface px-3 py-2.5">
            <Icon
              name="info"
              size={14}
              strokeWidth={2}
              className="mt-0.5 shrink-0 text-warn"
            />
            <p className="min-w-0 flex-1 text-12 leading-snug text-chalk-2">
              <span className="font-bold text-warn">
                {peerOnMyFile.user?.prenom ?? "Un autre membre"}
              </span>{" "}
              a ce même fichier ouvert. Écrivez puis relisez, ou attendez
              qu&apos;il ait terminé — deux écritures concurrentes ne sont
              pas fusionnées.
            </p>
          </div>
        )}

        {/* ── Éditeur ──
            La gouttière de numéros est celle de l'éditeur de
            code du design system : on sait où on est dans le
            fichier sans compter les lignes à la main. */}
        {current && (
          <Motion
            role="scale"
            key={current.path}
            className="flex min-h-0 flex-none flex-col"
          >
            <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  aria-label={mobileFilesOpen ? "Masquer les fichiers" : "Afficher les fichiers"}
                  aria-expanded={mobileFilesOpen}
                  aria-controls="project-file-tree"
                  onClick={() => setMobileFilesOpen((open) => !open)}
                  className="mo-press flex size-(--h-tap) shrink-0 items-center justify-center
                    text-chalk-4 hover:text-signal lg:hidden"
                >
                  <Icon name="layers" size={14} />
                </button>
                <p className="truncate font-mono text-12 text-chalk-2">
                  {current.path}
                  {dirty && <span className="ml-2 text-signal">• modifié</span>}
                  {/* La note du fichier suit le brouillon : elle sert
                      à écrire, donc elle réagit à ce qu'on écrit. */}
                  {currentScore && (
                    <span
                      className={`tnum ml-2 ${
                        currentScore.grade.tone === "ok"
                          ? "text-ok"
                          : currentScore.grade.tone === "warn"
                            ? "text-warn"
                            : "text-danger"
                      }`}
                      title={`Score du fichier : ${currentScore.score}/1000 (${currentScore.grade.letter} — ${currentScore.grade.label})`}
                    >
                      {currentScore.score}
                    </span>
                  )}
                </p>
              </div>

              <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                {/* « Exécuter » n'apparaît que si le fichier a un
                    moteur. Sur un fichier sans runtime — une
                    image, un `README` — un bouton qui explain
                    qu'il ne peut pas faire est un bouton inutile ;
                    son absence l'est moins. */}
                {refusalReason(current.path) === null && (
                  <button
                    type="button"
                    onClick={execute}
                    disabled={busyRunning || run.status === "loading"}
                    title={
                      run.status === "loading"
                        ? "Téléchargement du moteur…"
                        : "Exécuter"
                    }
                    className="mo-press inline-flex h-11 shrink-0 items-center
                      gap-1.5 rounded-(--radius-chip) border border-signal
                      bg-signal px-2.5 max-[340px]:px-2 font-mono text-12 font-bold
                      uppercase tracking-[0.12em] text-void disabled:opacity-50"
                  >
                    {run.status === "running" || run.status === "loading" ? (
                      <Spinner />
                    ) : (
                      <Icon name="bolt" size={11} strokeWidth={2.2} />
                    )}
                    {run.status === "loading" ? "moteur…" : "exécuter"}
                  </button>
                )}

                {/* « Exécuter le projet » : sur un dépôt, on ne veut pas
                    toujours lancer le fichier ouvert (un en-tête, un
                    module), mais le point d'entrée (`main.*`,
                    `index.*`). Le bouton n'apparaît que là où c'est
                    utile : au moins deux fichiers, dont un exécutable. */}
                {projectRunnable && (
                  <button
                    type="button"
                    onClick={executeProject}
                    disabled={busyRunning || run.status === "loading"}
                    title="Exécuter le point d'entrée du projet (main.*, index.*)"
                    className="mo-press inline-flex h-11 shrink-0 items-center
                      gap-1.5 rounded-(--radius-chip) border border-signal
                      bg-transparent px-2.5 font-mono text-12 font-bold
                      uppercase tracking-[0.12em] text-signal disabled:opacity-50"
                  >
                    <Icon name="layers" size={11} strokeWidth={2} />
                    projet
                  </button>
                )}

                {/* « Arrêter » n'existe que pendant qu'on tourne.
                    Un bouton toujours visible mais désactivé
afficherait une promesse permanente pour une action momentanée. */}
                {busyRunning && (
                  <button
                    type="button"
                    onClick={stopExecution}
                    title="Arrêter et terminer le worker"
                    className="mo-press inline-flex h-11 shrink-0 items-center
                      gap-1.5 rounded-(--radius-chip) border border-danger
                      bg-transparent px-2.5 font-mono text-12 font-bold
                      uppercase tracking-[0.12em] text-danger"
                  >
                    <Icon name="stop" size={11} strokeWidth={2.2} />
                    arrêter
                  </button>
                )}

                <button
                  type="button"
                  onClick={persist}
                  disabled={busy || !dirty}
                  className="mo-press inline-flex h-11 shrink-0 items-center gap-1.5
                    rounded-(--radius-chip) border border-line-3 px-2.5 max-[340px]:px-2
                    font-mono text-12 font-bold uppercase tracking-[0.12em]
                    text-chalk-3 transition-[border-color,color]
                    duration-(--d-fast)
                    hover:border-signal hover:text-signal disabled:opacity-40"
                >
                  <Icon name="check" size={11} strokeWidth={2} />
                  écrire
                </button>
              </div>
            </div>

            <div className="h-[calc(100dvh-230px)] min-h-90 lg:h-[calc(100dvh-250px)] lg:min-h-105">
              <MonacoCodeEditor
                path={current.path}
                value={content}
                onChange={setDraft}
                onSave={persist}
                onRun={execute}
                fill
              />
            </div>

            {/* La sortie occupe la place du fichier quand elle
                existe : deux blocs côte à côte sur un téléphone
                ne se lisent pas, et la sortie est ce qu'on vient
                de demander. La saisie, elle, se réclame dans une
                bulle au lancement (voir `StdinBubble`) — un champ
                toujours affiché ne disait pas qu'il fallait le
                remplir. */}
            <div ref={outputRef}>
              <RunOutput outcome={run} />
            </div>
          </Motion>
        )}

        {!current && (
          <EmptyState
            icon={<Icon name="file" size={20} strokeWidth={1.5} />}
            title="Aucun fichier ouvert"
            hint="Sélectionnez un fichier dans l&apos;arborescence."
            action={
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="mo-press inline-flex h-(--h-tap) items-center gap-2
                  rounded-(--radius-input) border border-signal bg-signal
                  px-4 text-13 font-bold text-void shadow-sh-2"
              >
                <Icon name="plus" size={14} strokeWidth={2} />
                Nouveau fichier
              </button>
            }
          />
        )}

        {/* ── Enregistrer une révision ──
            La boîte n'apparaît que s'il y a quelque chose à
            enregistrer. En permanence, elle ferait profession
            de se demander « ai-je oublié de valider ? » à chaque
            écran, et la réponse serait toujours non. */}
        {hasSomethingToCommit && (
          <Motion role="rise">
            <section className="mt-4 border border-signal/60 bg-surface p-3.5">
              <p className="label prompt-label mb-2 text-signal">
                {pending.length} {pending.length === 1 ? "fichier modifié" : "fichiers modifiés"}
              </p>

              <ul className="mb-3 space-y-0.5">
                {pending.map((c) => (
                  <li
                    key={c.path}
                    className="flex items-baseline gap-2 font-mono text-12"
                  >
                    <span
                      className={
                        c.status === "ajout" ? "text-signal" : "text-warn"
                      }
                    >
                      {c.status === "ajout" ? "+" : c.status === "suppression" ? "−" : "~"}
                    </span>
                    <span className="truncate text-chalk-2">{c.path}</span>
                    <span className="tnum ml-auto shrink-0 text-chalk-4">
                      +{c.insertions} −{c.deletions}
                    </span>
                  </li>
                ))}
              </ul>

              <label htmlFor="commit-msg" className="prompt-label mb-1.5 block text-chalk-2">
                message de la révision
              </label>
              <input
                id="commit-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Ce que ce changement fait, en une ligne."
                className="mb-3 h-(--h-input) w-full rounded-(--radius-input)
                  border border-line-3 bg-surface-2 px-3.5 font-mono text-13
                  outline transition-[transform,box-shadow]
                  duration-(--d-base) ease-(--ease-spring)
                  placeholder:text-chalk-4 focus:-translate-x-px
                  focus:-translate-y-px focus:shadow-[3px_3px_0_var(--color-signal)]"
              />

              <button
                type="button"
                onClick={commit}
                disabled={busy || !message.trim() || unsaved}
                title={
                  unsaved
                    ? "Écrivez d'abord le fichier ouvert : une révision ne prend que ce qui est sur le disque."
                    : undefined
                }
                className="mo-press flex h-(--h-tap) w-full items-center justify-center gap-2
                  rounded-(--radius-input) border border-signal bg-signal
                  text-13 font-bold text-void shadow-sh-2 disabled:opacity-40"
              >
                <Icon name="check" size={14} strokeWidth={2} />
                Enregistrer la révision
              </button>

              {unsaved && (
                <p className="mt-2 font-mono text-12 text-warn">
                  Fichier non enregistré.
                </p>
              )}
            </section>
          </Motion>
        )}

        {/* ── Historique ── */}
        <section className="mt-5">
          <p className="label prompt-label mb-2 text-chalk-3">historique</p>

          {commits === null && <Loading label="Lecture des révisions" />}

          {commits?.length === 0 && (
            <p className="font-mono text-12 text-chalk-4">
              aucune révision.
            </p>
          )}

          <ol className="space-y-1.5">
            {commits?.map((c) => (
              <li key={c.sha}>
                <button
                  type="button"
                  onClick={() => (diffSha === c.sha ? setDiffSha(null) : showDiff(c.sha))}
                  aria-expanded={diffSha === c.sha}
                  className={`w-full border bg-surface px-3 py-2.5 text-left
                    transition-colors duration-(--d-fast)
                    ${diffSha === c.sha
                      ? "border-signal"
                      : "border-line-2 hover:border-line-3"}`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="tnum shrink-0 font-mono text-12 text-signal">
                      {c.sha.slice(0, 7)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-sm text-chalk">
                      {c.message}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2.5 font-mono text-12 text-chalk-4">
                    <span>{c.author_name}</span>
                    <span>{timeAgo(c.created_at)}</span>
                    <span className="tnum">
                      +{c.insertions} −{c.deletions}
                    </span>
                  </span>
                </button>

                {diffSha === c.sha && (
                  <div className="border border-t-0 border-signal bg-surface px-3 py-2">
                    {diff === null && <Loading label="Comparaison" />}
                    {diff?.length === 0 && (
                      <p className="font-mono text-12 text-chalk-4">
                        aucune différence — première révision.
                      </p>
                    )}
                    {diff?.map((d) => (
                      <div key={d.path} className="mb-2 last:mb-0">
                        <p className="mb-1 font-mono text-12 text-chalk-3">
                          {d.path}
                        </p>
                        <pre className="overflow-x-auto font-mono text-12 leading-[1.55]">
                          {diffLines(d.before, d.after).map((l, i) => (
                            <span
                              key={i}
                              className={
                                l.kind === "ajout"
                                  ? "block text-signal"
                                  : l.kind === "suppression"
                                    ? "block text-danger"
                                    : "block text-chalk-3"
                              }
                            >
                              {l.kind === "ajout" ? "+" : l.kind === "suppression" ? "−" : " "}
                              {l.text || " "}
                            </span>
                          ))}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
