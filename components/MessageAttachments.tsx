"use client";

import { useState } from "react";
import { GifPicker } from "./GifPicker";
import { Icon } from "./Icon";
import { StickerFace } from "./StickerFace";
import type { Gif } from "@/lib/gifs";
import type { StickerRowView } from "@/lib/stickers";

/**
 * Pièces jointes d'un message : GIF.
 *
 * Le choix **envoie** : on ne passe pas par un brouillon avec pièce
 * jointe, parce qu'un GIF qu'on prépare n'existe pas — c'est un geste,
 * pas un document. Le bouton a la même cible de 44 px que le reste du
 * composeur.
 *
 * Le sélecteur de stickers a été retiré : la rangée d'accessoires du
 * composeur n'en montre plus que l'essentiel. Les messages qui en
 * contiennent déjà restent lisibles (`MessageAttachmentView`) — on
 * retire la possibilité d'en envoyer, pas les conversations existantes.
 */
export function MessageAttachmentButtons({
  disabled = false,
  onGif,
  onMedia,
}: {
  disabled?: boolean;
  onGif: (gif: Gif) => void;
  /** Le fichier est téléversé par l'appelant, qui connaît le destinataire. */
  onMedia?: (file: File) => void;
}) {
  const [gifOpen, setGifOpen] = useState(false);

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

      {onMedia && (
        <label
          aria-label="Envoyer une photo ou une vidéo"
          title={disabled ? "Choisis une conversation" : "Envoyer une photo ou une vidéo"}
          className={`mo-press flex size-[var(--h-input)] shrink-0 cursor-pointer items-center
            justify-center rounded-full border border-line-3 bg-surface
            text-chalk-4 transition-colors hover:text-signal ${disabled ? "pointer-events-none opacity-40" : ""}`}
        >
          <input
            type="file"
            accept="image/*,video/*"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // On remet le champ à zéro : choisir deux fois le même
              // fichier doit fonctionner, ce que `change` ne ferait pas.
              event.target.value = "";
              if (file) onMedia(file);
            }}
            className="sr-only"
          />
          <Icon name="image" size={18} strokeWidth={1.8} />
        </label>
      )}

      <GifPicker open={gifOpen} onClose={() => setGifOpen(false)} onPick={onGif} />
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
  mediaUrl,
  mediaType,
}: {
  gifUrl?: string;
  gifAlt?: string;
  sticker?: StickerRowView | null;
  mediaUrl?: string;
  mediaType?: "" | "image" | "video";
}) {
  if (mediaUrl) {
    return mediaType === "video" ? (
      <video
        data-message-media="video"
        src={mediaUrl}
        controls
        playsInline
        preload="metadata"
        className="mo-burst my-1 max-h-72 w-full max-w-72 rounded-input
          border border-line-2 bg-surface-2 object-contain"
      />
    ) : (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        data-message-media="photo"
        src={mediaUrl}
        alt="Photo jointe"
        loading="lazy"
        decoding="async"
        className="mo-burst my-1 max-h-72 w-full max-w-72 rounded-input
          border border-line-2 bg-surface-2 object-contain"
      />
    );
  }
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
