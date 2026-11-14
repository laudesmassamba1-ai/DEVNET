"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState, Loading } from "@/components/Avatar";
import { CodeBlock } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { Motion } from "@/components/Motion";
import { useToast } from "@/components/Toast";
import { useSession } from "@/hooks/useSession";
import { parseDoc } from "@/lib/doc";
import {
  createProjectPage,
  deleteProjectPage,
  fetchProjectPages,
  updateProjectPage,
  type ProjectPage,
} from "@/lib/pages";
import { timeAgo } from "@/lib/utils";

/**
 * Le wiki d'un dépôt.
 *
 * ## Ce que l'écran promet
 *
 * C'est la partie « Notion » du produit : un **sommaire** à gauche, un
 * **document** à droite, et deux gestes seulement — écrire, enregistrer.
 * Rien de plus, et c'est volontaire : une page qui n'a qu'un geste de
 * lecture se lit, tandis qu'une page tout éditable se manipule au lieu
 * de se lire. On affiche donc le document rendu, et on n'entre en
 * édition qu'à la demande.
 *
 * ## Pourquoi l'édition est un mode
 *
 * Un `textarea` permanent afficherait du texte brut là où le corps est
 * écrit pour être **lu** (titres, listes, blocs de code). La bascule
 * lecture / écriture est le seul moyen d'avoir les deux sans choisir :
 * on lit rendu, on écrit brut, et l'état dit toujours lequel des deux on
 * regarde.
 *
 * ## Ce qui n'est pas fait
 *
 * Pas d'imbrication de pages, pas d'historique par page. Ce sont de
 * vraies fonctionnalités, mais qui n'ont de sens qu'une fois que les
 * pages existent et sont lues — un sommaire vide n'a pas besoin d'arbre.
 */

interface Props {
  projectId: string;
}

