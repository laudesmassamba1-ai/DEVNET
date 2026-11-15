"use client";

/**
 * Éditeur de statut, en un seul écran : média, GIF ou fond ; texte, dessin et
 * stickers en calques ; filtre, cadrage ; annulation. L'aperçu et l'export lisent
 * les mêmes calques dans le même repère (1080 × 1920).
 *
 * Une vidéo et un GIF partent sans retouche : le dessin, les stickers et les
 * filtres y sont désactivés, avec la raison affichée.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { GifPicker } from "@/components/GifPicker";
import { Icon } from "@/components/Icon";
import { StatusComposerStage } from "@/components/StatusComposerStage";
import { StatusComposerContext, StatusComposerFooter } from "@/components/StatusComposerTools";
import { renderStageBlob } from "@/lib/status-export";
import {
  BACKGROUND_VARS,
  FILTERS,
  ZOOMS,
  canRedo,
  canUndo,
  clampPct,
  hasContent,
  textOf,
} from "@/lib/status-editor-model";
import { useStatusComposer } from "@/lib/use-status-composer";
import type { Gif } from "@/lib/gifs";
import type { StoryAudience } from "@/lib/types";

type ComposerProps = {
  open: boolean;
  onClose: () => void;
  /** Média déjà joint (reprise d'un brouillon). */
  initialMedia?: { url: string; kind: "image" | "video"; name?: string } | null;
  /** Fichier choisi avant l'ouverture. */
  sourceFile?: File | null;
  onUse: (file: File, audience: StoryAudience) => void | Promise<void>;
  onUseSource?: (file: File, audience: StoryAudience) => void | Promise<void>;
  /** GIF choisi : il part en lien, animé, sans passer par le canvas. */
  onUseGif?: (gif: Gif, audience: StoryAudience) => void | Promise<void>;
  onLayersChange?: (text: string) => void;
};

/**
 * Remonté à chaque ouverture avec un média neuf : l'état initial se calcule
 * au rendu, sans effet de remise à zéro.
 */
export function StatusComposer(props: ComposerProps) {
  if (!props.open) return null;
  const seed = props.sourceFile
    ? `${props.sourceFile.name}:${props.sourceFile.size}:${props.sourceFile.lastModified}`
    : (props.initialMedia?.url ?? "neuf");
  return <EditorShell key={seed} {...props} />;
}

async function fileFromUrl(url: string, name: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("media");
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type });
}

