"use client";

import { useCallback, useEffect, useState } from "react";

import { Avatar, EmptyState, Loading } from "@/components/Avatar";
import { Icon, asIconName } from "@/components/Icon";
import { useToast } from "@/components/Toast";
import {
  addProjectMember,
  deleteProject,
  findUserByPseudo,
  removeProjectMember,
  setProjectMemberRole,
  updateProject,
} from "@/lib/repo";
import { loadProjectMembers, type ProjectMemberView } from "@/lib/reputation";
import { PROJECT_STAGES, SEEKING_ROLES, stageSpec, type SeekingRole } from "@/lib/match";
import {
  LANGAGES,
  type Project,
  type ProjectRole,
  type ProjectVisibility,
  type UserLite,
} from "@/lib/types";

/**
 * Les réglages d'un projet : son identité, son équipe, et sa fin.
 *
 * ## Pourquoi un panneau et pas un menu « … »
 *
 * Un dépôt se règle rarement, mais quand on le règle on le fait en
 * plusieurs gestes : renommer, rendre public, nommer un mainteneur,
 * retirer quelqu'un. Éparpiller ces gestes dans un menu les rendrait
 * invisibles et, surtout, impossibles à relire ensemble — on veut voir
 * l'état de l'équipe **pendant** qu'on change un rôle.
 *
 * ## Qui voit quoi
 *
 * `canAdmin` est calculé par l'écran du dépôt (owner | maintainer). Le
 * créateur du projet est traité à part : lui seul supprime le dépôt, et
 * sa ligne n'est pas modifiable — un projet sans propriétaire n'aurait
 * personne pour le rouvrir. La base tranche de toute façon (027) ; ici
 * on ne montre que ce qui a une chance d'aboutir.
 */

interface Props {
  project: Project;
  me: UserLite | null;
  canAdmin: boolean;
  /** Le projet a changé (réglages) : l'écran du dépôt doit se relire. */
  onChanged: (project: Project) => void;
  /** Le projet vient d'être supprimé : on ne le réaffiche pas. */
  onDeleted: () => void;
}

/** Étiquettes des rôles — du plus large au plus restreint. */
const ROLE_LABELS: Record<ProjectRole, string> = {
  owner: "Propriétaire",
  maintainer: "Mainteneur",
  editor: "Éditeur",
  viewer: "Lecteur",
};

const ROLE_HINTS: Record<ProjectRole, string> = {
  owner: "Le projet est à lui : il le supprime, il nomme les autres.",
  maintainer: "Admet, règle les rôles, fusionne. Ne supprime pas le projet.",
  editor: "Écrit du code et commite. N'administre pas l'équipe.",
  viewer: "Peut lire, ne peut pas écrire.",
};

const VISIBILITY_LABELS: Record<ProjectVisibility, string> = {
  public: "Public",
  group: "Groupe",
  private: "Privé",
};

/** Palette courte d'icônes de projet — uniquement des icônes existantes. */
const EMOJI_CHOICES = [
  "package", "code", "terminal", "bolt", "layers", "grid", "server",
  "droplet", "flame", "heart", "chart", "globe", "target", "star", "fork", "file",
] as const;

const inputCls =
  "h-(--h-input) w-full rounded-(--radius-input) border border-line-3 " +
  "bg-surface px-3.5 text-14 shadow-sh-1 placeholder:text-chalk-4";
const labelCls = "label mb-1.5 block text-chalk";

