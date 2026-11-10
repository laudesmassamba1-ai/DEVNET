"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { EmptyState, Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { MonacoCodeEditor } from "@/components/MonacoCodeEditor";
import { RunOutput } from "@/components/RunOutput";
import { Sheet } from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { CursorLayer } from "@/components/collab/CursorLayer";
import { TeamChat } from "@/components/collab/TeamChat";
import { useSession } from "@/hooks/useSession";
import { useCollab } from "@/lib/collab/useCollab";
import { fetchActiveContributions } from "@/lib/extensions";
import { IDLE, runFile, type RunOutcome } from "@/lib/execution/runner";
import { DEFAULT_BRANCH, branchErrorText, validateBranchName } from "@/lib/git/refs";
import { buildTree, looksBinary, type FileNode } from "@/lib/git/paths";
import { DEFAULT_EXTENSIONS, devcontainerJson, recommendedExtensions } from "@/lib/vscode/bridge";
import type { ExtensionCommand, ExtensionSnippet, GitRef, Project } from "@/lib/types";
import {
  commitRepo,
  createBranch,
  deleteBranch,
  fetchBranches,
  fetchProject,
  fetchRepoFiles,
  saveRepoFile,
  type RepoFileState,
} from "@/lib/repo";

/**
 * Le dépôt dans l’IDE.
 *
 * L’éditeur immersif ne cherche pas à dupliquer toute la page de projet :
 * il concentre l’attention sur **l’écriture**, **l’exécution** et
 * **l’instantané** (branches, commit). On reprend les mêmes appels que
 * `app/projects/[id]/page.tsx` pour ne pas réinventer les contrats avec
 * les API du dépôt.
 */

/**
 * Arborescence des fichiers.
 *
 * Comme dans la référence, les répertoires sont affichés en lignes, sans
 * repliement interactif. Cela garde l’explorateur lisible et évite de
 * masquer ce qui vient d’être créé.
 */
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
          className="flex items-center gap-1.5 py-1 font-mono text-[11.5px] text-chalk-4"
          style={pad}
        >
          <Icon name="layers" size={11} className="shrink-0" />
          <span className="truncate">{node.name}/</span>
          <span className="tnum ml-auto text-[10.5px] text-chalk-4">
            {node.count}
          </span>
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
        className={`flex w-full items-center gap-1.5 py-1 text-left font-mono text-[11.5px]
          transition-colors duration-[var(--d-fast)]
          ${
            open === node.path
              ? "bg-surface-2 text-signal"
              : "text-chalk-3 hover:bg-surface-2/60 hover:text-chalk"
          }`}
      >
        <Icon name="file" size={11} className="shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  );
}

/**
 * Le premier fichier qu’on peut ouvrir dans l’arborescence.
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

/**
 * Utilitaire pour ouvrir un fichier sans déclencher de boucle.
 */
function selectOpenable(files: RepoFileState[]): string | null {
  if (files.length === 0) return null;
  const tree = buildTree(files.map((f) => f.path));
  return firstOpenable(tree);
}

/**
 * Télécharge un texte comme fichier, côté navigateur.
 *
 * Le pont VS Code tient le **contenu** (devcontainer, recommandations) ; le
 * transport vers le disque est un détail du navigateur. On garde donc cette
 * fonction ici, à la frontière, pour ne pas mêler `window` au module pur
 * `lib/vscode`.
 */