export function ProjectWikiPanel({ projectId }: Props) {
  const { profile } = useSession();
  const toast = useToast();

  const [pages, setPages] = useState<ProjectPage[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  /** Le document est-il en cours d'édition ? */
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    const rows = await fetchProjectPages(projectId);
    setPages(rows);
    // On garde la page ouverte si elle existe encore ; sinon on ouvre la
    // première. Un sommaire qui s'ouvre sur un document vide alors qu'il
    // contient des pages laisse croire que le wiki est vide.
    setOpenId((current) =>
      current && rows.some((p) => p.id === current) ? current : (rows[0]?.id ?? null),
    );
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await fetchProjectPages(projectId);
      if (!alive) return;
      setPages(rows);
      // On garde la page ouverte si elle existe encore ; sinon on ouvre la
      // première. Un sommaire qui s'ouvre sur un document vide alors qu'il
      // contient des pages laisse croire que le wiki est vide.
      setOpenId((current) =>
        current && rows.some((p) => p.id === current) ? current : (rows[0]?.id ?? null),
      );
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  const open = useMemo(
    () => pages?.find((p) => p.id === openId) ?? null,
    [pages, openId],
  );

  /** Passer en édition : on part du contenu enregistré, jamais d'une copie. */
  function startEdit() {
    if (!open) return;
    setDraftTitle(open.title);
    setDraftBody(open.body);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraftTitle("");
    setDraftBody("");
  }

  async function save() {
    if (!open) return;

    setBusy(true);
    const { error } = await updateProjectPage(open.id, {
      title: draftTitle,
      body: draftBody,
    });
    setBusy(false);

    if (error) return toast(error, "err");

    await load();
    setEditing(false);
    toast("Page enregistrée");
  }

  /** Crée une page « Sans titre », puis l'ouvre en écriture. */
  async function create() {
    if (!profile) return;

    setBusy(true);
    const { page, error } = await createProjectPage({
      projectId,
      authorId: profile.id,
      title: "Sans titre",
    });
    setBusy(false);

    if (error || !page) return toast(error ?? "Création impossible.", "err");

    await load();
    setOpenId(page.id);
    setDraftTitle(page.title);
    setDraftBody(page.body);
    setEditing(true);
  }

  async function remove() {
    if (!open) return;

    setBusy(true);
    const { error } = await deleteProjectPage(open.id);
    setBusy(false);

    if (error) return toast(error, "err");

    setConfirmDelete(false);
    setEditing(false);
    setOpenId(null);
    await load();
    toast("Page supprimée");
  }

  /* ── Chargement ─────────────────────────────────────────────── */

  if (pages === null) return <Loading label="Documentation" />;

  /* ── Aucune page ────────────────────────────────────────────── */

  if (pages.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="file" size={20} strokeWidth={1.5} />}
        title="Aucune page"
        action={
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy}
            className="mo-press inline-flex h-(--h-tap) items-center gap-2
              rounded-(--radius-input) border border-signal bg-signal
              px-4 text-13 font-bold text-void shadow-sh-2 disabled:opacity-40"
          >
            <Icon name="plus" size={14} strokeWidth={2} />
            Écrire la première page
          </button>
        }
      />
    );
  }

  /* ── Sommaire + document ────────────────────────────────────── */

  return (
    <div className="grid gap-3 lg:grid-cols-[210px_1fr]">
      {/* ── Sommaire ──
          Un sommaire, pas un fil : l'ordre est `position`, il ne bouge
          pas quand on écrit. Un wiki dont le sommaire se réordonne à
          chaque modification n'est plus consultable. */}
      <nav
        aria-label="Sommaire de la documentation"
        className="lg:border-r-2 lg:border-line-2 lg:pr-3"
      >
        <p className="label prompt-label mb-2 flex items-center justify-between text-chalk-3">
          sommaire
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy}
            aria-label="Nouvelle page"
            title="Nouvelle page"
            className="-mr-2 flex size-(--h-tap) items-center justify-center
              text-chalk-4 transition-colors hover:text-signal disabled:opacity-40"
          >
            <Icon name="plus" size={12} strokeWidth={2} />
          </button>
        </p>

        <ul className="space-y-0.5">
          {pages.map((page, i) => {
            const active = page.id === openId;
            return (
              <Motion key={page.id} role="rise" delay={Math.min(i * 35, 260)} as="li">
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(page.id);
                    setEditing(false);
                    setConfirmDelete(false);
                  }}
                  aria-current={active ? "page" : undefined}
                  className={`flex w-full items-center gap-2 border-l-2 px-2 py-1.5
                    text-left transition-colors duration-(--d-fast)
                    ${active
                      ? "border-signal bg-surface-2 text-chalk"
                      : "border-line-2 text-chalk-3 hover:border-chalk-4 hover:text-chalk"}`}
                >
                  <Icon
                    name="file"
                    size={11}
                    className={active ? "shrink-0 text-signal" : "shrink-0 text-chalk-4"}
                  />
                  <span className="truncate text-sm font-semibold">{page.title}</span>
                </button>
              </Motion>
            );
          })}
        </ul>
      </nav>

      {/* ── Document ── */}
      <div className="min-w-0">
        {open && editing ? (
          <Motion role="scale" key={`edit-${open.id}`}>
            <label className="mb-1 block font-mono text-12 text-chalk-3">titre</label>
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              aria-label="Titre de la page"
              placeholder="titre de la page"
              className="mb-3 h-(--h-input) w-full border border-line-2
                bg-surface-2 px-3 font-display text-15 font-bold text-chalk
                outline focus:border-signal"
            />

            <label className="mb-1 block font-mono text-12 text-chalk-3">
              contenu · # titre, - liste, &gt; citation, ``` code
            </label>
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              aria-label="Contenu de la page"
              rows={16}
              spellCheck={false}
              placeholder={"# Démarrage\n\nComment lancer le projet…"}
              className="mb-3 w-full resize-y border border-line-2 bg-surface-2 p-3
                font-mono text-sm leading-relaxed text-chalk outline
                focus:border-signal"
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy || draftTitle.trim().length === 0}
                className="mo-press inline-flex h-(--h-tap) items-center gap-2
                  border border-signal bg-signal px-4 text-13 font-bold
                  text-void disabled:opacity-40"
              >
                <Icon name="check" size={14} strokeWidth={2} />
                Enregistrer
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={busy}
                className="mo-press inline-flex h-(--h-tap) items-center
                  border border-line-2 px-4 text-13 text-chalk-3
                  hover:border-chalk-4 hover:text-chalk disabled:opacity-40"
              >
                Annuler
              </button>
            </div>
          </Motion>
        ) : open ? (
          <Motion role="fade" key={open.id}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-display text-[1.15rem] font-bold text-chalk">
                  {open.title}
                </h3>
                <p className="mt-0.5 font-mono text-12 text-chalk-4">
                  @{open.author?.pseudo ?? "inconnu"} · modifiée {timeAgo(open.updated_at)}
                </p>
              </div>

              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={startEdit}
                  aria-label="Modifier la page"
                  title="Modifier"
                  className="flex size-(--h-action) items-center justify-center
                    border border-line-2 text-chalk-3 transition-colors
                    hover:border-signal hover:text-signal"
                >
                  <Icon name="edit" size={14} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete((v) => !v)}
                  aria-label="Supprimer la page"
                  title="Supprimer"
                  className="flex size-(--h-action) items-center justify-center
                    border border-line-2 text-chalk-3 transition-colors
                    hover:border-danger hover:text-danger"
                >
                  <Icon name="trash" size={14} strokeWidth={2} />
                </button>
              </div>
            </div>

            {confirmDelete && (
              <Motion role="rise" className="mb-3 flex flex-wrap items-center gap-2
                border border-danger/60 bg-danger/10 px-3 py-2">
                <p className="flex-1 text-sm text-chalk-2">
                  Supprimer « {open.title} » ? C’est définitif.
                </p>
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy}
                  className="mo-press h-(--h-action) border border-danger
                    px-3 text-12 font-bold text-danger disabled:opacity-40"
                >
                  Supprimer
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="mo-press h-(--h-action) border border-line-2
                    px-3 text-12 text-chalk-3 hover:text-chalk"
                >
                  Annuler
                </button>
              </Motion>
            )}

            <Document body={open.body} />
          </Motion>
        ) : (
          <EmptyState title="Choisissez une page" />
        )}
      </div>
    </div>
  );
}

