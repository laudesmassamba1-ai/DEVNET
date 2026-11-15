"use client";

/**
 * Créateur de sticker, utilisable là où on en envoie.
 *
 * Un sticker est un **média**, jamais un caractère : on importe une image
 * (PNG, WebP, JPEG), on lui donne un nom, et le serveur la re-encode en
 * WebP borné avant de la ranger. Rien de ce qui part d'ici n'est publié
 * tel quel.
 *
 * Privé par défaut : un sticker personnel n'a pas à apparaître dans le
 * catalogue du réseau. Le passage en public reste un choix explicite.
 */
import { useRef, useState } from "react";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { createImageSticker, type StickerRowView } from "@/lib/stickers";

/** Bornes de lecture locales : le serveur tranche, on évite juste d'envoyer
 *  un fichier qui sera refusé pour une raison évidente. */
const MAX_BYTES = 8 * 1024 * 1024;

export function StickerCreator({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (sticker: StickerRowView) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"prive" | "public">("prive");
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setName("");
    setVisibility("prive");
    setDataUrl(null);
    setBusy(false);
    setError("");
  }

  function close() {
    reset();
    onClose();
  }

  function pick(file: File | undefined) {
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Choisis une image (PNG, WebP ou JPEG).");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image trop lourde (8 Mo maximum).");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError("Lecture du fichier impossible.");
    reader.onload = () => {
      if (typeof reader.result === "string") setDataUrl(reader.result);
      else setError("Fichier illisible.");
    };
    reader.readAsDataURL(file);
  }

  async function create() {
    const clean = name.trim();
    if (!clean) return setError("Donne un nom à ton sticker.");
    if (!dataUrl) return setError("Choisis une image.");
    if (busy) return;

    setBusy(true);
    setError("");
    const result = await createImageSticker({ name: clean, dataUrl, visibility });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated(result.value.sticker);
    toast(`Sticker « ${clean} » créé`);
    close();
  }

  return (
    <Sheet open={open} onClose={close} title="Créer un sticker">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative flex size-24 shrink-0 items-center justify-center overflow-hidden
            rounded-card border border-dashed border-line-3 bg-surface-2
            transition-colors hover:border-signal"
          aria-label="Choisir l'image du sticker"
        >
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dataUrl} alt="Aperçu du sticker" className="size-full object-contain" />
          ) : (
            <Icon name="image" size={20} className="text-chalk-4" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <label htmlFor="sticker-creator-name" className="label-micro mb-1.5 block text-chalk-3">
            Nom
          </label>
          <input
            id="sticker-creator-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            placeholder="Ex. : dauphin laser"
            className="h-11 w-full rounded-input border border-line-3 bg-surface px-3
              text-sm text-chalk placeholder:text-chalk-4 focus:border-signal"
          />
          <p className="mt-1.5 text-xs leading-relaxed text-chalk-4">
            PNG, WebP ou JPEG · 8 Mo maximum. Le serveur re-encode l&apos;image.
          </p>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/webp,image/jpeg"
        className="sr-only"
        aria-label="Fichier image du sticker"
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <fieldset className="mt-3">
        <legend className="label-micro mb-1.5 text-chalk-3">Visibilité</legend>
        <div className="flex gap-2">
          {(
            [
              { value: "prive", label: "Privé", hint: "Visible par toi seul" },
              { value: "public", label: "Public", hint: "Visible par le réseau" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={visibility === option.value}
              onClick={() => setVisibility(option.value)}
              className={`min-h-11 flex-1 rounded-input border px-3 py-1.5 text-left
                transition-colors ${
                  visibility === option.value
                    ? "border-signal bg-surface-2 text-chalk"
                    : "border-line-2 bg-surface text-chalk-3 hover:border-line-3"
                }`}
            >
              <span className="block text-xs font-bold">{option.label}</span>
              <span className="block text-xs text-chalk-4">{option.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-2.5 text-xs leading-relaxed text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={close}
          className="mo-press flex h-11 flex-1 items-center justify-center rounded-input
            border border-line-3 bg-surface text-sm font-medium text-chalk-2"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy || !name.trim() || !dataUrl}
          className="mo-press flex h-11 flex-1 items-center justify-center gap-2
            rounded-input border border-line-3 bg-signal text-sm font-bold text-void
            shadow-sh-2 disabled:opacity-40"
        >
          {busy ? "Création…" : "Créer le sticker"}
        </button>
      </div>
    </Sheet>
  );
}
