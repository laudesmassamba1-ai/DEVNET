"use client";

import { useCallback, useEffect, useState } from "react";

import { Avatar, EmptyState, Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Motion } from "@/components/Motion";
import { Sheet } from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { useSession } from "@/hooks/useSession";
import {
  addIssueComment,
  createIssue,
  deleteIssue,
  fetchIssueComments,
  fetchIssues,
  setIssueStatus,
  type Issue,
  type IssueComment,
} from "@/lib/issues";
import { timeAgo } from "@/lib/utils";

/**
 * Les issues d'un dépôt.
 *
 * ## Pourquoi une discussion et pas un statut
 *
 * Une issue qui ne porte que « ouvert / fermé » ne sert à rien dans un
 * projet de groupe : le cas ordinaire est « on en a parlé, et il
 * manquait une information ». Le fil de commentaires est donc le cœur de
 * l'écran, et le statut n'est qu'une conclusion qu'on y porte.
 *
 * On écrit sur une issue **fermée** sans réserve : la question « et
 *ensuite ? » se pose trois mois plus tard, et sa réponse doit rester sous
 * la question.
 *
 * ## Une issue ouverte, pas une modale
 *
 * La discussion se déplie **sous** l'issue, dans la liste. Une modale par
 * issue ferait perdre la position dans la liste, et le contexte — ce qui
 * a été dit juste au-dessus — qui est précisément ce qui aide à répondre.
 */
