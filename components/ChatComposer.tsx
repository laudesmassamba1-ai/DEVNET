"use client";

import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

/**
 * Le composeur de message — privé et groupe.
 *
 * Un seul composant pour les deux écrans : c'est le même geste, et deux
 * copies divergeraient dès la première retouche.
 *
 * ## Pourquoi il reste à sa place
 *
 * La barre est un frère de la liste de messages dans une colonne flex :
 * seule la liste défile et le composeur garde sa propre place au bas de
 * la conversation. `sticky` dans une liste à hauteur variable ne garantit
 * pas cet ancrage, en particulier quand le contenu est court ou que le
 * clavier mobile redimensionne la fenêtre.
 *
 * ## Le rendu, sans cadre doublé
 *
 * Les bulles et le champ portaient une bordure **et** une ombre dure
 * décalée. Sur fond encre, cette ombre se lit comme une seconde bordure
 * mal alignée — l'air d'un élément cassé plutôt que d'un élément posé.
 * Ici les surfaces sont plates : c'est la bordure qui tient le contour,
 * le fond qui tient la hiérarchie.
 */
export function ChatComposer({
  id,
  value,
  onValueChange,
  onSend,
  onTyping,
  placeholder,
  disabled = false,
  sending = false,
  code,
  onToggleCode,
  attachments,
}: {
  id: string;
  value: string;
  onValueChange: (next: string) => void;
  onSend: () => void;
  onTyping?: () => void;
  placeholder: string;
  disabled?: boolean;
  sending?: boolean;
  /**
   * Présent là où coller du code a un sens : canaux de groupe et messages
   * privés (migration 041). Le drapeau ne change que le rendu — le texte
   * reste du texte, jamais interprété.
   */
  code?: boolean;
  onToggleCode?: () => void;
  /**
   * Boutons de pièces jointes (GIF, sticker), rendus à gauche du champ.
   * Le composeur ne sait pas ce qu'ils envoient : il ouvre la place, les
   * écrans décident. Un GIF ou un sticker part **au choix**, sans étape
   * de confirmation : c'est le geste d'une messagerie, pas d'un e-mail.
   */
  attachments?: React.ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // La hauteur suit le contenu. On repart d'`auto` à chaque frappe :
  // mesurer sur une hauteur déjà étirée rendrait le champ impossible à
  // rétrécir — il ne ferait que grandir.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [value]);

  return (
    <div className="flex items-end gap-2">
      {/* Le sélecteur d'emojis a été retiré : aucune icône colorée ne
          correspond — les réactions du projet sont des glyphes du jeu
          d'icônes, pas des émoticônes. Le champ n'a rien perdu : la
          frappe suffit. */}

      {attachments}

      <textarea
        id={id}
        ref={ref}
        value={value}
        rows={1}
        disabled={disabled}
        onChange={(e) => {
          onValueChange(e.target.value);
          onTyping?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={placeholder}
        className="max-h-33 min-h-(--h-input) flex-1 resize-none
          rounded-(--radius-input) border border-line-3 bg-surface px-3.5
          py-[10px] text-base leading-[1.5] outline
          placeholder:text-chalk-4 focus:border-signal
          disabled:opacity-50"
      />

      {onToggleCode && (
        <button
          type="button"
          onClick={onToggleCode}
          aria-pressed={code}
          aria-label="Envoyer comme code"
          title="Envoyer comme code"
          className={`mo-press flex size-(--h-input) shrink-0 items-center
            justify-center rounded-full border transition-colors
            ${
              code
                ? "border-signal bg-signal text-void"
                : "border-line-3 bg-surface text-chalk-4 hover:text-chalk"
            }`}
        >
          <Icon name="code" size={16} strokeWidth={2} />
        </button>
      )}

      <button
        type="button"
        onClick={onSend}
        disabled={sending || disabled || value.trim().length === 0}
        aria-label="Envoyer"
        className="mo-press flex size-(--h-input) shrink-0 items-center
          justify-center rounded-full border border-signal
          bg-signal text-void shadow-(--shadow-action) disabled:opacity-40"
      >
        <Icon name="send" size={18} strokeWidth={2} />
      </button>
    </div>
  );
}

/**
 * La barre du bas — en **flux**, dernier enfant de la colonne de
 * discussion. Elle est `shrink-0` : la liste au-dessus prend toute la
 * hauteur restante et défile, la barre ne bouge jamais.
 *
 * `maxWidth` borne la barre sans borner le fond : autour d'elle, c'est le
 * vide de la conversation qui passe, pas un bandeau plein largeur. Un
 * fond pleine largeur derrière une barre centrée fait une bande
 * rectangulaire qui n'a l'air de rien appartenir.
 */
export function ComposerBar({
  children,
  maxWidth = 720,
}: {
  children: React.ReactNode;
  maxWidth?: number;
}) {
  return (
    <div
      className="relative z-10 shrink-0 border-t border-line-2/70 glass-strong px-3
        pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
    >
      <div className="mx-auto w-full" style={{ maxWidth }}>
        <div className="relative isolate rounded-(--radius-card) glass-lens p-1.5">
          {children}
        </div>
      </div>
    </div>
  );
}
