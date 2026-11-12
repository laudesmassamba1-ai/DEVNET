/**
 * L'import d'un dépôt GitHub dans DevNet — côté navigateur.
 *
 * Trois gestes : demander la suite d'états au route
 * `POST /api/github/import`, créer un projet DevNet, puis rejouer
 * l'histoire dans ce projet. Le route a lu GitHub ; c'est ici que
 * s'écrit le dépôt DevNet, par le moteur ordinaire (`lib/repo`), jamais
 * par la route — la règle « pas de route handler » tient.
 */

import {
  createProject,
  fetchProject,
  importRepoHistory,
  type HistorySnapshot,
  type UserLiteForRepo,
} from "@/lib/repo";
import { api } from "@/lib/api/client";
import type { GithubImportPayload, Project } from "@/lib/types";
import type { GithubReadError } from "@/lib/github/read";

/**
 * Le projet DevNet déjà raccordé à ce dépôt, s'il existe.
 *
 * Les sha de commits sont globaux (une clé primaire), donc réimporter un
 * dépôt déjà copié retrouve exactement les mêmes commits. Créer un second
 * projet les mettrait en collision : on rouvre le projet existant.
 */
async function findImportedProject(
  owner: string,
  repo: string,
  userId: string,
): Promise<Project | null> {
  const { data } = await api
    .from("project_links")
    .select("project_id")
    .eq("user_id", userId)
    .eq("owner", owner)
    .eq("repo", repo)
    .maybeSingle();

  const projectId = (data as { project_id: string } | null)?.project_id;
  return projectId ? fetchProject(projectId) : null;
}

/** Demande l'import au serveur. */
export async function fetchImportPayload(
  owner: string,
  repo: string,
  branch?: string,
): Promise<{ payload: GithubImportPayload | null; error: GithubReadError | null }> {
  try {
    const res = await fetch("/api/github/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner, repo, branch }),
    });

    const body = (await res.json().catch(() => null)) as
      | { payload?: GithubImportPayload; error?: string }
      | null;

    if (!res.ok || !body?.payload) {
      return { payload: null, error: (body?.error as GithubReadError) ?? "api" };
    }
    return { payload: body.payload, error: null };
  } catch {
    return { payload: null, error: "api" };
  }
}

/**
 * Reconstruit l'état cumulatif de chaque révision à partir du fil.
 *
 * La première révision est `full`, les suivantes sont `delta` : on part
 * donc d'une table chemin → contenu, on remplace tout à la révision
 * `full`, puis on applique chaque delta (écritures, puis suppressions).
 * Le résultat est l'état **complet** attendu, ce dont `createCommit` a
 * besoin pour recalculer un sha juste.
 */
export function buildSnapshots(payload: GithubImportPayload): HistorySnapshot[] {
  const current = new Map<string, string>();
  const snapshots: HistorySnapshot[] = [];

  for (const commit of payload.commits) {
    if (commit.mode === "full") {
      current.clear();
    }

    for (const file of commit.files) {
      current.set(file.path, file.content);
    }
    for (const path of commit.deleted) {
      current.delete(path);
    }

    snapshots.push({
      message: commit.message,
      authorName: commit.authorName,
      authorEmail: commit.authorEmail,
      when: commit.when,
      files: [...current.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([path, content]) => ({ path, content, blob_sha: "" })),
    });
  }

  return snapshots;
}

export interface ImportResult {
  project: Project | null;
  imported: number;
  skipped: number;
  truncated: boolean;
  error: string | null;
}

/**
 * Importe un dépôt GitHub comme projet DevNet.
 *
 * Le projet est créé **d'abord** : si la lecture de l'histoire échoue
 * ensuite, il reste un projet vide plutôt qu'un rattachement fantôme.
 * C'est réparable par l'utilisateur ; un import à moitié écrit ne le
 * serait pas.
 */
export async function importGithubRepo(options: {
  owner: string;
  repo: string;
  branch?: string;
  /** L'utilisateur DevNet qui reçoit le projet et signe les commits. */
  owner_: UserLiteForRepo;
  language?: string;
}): Promise<ImportResult> {
  const { payload, error } = await fetchImportPayload(options.owner, options.repo, options.branch);
  if (error || !payload) {
    return { project: null, imported: 0, skipped: 0, truncated: false, error: error ?? "api" };
  }

  // Un dépôt déjà importé rouvre son projet : les commits ont le même sha,
  // en créer un second les ferait entrer en collision.
  const existing = await findImportedProject(options.owner, options.repo, options.owner_.id);
  if (existing) {
    const history = await importRepoHistory({
      projectId: existing.id,
      authorId: options.owner_.id,
      branch: payload.branch,
      snapshots: buildSnapshots(payload),
    });
    return {
      project: existing,
      imported: history.imported,
      skipped: history.skipped,
      truncated: payload.truncated,
      error: history.error,
    };
  }

  const created = await createProject({
    name: options.repo,
    description: `Importé de GitHub : ${payload.owner}/${payload.repo}`,
    language: options.language ?? "",
    emoji: "code",
    owner: options.owner_,
  });
  if (created.error || !created.project) {
    return {
      project: null,
      imported: 0,
      skipped: 0,
      truncated: payload.truncated,
      error: created.error ?? "Création du projet impossible.",
    };
  }

  // On raccorde d'emblée le projet à son dépôt : c'est ce qui permet de
  // reconnaître l'import au prochain clic, et de pousser plus tard.
  await api.from("project_links").insert({
    project_id: created.project.id,
    user_id: options.owner_.id,
    owner: options.owner,
    repo: options.repo,
    default_branch: payload.branch,
    sync_mode: "manuel",
  });

  const snapshots = buildSnapshots(payload);
  const history = await importRepoHistory({
    projectId: created.project.id,
    authorId: options.owner_.id,
    branch: payload.branch,
    snapshots,
  });

  return {
    project: created.project,
    imported: history.imported,
    skipped: history.skipped,
    truncated: payload.truncated,
    error: history.error,
  };
}