export function IssuePanel({ projectId }: { projectId: string }) {
  const { profile } = useSession();
  const toast = useToast();

  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [reply, setReply] = useState("");
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setIssues(await fetchIssues(projectId));
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await fetchIssues(projectId);
      if (alive) setIssues(rows);
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  /**
   * Les commentaires ne sont chargés qu'à l'ouverture d'une issue.
   *
   * Un écran de dépôt affiche rarement toutes les discussions : en lire
   * dix pour en montrer une est un coût que personne ne remarque et que
   * tout le monde paie.
   */
  async function toggle(issue: Issue) {
    if (open === issue.id) return setOpen(null);

    setOpen(issue.id);
    setReply("");
    setComments(await fetchIssueComments(issue.id));
  }

  async function submit() {
    if (!profile || title.trim().length < 3) return;

    setBusy(true);
    const { issue, error } = await createIssue({
      projectId,
      authorId: profile.id,
      title,
      body,
    });
    setBusy(false);

    if (error) return toast(error, "err");

    setComposing(false);
    setTitle("");
    setBody("");
    await load();
    // La nouvelle issue s'ouvre : on vient d'écrire le problème, on veut
    // voir ce qu'on obtient. La laisser fermée, ce serait demander à
    // quelqu'un d'aller la retrouver dans une liste.
    if (issue) {
      setOpen(issue.id);
      setComments([]);
      toast(`Issue #${issue.number} ouverte`);
    }
  }

  async function answer(issue: Issue) {
    if (!profile || !reply.trim()) return;

    setBusy(true);
    const { error } = await addIssueComment({
      issueId: issue.id,
      authorId: profile.id,
      body: reply,
    });
    setBusy(false);

    if (error) return toast(error, "err");

    setReply("");
    setComments(await fetchIssueComments(issue.id));
  }

  async function toggleStatus(issue: Issue) {
    const next = issue.status === "open" ? "closed" : "open";

    setBusy(true);
    const { error } = await setIssueStatus(issue.id, next);
    setBusy(false);

    if (error) return toast(error, "err");

    await load();
    setComments(await fetchIssueComments(issue.id));
    toast(next === "closed" ? `Issue #${issue.number} fermée` : `Issue #${issue.number} rouverte`);
  }

  async function remove(issue: Issue) {
    setBusy(true);
    const { error } = await deleteIssue(issue.id);
    setBusy(false);

    if (error) return toast(error, "err");

    setOpen(null);
    await load();
    toast(`Issue #${issue.number} supprimée`);
  }

  if (issues === null) return <Loading label="Lecture des issues" />;

  return (
    <div className="mt-4">
      {/* ── En-tête ──
          Le compteur est ici et pas dans l'onglet : l'onglet donne la
          **où**, cet en-tête donne le **quoi**. Un onglet « Issues » sans
          nombre fait croire à un écran vide. */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="prompt-label text-chalk-3">
          {issues.length === 0
            ? "issues"
            : `${issues.filter((i) => i.status === "open").length} ouverte${
                issues.filter((i) => i.status === "open").length > 1 ? "s" : ""
              } sur ${issues.length}`}
        </p>

        <button
          type="button"
          onClick={() => setComposing(true)}
          className="mo-press inline-flex h-[32px] shrink-0 items-center gap-1.5
            rounded-[var(--radius-chip)] border border-signal px-2.5
            font-mono text-[11px] font-bold uppercase tracking-[0.12em]
            text-signal transition-[background-color,color]
            duration-[var(--d-fast)] hover:bg-signal hover:text-void"
        >
          <Icon name="plus" size={11} strokeWidth={2} />
          issue
        </button>
      </div>

      {issues.length === 0 && (
        <EmptyState
          icon={<Icon name="flag" size={20} strokeWidth={1.5} />}
          title="Aucune issue"
          action={
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="mo-press inline-flex h-[var(--h-tap)] items-center gap-2
                rounded-[var(--radius-input)] border border-signal bg-signal
                px-4 text-[13px] font-bold text-void shadow-sh-2"
            >
              <Icon name="plus" size={14} strokeWidth={2} />
              Ouvrir une issue
            </button>
          }
        />
      )}

      <ul className="space-y-1.5">
        {issues.map((issue, index) => {
          const expanded = open === issue.id;
          const mine = issue.author_id === profile?.id;

          return (
            <Motion key={issue.id} role="rise" delay={Math.min(index * 40, 320)} as="li">
              <div
                className={`border bg-surface transition-colors duration-[var(--d-fast)]
                  ${expanded ? "border-signal" : "border-line-2 hover:border-line-3"}`}
              >
                <button
                  type="button"
                  onClick={() => void toggle(issue)}
                  aria-expanded={expanded}
                  className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
                >
                  {/* Le numéro est l'identité de l'issue. Il est
                      énoncé par l'icône pour les lecteurs d'écran :
                      « #3 » seul ne dit pas ce qu'il représente. */}
                  <span
                    aria-label={`Issue numéro ${issue.number}`}
                    className={`tnum mt-0.5 shrink-0 font-mono text-[11.5px]
                      ${issue.status === "open" ? "text-signal" : "text-chalk-4"}`}
                  >
                    #{issue.number}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-[13px] leading-snug
                        ${issue.status === "open" ? "text-chalk" : "text-chalk-3 line-through decoration-chalk-4/50"}`}
                    >
                      {issue.title}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10.5px] text-chalk-4">
                      <span>@{issue.author?.pseudo ?? "inconnu"}</span>
                      <span>·</span>
                      <span>{timeAgo(issue.created_at)}</span>
                      {issue.status === "closed" && (
                        <>
                          <span>·</span>
                          <span className="text-ok">fermée</span>
                        </>
                      )}
                    </span>
                  </span>

                  <Icon
                    name={expanded ? "chevron-down" : "chevron-right"}
                    size={12}
                    className="mt-1 shrink-0 text-chalk-4"
                  />
                </button>

                {expanded && (
                  <div className="border-t border-line-2 px-3 py-3">
                    {issue.body && (
                      <p className="mb-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-chalk-2">
                        {issue.body}
                      </p>
                    )}

                    {/* ── Discussion ── */}
                    {comments.length === 0 && (
                      <p className="mb-3 font-mono text-[11px] text-chalk-4">
                        aucune réponse.
                      </p>
                    )}

                    <ul className="mb-3 space-y-2.5">
                      {comments.map((c) => (
                        <li key={c.id} className="flex items-start gap-2">
                          <Avatar
                            name={c.author?.prenom ?? "?"}
                            color={c.author?.avatar_color}
                            size="sm"
                            className="mt-0.5 !text-[9px]"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-[10.5px] text-chalk-4">
                              @{c.author?.pseudo ?? "inconnu"} · {timeAgo(c.created_at)}
                            </p>
                            <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-chalk-2">
                              {c.body}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>

                    <div className="mb-3 flex gap-2">
                      <input
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void answer(issue);
                        }}
                        placeholder="répondre…"
                        aria-label={`Répondre à l'issue ${issue.number}`}
                        className="h-[var(--h-input)] min-w-0 flex-1
                          rounded-[var(--radius-input)] border border-line-3
                          bg-surface-2 px-3 font-mono text-[12.5px] outline-none
                          transition-[border-color] duration-[var(--d-fast)]
                          placeholder:text-chalk-4 focus:border-signal"
                      />
                      <button
                        type="button"
                        onClick={() => void answer(issue)}
                        disabled={busy || !reply.trim()}
                        aria-label="Envoyer la réponse"
                        className="mo-press h-[var(--h-input)] shrink-0 rounded-[var(--radius-input)]
                          border border-line-3 px-3 font-mono text-[11px] font-bold
                          uppercase tracking-[0.12em] text-chalk-3
                          transition-[border-color,color] duration-[var(--d-fast)]
                          hover:border-signal hover:text-signal disabled:opacity-40"
                      >
                        <Icon name="check" size={12} strokeWidth={2} />
                      </button>
                    </div>

                    {/* ── Décisions ──
                        Fermer et supprimer ne sont pas le même geste et
                        ne s'affichent pas côte à côte : fermer se
                        refait, supprimer non. */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void toggleStatus(issue)}
                        disabled={busy}
                        className="mo-press inline-flex h-[30px] items-center gap-1.5
                          rounded-[var(--radius-chip)] border border-line-3 px-2.5
                          font-mono text-[11px] font-bold uppercase tracking-[0.12em]
                          text-chalk-3 transition-[border-color,color]
                          duration-[var(--d-fast)] hover:border-signal hover:text-signal
                          disabled:opacity-40"
                      >
                        {/* `✓✓` ferme, `✓` rouvre : fermer est le geste
                            le plus fort, rouvrir revient en arrière. Il
                            n'y a pas d'icône « annul » dans le jeu —
                            en ajouter une pour ce seul écran serait
                            une exception de plus dans le système. */}
                        <Icon
                          name={issue.status === "open" ? "check-double" : "check"}
                          size={11}
                          strokeWidth={2}
                        />
                        {issue.status === "open" ? "fermer" : "rouvrir"}
                      </button>

                      {mine && (
                        <button
                          type="button"
                          onClick={() => void remove(issue)}
                          disabled={busy}
                          className="mo-press inline-flex h-[30px] items-center gap-1.5
                            rounded-[var(--radius-chip)] border border-line-3 px-2.5
                            font-mono text-[11px] font-bold uppercase tracking-[0.12em]
                            text-chalk-4 transition-[border-color,color]
                            duration-[var(--d-fast)] hover:border-danger hover:text-danger
                            disabled:opacity-40"
                        >
                          <Icon name="trash" size={11} strokeWidth={1.8} />
                          retirer
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Motion>
          );
        })}
      </ul>

      {/* ── Nouvelle issue ──
          Titre puis description, dans cet ordre : le titre est ce qu'on
          sait toujours dire, la description est ce qu'on ne sait
          souvent pas encore. L'inverse ferait passer une description
          creuse devant un titre inventé. */}
      <Sheet
        open={composing}
        onClose={() => setComposing(false)}
        title="Nouvelle issue"
      >
        <label htmlFor="issue-title" className="prompt-label mb-1.5 block text-chalk-2">
          ce qui ne va pas
        </label>
        <input
          id="issue-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Le registre écrase les livraisons de la veille"
          autoFocus
          className="mb-4 h-[var(--h-input)] w-full rounded-[var(--radius-input)]
            border border-line-3 bg-surface px-3.5 text-[13px] shadow-sh-1
            outline-none transition-[transform,box-shadow] placeholder:text-chalk-4
            focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_var(--color-signal)]"
        />

        <label htmlFor="issue-body" className="prompt-label mb-1.5 block text-chalk-2">
          ce qu&apos;on a vu <span className="text-chalk-4">(facultatif)</span>
        </label>
        <textarea
          id="issue-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Comment on l'a vu, ce qu'on attend."
          className="mb-5 w-full resize-y rounded-[var(--radius-input)] border
            border-line-3 bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed
            shadow-sh-1 outline-none transition-[transform,box-shadow]
            placeholder:text-chalk-4 focus:-translate-x-px focus:-translate-y-px
            focus:shadow-[3px_3px_0_var(--color-signal)]"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setComposing(false)}
            className="mo-press h-[var(--h-tap)] flex-1 rounded-[var(--radius-input)]
              border border-transparent text-[13px] font-bold text-chalk-2
              hover:bg-surface-2 hover:text-chalk"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || title.trim().length < 3}
            title={
              title.trim().length > 0 && title.trim().length < 3
                ? "3 caractères minimum."
                : undefined
            }
            className="mo-press flex h-[var(--h-tap)] flex-1 items-center justify-center gap-2
              rounded-[var(--radius-input)] border border-signal bg-signal
              text-[13px] font-bold text-void shadow-sh-2 disabled:opacity-40"
          >
            <Icon name="flag" size={12} strokeWidth={2} />
            Ouvrir
          </button>
        </div>
      </Sheet>
    </div>
  );
}