function EditorShell({
  onClose,
  initialMedia = null,
  sourceFile = null,
  onUse,
  onUseSource,
  onUseGif,
  onLayersChange,
}: ComposerProps) {
  const state = useStatusComposer({ sourceFile, initialMedia });
  const {
    snapshot, source, gif, error, setError, selectedId, setSelectedId, selected,
    selectedText, editingId, setEditingId, drawing, setDrawing, stickersOpen,
    setStickersOpen, penColor, setPenColor, penWidth, setPenWidth, audience,
    setAudience, history, apply, pickGif, removeMedia, replaceSource, endGesture,
  } = state;
  const { layers, filter, background, zoom } = snapshot;

  const [busy, setBusy] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [stageWidth, setStageWidth] = useState(360);
  const mediaInput = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const strokeRef = useRef<string | null>(null);

  const isVideo = source?.kind === "video";
  const isPhoto = source?.kind === "image";
  const mediaReason = isVideo
    ? "Une vidéo part sans retouche : pas de dessin, de sticker ni de filtre."
    : gif
      ? "Un GIF part animé, sans retouche."
      : undefined;

  useEffect(() => {
    onLayersChange?.(textOf(layers));
  }, [layers, onLayersChange]);

  useEffect(() => {
    if (!editingId) return;
    const frame = requestAnimationFrame(() => textRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editingId]);

  // La taille du texte suit la largeur réelle de la scène.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStageWidth(entry.contentRect.width);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function pointIn(event: { clientX: number; clientY: number }) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clampPct(((event.clientX - rect.left) / rect.width) * 100),
      y: clampPct(((event.clientY - rect.top) / rect.height) * 100),
    };
  }

  function onStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // Un appui dans le champ de texte est une saisie, pas un geste de scène.
    if ((event.target as HTMLElement).closest("textarea")) return;
    const point = pointIn(event);
    if (!point) return;

    if (drawing) {
      strokeRef.current = state.startStroke([point.x, point.y]);
      stageRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    const id = (event.target as HTMLElement).closest<HTMLElement>("[data-layer-id]")?.dataset.layerId;
    const layer = id ? layers.find((item) => item.id === id) : undefined;
    if (id && layer && layer.kind !== "stroke") {
      dragRef.current = { id, dx: layer.x - point.x, dy: layer.y - point.y, moved: false };
      setSelectedId(id);
      stageRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    // Un appui dans le vide désélectionne et referme les panneaux.
    setSelectedId(null);
    setEditingId(null);
    setStickersOpen(false);
  }

  function onStagePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const point = pointIn(event);
    if (!point) return;
    if (strokeRef.current) {
      state.extendStroke(strokeRef.current, [point.x, point.y]);
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    drag.moved = true;
    state.dragTo(drag.id, point.x + drag.dx, point.y + drag.dy);
  }

  function onStagePointerUp() {
    if (strokeRef.current) {
      strokeRef.current = null;
      endGesture();
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.moved) {
      endGesture();
      return;
    }
    // Un appui sans déplacement sur un texte ouvre sa saisie.
    const layer = layers.find((item) => item.id === drag.id);
    if (layer?.kind === "text") setEditingId(layer.id);
  }

  async function run(task: () => Promise<void>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await task();
      onClose();
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  function publish() {
    if (busy) return;
    if (gif) {
      // Un GIF part en lien : le réencoder figerait l'animation.
      if (!onUseGif) return setError("Les GIF ne sont pas disponibles ici.");
      return run(async () => {
        await onUseGif(gif, audience);
      }, "La publication du GIF a échoué. Réessaie.");
    }
    if (!source && !hasContent(layers)) return setError("Ajoute un texte, une photo ou un GIF.");
    if (source?.kind === "video") {
      // Une vidéo part intacte : la réencoder détruirait sa durée.
      return run(async () => {
        const file = source.file ?? (await fileFromUrl(source.url, "statut.mp4"));
        await (onUseSource ?? onUse)(file, audience);
      }, "La publication de la vidéo a échoué. Réessaie.");
    }
    return run(async () => {
      const blob = await renderStageBlob({
        imageUrl: source?.url ?? null,
        background,
        filter,
        zoom,
        layers,
      });
      if (!blob) throw new Error("render");
      const file = new File([blob], `statut-${Date.now()}.webp`, { type: "image/webp" });
      await onUse(file, audience);
    }, "La publication a échoué. Réessaie.");
  }

  const backgroundCss = source || gif
    ? "var(--color-void)"
    : `linear-gradient(160deg, var(${BACKGROUND_VARS[background][0]}), var(${BACKGROUND_VARS[background][1]}))`;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Éditeur de statut"
      className="fixed inset-0 z-(--z-modal) flex flex-col bg-void text-chalk"
      style={{ paddingTop: "var(--h-safe-top)", paddingBottom: "var(--h-safe-bottom)" }}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line-2 bg-surface/95 px-3 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-(--h-tap) items-center gap-2 rounded-(--radius-chip) px-2 text-sm font-medium text-chalk-3 transition-colors hover:bg-surface-2 hover:text-chalk"
        >
          <Icon name="close" size={18} />
          Fermer
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Annuler"
            title="Annuler"
            disabled={!canUndo(history)}
            onClick={state.undo}
            className="inline-flex size-(--h-tap) items-center justify-center rounded-(--radius-chip) text-chalk-3 hover:text-chalk disabled:opacity-35"
          >
            <Icon name="undo" size={18} />
          </button>
          <button
            type="button"
            aria-label="Rétablir"
            title="Rétablir"
            disabled={!canRedo(history)}
            onClick={state.redo}
            className="inline-flex size-(--h-tap) items-center justify-center rounded-(--radius-chip) text-chalk-3 hover:text-chalk disabled:opacity-35"
          >
            <Icon name="redo" size={18} />
          </button>
        </div>
        <button
          type="button"
          onClick={publish}
          disabled={busy}
          className="inline-flex min-h-(--h-tap) items-center justify-center rounded-(--radius-chip) bg-signal px-4 text-sm font-semibold text-void transition-opacity disabled:opacity-50"
        >
          {busy ? "Envoi…" : "Publier"}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center bg-page px-3 py-3">
        <StatusComposerStage
          stageRef={stageRef}
          textRef={textRef}
          layers={layers}
          filter={filter}
          zoom={zoom}
          backgroundCss={backgroundCss}
          imageUrl={isPhoto ? source.url : null}
          videoUrl={isVideo ? source.url : null}
          gifUrl={gif?.url ?? null}
          gifAlt={gif?.alt ?? ""}
          stageWidth={stageWidth}
          interactive
          drawing={drawing}
          selectedId={selectedId}
          editingId={editingId}
          onTextChange={state.typeText}
          onTextDone={state.finishText}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={onStagePointerUp}
        />
      </div>

      {error ? (
        <p role="alert" className="px-4 pb-1 text-center text-sm text-danger">
          {error}
        </p>
      ) : null}

      <StatusComposerContext
        tool={drawing ? "draw" : "move"}
        onStopDrawing={() => setDrawing(false)}
        penColor={penColor}
        onPenColor={setPenColor}
        penWidth={penWidth}
        onPenWidth={setPenWidth}
        selectedText={selectedText}
        onPatchText={state.patchSelectedText}
        hasSelection={Boolean(selected)}
        onRemoveSelected={state.removeSelected}
        stickersOpen={stickersOpen}
        onSticker={state.addSticker}
      />

      <StatusComposerFooter
        audience={audience}
        onAudience={setAudience}
        mediaReason={mediaReason}
        isPhoto={isPhoto}
        hasGif={Boolean(gif)}
        hasSource={Boolean(source)}
        filter={filter}
        zoom={zoom}
        background={background}
        drawing={drawing}
        stickersOpen={stickersOpen}
        onMedia={() => mediaInput.current?.click()}
        onGif={() => setGifOpen(true)}
        onRemoveMedia={removeMedia}
        onText={state.addText}
        onDraw={() => {
          setStickersOpen(false);
          setSelectedId(null);
          setDrawing((on) => !on);
        }}
        onSticker={() => {
          setDrawing(false);
          setStickersOpen((open) => !open);
        }}
        onBackground={() => apply((s) => ({ ...s, background: (s.background + 1) % BACKGROUND_VARS.length }))}
        onFilter={() => apply((s) => ({ ...s, filter: (s.filter + 1) % FILTERS.length }))}
        onZoom={() => apply((s) => ({ ...s, zoom: (s.zoom + 1) % ZOOMS.length }))}
      />

      <input
        ref={mediaInput}
        type="file"
        accept="image/*,video/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Joindre un média au statut"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) replaceSource(file);
        }}
      />
      {gifOpen ? (
        <GifPicker
          open
          onClose={() => setGifOpen(false)}
          onPick={(picked) => {
            pickGif(picked);
            setGifOpen(false);
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}
