"use client";

import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { TrendDirection } from "@/lib/scoring";

/**
 * Le **verdict de tendance**, écrit et coloré de la même façon partout.
 *
 * Trois écrans lisent des trajectoires : la courbe d'un dépôt (révision par
 * révision), la liste des dépôts d'une personne, et sa fiche publique. Le
 * verdict et sa couleur doivent y être identiques — sinon « stable » finit
 * vert sur un écran et gris sur l'autre, et le même mot ne veut plus dire la
 * même chose.
 *
 * La **phrase**, elle, reste écrite par l'écran : ce qui doit être comparé
 * n'est pas la même chose quand on parle de révisions (« le bruit d'une
 * révision à l'autre ») et de dépôts (« l'écart entre des projets »), et une
 * phrase générique qui marcherait pour les deux ne dirait rien de précis
 * pour aucun.
 */
export function TrendNote({
  trend,
  children,
  className = "",
}: {
  trend: TrendDirection;
  /** L'explication, écrite par l'écran — le composant ne fait que la présenter. */
  children: ReactNode;
  className?: string;
}) {
  const tone =
    trend === "hausse" ? "text-ok" : trend === "baisse" ? "text-danger" : "text-chalk-3";

  return (
    <p
      className={`flex items-start gap-1.5 text-[10.5px] leading-snug text-chalk-4 ${className}`}
    >
      <Icon
        name={trend === "baisse" ? "flag" : "chart"}
        size={11}
        strokeWidth={1.8}
        className={`mt-0.5 shrink-0 ${tone}`}
      />
      <span>
        <span className={tone}>tendance {trend}</span> : {children}
      </span>
    </p>
  );
}
