"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { useToast } from "@/components/Toast";

/** Applications disponibles pour partager. Ajouter une ligne = ajouter un
 *  bouton dans la liste. Chaque cible a son URI dédiée : le partage
 *  mène **toujours** dans l'application choisie, jamais dans la feuille
 *  système — c'est le but du choix. */
const APPS = [
  { id: "copy", label: "Copier le lien", icon: "copy", href: "" },
  { id: "whatsapp", label: "WhatsApp", icon: "send", href: "https://wa.me/?text=" },
  { id: "telegram", label: "Telegram", icon: "send", href: "https://t.me/share/url?url=" },
  { id: "x", label: "X (anciennement Twitter)", icon: "globe", href: "https://twitter.com/intent/tweet?text=" },
  { id: "facebook", label: "Facebook", icon: "globe", href: "https://www.facebook.com/sharer/sharer.php?u=" },
  { id: "linkedin", label: "LinkedIn", icon: "globe", href: "https://www.linkedin.com/sharing/share-offsite/?url=" },
  { id: "reddit", label: "Reddit", icon: "link", href: "https://www.reddit.com/submit?url=" },
  { id: "email", label: "Email", icon: "send", href: "mailto:?subject=" },
] as const;

export type ShareAppId = (typeof APPS)[number]["id"];

function extensionFor(url: string): string {
  return (
    url.endsWith(".pdf") ? "pdf" :
    url.includes(".zip") ? "zip" :
    url.endsWith(".png") ? "png" :
    url.endsWith(".jpg") ? "jpg" :
    url.endsWith(".jpeg") ? "jpeg" :
    url.endsWith(".gif") ? "gif" :
    url.includes(".mp4") ? "mp4" :
    url.includes(".webm") ? "webm" :
    url.includes(".js") ? "js" :
    url.includes(".ts") ? "ts" :
    url.includes(".css") ? "css" :
    "bin"
  );
}

interface ShareSheetProps {
  open: boolean;
  onClose: () => void;
  url: string;
  title: string;
}

export function ShareSheet({ open, onClose, url, title }: ShareSheetProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  /** On ne peut pas télécharger le lien directement, on désactive l'option
   *  download pour l'instant. */
  const handleDownload = async (filename: string) => {
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast("Téléchargé", "ok");
    } catch {
      toast("Échec du téléchargement", "err");
    }
    onClose();
  };

  async function shareViaApp(appId: string) {
    setBusy(true);
    try {
      if (appId === "copy") {
        await navigator.clipboard.writeText(url);
        toast("Lien copié", "ok");
        return;
      }

      const app = APPS.find((a) => a.id === appId);
      if (!app) return;

      // L'URI construit un message **porteur** : X reçoit le texte et le
      // lien, WhatsApp un « texte + lien » prêts à envoyer, l'e-mail un
      // sujet et un corps. Un lien nu serait un geste sans contexte.
      const text = encodeURIComponent(title);
      const link = encodeURIComponent(url);
      const full =
        app.id === "whatsapp"
          ? `https://wa.me/?text=${encodeURIComponent(`${title} — ${url}`)}`
          : app.id === "telegram"
            ? `https://t.me/share/url?url=${link}&text=${text}`
            : app.id === "x"
              ? `https://twitter.com/intent/tweet?text=${text}&url=${link}`
              : app.id === "email"
                ? `mailto:?subject=${text}&body=${link}`
                : `${app.href}${link}`;

      window.open(full, "_blank", "noopener,noreferrer");
      toast(`Ouvert ${app.label}`, "ok");
    } catch {
      toast("Partage abandonné", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Partager">
      <div className="px-(--gutter) pb-2">
        <div className="flex flex-col gap-1.5" role="listbox" aria-label="Applications pour partager">
          {APPS.map((app) => (
            <button
              key={app.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => shareViaApp(app.id)}
              disabled={busy}
              className={`flex w-full items-center justify-between gap-3 rounded-(--radius-input)
                border px-3 py-2.5 text-left transition-[background-color,color,border-color]
                duration-(--d-fast) ${busy ? "opacity-50" : ""}
                ${app.id === "copy"
                  ? "border-line-3 hover:border-line-3"
                  : "border-line-2 hover:border-signal hover:bg-signal/10"
                  }`}
            >
              <span className="flex items-center gap-2.5">
                <Icon name={app.icon} size={14} strokeWidth={2} />
                <span className="font-mono text-[13px]">{app.label}</span>
              </span>
              {app.id === "copy" && <Icon name="check" size={12} strokeWidth={3} className="text-signal" />}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() =>
            handleDownload(`devnet-${Date.now()}.${extensionFor(url)}`)
          }
          disabled={busy}
          className="mo-press mt-3 inline-flex h-(--h-tap) w-full items-center
            justify-center gap-2 rounded-(--radius-input) border border-line-2
            bg-surface px-4 font-mono text-[11.5px] font-bold text-chalk-2
            transition-colors hover:border-line-3 hover:text-chalk
            disabled:opacity-40"
        >
          <Icon name="send" size={12} strokeWidth={2} />
          Télécharger le post
        </button>
      </div>
    </Sheet>
  );
}
