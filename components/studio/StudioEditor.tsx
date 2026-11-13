"use client";

/** atelier — éditeur de calques pour les statuts, images et vidéos. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, asIconName } from "@/components/Icon";
import { StudioInspector } from "@/components/studio/StudioInspector";
import { StudioLayerView } from "@/components/studio/StudioLayerView";
import {
  canvasToBlob,
  createBezier,
  createMedia,
  createShape,
  createText,
  INK_TOKENS,
  RATIOS,
  renderToCanvas,
  snapshot,
  SURFACE_TOKENS,
  type Layer,
  type RatioId,
} from "@/lib/studio/editor";

const MAX_HISTORY = 50;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export type StudioMediaSource = {
  url: string;
  kind: "image" | "video";
  name?: string;
};

const STICKERS = [
  { src: "/stickers/etoile.svg", label: "Étoile" },
  { src: "/stickers/eclair.svg", label: "Éclair" },
  { src: "/stickers/etincelle.svg", label: "Étincelle" },
  { src: "/stickers/coeur.svg", label: "Cœur" },
  { src: "/stickers/check.svg", label: "Validation" },
  { src: "/stickers/fleche.svg", label: "Flèche" },
];

const TOOLS = [
  { id: "text", label: "Texte", icon: "type" },
  { id: "image", label: "Image", icon: "image" },
  { id: "video", label: "Vidéo", icon: "video" },
  { id: "shapes", label: "Formes", icon: "square" },
  { id: "bezier", label: "Courbes", icon: "link" },
  { id: "stickers", label: "Stickers", icon: "sticker" },
] as const;

function textOf(layers: Layer[]): string {
  return layers
    .filter((layer) => layer.type === "text")
    .map((layer) => layer.text)
    .join("\n")
    .trim();
}

export function StudioEditor({
  open,
  onClose,
  onUse,
  onUseSource,
  sourceFile = null,
  owner,
  onLayersChange,
  initialMedia = null,
}: {
  open: boolean;
  onClose: () => void;
  onUse: (file: File) => void;
  /** Fichier importé avant l'ouverture : permet d'envoyer la vidéo d'origine. */
  sourceFile?: File | null;
  /** Envoie le fichier d'origine au lieu de l'export image. */
  onUseSource?: (file: File) => void;
  owner: string;
  onLayersChange?: (text: string) => void;
  /** Média déjà joint au brouillon, chargé comme calque de fond. */
  initialMedia?: StudioMediaSource | null;
}) {
  const [monte, setMonte] = useState(false);
  const [ratio, setRatio] = useState<RatioId>("story");
  const [background, setBackground] = useState<string>("--color-void");
  const [foreground, setForeground] = useState<string>("--color-chalk");
  const [layers, setLayers] = useState<Layer[]>(() => [
    createText({ text: "Votre statut" }),
  ]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [past, setPast] = useState<Layer[][]>([]);
  const [future, setFuture] = useState<Layer[][]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const videosRef = useRef(new Map<string, HTMLVideoElement>());
  const loadedSource = useRef<string | null>(null);

  const dimensions = RATIOS[ratio];
  const selected = useMemo(
    () => layers.find((layer) => layer.id === selectedId) ?? null,
    [layers, selectedId],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portail disponible après hydratation
    setMonte(true);
  }, []);

  // Le portail est posé sur `document.body` : la feuille « Nouveau post »
  // est transformée et défile, donc un `position: fixed` enfant resterait
  // encastré et tronqué. L'atelier doit couvrir la fenêtre, pas la feuille.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  // Le média choisi dans le composeur devient le fond de l'atelier. On ne
  // l'ajoute qu'une fois par URL : rouvrir l'atelier ne doit pas empiler
  // des copies du même calque ni perdre les réglages déjà faits.
  useEffect(() => {
    if (!open || !initialMedia) return;
    if (loadedSource.current === initialMedia.url) return;
    loadedSource.current = initialMedia.url;
    const media = createMedia(initialMedia.kind, initialMedia.url, {
      name: initialMedia.name ?? (initialMedia.kind === "video" ? "Vidéo" : "Image"),
    });
    setLayers((current) => [media, ...current.filter((layer) => layer.type !== initialMedia.kind)]);
    setSelectedId(media.id);
  }, [open, initialMedia]);

  const replace = useCallback(
    (next: Layer[], remember = true) => {
      setLayers((current) => {
        if (remember) {
          setPast((history) =>
            [...history, snapshot(current)].slice(-MAX_HISTORY),
          );
          setFuture([]);
        }
        return next;
      });
      onLayersChange?.(textOf(next));
    },
    [onLayersChange],
  );

  const undo = useCallback(() => {
    setPast((history) => {
      if (!history.length) return history;
      const previous = history[history.length - 1];
      setFuture((forward) =>
        [snapshot(layers), ...forward].slice(0, MAX_HISTORY),
      );
      setLayers(previous);
      onLayersChange?.(textOf(previous));
      return history.slice(0, -1);
    });
  }, [layers, onLayersChange]);

  const redo = useCallback(() => {
    setFuture((forward) => {
      if (!forward.length) return forward;
      const next = forward[0];
      setPast((history) => [...history, snapshot(layers)].slice(-MAX_HISTORY));
      setLayers(next);
      onLayersChange?.(textOf(next));
      return forward.slice(1);
    });
  }, [layers, onLayersChange]);

  const patch = useCallback(
    (id: string, next: Partial<Layer>) => {
      const updated = layers.map((layer) =>
        layer.id === id ? ({ ...layer, ...next } as Layer) : layer,
      );
      replace(updated, false);
    },
    [layers, replace],
  );

  function addTool(id: (typeof TOOLS)[number]["id"]) {
    if (id === "text")
      replace([...layers, createText({ color: `var(${foreground})` })]);
    if (id === "shapes")
      replace([...layers, createShape("rect", { fill: `var(${foreground})` })]);
    if (id === "bezier") replace([...layers, createBezier()]);
    if (id === "stickers")
      replace([...layers, createMedia("sticker", STICKERS[0].src, { name: STICKERS[0].label })]);
    if (id === "image") imageInput.current?.click();
    if (id === "video") videoInput.current?.click();
  }

  function chooseFile(file: File | undefined, kind: "image" | "video") {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("Fichier trop lourd : 4 Mo maximum.");
      return;
    }
    const url = URL.createObjectURL(file);
    replace([
      ...layers,
      createMedia(kind, url, { name: file.name, fit: "cover" }),
    ]);
  }

  async function exportImage(type: "image/png" | "image/jpeg") {
    setBusy(true);
    setError(null);
    try {
      const canvas = await renderToCanvas(layers, {
        width: dimensions.w,
        height: dimensions.h,
        background: `var(${background})`,
        videos: videosRef.current,
      });
      const blob = await canvasToBlob(canvas, type);
      const extension = type === "image/png" ? "png" : "jpg";
      onUse(new File([blob], `atelier.${extension}`, { type }));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (!open || !monte || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex flex-col bg-page text-chalk"
      role="dialog"
      aria-modal="true"
      aria-label="Atelier"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line-2 px-3 py-2">
        <h2 className="font-display text-base font-bold">Atelier</h2>
        <span className="font-mono text-xs text-chalk-4">@{owner}</span>
        <label className="ml-auto flex items-center gap-1 text-xs text-chalk-3">
          Format
          <select
            value={ratio}
            onChange={(event) => setRatio(event.target.value as RatioId)}
            className="rounded-md border border-line-2 bg-surface-2 px-2 py-1 text-chalk"
          >
            {Object.entries(RATIOS).map(([id, item]) => (
              <option key={id} value={id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-chalk-3">
          Fond
          <select
            value={background}
            onChange={(event) => setBackground(event.target.value)}
            className="rounded-md border border-line-2 bg-surface-2 px-2 py-1 text-chalk"
          >
            {SURFACE_TOKENS.map((token) => (
              <option key={token} value={token}>
                {token.replace("--color-", "")}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer l'atelier"
          className="mo-press rounded-full p-2 text-chalk-3 hover:text-chalk"
        >
          <Icon name="close" size={16} strokeWidth={2} />
        </button>
      </header>

      <nav
        aria-label="Outils de l'atelier"
        className="flex gap-1 overflow-x-auto border-b border-line-2 px-2 py-2 lg:w-16 lg:flex-col lg:border-b-0 lg:border-r"
      >
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={() => addTool(tool.id)}
            className="flex min-w-12 flex-col items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-chalk-3 hover:bg-surface-2 hover:text-chalk"
          >
            <Icon name={asIconName(tool.icon, "plus")} size={16} />
            {tool.label}
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-surface p-3 lg:flex-row">
        <div
          className="relative max-h-full max-w-full overflow-hidden rounded-[var(--radius-card)] border border-line-2"
          style={{
            aspectRatio: `${dimensions.w} / ${dimensions.h}`,
            background: `var(${background})`,
            width: "min(100%, 520px)",
          }}
        >
          {layers.map((layer) => (
            <StudioLayerView
              key={layer.id}
              layer={layer}
              selected={layer.id === selectedId}
              parentWidth={dimensions.w}
              onSelect={() => setSelectedId(layer.id)}
              onDragStart={() => setSelectedId(layer.id)}
              registerVideo={(element) => {
                if (element)
                  videosRef.current.set(
                    layer.type === "video" ? layer.src : layer.id,
                    element,
                  );
                else videosRef.current.delete(layer.id);
              }}
            />
          ))}
        </div>

        <div className="flex w-80 flex-col overflow-y-auto p-4">
          {selected ? (
            <StudioInspector
              layer={selected}
              onChange={(next) => patch(selected.id, next)}
            />
          ) : (
            <p className="text-sm text-chalk-3">
              Sélectionne un calque pour le modifier.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line-2/70 p-3 glass-strong">
        <button
          type="button"
          onClick={undo}
          disabled={!past.length}
          className="mo-press rounded-md bg-surface px-3 py-2 text-chalk-3 disabled:opacity-40"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!future.length}
          className="mo-press rounded-md bg-surface px-3 py-2 text-chalk-3 disabled:opacity-40"
        >
          Rétablir
        </button>
        <label className="flex items-center gap-1 text-xs text-chalk-3">
          Encre
          <select
            value={foreground}
            onChange={(event) => setForeground(event.target.value)}
            className="rounded-md border border-line-2 bg-surface-2 px-2 py-1 text-chalk"
          >
            {INK_TOKENS.map((token) => (
              <option key={token} value={token}>
                {token.replace("--color-", "")}
              </option>
            ))}
          </select>
        </label>
        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          aria-label="Choisir une image"
          className="sr-only"
          onChange={(event) => {
            chooseFile(event.target.files?.[0], "image");
            event.target.value = "";
          }}
        />
        <input
          ref={videoInput}
          type="file"
          accept="video/*"
          aria-label="Choisir une vidéo"
          className="sr-only"
          onChange={(event) => {
            chooseFile(event.target.files?.[0], "video");
            event.target.value = "";
          }}
        />
        {error && (
          <span role="alert" className="text-xs text-danger">
            {error}
          </span>
        )}
        {sourceFile?.type.startsWith("video/") && onUseSource && (
          <button
            type="button"
            onClick={() => {
              onUseSource(sourceFile);
              onClose();
            }}
            disabled={busy}
            className="mo-press flex items-center gap-1.5 rounded-md border border-line-2 px-3 py-2 text-xs font-semibold text-chalk-2 hover:border-signal hover:text-signal disabled:opacity-40"
          >
            <Icon name="video" size={14} />
            Vidéo d&apos;origine
          </button>
        )}
        <button
          type="button"
          onClick={() => exportImage("image/png")}
          disabled={busy}
          className="ml-auto mo-press rounded-md bg-signal px-4 py-2 font-bold text-void disabled:opacity-40"
        >
          {busy ? "Export…" : "PNG"}
        </button>
        <button
          type="button"
          onClick={() => exportImage("image/jpeg")}
          disabled={busy}
          className="mo-press rounded-md bg-signal px-4 py-2 font-bold text-void disabled:opacity-40"
        >
          JPEG
        </button>
      </div>
    </div>,
    document.body,
  );
}
