"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { uploadMedia } from "@/lib/media";

const PREVIEW = 320;
const OUTPUT = 512;

type Transform = {
  zoom: number;
  rotation: number;
  x: number;
  y: number;
};

function draw(
  context: CanvasRenderingContext2D,
  size: number,
  image: HTMLImageElement,
  transform: Transform,
) {
  const scale = size / PREVIEW;
  const cover = size / Math.min(image.width, image.height);
  context.clearRect(0, 0, size, size);
  context.save();
  context.translate(size / 2 + transform.x * scale, size / 2 + transform.y * scale);
  context.rotate((transform.rotation * Math.PI) / 180);
  context.scale(transform.zoom, transform.zoom);
  context.drawImage(
    image,
    (-image.width * cover) / 2,
    (-image.height * cover) / 2,
    image.width * cover,
    image.height * cover,
  );
  context.restore();
}

/**
 * Recadrage carré d'une photo de profil.
 *
 * L'image est toujours agrandie pour couvrir le carré (aucune bande vide),
 * puis déplacée, zoomée et tournée. L'export 512 px est réencodé par le
 * pipeline média existant avant d'être enregistré sur `users.avatar_url`.
 */
export function AvatarEditor({
  currentUrl,
  name,
  onApply,
  onCancel,
}: {
  currentUrl?: string;
  name?: string;
  onApply: (url: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [objectUrl, setObjectUrl] = useState("");
  const [transform, setTransform] = useState<Transform>({
    zoom: 1,
    rotation: 0,
    x: 0,
    y: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    draw(context, PREVIEW, image, transform);
  }, [image, transform]);

  function choose(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choisis une image (JPEG, PNG, WebP ou GIF).");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("Image trop lourde (12 Mo maximum avant compression).");
      return;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const url = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => {
      setObjectUrl(url);
      setImage(next);
      setTransform({ zoom: 1, rotation: 0, x: 0, y: 0 });
      setError("");
    };
    next.onerror = () => {
      URL.revokeObjectURL(url);
      setError("Cette image ne peut pas être lue.");
    };
    next.src = url;
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!image) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      ox: transform.x,
      oy: transform.y,
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setTransform((current) => ({
      ...current,
      x: drag.ox + event.clientX - drag.x,
      y: drag.oy + event.clientY - drag.y,
    }));
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  async function save() {
    if (!image || busy) return;
    setBusy(true);
    setError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas indisponible");
      draw(context, OUTPUT, image, transform);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", 0.9),
      );
      if (!blob) throw new Error("Export de la photo impossible");
      const file = new File([blob], "avatar.webp", { type: "image/webp" });
      const result = await uploadMedia(file);
      if (!result.ok) throw new Error(result.error);
      onApply(result.media.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[8000] flex items-center justify-center bg-void/80 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-editor-title"
        className="max-h-full w-full max-w-[430px] overflow-y-auto rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-3"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 id="avatar-editor-title" className="font-display text-[18px] font-bold">
              Photo de profil
            </h2>
            <p className="mt-0.5 text-12 text-chalk-4">
              Déplace, zoome et tourne l’image dans le carré.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fermer l’éditeur"
            className="grid size-(--h-tap) place-items-center rounded-full border border-line-2 text-chalk-3 hover:text-chalk"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="mb-3 flex items-center gap-3 rounded-(--radius-input) border border-line-2 bg-surface-2 p-3">
          <Avatar name={name} size="md" src={image ? undefined : currentUrl} />
          <label className="inline-flex min-h-(--h-tap) cursor-pointer items-center gap-2 rounded-(--radius-input) border border-line-3 px-3 text-12 font-semibold text-chalk-2 hover:border-signal hover:text-signal">
            <Icon name="image" size={14} />
            Choisir une image
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => choose(event.target.files?.[0])}
            />
          </label>
          {image && (
            <button
              type="button"
              onClick={() => {
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                setImage(null);
                setObjectUrl("");
              }}
              className="text-12 text-chalk-4 hover:text-danger"
            >
              Remplacer
            </button>
          )}
        </div>

        <div className="relative mx-auto aspect-square w-full max-w-[320px] overflow-hidden rounded-(--radius-input) border border-line-2 bg-void">
          <canvas
            ref={canvasRef}
            width={PREVIEW}
            height={PREVIEW}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="size-full touch-none cursor-grab active:cursor-grabbing"
          />
          {!image && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center">
              <p className="text-13 leading-relaxed text-chalk-3">
                Choisis une image pour la recadrer en carré.
              </p>
            </div>
          )}
        </div>

        <div className="mt-3 space-y-2.5">
          <label className="block text-12 font-semibold text-chalk-2">
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={transform.zoom}
              onChange={(event) =>
                setTransform((current) => ({ ...current, zoom: Number(event.target.value) }))
              }
              className="mt-1 w-full accent-signal"
            />
          </label>
          <label className="block text-12 font-semibold text-chalk-2">
            Rotation · {Math.round(transform.rotation)}°
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={transform.rotation}
              onChange={(event) =>
                setTransform((current) => ({ ...current, rotation: Number(event.target.value) }))
              }
              className="mt-1 w-full accent-signal"
            />
          </label>
          <button
            type="button"
            onClick={() => setTransform({ zoom: 1, rotation: 0, x: 0, y: 0 })}
            className="text-12 font-semibold text-chalk-3 hover:text-signal"
          >
            Réinitialiser le cadrage
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-3 border-l-2 border-danger pl-2.5 text-12 text-danger">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-(--h-tap) flex-1 rounded-(--radius-input) border border-line-3 text-13 font-semibold text-chalk-3"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!image || busy}
            className="min-h-(--h-tap) flex-1 rounded-(--radius-input) border border-signal bg-signal text-13 font-bold text-void disabled:opacity-40"
          >
            {busy ? "Envoi…" : "Utiliser cette photo"}
          </button>
        </div>
      </div>
    </div>
  );
}
