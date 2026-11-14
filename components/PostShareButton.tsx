"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { ShareSheet } from "./ShareSheet";

/**
 * Le bouton de partage d'une publication.
 *
 * Chaque application sociale a son URI codé en dur — WhatsApp ouvre
 * `wa.me`, X ouvre une publication. C'est le même tableau que celui de
 * la feuille `ShareSheet` : un post ne se partage pas en interne, il se
 * remet aux applications vers lesquelles il mène.
 *
 * L'API Web Share, quand elle existe, reçoit le titre et l'adresse —
 * rien de plus : la cible se choisit dans la feuille, pas dans l'appel.
 */
export function PostShareButton({
  title,
  url,
}: {
  title: string;
  url: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Partager cette publication"
        className="ml-auto inline-flex items-center gap-1.5 rounded-(--radius-chip)
          border-(--bw-thin) border-line px-2.5 py-2 min-h-(--h-action)
          max-sm:min-h-(--h-tap) max-sm:w-(--h-tap) max-sm:justify-center
          max-sm:px-0 inline-flex items-center label
          text-chalk-3 transition-[color,background-color,border-color]
          duration-(--d-fast) hover:border-signal hover:bg-signal hover:text-void
          active:translate-y-px"
      >
        <Icon name="share" size={12} strokeWidth={2} />
        {/* Le mot reste au bureau ; au doigt, l'icône seule tient la
            ligne — le nom accessible, lui, ne change pas. */}
        <span className="max-sm:sr-only">Partager</span>
      </button>

      <ShareSheet
        open={open}
        onClose={() => setOpen(false)}
        url={url}
        title={title}
      />
    </>
  );
}