export function ProjectSettingsPanel({ project, me, canAdmin, onChanged, onDeleted }: Props) {
  const toast = useToast();
  const isCreator = me !== null && me.id === project.created_by;

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [emoji, setEmoji] = useState(project.emoji);
  const [language, setLanguage] = useState(project.language);
  const [visibility, setVisibility] = useState<ProjectVisibility>(project.visibility);
  const [stage, setStage] = useState(project.stage);
  const [seeking, setSeeking] = useState(project.seeking);
  const [demandLanguages, setDemandLanguages] = useState<string[]>(project.demand_languages ?? []);
  const [demandRoles, setDemandRoles] = useState<SeekingRole[]>(
    (project.demand_roles ?? []) as SeekingRole[],
  );
  const [saving, setSaving] = useState(false);

  const [members, setMembers] = useState<ProjectMemberView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [invite, setInvite] = useState("");
  const [inviting, setInviting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const reloadMembers = useCallback(async () => {
    setMembers(await loadProjectMembers(project.id));
  }, [project.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await loadProjectMembers(project.id);
      if (alive) setMembers(rows);
    })();
    return () => {
      alive = false;
    };
  }, [project.id]);

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  }

  async function saveSettings() {
    if (!canAdmin) return;
    const cleanName = name.trim();
    if (!cleanName) return toast("Le projet a besoin d'un nom", "err");

    setSaving(true);
    const { project: updated, error } = await updateProject(project.id, {
      name: cleanName,
      description: description.trim(),
      emoji,
      language: language.trim(),
      visibility,
      stage,
      seeking,
      demand_languages: demandLanguages,
      demand_roles: demandRoles,
    });
    setSaving(false);

    if (error || !updated) return toast(error ?? "Mise à jour impossible", "err");
    onChanged(updated);
    toast("Réglages enregistrés");
  }

  async function changeRole(member: ProjectMemberView, role: ProjectRole) {
    setBusy(member.user_id);
    const { error } = await setProjectMemberRole(project.id, member.user_id, role);
    setBusy(null);
    if (error) return toast("Changement refusé", "err");
    await reloadMembers();
  }

  async function removeMember(member: ProjectMemberView) {
    setBusy(member.user_id);
    const { error } = await removeProjectMember(project.id, member.user_id);
    setBusy(null);
    if (error) return toast("Retrait refusé", "err");
    await reloadMembers();
    toast(member.user_id === me?.id ? "Tu as quitté le projet" : "Membre retiré");
  }

  async function addByPseudo() {
    const pseudo = invite.trim().replace(/^@/, "");
    if (!pseudo) return;

    setInviting(true);
    const { user, error } = await findUserByPseudo(pseudo);
    if (error) {
      setInviting(false);
      return toast("Recherche impossible", "err");
    }
    if (!user) {
      setInviting(false);
      return toast(`Aucun compte : « ${pseudo} »`, "err");
    }
    if (members?.some((m) => m.user_id === user.id)) {
      setInviting(false);
      return toast(`${user.prenom} est déjà dans l'équipe`, "err");
    }

    const added = await addProjectMember(project.id, user.id, "editor");
    setInviting(false);
    if (added.error) return toast("Ajout refusé", "err");
    setInvite("");
    await reloadMembers();
    toast(`${user.prenom} rejoint le projet`);
  }

  async function confirmDeleteProject() {
    setDeleting(true);
    const { error } = await deleteProject(project.id);
    setDeleting(false);
    if (error) return toast("Suppression refusée", "err");
    toast("Projet supprimé");
    onDeleted();
  }

  return (
    <div className="pb-8">
      {/* ── Identité du projet ── */}
      <section className="mb-5 border border-line-2 bg-surface p-4">
        <h2 className="mb-3 flex items-center gap-2 font-display text-[1.05rem] font-bold text-chalk">
          <Icon name="edit" size={14} className="text-signal" />
          Identité
        </h2>

        <div className="mb-4">
          <label className={labelCls}>Icône</label>
          <div className="flex flex-wrap gap-2">
            {EMOJI_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setEmoji(choice)}
                aria-label={`Icône ${choice}`}
                aria-pressed={emoji === choice}
                className={`mo-press grid size-10 place-items-center rounded-(--radius-input)
                  border transition-colors ${
                    emoji === choice
                      ? "border-signal bg-signal/10 text-signal"
                      : "border-line-3 text-chalk-3 hover:border-chalk-3 hover:text-chalk"
                  }`}
              >
                <Icon name={choice} size={16} />
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className={labelCls}>Nom</label>
          <input value={name} aria-label="Nom du projet" onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>

        <div className="mb-4">
          <label className={labelCls}>Description</label>
          <textarea
            aria-label="Description du projet"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="En une phrase, ce que fait le projet."
            className="w-full rounded-(--radius-input) border border-line-3 bg-surface
              px-3.5 py-3 text-14 shadow-sh-1 placeholder:text-chalk-4"
          />
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Langage principal</label>
            <input
              aria-label="Langage principal"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="Python"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Visibilité</label>
            <select
              aria-label="Visibilité du projet"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as ProjectVisibility)}
              className={`${inputCls} cursor-pointer`}
            >
              {(Object.keys(VISIBILITY_LABELS) as ProjectVisibility[]).map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABELS[v]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className={labelCls}>Étape</label>
          <div className="flex flex-wrap gap-2">
            {PROJECT_STAGES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStage(s.id)}
                aria-pressed={stage === s.id}
                title={s.hint}
                className={`mo-press rounded-(--radius-chip) border px-3 py-1.5 text-sm
                  font-bold transition-colors ${
                    stage === s.id
                      ? "border-signal bg-signal/10 text-signal"
                      : "border-line-3 text-chalk-3 hover:border-chalk-3 hover:text-chalk"
                  }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-12 text-chalk-4">{stageSpec(stage).hint}</p>
        </div>

        {/* ── Recherche de coéquipiers ── */}
        <div className="mb-4 border-t border-line-2 pt-4">
          <label className="flex cursor-pointer items-center gap-2.5">
            <button
              type="button"
              role="switch"
              aria-checked={seeking}
              onClick={() => setSeeking((v) => !v)}
              className={`mo-press relative h-[26px] w-[46px] shrink-0 rounded-(--radius-chip)
                border transition-colors ${
                  seeking ? "border-signal bg-signal/30" : "border-line-3 bg-surface-2"
                }`}
            >
              <span
                className={`absolute top-0.5 size-[20px] rounded-full bg-chalk transition-all
                  ${seeking ? "left-[22px]" : "left-0.5"}`}
              />
            </button>
            <span className="text-13 text-chalk">
              Ce projet cherche des coéquipiers
            </span>
          </label>

          {seeking && (
            <div className="mo-slide mt-4">
              <label className={labelCls}>Langages recherchés</label>
              <div className="mb-4 flex flex-wrap gap-2">
                {LANGAGES.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setDemandLanguages((cur) => toggle(cur, l))}
                    aria-pressed={demandLanguages.includes(l)}
                    className={`mo-press rounded-(--radius-chip) border px-2.5 py-1
                      font-mono text-12 transition-colors ${
                        demandLanguages.includes(l)
                          ? "border-signal text-signal"
                          : "border-line-3 text-chalk-3 hover:text-chalk"
                      }`}
                  >
                    {l}
                  </button>
                ))}
              </div>

              <label className={labelCls}>Rôles recherchés</label>
              <div className="flex flex-wrap gap-2">
                {SEEKING_ROLES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setDemandRoles((cur) => toggle(cur, r.id))}
                    aria-pressed={demandRoles.includes(r.id)}
                    title={r.hint}
                    className={`mo-press inline-flex items-center gap-1.5 rounded-(--radius-chip)
                      border px-2.5 py-1.5 text-12 transition-colors ${
                        demandRoles.includes(r.id)
                          ? "border-signal text-signal"
                          : "border-line-3 text-chalk-3 hover:text-chalk"
                      }`}
                  >
                    <Icon name={asIconName(r.icon, "code")} size={12} />
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => void saveSettings()}
          disabled={saving || !canAdmin}
          className="mo-press inline-flex h-(--h-tap) items-center justify-center gap-2
            rounded-(--radius-input) border border-line-3 bg-signal px-4 text-sm
            font-bold text-void shadow-sh-1 hover:shadow-sh-2 disabled:opacity-40"
        >
          <Icon name="check" size={14} strokeWidth={2.2} />
          {saving ? "Enregistrement…" : "Enregistrer les réglages"}
        </button>
      </section>

      {/* ── Équipe ── */}
      <section className="mb-5 border border-line-2 bg-surface p-4">
        <h2 className="mb-3 flex items-center gap-2 font-display text-[1.05rem] font-bold text-chalk">
          <Icon name="groups" size={14} className="text-signal" />
          Équipe
        </h2>

        {members === null ? (
          <Loading label="Chargement de l'équipe" />
        ) : members.length === 0 ? (
          <EmptyState title="Aucun membre" hint="Personne n&apos;est encore rattaché à ce projet." />
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((m) => {
              const isOwnerRow = m.user_id === project.created_by;
              const isMe = m.user_id === me?.id;
              const locked = isOwnerRow || isMe;
              return (
                <li
                  key={m.user_id}
                  className="flex flex-wrap items-center gap-2.5 border border-line-2 bg-page px-3 py-2"
                >
                  <Avatar name={m.prenom} color={m.avatar_color} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-13 font-bold text-chalk">
                      {m.prenom} {isMe && <span className="text-chalk-4">(toi)</span>}
                    </p>
                    <p className="truncate font-mono text-12 text-chalk-4">@{m.pseudo}</p>
                  </div>

                  {canAdmin && !locked ? (
                    <select
                      value={m.role}
                      disabled={busy === m.user_id}
                      onChange={(e) => void changeRole(m, e.target.value as ProjectRole)}
                      aria-label={`Rôle de ${m.prenom}`}
                      title={ROLE_HINTS[m.role as ProjectRole] ?? ""}
                      className="h-[34px] cursor-pointer rounded-(--radius-input)
                        border border-line-3 bg-surface px-2 text-sm text-chalk-2"
                    >
                      {(["maintainer", "editor", "viewer"] as ProjectRole[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      title={ROLE_HINTS[m.role as ProjectRole] ?? ""}
                      className="label-micro border border-line-2 px-1.5 py-0.5 font-mono text-chalk-3"
                    >
                      {ROLE_LABELS[m.role as ProjectRole] ?? m.role}
                    </span>
                  )}

                  {canAdmin && !isOwnerRow && !isMe && (
                    <button
                      type="button"
                      onClick={() => void removeMember(m)}
                      disabled={busy === m.user_id}
                      aria-label={`Retirer ${m.prenom}`}
                      className="mo-press grid size-[34px] place-items-center rounded-(--radius-chip)
                        text-chalk-4 transition-colors hover:text-danger disabled:opacity-40"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  )}

                  {isMe && !isCreator && (
                    <button
                      type="button"
                      onClick={() => void removeMember(m)}
                      disabled={busy === m.user_id}
                      className="mo-press rounded-(--radius-chip) border border-line-3 px-2.5 py-1
                        font-mono text-12 font-bold uppercase tracking-[0.12em]
                        text-chalk-3 transition-colors hover:text-danger disabled:opacity-40"
                    >
                      quitter
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {canAdmin && (
          <div className="mt-3 border-t border-line-2 pt-3">
            <label className={labelCls}>Inviter par pseudo</label>
            <div className="flex gap-2">
              <input
                aria-label="Inviter un membre par pseudo"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addByPseudo();
                }}
                placeholder="ex. koffi"
                className={`${inputCls} flex-1`}
              />
              <button
                type="button"
                onClick={() => void addByPseudo()}
                disabled={inviting || !invite.trim()}
                className="mo-press inline-flex h-(--h-input) shrink-0 items-center gap-1.5
                  rounded-(--radius-input) border border-line-3 bg-page px-3.5 text-sm
                  font-bold text-chalk transition-colors hover:border-chalk-3 disabled:opacity-40"
              >
                <Icon name="follow" size={14} />
                {inviting ? "…" : "Ajouter"}
              </button>
            </div>
            <p className="mt-1.5 text-12 text-chalk-4">
              Le membre rejoint en tant qu&apos;éditeur ; tu règles son rôle ensuite.
            </p>
          </div>
        )}
      </section>

      {/* ── Zone dangereuse : réservée au créateur ── */}
      {isCreator && (
        <section className="border border-danger/50 bg-surface p-4">
          <h2 className="mb-1.5 flex items-center gap-2 font-display text-[1.05rem] font-bold text-danger">
            <Icon name="flag" size={14} />
            Supprimer le projet
          </h2>
          <p className="mb-3 text-sm leading-relaxed text-chalk-3">
            Le dépôt, ses commits, ses issues et ses tâches disparaissent. C&apos;est
            définitif : il n&apos;y a pas de corbeille.
          </p>

          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-sm font-bold text-chalk">
                Confirmer la suppression de « {project.name} » ?
              </span>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-(--radius-input) border border-line-3 px-3 py-1.5
                  text-12 font-bold text-chalk-2 hover:text-chalk"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteProject()}
                disabled={deleting}
                className="mo-press rounded-(--radius-input) border border-danger bg-danger px-3 py-1.5
                  text-12 font-bold text-void disabled:opacity-40"
              >
                {deleting ? "Suppression…" : "Supprimer définitivement"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="mo-press inline-flex h-(--h-tap) items-center gap-2 rounded-(--radius-input)
                border border-danger px-3.5 text-sm font-bold text-danger transition-colors
                hover:bg-danger hover:text-void"
            >
              <Icon name="trash" size={14} />
              Supprimer ce projet
            </button>
          )}
        </section>
      )}

      {!canAdmin && (
        <p className="text-12 text-chalk-4">
          Seuls le propriétaire et les mainteneurs peuvent modifier ces réglages.
        </p>
      )}
    </div>
  );
}
