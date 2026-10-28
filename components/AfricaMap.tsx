"use client";

import { useState } from "react";

import { project, outlinePath, type MapPoint } from "@/lib/geo";

/**
 * La carte d'Afrique de l'accueil.
 *
 * Chaque point est un développeur **prouvé** : sa taille suit le nombre de
 * preuves, jamais sa popularité. Un point n'est pas une épingle décorative,
 * c'est un fait vérifiable — le survol dit qui, où, et combien.
 *
 * Le composant ne charge rien : il reçoit ses points. La donnée vit dans
 * `lib/geo.ts`, ce qui permet de l'utiliser sur l'accueil public comme sur
 * un futur tableau de bord sans dupliquer la projection.
 */

const W = 640;
const H = 680;

export function AfricaMap({
  points,
  className = "",
}: {
  points: MapPoint[];
  className?: string;
}) {
  const [hover, setHover] = useState<MapPoint | null>(null);

  const path = outlinePath(W, H);
  const maxProofs = Math.max(1, ...points.map((p) => p.proofs));

  return (
    <figure className={`relative ${className}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Carte d'Afrique des preuves vérifiées"
        className="h-auto w-full"
      >
        <path
          d={path}
          fill="var(--color-surface-2)"
          stroke="var(--color-line-3)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {points.map((p) => {
          const { x, y } = project(p.lng, p.lat, W, H);
          const r = 5 + (p.proofs / maxProofs) * 9;
          const active = hover?.id === p.id;
          return (
            <g key={p.id}>
              <circle
                cx={x}
                cy={y}
                r={30}
                fill="transparent"
                pointerEvents="all"
                role="button"
                tabIndex={0}
                aria-label={`${p.prenom} — ${p.ville}, ${p.pays} : ${p.proofs} preuves`}
                onPointerEnter={(event) => {
                  if (event.pointerType === "mouse") setHover(p);
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType === "mouse") {
                    setHover((current) => (current?.id === p.id ? null : current));
                  }
                }}
                onFocus={() => setHover(p)}
                onBlur={() => setHover((current) => (current?.id === p.id ? null : current))}
                onClick={() => setHover(p)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setHover(p);
                  } else if (event.key === "Escape") {
                    setHover(null);
                  }
                }}
                style={{ cursor: "pointer" }}
              />
              <circle
                cx={x}
                cy={y}
                r={active ? r + 1 : r}
                fill="var(--color-signal)"
                stroke={active ? "var(--color-chalk)" : "var(--color-void)"}
                strokeWidth={active ? 2 : 1.5}
                aria-hidden="true"
                pointerEvents="none"
                style={{ transition: "r var(--d-fast) var(--ease-spring)" }}
              />
            </g>
          );
        })}
      </svg>

      {hover && (
        <figcaption
          className="pointer-events-none absolute z-10 max-w-[240px] rounded-[var(--radius-input)]
            border border-line-3 bg-surface-2 px-3 py-2 shadow-drop"
          style={{ left: "50%", bottom: 12, transform: "translateX(-50%)" }}
        >
          <p className="font-mono text-[12px] font-bold text-chalk">
            {hover.prenom} <span className="text-chalk-4">@{hover.pseudo}</span>
          </p>
          <p className="mt-0.5 text-[11.5px] text-chalk-3">
            {hover.ville}, {hover.pays}
          </p>
          <p className="mt-1 font-mono text-[11px] text-signal">
            {hover.proofs} preuve{hover.proofs > 1 ? "s" : ""}
            {hover.languages.length > 0 && (
              <span className="text-chalk-4"> · {hover.languages.join(", ")}</span>
            )}
          </p>
        </figcaption>
      )}
    </figure>
  );
}
