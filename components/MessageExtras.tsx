"use client";

import { useState } from "react";
import { Icon } from "./Icon";
import { MESSAGE_EMOJIS, type ReactionSummary } from "@/lib/messages";

/**
 * Ce qu'on accroche à une bulle de message : des réactions, une épingle,
 * une réponse. Le même composant sert au privé et aux canaux — c'est le
 * même geste, et deux copies divergeraient dès la première retouche.
 *
 * ## Ce qui est toujours visible, et ce qui ne l'est pas
 *
 * Les **réactions** s'affichent toujours : elles portent de
 * l'information, les cacher serait cacher le message de quelqu'un.
 *
 * La **barre d'actions** (réagir, répondre, épingler) est en revanche
 * discrète : visible au survol et au focus sur grand écran — là où la
 * souris existe — et toujours visible sur petit écran, où il n'y a pas
 * de survol. C'est le seul compromis honnête : un téléphone ne connaît
 * pas `:hover`, donc une barre qui n'apparaîtrait qu'au survol serait
 * inatteignable sur mobile.
 */

/** La citation du message auquel on répond, au-dessus de la bulle. */
export function ReplyQuote({
  author,
  text,
  onClick,
  align,
}: {
  author: string;
  text: string;
  onClick?: () => void;
  align: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-1 flex max-w-full items-baseline gap-1.5 border-l-2 border-signal
        bg-surface-2 px-2 py-1 text-left text-12 text-chalk-3
        transition-colors hover:text-chalk-2 ${align === "right" ? "self-end" : "self-start"}`}
    >
      <span className="shrink-0 font-bold text-chalk-2">{author}</span>
      <span className="min-w-0 truncate">{text}</span>
    </button>
  );
}

/** Une icône proposée dans le sélecteur. */
function ReactionButton({ emoji, onPick }: { emoji: string; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`Réagir ${emoji}`}
      className="mo-press flex size-7.5 items-center justify-center rounded-(--radius-chip)
        text-[17px] leading-none transition-colors hover:bg-surface-2"
    >
      <span aria-hidden>{emoji}</span>
    </button>
  );
}

export function MessageExtras({
  summary,
  pinned,
  align,
  onToggleReaction,
  onReply,
  onTogglePin,
  onEdit,
  onDelete,
}: {
  summary: ReactionSummary[];
  pinned: boolean;
  align: "left" | "right";
  onToggleReaction: (emoji: string) => void;
  onReply: () => void;
  onTogglePin: () => void;
  /**
   * Corriger son propre message (migration 041). Absent là où la
   * correction n'a pas de sens : message en cours d'envoi, ou d'un autre
   * auteur. Le bouton suit la même règle que la RLS, sans la doubler.
   */
  onEdit?: () => void;
  /**
   * Supprimer le message. **Absent** quand l'écran sait que l'action
   * échouerait : l'auteur supprime le sien, l'équipe du groupe
   * (`gm_delete`, migration 020) supprime celui des autres. Un bouton
   * montré là où la RLS refuse serait le défaut que ce projet combat.
   */
  onDelete?: () => void;
}) {
  const [picker, setPicker] = useState(false);

  return (
    <div
      className={`mt-1 flex flex-col gap-1 ${
        align === "right" ? "items-end" : "items-start"
      }`}
    >
      {summary.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {summary.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => onToggleReaction(r.emoji)}
              aria-label={`Réaction ${r.emoji} (${r.count})`}
              aria-pressed={r.mine}
              className={`flex min-h-7 items-center gap-1 rounded-(--radius-chip)
                border px-1.5 text-13 leading-none transition-colors
                ${
                  r.mine
                    ? "border-signal bg-signal/15 text-signal"
                    : "border-line-2 bg-surface text-chalk-2 hover:border-chalk-3"
                }`}
            >
              <span aria-hidden="true" className="text-14 leading-none">
                {r.emoji}
              </span>
              <span className="tnum font-mono text-12">{r.count}</span>
            </button>
          ))}
        </div>
      )}

      {picker && (
        <div className="flex gap-0.5 border border-edge overlay-panel p-0.5 shadow-sh-1">
          {MESSAGE_EMOJIS.map((emoji) => (
            <ReactionButton
              key={emoji}
              emoji={emoji}
              onPick={() => {
                onToggleReaction(emoji);
                setPicker(false);
              }}
            />
          ))}
        </div>
      )}

      <div
        className={`flex items-center gap-0.5 opacity-100
          md:opacity-0 md:transition-opacity md:duration-(--d-fast)
          md:group-hover/message:opacity-100 md:group-focus-within/message:opacity-100`}
      >
        <button
          type="button"
          onClick={() => setPicker((p) => !p)}
          aria-label="Réagir"
          aria-expanded={picker}
          className="mo-press flex size-8 items-center justify-center rounded-(--radius-chip)
            text-chalk-4 transition-colors hover:text-signal"
        >
          <Icon name="smile" size={12} />
        </button>
        <button
          type="button"
          onClick={onReply}
          aria-label="Répondre à ce message"
          className="mo-press flex size-8 items-center justify-center rounded-(--radius-chip)
            text-chalk-4 transition-colors hover:text-signal"
        >
          <Icon name="comment" size={12} />
        </button>
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={pinned ? "Désépingler ce message" : "Épingler ce message"}
          aria-pressed={pinned}
          className={`mo-press flex size-8 items-center justify-center rounded-(--radius-chip)
            transition-colors hover:text-signal ${pinned ? "text-signal" : "text-chalk-4"}`}
        >
          <Icon name="pin" size={12} fill={pinned ? "currentColor" : "none"} />
        </button>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label="Corriger ce message"
            className="mo-press flex size-8 items-center justify-center rounded-(--radius-chip)
              text-chalk-4 transition-colors hover:text-signal"
          >
            <Icon name="edit" size={12} />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Supprimer ce message"
            className="mo-press flex size-8 items-center justify-center rounded-(--radius-chip)
              text-chalk-4 transition-colors hover:text-danger"
          >
            <Icon name="trash" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
