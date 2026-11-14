"use client";

import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import type { PostWithAuthor } from "@/lib/types";

/**
 * Les outils du propriétaire : confirmation de suppression, et
 * modification du texte.
 *
 * Ce composant ne connaît rien de la base : il reçoit l'état et les
 * actions d'`usePostActions` et ne fait que les rendre. Il existe pour
 * que le fil et le profil public partagent exactement le même rendu —
 * deux copies de cette barre finiraient fatalement par divergir d'un
 * mot ou d'une classe, et c'est le genre d'écart qui ne se voit qu'au
 * moment de la démonstration.
 */
export function PostOwnerTools({
  actions,
}: {
  actions: {
    editing: PostWithAuthor | null;
    editText: string;
    setEditText: (v: string) => void;
    pendingDelete: PostWithAuthor | null;
    busy: boolean;
    cancelEdit: () => void;
    saveEdit: () => void;
    cancelDelete: () => void;
    confirmDelete: () => void;
  };
}) {
  const {
    editing, editText, setEditText, pendingDelete, busy,
    cancelEdit, saveEdit, cancelDelete, confirmDelete,
  } = actions;

  return (
    <>
      {/* Suppression.
          La confirmation ne vit pas dans une modale : une modale
          masquerait le fil pour demander de confirmer un effacement
          dont on voit déjà l'objet. Le contexte est ce qui rend la
          décision facile, et la barre est déjà là, sous la carte. */}
      {pendingDelete && (
        <div
          role="alertdialog"
          aria-label="Confirmer la suppression"
          className="mx-(--gutter) mb-3 flex flex-wrap items-center gap-2 border
            border-danger bg-surface px-3.5 py-3 text-[13px] text-chalk shadow-sh-1"
        >
          <Icon name="trash" size={14} className="text-danger" />
          <span className="mr-auto">
            Supprimer ce post ? Ses commentaires et ses likes partent avec.
          </span>
          <button
            type="button"
            onClick={cancelDelete}
            className="rounded-(--radius-chip) border border-line-3 px-2.5 py-1.5
              font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-chalk-3
              transition-colors duration-(--d-fast) hover:text-chalk"
          >
            annuler
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            className="rounded-(--radius-chip) border border-danger bg-danger
              px-2.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em]
              text-void transition-transform duration-(--d-fast) active:translate-y-px"
          >
            supprimer
          </button>
        </div>
      )}

      {/* Modification. La feuille est celle de la publication : c'est le
          même acte, sur un texte déjà existant. Le snippet n'y est pas
          repris — modifier un post ne veut pas dire réécrire son code,
          et un éditeur à moitié dans une feuille à moitié serait un
          pis-aller. */}
      <Sheet open={editing !== null} onClose={cancelEdit} title="Modifier le post">
        <textarea
          aria-label="Texte du post"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          rows={5}
          placeholder="Le texte du post…"
          className="mb-3 w-full rounded-(--radius-input) border border-line-3 bg-surface px-3.5 py-3
            text-[14px] leading-[1.6] shadow-sh-1
            transition-[transform,box-shadow] placeholder:text-chalk-4
            focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_var(--color-signal)]"
        />

        <div className="flex gap-2">
          <button
            type="button" onClick={cancelEdit}
            className="mo-press h-(--h-tap) flex-1 rounded-(--radius-input)
              border border-transparent text-[13px] font-bold text-chalk-2
              transition-colors hover:bg-surface-2 hover:text-chalk"
          >
            Annuler
          </button>
          <button
            type="button" onClick={saveEdit} disabled={busy}
            className="mo-press flex h-(--h-tap) flex-1 items-center justify-center gap-2
              rounded-(--radius-input) border border-line-3 bg-signal text-[13px]
              font-bold text-void shadow-sh-2 disabled:opacity-40"
          >
            Enregistrer
          </button>
        </div>
      </Sheet>
    </>
  );
}