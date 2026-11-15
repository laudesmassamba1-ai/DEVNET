"use client";

import { useState } from "react";
import { useToast } from "@/components/Toast";
import { deletePost, updatePost } from "@/lib/social";
import type { PostWithAuthor } from "@/lib/types";

/**
 * Modification et suppression d'un post, pour les écrans qui les proposent.
 *
 * Le fil et le profil public offrent les deux mêmes gestes sur les mêmes
 * cartes. Ce hook existe pour que cette logique — l'état d'édition, la
 * demande de confirmation, les messages d'erreur — n'ait qu'un endroit.
 * L'alternative était de la copier dans chaque page, et c'est
 * exactement le genre de duplication qui diverge en silence : un
 * raccourci oublié d'un côté, un message d'erreur retaillé de l'autre.
 *
 * La feuille de modification reste dans la page : sa présentation dépend
 * du gabarit de chaque écran, et un composant ne devrait pas choisir à la
 * place d'un écran. Ce hook tient l'état et fournit les actions.
 */
export function usePostActions(options?: {
  /** Rappelé après une suppression, avec l'identifiant du post retiré. */
  onDeleted?: (postId: string) => void | Promise<void>;
  /** Rappelé après une modification, avec le texte retenu. */
  onUpdated?: (postId: string, text: string) => void | Promise<void>;
  /**
   * Identifiant du lecteur. C'est ce qui décide, post par post, si les
   * actions d'auteur sont proposées — et non un drapeau global : un
   * profil affiche aussi les posts des autres, et le fil affiche les siens
   * au milieu de ceux de tout le monde.
   */
  meId?: string | null;
}) {
  const toast = useToast();

  /** Post en cours de modification — `null` quand la feuille est fermée. */
  const [editing, setEditing] = useState<PostWithAuthor | null>(null);
  /** Texte du post en cours de modification. */
  const [editText, setEditText] = useState("");
  /** Post dont la suppression a été demandée, en attente de confirmation. */
  const [pendingDelete, setPendingDelete] = useState<PostWithAuthor | null>(null);
  const [busy, setBusy] = useState(false);

  /** Ouvre la modification, amorcée avec le texte existant. */
  function startEdit(post: PostWithAuthor) {
    setEditing(post);
    setEditText(post.text);
  }

  /** Referme la feuille sans écrire. */
  function cancelEdit() {
    setEditing(null);
  }

  /** Enregistre la modification du texte. */
  async function saveEdit() {
    if (!editing) return;

    const body = editText.trim();
    // Un post vide n'est pas un post : on le dit ici plutôt que de
    // laisser la base refuser une écriture qui n'a pas de sens.
    if (!body) return toast("Le post ne peut pas être vide", "err");

    setBusy(true);
    const { error } = await updatePost(editing.id, { text: body });
    setBusy(false);

    if (error) return toast(`Erreur : ${error}`, "err");

    await options?.onUpdated?.(editing.id, body);
    setEditing(null);
    toast("Post modifié");
  }

  /**
   * Première étape : la suppression est **demandée**, pas faite.
   *
   * La confirmation vit dans la barre d'actions de la carte, pas dans
   * une modale. Une modale masquerait le fil pour demander de confirmer
   * quelque chose dont on voit déjà l'objet — et le contexte est
   * précisément ce qui rend la décision facile.
   */
  function askDelete(post: PostWithAuthor) {
    setPendingDelete(post);
  }

  function cancelDelete() {
    setPendingDelete(null);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;

    setPendingDelete(null);
    const { error } = await deletePost(id);
    if (error) return toast(`Erreur : ${error}`, "err");

    await options?.onDeleted?.(id);
    toast("Post supprimé");
  }

  return {
    editing,
    editText,
    setEditText,
    pendingDelete,
    busy,
    startEdit,
    cancelEdit,
    saveEdit,
    askDelete,
    cancelDelete,
    confirmDelete,
    /** Ce post est-il à toi ? Les actions d'auteur ne s'affichent que là. */
    isMine: (post: PostWithAuthor) => Boolean(options?.meId) && post.author_id === options?.meId,

    /** À étaler tel quel sur un `PostCard`, avec `isMine` calculé à part. */
    cardProps: {
      onEdit: startEdit,
      onDelete: askDelete,
    },
  };
}