function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function IdePage() {
  const params = useParams<{ project: string }>();
  const raw = params?.project;
  const projectId = Array.isArray(raw) ? raw[0] : raw ?? "";
  const { profile } = useSession();
  const router = useRouter();
  const toast = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [branch, setBranch] = useState(DEFAULT_BRANCH);
  const [branches, setBranches] = useState<GitRef[]>([]);
  const branchReady = useRef(false);

  const [files, setFiles] = useState<RepoFileState[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);

  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [savedSha, setSavedSha] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Brouillons par chemin : changer d'onglet ne doit pas effacer ce qu'on
  // vient d'écrire. On garde donc le texte non enregistré de chaque fichier
  // ici, et on le restaure quand on revient dessus — sinon une simple visite
  // dans l'arborescence faisait perdre la frappe en cours, sans avertir.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  const [outcome, setOutcome] = useState<RunOutcome>(IDLE);
  const abortRef = useRef<(() => void) | null>(null);

  // Les contributions des extensions **activées** : extraits pour la
  // complétion, commandes pour la palette (`F1`). Une seule lecture, une
  // fois par session ; une extension désactivée ne contribue rien.
  const [snippets, setSnippets] = useState<ExtensionSnippet[]>([]);
  const [commands, setCommands] = useState<ExtensionCommand[]>([]);
  useEffect(() => {
    if (!profile?.id) {
    // eslint-disable-next-line react-hooks/set-state-in-effect
      setSnippets([]);
      setCommands([]);
      return;
    }
    let alive = true;
    fetchActiveContributions(profile.id).then((active) => {
      if (!alive) return;
      setSnippets(active.snippets);
      setCommands(active.commands);
    });
    return () => {
      alive = false;
    };
  }, [profile?.id]);

  // Présence et fil d'équipe : la salle suit le fichier ouvert, pour qu'on
  // ne voie que les curseurs du fichier qu'on regarde. Défilement et volet
  // de discussion restent des états d'écran.
  const [scrollTop, setScrollTop] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const { cursors, messages, sendCursor, sendChat } = useCollab({
    room: open ? `ide:${projectId}:${open}` : null,
    self: profile
      ? {
          id: profile.id,
          pseudo: profile.pseudo,
          color: profile.avatar_color,
          path: open ?? "",
        }
      : null,
  });

  const [namingBranch, setNamingBranch] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [dropping, setDropping] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");

  const openRef = useRef<string | null>(null);
  const branchRef = useRef(branch);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    branchRef.current = branch;
  }, [branch]);

  const current = useMemo(
    () => (files ?? []).find((f) => f.path === open) ?? null,
    [files, open],
  );

  const tree = useMemo(
    () => buildTree((files ?? []).map((f) => f.path)),
    [files],
  );

  useEffect(() => {
    if (!current) {
      // Aucun fichier ouvert : l'éditeur repart vierge. Re-synchronisation
      // d'affichage (contenu éditable, non dérivable du rendu).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContent("");
      setDirty(false);
      setSavedSha("");
      return;
    }
    const draft = draftsRef.current[current.path];
    const next = draft !== undefined ? draft : current.content;
    // Re-synchronisation d'affichage au changement de fichier : le contenu
    // repart du dépôt (ou du brouillon de CE fichier), pas d'un autre.
    setContent(next);
    setSavedSha(current.blob_sha);
    setDirty(next !== current.content);
    setOutcome(IDLE);
  }, [current]);

  const load = useCallback(async () => {
    if (!projectId) return;
    const found = await fetchProject(projectId);
    if (!found) {
      setMissing(true);
      return;
    }
    setProject(found);

    const currentBranch = branchReady.current
      ? branch
      : found.default_branch || DEFAULT_BRANCH;

    if (!branchReady.current) {
      setBranch(currentBranch);
      branchReady.current = true;
    }

    const [nextFiles, nextBranches] = await Promise.all([
      fetchRepoFiles(projectId, currentBranch),
      fetchBranches(projectId),
    ]);

    setFiles(nextFiles);
    setBranches(nextBranches);

    setOpen((prev) => {
      if (prev && nextFiles.some((f) => f.path === prev)) return prev;
      const cand = selectOpenable(nextFiles);
      if (cand) {
        setOpenTabs((t) => (t.includes(cand) ? t : [cand, ...t].slice(0, 12)));
      }
      return cand;
    });
  }, [projectId, branch]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const openFile = useCallback(
    (path: string) => {
      setOpen(path);
      setOpenTabs((t) => (t.includes(path) ? t : [path, ...t].slice(0, 12)));
    },
    [],
  );

  const closeTab = useCallback(
    (path: string) => {
      setOpenTabs((t) => t.filter((p) => p !== path));
      setDrafts((d) => {
        if (!(path in d)) return d;
        const copy = { ...d };
        delete copy[path];
        return copy;
      });
      if (open === path) {
        const remaining = openTabs.filter((p) => p !== path);
        setOpen(remaining[0] ?? null);
      }
    },
    [open, openTabs],
  );

  const switchBranch = useCallback(
    async (b: string) => {
      if (b === branch) return;
      setBranch(b);
      setOpen(null);
      setOpenTabs([]);
      setContent("");
      setDrafts({});
      setDirty(false);
      setSavedSha("");
      setOutcome(IDLE);
    },
    [branch],
  );

  const persist = useCallback(async () => {
    if (!current || !profile?.id || !dirty) return;
    setBusy(true);
    const res = await saveRepoFile({
      projectId,
      path: current.path,
      content,
      userId: profile.id,
      branch,
      expectedSha: savedSha,
    });
    setBusy(false);
    if (res.error) {
      if (res.diverged) {
        toast("Conflit : le fichier a changé entre-temps.", "err");
      } else {
        toast(res.error, "err");
      }
      return;
    }
    toast("Fichier enregistré");
    setDirty(false);
    setDrafts((d) => {
      if (!(current.path in d)) return d;
      const copy = { ...d };
      delete copy[current.path];
      return copy;
    });
    await load();
  }, [current, profile, dirty, projectId, content, branch, savedSha, toast, load]);

  const execute = useCallback(async () => {
    if (!current) return;
    if (abortRef.current) abortRef.current();
    const project: Record<string, string> = {};
    for (const file of (files ?? [])) {
      if (looksBinary(file.path)) continue;
      project[file.path] = file.content;
    }
    project[current.path] = content;
    const controller = new AbortController();
    // On relie la référence d'arrêt au contrôleur de cette exécution :
    // c'est ce que le bouton « Stop » (`stopExec`) appellera. Sans cette
    // ligne, `abortRef` resterait à `null` et l'arrêt ne ferait rien.
    abortRef.current = () => controller.abort();
    try {
      const res = await runFile(
        current.path,
        content,
        (o: RunOutcome) => setOutcome(o),
        project,
        "",
        controller.signal,
      );
      setOutcome(res);
    } finally {
      abortRef.current = null;
    }
  }, [current, content, files]);

  const stopExec = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
  }, []);

  const createNewBranch = useCallback(async () => {
    const v = validateBranchName(branchName);
    if (!v.ok) {
      toast(branchErrorText(v.reason), "err");
      return;
    }
    const err = await createBranch({
      projectId,
      name: v.name,
      from: branch,
    });
    if (err.error) {
      toast(err.error, "err");
      return;
    }
    toast("Branche créée");
    setNamingBranch(false);
    setBranchName("");
    setBranch(v.name);
  }, [branchName, projectId, branch, toast]);

  const dropBranch = useCallback(async (b: string) => {
    const err = await deleteBranch({ projectId, name: b });
    if (err.error) {
      toast(err.error, "err");
      return;
    }
    toast("Branche supprimée");
    setDropping(null);
    if (b === branch) {
      setBranch(DEFAULT_BRANCH);
    }
    await load();
  }, [projectId, branch, toast, load]);

  const commit = useCallback(async () => {
    if (!profile?.id) return;
    const msg = commitMsg.trim();
    if (!msg) {
      toast("Un message est requis pour le commit.", "err");
      return;
    }
    setBusy(true);
    const res = await commitRepo({
      projectId,
      branch,
      message: msg,
      author: {
        id: profile.id,
        prenom: profile.prenom ?? "Auteur",
        email: profile.email ?? "",
      },
    });
    setBusy(false);
    if (res.error) {
      toast(res.error, "err");
      return;
    }
    if (!res.commit) {
      toast("Rien à enregistrer.");
      setCommitting(false);
      setCommitMsg("");
      return;
    }
    toast("Commit enregistré");
    setCommitting(false);
    setCommitMsg("");
    setDirty(false);
    await load();
  }, [profile, commitMsg, projectId, branch, toast, load]);

  const handleChange = useCallback(
    (next: string) => {
      setContent(next);
      const path = openRef.current;
      if (path) {
        setDrafts((d) => (d[path] === next ? d : { ...d, [path]: next }));
      }
      if (current) {
        setDirty(next !== (current.content ?? ""));
      } else {
        setDirty(next.length > 0);
      }
    },
    [current],
  );

  // Le pont VS Code exporte ce que le dépôt ne stocke pas : la configuration
  // d'environnement locale. On la fabrique à la demande plutôt que de la
  // versionner, pour qu'elle reflète le projet courant.
  const exportDevcontainer = useCallback(() => {
    downloadText(
      "devcontainer.json",
      devcontainerJson({
        name: `devnet-${project?.slug ?? projectId}`,
        postCreateCommand: "npm install",
        forwardPorts: [3000],
      }),
    );
  }, [project, projectId]);

  const exportExtensions = useCallback(() => {
    downloadText("extensions.json", recommendedExtensions(DEFAULT_EXTENSIONS));
  }, []);

  if (missing) {
    return (
      <AppShell path="~/ide" immersive>
        <EmptyState
          title="Projet introuvable"
          action={
            <button
              type="button"
              onClick={() => router.push("/projects")}
              className="mo-press inline-flex h-[var(--h-tap)] items-center rounded-[var(--radius-input)]
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

  if (!project || !files) {
    return (
      <AppShell path="~/ide" immersive>
        <div className="flex h-full items-center justify-center">
          <Loading label="Chargement de l’IDE…" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={project.name}
      path={`~/ide/${project.slug ?? project.id}`}
      immersive
    >
      <div className="flex h-full flex-col">
        {/* ── Barre d’onglets ── */}
        <div className="flex h-[38px] items-center gap-1 border-b border-line-3 bg-surface-2/60 px-2">
          {openTabs.length === 0 && (
            <span className="px-2 font-mono text-[11px] text-chalk-4">
              Aucun fichier ouvert
            </span>
          )}
          {openTabs.map((p) => {
            const saved = (files ?? []).find((f) => f.path === p)?.content ?? "";
            const changed = drafts[p] !== undefined && drafts[p] !== saved;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setOpen(p)}
                className={`flex max-w-[220px] items-center gap-1.5 rounded-t-[var(--radius-chip)] border-x border-t px-2.5 py-1 font-mono text-[11px] transition-colors
                  ${
                    open === p
                      ? "border-line-3 bg-surface text-chalk"
                      : "border-transparent bg-surface-2/40 text-chalk-3 hover:bg-surface-2/80"
                  }`}
              >
                {changed && (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-signal"
                    title="Modifications non enregistrées"
                  />
                )}
                <span className="truncate">{p}</span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(p);
                  }}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-chalk-4 hover:bg-surface-2 hover:text-chalk"
                >
                  <Icon name="close" size={9} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex min-h-0 flex-1">
          {/* ── Arborescence ── */}
          <aside className="flex w-[260px] shrink-0 flex-col border-r border-line-3 bg-surface-2/40">
            <div className="flex items-center justify-between border-b border-line-3 px-2.5 py-2">
              <span className="label-micro text-chalk-3">Fichiers</span>
              <span className="tnum font-mono text-[10.5px] text-chalk-4">
                {(files ?? []).length}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto py-1">
              <ul>
                {tree.map((n) => (
                  <TreeNode
                    key={n.path || n.name}
                    node={n}
                    open={open}
                    onOpen={openFile}
                    depth={0}
                  />
                ))}
              </ul>
            </div>
          </aside>

          {/* ── Éditeur + sortie ── */}
          <main className="flex min-h-0 flex-1 flex-col">
            {/* ── Actions haut ── */}
            <div className="flex flex-wrap items-center gap-2 border-b border-line-3 bg-surface-2/40 px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <select
                  value={branch}
                  aria-label="Branche"
                  onChange={(e) => switchBranch(e.target.value)}
                  className="mo-press h-[32px] rounded-[var(--radius-chip)] border border-line-3 bg-surface px-2 font-mono text-[11px] text-chalk-2"
                >
                  {branches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setNamingBranch(true)}
                  className="mo-press inline-flex h-[32px] items-center gap-1 rounded-[var(--radius-chip)] border border-line-3 px-2 font-mono text-[11px] text-chalk-2 hover:border-signal hover:text-signal"
                >
                  <Icon name="plus" size={11} />
                  branche
                </button>
                {branch !== DEFAULT_BRANCH && (
                  <button
                    type="button"
                    onClick={() => setDropping(branch)}
                    className="mo-press inline-flex h-[32px] items-center gap-1 rounded-[var(--radius-chip)] border border-line-3 px-2 font-mono text-[11px] text-chalk-2 hover:border-danger hover:text-danger"
                  >
                    <Icon name="close" size={11} />
                    supprimer
                  </button>
                )}
              </div>

              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setChatOpen((v) => !v)}
                  className={`mo-press inline-flex h-[32px] items-center gap-1.5 rounded-[var(--radius-chip)] border px-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em]
                    ${chatOpen ? "border-signal text-signal" : "border-line-3 text-chalk-3 hover:border-signal hover:text-signal"}`}
                >
                  <Icon name="messages" size={11} />
                  équipe
                  {cursors.length > 0 && (
                    <span className="tnum text-[10px] text-signal">{cursors.length + 1}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={exportDevcontainer}
                  title="Exporter devcontainer.json"
                  className="mo-press inline-flex h-[32px] items-center gap-1.5 rounded-[var(--radius-chip)] border border-line-3 px-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-chalk-3 hover:border-signal hover:text-signal"
                >
                  <Icon name="code" size={11} />
                  devcontainer
                </button>
                <button
                  type="button"
                  onClick={exportExtensions}
                  title="Exporter extensions.json"
                  className="mo-press inline-flex h-[32px] items-center gap-1.5 rounded-[var(--radius-chip)] border border-line-3 px-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-chalk-3 hover:border-signal hover:text-signal"
                >
                  <Icon name="package" size={11} />
                  extensions
                </button>
                <button
                  type="button"
                  onClick={stopExec}
                  disabled={outcome.status !== "running" && outcome.status !== "loading"}
                  className="mo-press inline-flex h-[32px] items-center gap-1.5 rounded-[var(--radius-chip)] border border-line-3 px-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-chalk-3 hover:border-warn hover:text-warn disabled:opacity-40"
                >
                  <Icon name="stop" size={11} strokeWidth={2.2} />
                  arrêter
                </button>
                <button
                  type="button"
                  onClick={execute}
                  disabled={!current || busy}
                  className="mo-press inline-flex h-[32px] items-center gap-1.5 rounded-[var(--radius-chip)] border border-line-3 px-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-chalk-3 hover:border-signal hover:text-signal disabled:opacity-40"
                >
                  <Icon name="bolt" size={11} strokeWidth={2} />
                  exécuter
                </button>
                <button
                  type="button"
                  onClick={persist}
                  disabled={busy || !dirty}
                  className="mo-press inline-flex h-[32px] items-center gap-1.5 rounded-[var(--radius-chip)] border border-line-3 px-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-chalk-3 hover:border-signal hover:text-signal disabled:opacity-40"
                >
                  <Icon name="check" size={11} strokeWidth={2} />
                  écrire
                </button>
                <button
                  type="button"
                  onClick={() => setCommitting(true)}
                  disabled={busy}
                  className="mo-press inline-flex h-[32px] items-center gap-1.5 rounded-[var(--radius-chip)] border border-line-3 px-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-chalk-3 hover:border-signal hover:text-signal disabled:opacity-40"
                >
                  <Icon name="plus" size={11} strokeWidth={2} />
                  commit
                </button>
              </div>
            </div>

            {/* ── Éditeur ── */}
            <div className="relative min-h-0 flex-1">
              {current ? (
                <MonacoCodeEditor
                  path={current.path}
                  value={content}
                  onChange={handleChange}
                  onSave={persist}
                  onRun={execute}
                  onSelectionChange={(sel) => sendCursor(sel.anchor, sel.head)}
                  onScrollChange={setScrollTop}
                  snippets={snippets}
                  commands={commands}
                  fill
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-chalk-4">
                  Sélectionner un fichier dans l’arborescence pour commencer.
                </div>
              )}
              {current && (
                <CursorLayer
                  cursors={cursors}
                  path={current.path}
                  lineHeight={25}
                  charWidth={9.6}
                  paddingTop={12 - scrollTop}
                />
              )}
            </div>

            {/* ── Sortie ── */}
            <div className="border-t border-line-3 bg-surface-2/40 px-2.5 py-2">
              <RunOutput outcome={outcome} />
            </div>
          </main>

          {/* ── Fil d'équipe ── */}
          {chatOpen && (
            <aside className="flex w-[300px] shrink-0 flex-col border-l border-line-3 bg-surface-2/40">
              <TeamChat messages={messages} onSend={sendChat} />
            </aside>
          )}
        </div>
      </div>

      {/* ── Feuille : nouvelle branche ── */}
      <Sheet
        open={namingBranch}
        onClose={() => setNamingBranch(false)}
        title="Nouvelle branche"
      >
        <div className="space-y-4 p-4">
          <p className="text-sm leading-relaxed text-chalk-3">
            Créer depuis <span className="font-mono text-chalk-2">{branch}</span>
          </p>
          <div className="space-y-2">
            <label className="label block text-chalk-2">Nom de la branche</label>
            <input
              aria-label="Nom de la nouvelle branche"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              className="w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3 py-2 font-mono text-sm text-chalk"
              placeholder="feature/ide"
              spellCheck={false}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setNamingBranch(false)}
              className="mo-press inline-flex h-[var(--h-tap)] items-center rounded-[var(--radius-input)] border border-line-3 px-4 text-[13px] font-bold text-chalk-2 hover:border-chalk-2"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={createNewBranch}
              className="mo-press inline-flex h-[var(--h-tap)] items-center rounded-[var(--radius-input)] border border-signal bg-signal px-4 text-[13px] font-bold text-void hover:opacity-95"
            >
              Créer
            </button>
          </div>
        </div>
      </Sheet>

      {/* ── Feuille : supprimer branche ── */}
      <Sheet
        open={dropping !== null}
        onClose={() => setDropping(null)}
        title="Supprimer la branche"
      >
        <div className="space-y-4 p-4">
          <p className="text-sm leading-relaxed text-chalk-3">
            Confirmer la suppression de <span className="font-mono text-danger">{dropping}</span>
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDropping(null)}
              className="mo-press inline-flex h-[var(--h-tap)] items-center rounded-[var(--radius-input)] border border-line-3 px-4 text-[13px] font-bold text-chalk-2 hover:border-chalk-2"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => dropping && dropBranch(dropping)}
              className="mo-press inline-flex h-[var(--h-tap)] items-center rounded-[var(--radius-input)] border border-danger bg-danger px-4 text-[13px] font-bold text-void hover:opacity-95"
            >
              Supprimer
            </button>
          </div>
        </div>
      </Sheet>

      {/* ── Feuille : commit ── */}
      <Sheet
        open={committing}
        onClose={() => setCommitting(false)}
        title="Enregistrer (commit)"
      >
        <div className="space-y-4 p-4">
          <p className="text-sm leading-relaxed text-chalk-3">
            Branche <span className="font-mono text-chalk-2">{branch}</span>
          </p>
          <div className="space-y-2">
            <label className="label block text-chalk-2">Message du commit</label>
            <textarea
              aria-label="Message du commit"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              rows={3}
              spellCheck={false}
              className="w-full resize-y rounded-[var(--radius-input)] border border-line-3 bg-surface px-3 py-2 font-mono text-sm leading-relaxed text-chalk"
              placeholder="fix: corriger l’éditeur"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCommitting(false)}
              className="mo-press inline-flex h-[var(--h-tap)] items-center rounded-[var(--radius-input)] border border-line-3 px-4 text-[13px] font-bold text-chalk-2 hover:border-chalk-2"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={commit}
              className="mo-press inline-flex h-[var(--h-tap)] items-center rounded-[var(--radius-input)] border border-signal bg-signal px-4 text-[13px] font-bold text-void hover:opacity-95"
            >
              Enregistrer
            </button>
          </div>
        </div>
      </Sheet>
    </AppShell>
  );
}


