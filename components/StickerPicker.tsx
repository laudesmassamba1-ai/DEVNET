"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { StickerCreator } from "./StickerCreator";
import { StickerFace } from "./StickerFace";
import { fetchStickers, type StickerRowView } from "@/lib/stickers";

/**
 * Sélecteur de sticker pour la messagerie.
 *
 * Le catalogue est chargé à l'ouverture, pas au montage de la page : un
 * canal qu'on lit sans envoyer de sticker ne paie pas la requête. Les
 * stickers retirés ne sont pas proposés — le serveur peut encore les
 * référencer dans d'anciens messages, mais on n'en envoie plus.
 */
export function StickerPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (sticker: StickerRowView) => void;
}) {
  const [stickers, setStickers] = useState<StickerRowView[] | null>(null);
  const [error, setError] = useState("");
  const [creatorOpen, setCreatorOpen] = useState(false);

  const load = useCallback(async (): Promise<StickerRowView[]> => {
    const rows = await fetchStickers();
    const active = rows.filter((row) => row.status === "actif");
    setStickers(active);
    setError(active.length === 0 ? "Aucun sticker dans ton catalogue." : "");
    return active;
  }, []);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remet la grille en chargement à chaque ouverture
    setStickers(null);
    setError("");
    void load();
  }, [open, load]);

  return (
    <Sheet open={open} onClose={onClose} title="Envoyer un sticker">
      {stickers === null && (
        <div className="grid grid-cols-4 gap-2" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <span
              key={i}
              className="block aspect-square mo-pulse rounded-(--radius-input) bg-surface-2"
            />
          ))}
        </div>
      )}

      {stickers !== null && stickers.length === 0 && (
        <div className="rounded-(--radius-input) border border-line-2 bg-surface-2 px-3.5 py-3">
          <p className="text-13 font-semibold text-chalk">{error}</p>
          <p className="mt-1 text-sm leading-relaxed text-chalk-3">
            Crée ton premier sticker juste ici — un sticker est une image, pas un
            emoji.
          </p>
        </div>
      )}

      {stickers !== null && stickers.length > 0 && (
        <ul className="grid grid-cols-4 gap-2">
          {stickers.map((sticker) => (
            <li key={sticker.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(sticker);
                  onClose();
                }}
                aria-label={`Envoyer le sticker ${sticker.name}`}
                className="flex aspect-square w-full items-center justify-center
                  rounded-(--radius-input) border border-line-2 bg-surface-2
                  transition-[border-color,transform] duration-(--d-fast)
                  hover:border-signal active:translate-y-px"
              >
                <StickerFace
                  kind={sticker.kind}
                  glyph={sticker.glyph}
                  fg={sticker.fg}
                  bg={sticker.bg}
                  assetId={sticker.id}
                  builtin={sticker.builtin}
                  size={44}
                  alt={sticker.name}
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setCreatorOpen(true)}
        className="mo-press mt-3 flex min-h-11 w-full items-center justify-center gap-2
          rounded-input border border-dashed border-line-3 bg-surface text-xs
          font-medium text-chalk-2 transition-colors hover:border-signal hover:text-signal"
      >
        <Icon name="plus" size={14} strokeWidth={2.2} />
        Créer un sticker
      </button>

      <StickerCreator
        open={creatorOpen}
        onClose={() => setCreatorOpen(false)}
        onCreated={(sticker) => {
          // Le nouveau sticker entre dans la grille sans rechargement :
          // on vient de le créer, il est forcément actif.
          setStickers((prev) => [...(prev ?? []), sticker]);
          setError("");
        }}
      />
    </Sheet>
  );
}
