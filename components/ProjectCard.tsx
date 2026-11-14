"use client";

import Link from "next/link";

import { Icon, asIconName } from "./Icon";
import { Motion, Tilt } from "./Motion";
import { timeAgo } from "@/lib/utils";
import type { ProjectCard as ProjectCardData } from "@/lib/repo";

/**
 * Carte de projet.
 *
 * Elle répond à une seule question : **y a-t-il du travail derrière ce
 * profil ?** Un nom et une description n'y suffisent pas — n'importe qui
 * écrit « projet ambitieux ». Ce qui ne se invente pas, c'est un nombre de
 * révisions et un dernier message daté. Les deux sont donc affichés, et
 * rien d'autre ne l'est : pas d'étoile, pas de compteur de vues, pas de
 * badge. Un projet ne se like pas.
 *
 * Les compteurs sont ceux réellement lus en base, jamais un nombre de
 * présentation. C'est la même règle que pour le score de progression : un
 * chiffre qui ne peut pas mentir vaut plus qu'un chiffre flatteur.
 */
export function ProjectCard({
  project,
  index = 0,
  score,
}: {
  project: ProjectCardData;
  /** Rang dans la liste — pilote le retard de la cascade. */
  index?: number;
  /**
   * La note du dépôt, si le lecteur l'a déjà calculée (profil public).
   *
   * Absente ou à zéro : pas de pastille. `0` n'est pas une note, c'est
   * l'absence d'une mesure — afficher « 0 » ferait dire que le dépôt est
   * mauvais là où il est simplement illisible.
   */
  score?: number | null;
}) {
  return (
    <Motion role="rise" delay={Math.min(index * 55, 320)} as="article">
      {/* La carte s'incline vers le pointeur : elle prend une épaisseur
          qu'on sent au mouvement, sans dégradé ni verre dépoli — la DA
          refuse les deux. L'inclinaison est sur un élément à part car
          l'animation d'entrée possède déjà le `transform` (voir `Tilt`). */}
      <Tilt>
      <Link
        href={`/projects/${project.id}`}
        className="group mb-2 flex items-start gap-3 rounded-(--radius-card) border border-line-2 bg-surface
          px-3.5 py-3 shadow-sh-1 transition-colors duration-(--d-fast)
          hover:border-signal"
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-(--radius-input) border
            border-line-2 bg-surface-2 text-signal-d"
        >
          <Icon name={asIconName(project.emoji, "layers")} size={18} strokeWidth={1.7} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-display text-[15px] font-bold text-chalk">
              {project.name}
            </span>
            <Icon
              name="branch"
              size={11}
              className="shrink-0 text-chalk-4 transition-colors group-hover:text-signal"
            />
          </span>

          {project.description && (
            <span className="mt-0.5 line-clamp-2 block text-sm leading-snug text-chalk-3">
              {project.description}
            </span>
          )}

          {project.lastCommitMessage && (
            <span className="mt-1 block truncate font-mono text-12 text-chalk-4">
              <span className="block truncate text-signal">{project.lastCommitMessage}</span>
            </span>
          )}

          {/* Les compteurs sont ici pour être crus : révisions
              enregistrées, publications rattachées, dernière activité.
              Un projet sans révision n'affiche pas « 0 révisions » — il
              n'affiche rien, parce que « 0 » serait une promesse. */}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-12 text-chalk-4">
            <span className="tnum inline-flex items-center gap-1">
              <Icon name="command" size={11} />
              {project.commitCount} {project.commitCount === 1 ? "révision" : "révisions"}
            </span>

            {project.postCount > 0 && (
              <span className="tnum inline-flex items-center gap-1">
                <Icon name="comment" size={11} />
                {project.postCount}{" "}
                {project.postCount === 1 ? "publication" : "publications"}
              </span>
            )}

            {project.language && (
              <span className="inline-flex items-center gap-1">
                <Icon name="code" size={11} />
                {project.language}
              </span>
            )}

            {/* La note, quand elle existe : une pastille, pas un chiffre
                nu — elle doit se distinguer des compteurs à côté. */}
            {typeof score === "number" && score > 0 && (
              <span
                title="Note du dépôt"
                className="tnum inline-flex items-center gap-1 rounded-(--radius-chip)
                  border-(--bw-thin) border-signal/60 bg-signal/10 px-1.5
                  font-bold text-signal"
              >
                <Icon name="target" size={11} />
                {score}
              </span>
            )}

            <span>{timeAgo(project.lastCommitAt)}</span>
          </span>
        </span>
      </Link>
      </Tilt>
    </Motion>
  );
}

/**
 * Les publications d'un projet, listées depuis une carte.
 *
 * Rendues hors du `Link` principal : imbriquer un bouton dans un lien
 * produit un lien dans un lien, et le clic va au mauvais endroit selon le
 * navigateur. La carte est un lien ; ce compteur est une action à part.
 */
export function ProjectPostsButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 inline-flex items-center gap-1.5 border border-line-3
        px-2 py-1 font-mono text-12 text-chalk-3 transition-colors
        duration-(--d-fast) hover:border-signal hover:text-signal"
    >
      <Icon name="comment" size={11} />
      {count} publication{count === 1 ? "" : "s"}
    </button>
  );
}