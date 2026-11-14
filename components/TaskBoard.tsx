"use client";

import { useCallback, useEffect, useState } from "react";

import { Icon } from "./Icon";
import { Loading } from "./Avatar";
import { Motion } from "./Motion";
import { useToast } from "./Toast";
import {
  assignTask,
  createTask,
  deleteTask,
  loadProjectMembers,
  loadTasks,
  moveTask,
  type ProjectMemberView,
} from "@/lib/reputation";
import { timeAgo } from "@/lib/utils";
import type { ProjectTask } from "@/lib/types";

/**
 * Tableau des tâches de l'équipe, en trois colonnes (§7).
 *
 * C'est la pièce qui donne un **sens** aux candidatures : on postule à un
 * projet pour que le travail ait un endroit où avancer. Sans ce tableau,
 * DevNet s'arrête à la rencontre, et l'équipe repart travailler ailleurs.
 *
 * ## Trois colonnes, un seul axe
 *
 * « À faire / en cours / fait » est le seul découpage qui se lise sans
 * explication : c'est un état, pas une priorité ni une étiquette. On
 * déplace une carte en la faisant glisser — mais chaque carte porte aussi
 * deux flèches, parce qu'un glisser-déposer est inutilisable au clavier
 * et fragile sur un téléphone. Le geste est un raccourci, jamais le seul
 * chemin.
 *
 * ## Terminer une tâche, c'est poser une preuve
 *
 * Le passage à « fait » écrit `done_at`, et la base en fait une preuve
 * pour celui qui a terminé la tâche (déclencheur `tasks_record_proof`).
 * L'écran n'a donc rien à inventer : il déplace une carte, et le profil
 * de la personne gagne une ligne vérifiable.
 *
 * ## Toute la largeur
 *
 * Sur grand écran, les trois colonnes se partagent la largeur au lieu de
 * s'empiler dans une colonne étroite : un tableau de bord se lit d'un
 * coup d'œil, pas en défilant. En dessous de `lg`, il redevient une pile.
 */

const COLUMNS = [
  { id: "todo", label: "À faire" },
  { id: "doing", label: "En cours" },
  { id: "done", label: "Fait" },
] as const;

type ColumnId = (typeof COLUMNS)[number]["id"];

/** L'ordre des colonnes, pour déplacer une carte vers la gauche ou la droite. */
const ORDER: ColumnId[] = ["todo", "doing", "done"];

function memberLabel(m: ProjectMemberView): string {
  return m.prenom || m.pseudo || "Membre";
}

