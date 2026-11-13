"use client";

/**
 * Un calque à l'écran.
 *
 * L'aperçu est en DOM, pas en canvas : le texte reste net, le navigateur
 * gère le crénelage, et la sélection suit le pointeur sans conversion. Le
 * canvas n'intervient qu'à l'export, et relit le même modèle — c'est ce qui
 * garantit que l'image publiée est celle qu'on a vue.
 *
 * Les tailles de police passent par `cqw` : la scène est un conteneur de
 * requête, donc 4 `cqw` valent 4 % de la largeur du cadre — exactement le
 * calcul du rendu (taille / 1080 × largeur). Un seul système, deux moteurs.
 */
import { filterCss, isFiltered, type Layer, type TextLayer } from "@/lib/studio/editor";
import { bezierPath } from "@/lib/studio/bezier";

export type DragMode =
  | "move"
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw"
  | "rotate"
  | `point:${number}`
  | `control:${number}`;

export const CORNERS: DragMode[] = ["nw", "ne", "sw", "se"];

const FONT_STACK: Record<TextLayer["font"], string> = {
  sans: "var(--font-sans)",
  display: "var(--font-display)",
  mono: "var(--font-mono)",
};

export function StudioLayerView({
  layer,
  selected,
  parentWidth,
  onSelect,
  onDragStart,
  registerVideo,
  onBezierHandle,
}: {
  layer: Layer;
  selected: boolean;
  /** Largeur du cadre de référence (1080 pour un statut). */
  parentWidth: number;
  onSelect: () => void;
  onDragStart: (event: React.PointerEvent, mode: DragMode) => void;
  registerVideo: (element: HTMLVideoElement | null) => void;
  /** Poignée de courbe tirée : le parent applique la géométrie. */
  onBezierHandle?: (event: React.PointerEvent, mode: DragMode) => void;
}) {
  const filter = isFiltered(layer.filters) ? filterCss(layer.filters) : undefined;

  return (
    <div
      role="presentation"
      style={{
        position: "absolute",
        left: `${layer.x}%`,
        top: `${layer.y}%`,
        width: `${layer.w}%`,
        height: `${layer.h}%`,
        transform: `rotate(${layer.rotation}deg)`,
        opacity: layer.opacity,
        filter,
        cursor: layer.locked ? "default" : "move",
        touchAction: "none",
      }}
      onPointerDown={(event) => {
        if (layer.locked) return;
        onSelect();
        onDragStart(event, "move");
      }}
    >
      {layer.type === "text" ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "flex-start",
            justifyContent:
              layer.align === "center"
                ? "center"
                : layer.align === "right"
                  ? "flex-end"
                  : "flex-start",
            fontFamily: FONT_STACK[layer.font],
            fontWeight: layer.weight,
            fontSize: `${(layer.size / parentWidth) * 100}cqw`,
            lineHeight: layer.lineHeight,
            letterSpacing: `${layer.letterSpacing}em`,
            color: layer.color,
            textTransform: layer.uppercase ? "uppercase" : "none",
            textAlign: layer.align,
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
          }}
        >
          {layer.text}
        </div>
      ) : layer.type === "shape" ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: layer.shape === "line" ? "transparent" : layer.fill,
            border:
              layer.strokeWidth > 0
                ? `${layer.strokeWidth}px solid ${layer.stroke}`
                : undefined,
            borderTop:
              layer.shape === "line"
                ? `${Math.max(2, layer.h)}px solid ${layer.fill}`
                : undefined,
            borderRadius: layer.shape === "ellipse" ? "50%" : `${layer.radius}px`,
          }}
        />        ) : layer.type === "bezier" ? (
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          // La boîte du calque n'a pas forcément les proportions de la scène :
          // on étire le repère 0–100 sur la boîte réelle.
          preserveAspectRatio="none"
          style={{ overflow: "visible" }}
        >
          <path
            d={bezierPath(layer.points, layer.controlPoints, 100, 100)}
            stroke={layer.stroke || "var(--color-void)"}
            strokeWidth={Math.max(1, layer.strokeWidth)}
            fill={layer.fill && layer.fill !== "transparent" ? layer.fill : "none"}
            fillOpacity={0.25}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
          />
        </svg>
      ) : layer.type === "video" ? (
        <video
          ref={registerVideo}
          src={layer.src}
          muted
          loop
          autoPlay
          playsInline
          aria-label={`Vidéo ${layer.name}`}
          style={{
            width: "100%",
            height: "100%",
            objectFit: layer.fit,
            borderRadius: `${layer.radius}px`,
          }}
        />
      ) : (
        <div
          role="img"
          aria-label={layer.name}
          style={{
            width: "100%",
            height: "100%",
            backgroundImage: `url("${layer.src}")`,
            backgroundSize: layer.fit,
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            borderRadius: `${layer.radius}px`,
          }}
        />
      )}

      {/*
        Poignées de la courbe, en HTML et non dans le SVG : le SVG est
        étiré sur la boîte du calque, donc un cercle y serait déformé et
        sa zone de saisie deviendrait elliptique.
      */}
      {selected && !layer.locked && layer.type === "bezier" && onBezierHandle && (
        <>
          {layer.points.map((point, index) => (
            <button
              key={`point-${index}`}
              type="button"
              aria-label={`Déplacer le point ${index + 1} de la courbe`}
              onPointerDown={(event) => {
                event.stopPropagation();
                onBezierHandle(event, `point:${index}`);
              }}
              className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-void bg-chalk"
              style={{ left: `${point[0] * 100}%`, top: `${point[1] * 100}%` }}
            />
          ))}
          {layer.controlPoints.map((control, index) => (
            <button
              key={`control-${index}`}
              type="button"
              aria-label={`Déplacer le point de contrôle ${index + 1}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                onBezierHandle(event, `control:${index}`);
              }}
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-void bg-signal"
              style={{ left: `${control[0] * 100}%`, top: `${control[1] * 100}%` }}
            />
          ))}
        </>
      )}

      {selected && !layer.locked && (
        <>
          <span className="pointer-events-none absolute inset-0 border border-signal" />
          {CORNERS.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-label={`Redimensionner ${mode}`}
              onPointerDown={(event) => onDragStart(event, mode)}
              className="absolute size-3 rounded-sm border border-void bg-signal"
              style={{
                top: mode.includes("n") ? -6 : undefined,
                bottom: mode.includes("s") ? -6 : undefined,
                left: mode.includes("w") ? -6 : undefined,
                right: mode.includes("e") ? -6 : undefined,
                cursor: `${mode}-resize`,
              }}
            />
          ))}
          <button
            type="button"
            aria-label="Pivoter le calque"
            onPointerDown={(event) => onDragStart(event, "rotate")}
            className="absolute -top-7 left-1/2 size-4 -translate-x-1/2 rounded-full border border-void bg-signal"
            style={{ cursor: "grab" }}
          />
        </>
      )}
    </div>
  );
}
