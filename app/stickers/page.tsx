"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Loading } from "@/components/Avatar";
import { SectionIcon } from "@/components/SectionIcon";
import { useSession } from "@/hooks/useSession";
import { useToast } from "@/components/Toast";
import {
  createImageSticker,
  fetchStickers,
  retireSticker,
  stickerAssetUrl,
  type StickerRowView,
} from "@/lib/stickers";

/**
 * Studio de stickers.
 *
 * Un sticker est un **média**, pas un caractère. Le studio n'offre donc plus
 * de glyphe ni de palette : on importe une image ou un GIF, le serveur la
 * borne, la ré-encode en WebP (animé pour un GIF) et retire ses métadonnées.
 * Un sticker de texte n'a pas sa place dans une messagerie où il finirait par
 * se confondre avec un emoji.
 *
 * Privé par défaut : un sticker personnel n'est visible par le réseau que si
 * son auteur le décide.
 */

export default function StickerStudioPage() {
  const { profile } = useSession();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<StickerRowView[] | null>(null);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"prive" | "public">("prive");
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    const next = await fetchStickers();
    setRows(next.filter((row) => row.kind === "image"));
  }

  useEffect(() => {
    let alive = true;
    fetchStickers().then((next) => {
      if (alive) setRows(next.filter((row) => row.kind === "image"));
    });
    return () => {
      alive = false;
    };
  }, []);

  function readFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      toast("Image PNG, JPEG, WebP ou GIF attendue", "err");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast("Fichier trop lourd (2 Mo maximum)", "err");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setDataUrl(reader.result);
    };
    reader.onerror = () => toast("Lecture du fichier impossible", "err");
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (busy) return;
    const clean = name.trim();
    if (!clean) {
      toast("Donne un nom à ton sticker", "err");
      return;
    }
    if (!dataUrl) {
      toast("Choisis une image ou un GIF", "err");
      return;
    }

    setBusy(true);
    try {
      const result = await createImageSticker({ name: clean, dataUrl, visibility });
      if (!result.ok) {
        toast(result.error, "err");
        return;
      }
      toast("Sticker re-encodé et enregistré");
      setName("");
      setDataUrl(null);
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(sticker: StickerRowView) {
    const result = await retireSticker(sticker.id);
    if (!result.ok) {
      toast(result.error, "err");
      return;
    }
    toast("Sticker retiré");
    setRows((current) =>
      current?.map((row) =>
        row.id === sticker.id ? { ...row, status: "retire" as const } : row,
      ) ?? current,
    );
  }

  const mine = rows ?? [];

  return (
    <AppShell path="~/stickers">
      <header className="mb-6">
        <p className="label-micro text-chalk-3">Studio</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk">Tes stickers</h1>
        <p className="mt-2 max-w-prose text-sm text-chalk-2">
          Images et GIF uniquement. Le serveur borne le média à 512 px, le
          ré-encode en WebP — animé s’il s’agit d’un GIF — et retire ses
          métadonnées. Rien de ce que tu envoies n’est publié tel quel.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section
          aria-labelledby="composer-title"
          className="rounded-[var(--radius-card)] border border-line-2 bg-surface p-4"
        >
          <h2 id="composer-title" className="label-micro text-chalk-3">
            Nouveau sticker
          </h2>

          <div className="mt-4 flex items-center gap-4">
            <div className="flex size-20 items-center justify-center rounded-[26%] border border-line-2 bg-void">
              {dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={dataUrl} alt="" width={72} height={72} className="rounded-[26%] object-cover" />
              ) : (
                <SectionIcon name="sticker" size={26} className="text-chalk-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <label htmlFor="sticker-name" className="label-micro text-chalk-3">
                Nom
              </label>
              <input
                id="sticker-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={40}
                placeholder="ex. Déploiement du vendredi"
                className="mt-1 min-h-11 w-full rounded-[var(--radius-chip)] border border-line-2 bg-void px-3 text-sm text-chalk"
              />
            </div>
          </div>

          <label htmlFor="sticker-file" className="mt-4 block label-micro text-chalk-3">
            Média — PNG, JPEG, WebP ou GIF · 2 Mo · 80 images · 1,5 Mo animé
          </label>
          {/* Le champ natif affiche « Choose File / No file chosen » : sa
              langue suit celle du navigateur, pas celle de la page. On le
              masque et on écrit nous-mêmes le bouton et le nom du fichier. */}
          <input
            id="sticker-file"
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => readFile(event.target.files?.[0])}
            className="sr-only"
          />
          <div className="mt-1 flex min-w-0 flex-col items-start gap-1.5">
            <label
              htmlFor="sticker-file"
              className="inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-[var(--radius-chip)]
                border border-line-2 bg-surface-2 px-4 font-mono text-[10px] font-bold
                uppercase tracking-[0.12em] text-chalk transition-colors hover:border-signal"
            >
              Choisir un fichier
            </label>
            <span className="break-all font-mono text-[11px] text-chalk-3">
              {fileName || "Aucun fichier choisi"}
            </span>
          </div>

          <fieldset className="mt-5">
            <legend className="label-micro text-chalk-3">Visibilité</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {(["prive", "public"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={visibility === value}
                  onClick={() => setVisibility(value)}
                  className={`min-h-11 rounded-[var(--radius-chip)] border px-3 label-micro ${
                    visibility === value
                      ? "border-signal text-chalk"
                      : "border-line-2 text-chalk-2"
                  }`}
                >
                  {value === "prive" ? "Visible par moi seul" : "Visible par le réseau"}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mt-5">
            <button
              type="button"
              onClick={submit}
              disabled={!profile || busy}
              className="mo-press inline-flex h-[var(--h-tap)] items-center justify-center
                rounded-[var(--radius-input)] border border-line-3 bg-signal px-4
                text-[12.5px] font-bold text-void shadow-sh-1
                hover:border-signal hover:shadow-sh-2
                disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Enregistrement…" : "Créer le sticker"}
            </button>
            {!profile ? (
              <p className="mt-2 text-xs text-chalk-3">
                Connecte-toi pour créer un sticker.
              </p>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="library-title">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="library-title" className="label-micro text-chalk-3">
              Ma bibliothèque
            </h2>
            <span className="label-micro text-chalk-3">{mine.length} / 50</span>
          </div>

          {rows === null ? (
            <Loading />
          ) : mine.length === 0 ? (
            <p className="rounded-[var(--radius-card)] border border-dashed border-line-2 p-6 text-sm text-chalk-3">
              Aucun sticker personnel. Le premier est à gauche.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {mine.map((sticker) => (
                <li
                  key={sticker.id}
                  className="rounded-[var(--radius-card)] border border-line-2 bg-surface p-2"
                >
                  <div className="flex aspect-square items-center justify-center">
                    {sticker.status === "actif" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={stickerAssetUrl(sticker.id)}
                        alt={sticker.name}
                        width={64}
                        height={64}
                        loading="lazy"
                        className="rounded-[26%] object-cover"
                      />
                    ) : (
                      <span className="label-micro text-chalk-4">retiré</span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-chalk" title={sticker.name}>
                    {sticker.name}
                  </p>
                  <p className="text-[11px] text-chalk-3">
                    {sticker.visibility === "public" ? "public" : "privé"}
                    {sticker.byteSize > 0
                      ? ` · ${Math.round(sticker.byteSize / 1024)} Ko`
                      : ""}
                  </p>
                  {sticker.status === "actif" ? (
                    <button
                      type="button"
                      onClick={() => remove(sticker)}
                      aria-label={`Retirer ${sticker.name}`}
                      className="mt-1 flex min-h-11 items-center gap-1 text-xs text-chalk-3 hover:text-danger"
                    >
                      <SectionIcon name="trash" size={14} /> Retirer
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