export function TaskBoard({
  projectId,
  meId,
  meName,
}: {
  projectId: string;
  meId: string | null;
  meName?: string;
}) {
  const toast = useToast();

  const [tasks, setTasks] = useState<ProjectTask[] | null>(null);
  const [members, setMembers] = useState<ProjectMemberView[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  /** La colonne survolée pendant un glisser — pour montrer où la carte tombe. */
  const [over, setOver] = useState<ColumnId | null>(null);

  const reload = useCallback(async () => {
    const [rows, people] = await Promise.all([
      loadTasks(projectId),
      loadProjectMembers(projectId),
    ]);
    setTasks(rows);
    setMembers(people);
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [rows, people] = await Promise.all([
        loadTasks(projectId),
        loadProjectMembers(projectId),
      ]);
      if (!alive) return;
      setTasks(rows);
      setMembers(people);
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function add() {
    const value = title.trim();
    if (!value || !meId) return;

    setBusy(true);
    const { error } = await createTask({
      projectId,
      title: value,
      createdBy: meId,
      status: "todo",
    });
    setBusy(false);
    if (error) return toast(error, "err");

    setTitle("");
    await reload();
  }

  /**
   * Déplace une carte, en optimiste.
   *
   * Le déplacement est immédiat à l'écran : une carte qui met 300 ms à
   * traverser un tableau fait douter du clic. Si la base refuse, on relit
   * la vérité — jamais une carte affichée dans une colonne où elle n'est
   * pas.
   */
  async function move(task: ProjectTask, status: ColumnId) {
    if (task.status === status) return;

    setTasks((prev) =>
      prev ? prev.map((t) => (t.id === task.id ? { ...t, status } : t)) : prev,
    );

    const { error } = await moveTask({ id: task.id, status });
    if (error) {
      toast(error, "err");
      await reload();
      return;
    }

    if (status === "done" && task.status !== "done") {
      toast("Tâche terminée · preuve ajoutée");
    }
    await reload();
  }

  function step(task: ProjectTask, dir: -1 | 1): ColumnId {
    const i = ORDER.indexOf(task.status);
    return ORDER[Math.min(ORDER.length - 1, Math.max(0, i + dir))];
  }

  async function assign(task: ProjectTask, userId: string | null) {
    setTasks((prev) =>
      prev ? prev.map((t) => (t.id === task.id ? { ...t, assignee: userId } : t)) : prev,
    );
    const { error } = await assignTask({ id: task.id, assignee: userId });
    if (error) {
      toast(error, "err");
      await reload();
    }
  }

  async function remove(task: ProjectTask) {
    setTasks((prev) => (prev ? prev.filter((t) => t.id !== task.id) : prev));
    const { error } = await deleteTask(task.id);
    if (error) {
      toast(error, "err");
      await reload();
    }
  }

  if (tasks === null) return <Loading label="Ouverture du tableau" />;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {COLUMNS.map((col) => {
        return (
          <Motion
            key={col.id}
            role="rise"
            as="section"
            className={`flex min-h-[220px] flex-col rounded-(--radius-card)
              border depth-card transition-colors duration-(--d-fast)
              ${over === col.id ? "border-signal" : "border-line-2"}`}
          >
            <header className="flex items-center justify-between border-b border-line-2 px-3 py-2">
              <h3 className="label flex items-center gap-2 text-chalk-3">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-signal"
                  style={{ opacity: col.id === "done" ? 0.4 : 1 }}
                />
                {col.label}
              </h3>
              <span className="tnum font-mono text-[11px] text-chalk-4">
                {tasks.filter((t) => t.status === col.id).length}
              </span>
            </header>

            <ul
              // La zone de dépôt couvre toute la colonne, pas seulement les
              // cartes : déposer dans le vide d'une colonne vide doit marcher.
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.id);
              }}
              onDragLeave={() => setOver((c) => (c === col.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/devnet-task");
                const task = tasks.find((t) => t.id === id);
                if (task) void move(task, col.id);
              }}
              className="flex min-h-[140px] flex-1 flex-col gap-2 p-2.5"
            >
              {tasks.filter((t) => t.status === col.id).length === 0 && (
                <li className="flex flex-1 items-center justify-center py-6 text-center">
                  <span className="font-mono text-[11px] text-chalk-4">
                    {col.id === "todo"
                      ? "ajoutez une tâche."
                      : "rien ici."}
                  </span>
                </li>
              )}

              {tasks
                .filter((t) => t.status === col.id)
                .map((task) => {
                  return (
                    <li
                      key={task.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/devnet-task", task.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      className="group cursor-grab rounded-(--radius-input) border
                        border-line-2 bg-surface p-2.5 transition-colors duration-(--d-fast)
                        hover:border-line-3 active:cursor-grabbing"
                    >
                      <div className="flex items-start gap-2">
                        <p className="flex-1 text-[13px] leading-snug text-chalk">
                          {task.title}
                        </p>
                        <button
                          type="button"
                          onClick={() => void remove(task)}
                          aria-label={`Supprimer la tâche ${task.title}`}
                          className="-mr-1 -mt-1 flex size-6 shrink-0 items-center justify-center
                            rounded-full text-chalk-4 opacity-0 transition-opacity
                            hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <Icon name="close" size={11} strokeWidth={2.2} />
                        </button>
                      </div>

              {task.body && (
                <p className="mt-1 text-12 leading-snug text-chalk-3">{task.body}</p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {task.language && (
                  <span className="inline-flex items-center gap-1 rounded-(--radius-chip)
                    border border-line-2 px-1.5 py-0.5 font-mono text-[10.5px] text-chalk-3">
                    <Icon name="code" size={11} strokeWidth={2} />
                    {task.language}
                  </span>
                )}

                <label className="inline-flex items-center gap-1.5 rounded-(--radius-chip)
                  border border-line-2 px-1.5 py-0.5 font-mono text-[10.5px] text-chalk-3">
                  <Icon name="profile" size={11} strokeWidth={2} />
                  <select
                    value={task.assignee ?? ""}
                    onChange={(e) => void assign(task, e.target.value || null)}
                    aria-label={`Assigner la tâche ${task.title}`}
                    className="max-w-[120px] cursor-pointer bg-transparent text-chalk-3 outline"
                  >
                    <option value="">personne</option>
                    {meId && (
                      <option value={meId}>{meName ? `moi (${meName})` : "moi"}</option>
                    )}
                    {members
                      .filter((m) => m.user_id !== meId)
                      .map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {memberLabel(m)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              <div className="mt-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void move(task, step(task, -1))}
                  disabled={task.status === "todo"}
                  aria-label="Reculer d'une colonne"
                  className="flex size-7 items-center justify-center rounded-full border
                    border-line-2 text-chalk-3 transition-colors
                    hover:border-signal hover:text-signal disabled:opacity-25
                    disabled:hover:border-line-2 disabled:hover:text-chalk-3"
                >
                  <Icon name="chevron-left" size={12} strokeWidth={2.2} />
                </button>

                <button
                  type="button"
                  onClick={() => void move(task, step(task, 1))}
                  disabled={task.status === "done"}
                  aria-label="Avancer d'une colonne"
                  className="flex size-7 items-center justify-center rounded-full border
                    border-line-2 text-chalk-3 transition-colors
                    hover:border-signal hover:text-signal disabled:opacity-25
                    disabled:hover:border-line-2 disabled:hover:text-chalk-3"
                >
                  <Icon name="chevron-right" size={12} strokeWidth={2.2} />
                </button>

                <span className="ml-auto font-mono text-[10.5px] text-chalk-4">
                  {task.status === "done" && task.done_at
                    ? `terminé ${timeAgo(task.done_at)}`
                    : timeAgo(task.created_at)}
                </span>
              </div>
                    </li>
                  );
                })}
            </ul>

            {col.id === "todo" && (
              <div className="border-t border-line-2 p-2.5">
                <label className="sr-only" htmlFor="new-task">
                  Nouvelle tâche
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="new-task"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void add();
                    }}
                    placeholder="Nouvelle tâche…"
                    className="h-(--h-input) min-w-0 flex-1 rounded-(--radius-input)
                      border border-line-2 bg-surface px-3 text-[13px] text-chalk
                      placeholder:text-chalk-4 focus:border-signal"
                  />
                  <button
                    type="button"
                    onClick={() => void add()}
                    disabled={busy || !title.trim()}
                    aria-label="Ajouter la tâche"
                    className="mo-press flex size-(--h-input) shrink-0 items-center
                      justify-center rounded-(--radius-input) border border-signal
                      bg-signal text-void disabled:opacity-40"
                  >
                    <Icon name="plus" size={14} strokeWidth={2.4} />
                  </button>
                </div>
              </div>
            )}
          </Motion>
        );
      })}
    </div>
  );
}
