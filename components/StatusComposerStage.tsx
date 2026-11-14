"use client";

/**
 * Aperçu de la scène du statut. Le repère est celui de l'export : la scène
 * est un 1080 × 1920 mis à l'échelle, les tracés sont un SVG `viewBox`
 * 1080 × 1920 et les tailles sont des fractions de la largeur. Ainsi l'aperçu
 * et le fichier publié ne peuvent pas diverger.
 */
import type { PointerEventHandler, RefObject } from "react";
import {
  INK_VARS,
  STAGE_H,
  STAGE_W,
  STICKER_SCALE,
  STROKE_WIDTHS,
  TEXT_BOX_RATIO,
  TEXT_SIZES,
  ZOOMS,
  FILTERS,
  type Align,
  type Layer,
} from "@/lib/status-editor-model";

const ALIGN_CSS = ["left", "center", "right"] as const;

export type StageProps = {
  layers: Layer[];
  filter: number;
  zoom: number;
  backgroundCss: string;
  imageUrl: string | null;
  videoUrl: string | null;
  gifUrl: string | null;
  gifAlt: string;
  stageWidth: number;
  /** Les calques ne reçoivent les gestes qu'en mode déplacement. */
  interactive: boolean;
  selectedId: string | null;
  editingId: string | null;
  textRef: RefObject<HTMLTextAreaElement | null>;
  onTextChange: (id: string, value: string) => void;
  onTextDone: (id: string) => void;
  stageRef: RefObject<HTMLDivElement | null>;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  drawing: boolean;
};

export function StatusComposerStage(props: StageProps) {
  const {
    layers, filter, zoom, backgroundCss, imageUrl, videoUrl, gifUrl, gifAlt,
    stageWidth, interactive, selectedId, editingId, textRef, stageRef,
    onTextChange, onTextDone, onPointerDown, onPointerMove, onPointerUp, drawing,
  } = props;
  const strokes = layers.filter((layer) => layer.kind === "stroke");

  return (
    <div
      ref={stageRef}
      aria-label="Scène du statut"
      role="group"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`relative h-full max-h-full touch-none overflow-hidden rounded-(--radius-card) border border-line-2 shadow-sh-1 ${drawing ? "cursor-crosshair" : ""}`}
      style={{ aspectRatio: "9 / 16", background: backgroundCss }}
    >
      {gifUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={gifUrl} alt={gifAlt} draggable={false} className="absolute inset-0 h-full w-full object-contain" />
      ) : null}
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ filter: FILTERS[filter].css, transform: `scale(${ZOOMS[zoom]})` }}
        />
      ) : null}
      {videoUrl ? (
        <video src={videoUrl} className="absolute inset-0 h-full w-full object-cover" playsInline autoPlay loop muted />
      ) : null}

      <svg
        aria-hidden="true"
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      >
        {strokes.map((stroke) => {
          if (stroke.kind !== "stroke" || stroke.points.length === 0) return null;
          const width = (STROKE_WIDTHS[stroke.width] ?? STROKE_WIDTHS[1]) * STAGE_W;
          const color = `var(${INK_VARS[stroke.color] ?? INK_VARS[0]})`;
          const points = stroke.points.map(([x, y]) => `${(x / 100) * STAGE_W},${(y / 100) * STAGE_H}`);
          if (points.length === 1) {
            const [cx, cy] = points[0].split(",");
            return <circle key={stroke.id} cx={cx} cy={cy} r={width / 2} fill={color} />;
          }
          return (
            <polyline
              key={stroke.id}
              points={points.join(" ")}
              fill="none"
              stroke={color}
              strokeWidth={width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>

      {layers.map((layer) => {
        if (layer.kind === "stroke") return null;
        const active = interactive && layer.id === selectedId;
        const common = {
          "data-layer-id": layer.id,
          className: `absolute -translate-x-1/2 -translate-y-1/2 ${interactive ? "cursor-move" : "pointer-events-none"} ${active ? "outline-2 outline-dashed outline-signal" : ""}`,
          style: { left: `${layer.x}%`, top: `${layer.y}%` },
        } as const;

        if (layer.kind === "sticker") {
          return (
            <div key={layer.id} {...common} style={{ ...common.style, fontSize: STICKER_SCALE * stageWidth, lineHeight: 1 }}>
              <span aria-hidden="true">{layer.glyph}</span>
            </div>
          );
        }

        const size = Math.round(TEXT_SIZES[layer.size] * stageWidth);
        const editing = editingId === layer.id;
        return (
          <div
            key={layer.id}
            {...common}
            style={{
              ...common.style,
              width: `${TEXT_BOX_RATIO * 100}%`,
              textAlign: ALIGN_CSS[layer.align as Align],
              fontSize: size,
              fontWeight: 800,
              lineHeight: 1.22,
              color: `var(${INK_VARS[layer.color] ?? INK_VARS[0]})`,
              textShadow: layer.pill ? undefined : "var(--story-text-shadow)",
            }}
          >
            {editing ? (
              <>
                <label htmlFor="status-composer-text" className="sr-only">
                  Texte du statut
                </label>
                <textarea
                  id="status-composer-text"
                  ref={textRef}
                  value={layer.text}
                  onChange={(event) => onTextChange(layer.id, event.target.value)}
                  onBlur={() => onTextDone(layer.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      onTextDone(layer.id);
                    }
                  }}
                  rows={1}
                  placeholder="Votre statut"
                  className="w-full resize-none appearance-none border-0 bg-transparent p-0 font-extrabold leading-tight shadow-none ring-0 placeholder:text-chalk-3"
                  style={{ color: "inherit", textAlign: "inherit", fontSize: "inherit" }}
                />
              </>
            ) : layer.text.trim() ? (
              <span
                className="whitespace-pre-wrap break-words"
                style={layer.pill ? {
                  background: "color-mix(in srgb, var(--color-void) 55%, transparent)",
                  boxDecorationBreak: "clone",
                  WebkitBoxDecorationBreak: "clone",
                  padding: "0 0.28em",
                } : undefined}
              >
                {layer.text}
              </span>
            ) : (
              <span className="rounded-chip bg-void/70 px-3 py-1 font-mono text-xs uppercase tracking-wide text-chalk">
                Texte vide
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
