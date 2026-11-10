"use client";

import { useState } from "react";
import { GifPicker } from "./GifPicker";
import { Icon } from "./Icon";
import { StickerFace } from "./StickerFace";
import { StickerPicker } from "./StickerPicker";
import type { Gif } from "@/lib/gifs";
import type { StickerRowView } from "@/lib/stickers";

/**
 * Pièces jointes d'un message : GIF et sticker.
 *
 * Le choix **envoie** : on ne passe pas par un brouillon avec pièce
 * jointe, parce qu'un sticker qu'on prépare n'existe pas — c'est un
 * geste, pas un document. Les deux boutons ont la même cible de 44 px
 * que le reste du composeur.
 */
export function MessageAttachmentButtons({
  disabled = false,
  onGif,
  onSticker,
}: {
  disabled?: boolean;
  onGif: (gif: Gif) => void;
  onSticker: (sticker: StickerRowView) => void;
}) {
  const [gifOpen, setGifOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setGifOpen(true)}
        disabled={disabled}
        aria-label="Envoyer un GIF"
        aria-haspopup="dialog"
        title="Envoyer un GIF"
        className="mo-press flex size-[var(--h-input)] shrink-0 items-center
          justify-center rounded-full border border-line-3 bg-surface
          text-chalk-4 transition-colors hover:text-signal disabled:opacity-40"
      >
        <Icon name="gif" size={18} strokeWidth={1.8} />
      </button>

      <button
        type="button"
        onClick={() => setStickerOpen(true)}
        disabled={disabled}
        aria-label="Envoyer un sticker"
        aria-haspopup="dialog"
        title="Envoyer un sticker"
        className="mo-press flex size-[var(--h-input)] shrink-0 items-center
          justify-center rounded-full border border-line-3 bg-surface
          text-chalk-4 transition-colors hover:text-signal disabled:opacity-40"
      >
        <Icon name="smile" size={18} strokeWidth={1.8} />
      </button>

      <GifPicker open={gifOpen} onClose={() => setGifOpen(false)} onPick={onGif} />
      <StickerPicker
        open={stickerOpen}
        onClose={() => setStickerOpen(false)}
        onPick={onSticker}
      />
    </>
  );
}

/**
 * Le média dans la bulle. Il remplace le texte quand il n'y en a pas :
 * une bulle vide laisserait croire à un message perdu.
 */
export function MessageAttachmentView({
  gifUrl,
  gifAlt,
  sticker,
}: {
  gifUrl?: string;
  gifAlt?: string;
  sticker?: StickerRowView | null;
}) {
  if (sticker) {
    return (
      <div className="mo-burst py-1" data-message-media="sticker">
        <StickerFace
          kind={sticker.kind}
          glyph={sticker.glyph}
          fg={sticker.fg}
          bg={sticker.bg}
          assetId={sticker.id}
          builtin={sticker.builtin}
          size={96}
          alt={`Sticker ${sticker.name}`}
        />
      </div>
    );
  }
  if (gifUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        data-message-media="gif"
        src={gifUrl}
        alt={gifAlt || "GIF"}
        loading="lazy"
        decoding="async"
        className="mo-burst my-1 max-h-64 w-full max-w-72 rounded-input
          border border-line-2 bg-surface-2 object-contain"
      />
    );
  }
  return null;
}