/**
 * Le rendu d'un corps de page.
 *
 * Le découpage vient de `lib/doc.ts` : cet écran ne sait pas ce qu'est un
 * titre, il sait seulement comment en dessiner un. La règle de lecture
 * vit dans un module pur, testable sans navigateur — c'est la même
 * séparation que la coloration syntaxique.
 */
function Document({ body }: { body: string }) {
  const blocks = useMemo(() => parseDoc(body), [body]);

  if (blocks.length === 0) {
    return (
      <p className="border border-dashed border-line-2 px-3 py-6 text-center
        font-mono text-12 text-chalk-4">
        Page vide — passez en édition.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <h4
                key={i}
                className={
                  block.level === 1
                    ? "font-display text-[1.3rem] font-bold tracking-[-0.01em] text-chalk"
                    : block.level === 2
                      ? "font-display text-[1.08rem] font-bold text-chalk"
                      : "font-mono text-[0.9rem] font-bold tracking-[0.04em] text-chalk-2 uppercase"
                }
              >
                {block.text}
              </h4>
            );

          case "paragraph":
            return (
              <p key={i} className="text-13 leading-[1.7] text-chalk-2">
                {block.text}
              </p>
            );

          case "list":
            return block.ordered ? (
              <ol key={i} className="ml-4 list-decimal space-y-1 text-13 leading-[1.6] text-chalk-2">
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ol>
            ) : (
              <ul key={i} className="space-y-1 text-13 leading-[1.6] text-chalk-2">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-2">
                    <span aria-hidden className="mt-1 text-signal">—</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            );

          case "quote":
            return (
              <blockquote
                key={i}
                className="border-l-2 border-signal bg-surface-2/60 px-3 py-2
                  text-13 leading-[1.65] italic text-chalk-3"
              >
                {block.text}
              </blockquote>
            );

          case "code":
            return (
              <CodeBlock
                key={i}
                code={block.code}
                lang={block.lang || null}
                variant="terminal"
              />
            );
        }
      })}
    </div>
  );
}
