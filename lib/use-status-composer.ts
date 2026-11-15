"use client";

/**
 * État de l'éditeur de statut : historique, calques, outils, média. Ne touche
 * pas au DOM : le pointeur et l'export sont dans `components/StatusComposer`.
 * Toute action complète passe par `apply` (une étape d'annulation) ; un geste
 * en cours par `applyLive`, clos ensuite par `endGesture`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PEN_COLORS,
  addStickerLayer,
  addStrokeLayer,
  addTextLayer,
  appendStrokePoint,
  commit,
  createHistory,
  live,
  moveLayer,
  redo,
  removeLayer,
  undo,
  updateLayer,
  type History,
  type Layer,
  type Snapshot,
  type TextLayer,
} from "@/lib/status-editor-model";
import type { Gif } from "@/lib/gifs";
import type { StoryAudience } from "@/lib/types";

export type Source = { url: string; kind: "image" | "video"; file: File | null };

export function sourceFromFile(file: File): Source {
  return {
    url: URL.createObjectURL(file),
    kind: file.type.startsWith("video/") ? "video" : "image",
    file,
  };
}

export function useStatusComposer(options: {
  sourceFile: File | null;
  initialMedia: { url: string; kind: "image" | "video" } | null;
}) {
  const [history, setHistory] = useState<History>(() => createHistory());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [penColor, setPenColor] = useState<number>(PEN_COLORS[0]);
  const [penWidth, setPenWidth] = useState(1);
  const [audience, setAudience] = useState<StoryAudience>("public");
  const [gif, setGif] = useState<Gif | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(() => {
    if (options.sourceFile) return sourceFromFile(options.sourceFile);
    if (options.initialMedia) return { ...options.initialMedia, file: null };
    return null;
  });

  // L'URL créée localement est révoquée à la fermeture, pas à chaque rendu.
  const ownedUrl = useRef<string | null>(source?.file ? source.url : null);
  useEffect(() => {
    return () => {
      if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    };
  }, []);

  const snapshot = history.present;
  const selected = snapshot.layers.find((layer) => layer.id === selectedId) ?? null;
  const selectedText: TextLayer | null = selected?.kind === "text" ? selected : null;

  const apply = useCallback((change: (s: Snapshot) => Snapshot) => {
    setHistory((h) => commit(h, change(h.present)));
  }, []);

  const applyLive = useCallback((change: (s: Snapshot) => Snapshot) => {
    setHistory((h) => live(h, change(h.present)));
  }, []);

  /** Clôt un geste : une étape seulement s'il a commencé (`base` posé). */
  const endGesture = useCallback(() => {
    setHistory((h) => (h.base ? commit(h, h.present) : h));
  }, []);

  function setLayers(layers: Layer[]) {
    apply((s) => ({ ...s, layers }));
  }

  function addText() {
    const { layers, id } = addTextLayer(snapshot.layers);
    setLayers(layers);
    setSelectedId(id);
    setEditingId(id);
    setStickersOpen(false);
  }

  function addSticker(glyph: string) {
    const { layers, id } = addStickerLayer(snapshot.layers, glyph);
    setLayers(layers);
    setSelectedId(id);
    setStickersOpen(false);
  }

  function removeSelected() {
    if (!selectedId) return;
    setLayers(removeLayer(snapshot.layers, selectedId));
    setSelectedId(null);
    setEditingId(null);
  }

  function patchSelectedText(patch: Partial<TextLayer>) {
    if (!selectedText) return;
    setLayers(updateLayer(snapshot.layers, selectedText.id, patch));
  }

  /** Démarre un tracé : `apply` ne sert pas, le geste est clos au relâchement. */
  function startStroke(point: [number, number]): string {
    const { layers, id } = addStrokeLayer(snapshot.layers, point, penColor, penWidth);
    setSelectedId(null);
    setEditingId(null);
    applyLive((s) => ({ ...s, layers }));
    return id;
  }

  function extendStroke(id: string, point: [number, number]) {
    applyLive((s) => ({ ...s, layers: appendStrokePoint(s.layers, id, point) }));
  }

  function dragTo(id: string, x: number, y: number) {
    applyLive((s) => ({ ...s, layers: moveLayer(s.layers, id, x, y) }));
  }

  /** Saisie d'un texte : en direct, puis une étape à la fin. */
  function typeText(id: string, value: string) {
    applyLive((s) => ({ ...s, layers: updateLayer(s.layers, id, { text: value }) }));
  }

  /** Fin de saisie : un texte resté vide disparaît. */
  function finishText(id: string) {
    setEditingId(null);
    setSelectedId((current) => (current === id ? null : current));
    setHistory((h) => {
      const layer = h.present.layers.find((item) => item.id === id);
      if (layer?.kind === "text" && !layer.text.trim()) {
        const cleaned = { ...h.present, layers: removeLayer(h.present.layers, id) };
        return h.base ? commit(h, cleaned) : { ...h, present: cleaned };
      }
      return h.base ? commit(h, h.present) : h;
    });
  }

  /** Remplace le média : le fond et les calques restent, le GIF est retiré. */
  function replaceSource(file: File) {
    const next = sourceFromFile(file);
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    ownedUrl.current = next.url;
    setSource(next);
    setGif(null);
    setError(null);
    if (next.kind === "video") {
      setDrawing(false);
      setStickersOpen(false);
      // Une vidéo part intacte : rien n'est dessiné dessus. Les calques
      // posés avant elle (texte, sticker, tracé) restaient dans l'aperçu
      // mais n'atteignaient jamais le fichier publié — on voyait un texte
      // qui n'existait pas. On les retire, et l'aperçu redevient vrai.
      setSelectedId(null);
      setEditingId(null);
      setLayers([]);
    }
  }

  /** Un GIF remplace la photo : il part animé, en lien. */
  function pickGif(next: Gif) {
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    ownedUrl.current = null;
    setSource(null);
    setGif(next);
    setDrawing(false);
    setStickersOpen(false);
    // Même raison que pour la vidéo : un GIF part en lien, sans retouche.
    setSelectedId(null);
    setEditingId(null);
    setLayers([]);
  }

  function removeMedia() {
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    ownedUrl.current = null;
    setSource(null);
    setGif(null);
  }

  return {
    apply, pickGif, removeMedia,
    history, setHistory, snapshot, source, gif, setGif, error, setError,
    selectedId, setSelectedId, selected, selectedText, editingId, setEditingId,
    drawing, setDrawing, stickersOpen, setStickersOpen, penColor, setPenColor,
    penWidth, setPenWidth, audience, setAudience,
    addText, addSticker, removeSelected, patchSelectedText,
    startStroke, extendStroke, dragTo, typeText, finishText, endGesture,
    replaceSource,
    undo: () => setHistory((h) => undo(h)),
    redo: () => setHistory((h) => redo(h)),
  };
}
