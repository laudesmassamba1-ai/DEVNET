"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { useSession } from "@/hooks/useSession";
import { useToast } from "@/components/Toast";
import {
  createImageSticker,
  createTextSticker,
  fetchStickers,
  retireSticker,
  stickerAssetUrl,
  type StickerRowView,
} from "@/lib/stickers";
import { STICKER_COLOR_TOKENS, type StickerColorToken } from "@/modules/stickers";

/**
 * Studio de stickers.
 *
 * Deux matières, un même contrat : ce que l'on crée est **re-encodé par le
 * serveur** avant d'exister. Un glyphe est borné, ses couleurs sont des jetons
 * du thème ; une image est redimensionnée, convertie en WebP, dépouillée de ses
 * métadonnées et refusée au-delà de 60 Ko. Rien de ce que le navigateur envoie
 * n'est publié tel quel.
 *
 * Privé par défaut : un sticker personnel n'a aucune raison d'être visible par
 * le réseau avant que son auteur ne le décide.
 */

const GLYPH_SUGGESTIONS = ["🚀", "🔥", "💡", "✅", "🐛", "🧠", "⚡", "🎯", "📦", "🌍", "🛠️", "☕"];
const VISIBILITY_LABEL: Record<"prive" | "public", string> = {
  prive: "Visible par moi seul",
  public: "Visible par le réseau",
};

function StickerPreview({
  glyph,
  fg,
  bg,
  imageUrl,
  size = 72,
}: {
  glyph: string;
  fg: string;
  bg: string;
  imageUrl?: string;
  size?: number;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        className="rounded-[26%] object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-[26%]"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        backgroundColor: fg && bg ? `var(--color-${bg})` : "transparent",
        color: fg ? `var(--color-${fg})` : "inherit",
      }}
    >
      {glyph}
    </span>
  );
}

export default function StickerStudioPage() {
  const { profile } = useSession();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<StickerRowView[] | null>(null);
  const [mode, setMode] = useState<"texte" | "image">("texte");
  const [name, setName] = useState("");
  const [glyph, setGlyph] = useState("🚀");
  const [fg, setFg] = useState<StickerColorToken>("chalk");
  const [bg, setBg] = useState<StickerColorToken>("signal");
  const [visibility, setVisibility] = useState<"prive" | "public">("prive");
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setRows(await fetchStickers());
  }

  useEffect(() => {
    let alive = true;
    fetchStickers().then((next) => {
      if (alive) setRows(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function submit() {
    if (busy) return;
    const clean = name.trim();
    if (!clean) {
      toast("Donne un nom à ton sticker", "err");
      return;
    }

    setBusy(true);
    try {
      const result =
        mode === "texte"
          ? await createTextSticker({ name: clean, glyph, fg, bg, visibility })
          : dataUrl
            ? await createImageSticker({ name: clean, dataUrl, visibility })
            : null;

      if (!result) {
        toast("Choisis une image", "err");
        return;
      }
      if (!result.ok) {
        toast(result.error, "err");
        return;
      }

      toast(mode === "image" ? "Image re-encodée et enregistrée" : "Sticker créé");
      setName("");
      setDataUrl(null);
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

  function readFile(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast("PNG, JPEG ou WebP attendu", "err");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast("Image trop lourde (2 Mo maximum)", "err");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setDataUrl(reader.result);
    };
    reader.onerror = () => toast("Lecture du fichier impossible", "err");
    reader.readAsDataURL(file);
  }

  const mine = rows?.filter((row) => row.mine) ?? [];
  const catalogue = rows?.filter((row) => !row.mine) ?? [];

  return (
    <AppShell path="~/stickers">
      <header className="mb-6">
        <p className="label-micro text-chalk-3">Studio</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk">Tes stickers</h1>
        <p className="mt-2 max-w-prose text-sm text-chalk-2">
          Un signe sur une couleur, ou une image que le serveur re-encode. Les
          stickers personnels sont privés tant que tu ne les partages pas, et tu
          peux les retirer à tout moment.
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

          <div
            role="tablist"
            aria-label="Matière du sticker"
            className="mt-3 flex gap-1 rounded-[var(--radius-chip)] border border-line-2 p-1"
          >
            {(["texte", "image"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={`min-h-11 flex-1 rounded-[var(--radius-chip)] label-micro ${
                  mode === value ? "bg-signal text-void" : "text-chalk-2"
                }`}
              >
                {value === "texte" ? "Signe" : "Image"}
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-4">
            <StickerPreview
              glyph={glyph}
              fg={mode === "texte" ? fg : ""}
              bg={mode === "texte" ? bg : ""}
              imageUrl={mode === "image" && dataUrl ? dataUrl : undefined}
            />
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

          {mode === "texte" ? (
            <>
              <label htmlFor="sticker-glyph" className="mt-4 block label-micro text-chalk-3">
                Signe
              </label>
              <input
                id="sticker-glyph"
                value={glyph}
                onChange={(event) => setGlyph(event.target.value.slice(0, 8))}
                maxLength={8}
                className="mt-1 min-h-11 w-24 rounded-[var(--radius-chip)] border border-line-2 bg-void px-3 text-center text-xl text-chalk"
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {GLYPH_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    aria-label={`Choisir ${suggestion}`}
                    onClick={() => setGlyph(suggestion)}
                    className="flex size-11 items-center justify-center rounded-[var(--radius-chip)] text-xl hover:bg-surface-2"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>

              <fieldset className="mt-4">
                <legend className="label-micro text-chalk-3">Couleur du signe</legend>
                <div className="mt-1 flex flex-wrap gap-1">
                  {STICKER_COLOR_TOKENS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      aria-label={`Signe ${token}`}
                      aria-pressed={fg === token}
                      onClick={() => setFg(token)}
                      className={`size-11 rounded-full border-2 ${
                        fg === token ? "border-chalk" : "border-transparent"
                      }`}
                      style={{ backgroundColor: `var(--color-${token})` }}
                    />
                  ))}
                </div>
              </fieldset>

              <fieldset className="mt-4">
                <legend className="label-micro text-chalk-3">Fond</legend>
                <div className="mt-1 flex flex-wrap gap-1">
                  {STICKER_COLOR_TOKENS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      aria-label={`Fond ${token}`}
                      aria-pressed={bg === token}
                      onClick={() => setBg(token)}
                      className={`size-11 rounded-full border-2 ${
                        bg === token ? "border-chalk" : "border-transparent"
                      }`}
                      style={{ backgroundColor: `var(--color-${token})` }}
                    />
                  ))}
                </div>
              </fieldset>
            </>
          ) : (
            <div className="mt-4">
              <label htmlFor="sticker-file" className="label-micro text-chalk-3">
                Image — PNG, JPEG ou WebP, 2 Mo maximum
              </label>
              <input
                id="sticker-file"
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => readFile(event.target.files?.[0])}
                className="mt-1 block w-full text-sm text-chalk-2 file:mr-3 file:min-h-11
                  file:rounded-[var(--radius-chip)] file:border-0 file:bg-surface-2
                  file:px-4 file:label-micro file:text-chalk"
              />
              <p className="mt-2 text-xs text-chalk-3">
                Le serveur la borne à 512 px, la convertit en WebP et retire ses
                métadonnées. Le fichier d’origine n’est jamais publié.
              </p>
            </div>
          )}

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
                  {VISIBILITY_LABEL[value]}
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
              Aucun sticker personnel. Le premier est à droite.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {mine.map((sticker) => (
                <li
                  key={sticker.id}
                  className="rounded-[var(--radius-card)] border border-line-2 bg-surface p-2"
                >
                  <div className="flex aspect-square items-center justify-center">
                    <StickerPreview
                      glyph={sticker.glyph}
                      fg={sticker.fg}
                      bg={sticker.bg}
                      imageUrl={
                        sticker.kind === "image" ? stickerAssetUrl(sticker.id) : undefined
                      }
                      size={64}
                    />
                  </div>
                  <p className="mt-1 truncate text-xs text-chalk" title={sticker.name}>
                    {sticker.name}
                  </p>
                  <p className="text-[11px] text-chalk-3">
                    {sticker.status === "retire"
                      ? "retiré"
                      : sticker.visibility === "public"
                        ? "public"
                        : "privé"}
                    {sticker.kind === "image" && sticker.byteSize > 0
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
                      <Icon name="trash" size={14} /> Retirer
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-6 mb-2 label-micro text-chalk-3">Catalogue du réseau</h2>
          {catalogue.length === 0 ? (
            <p className="text-sm text-chalk-3">Aucun sticker public pour l’instant.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {catalogue.slice(0, 24).map((sticker) => (
                <li key={sticker.id} title={sticker.name}>
                  <StickerPreview
                    glyph={sticker.glyph}
                    fg={sticker.fg}
                    bg={sticker.bg}
                    imageUrl={sticker.kind === "image" ? stickerAssetUrl(sticker.id) : undefined}
                    size={44}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
