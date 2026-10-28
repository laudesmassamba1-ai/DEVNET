"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import type { StoryWithAuthor } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

/**
 * Stories DevNet — ce que le réseau a écrit dans les dernières 24 h.
 *
 * L'analogie Instagram est assumée : un rail horizontal de cercles, un
 * lecteur plein écran avec des barres de progression. Mais le contenu
 * n'est pas un statut décoratif : c'est une **vraie ligne** de `stories`,
 * avec une échéance. Une story vide n'existe pas — l'écran refuse de la
 * publier, et il n'y a dès lors rien à afficher.
 *
 * ## Un cercle par personne, une série par personne
 *
 * La table autorise plusieurs stories du même auteur ; le rail les
 * regroupe donc sous un seul cercle, et le lecteur déroule la série de
 * cette personne. C'est ce qui évite un rail où quelqu'un qui publie
 * trois fois occupe trois places, poussant les autres hors de l'écran.
 */

/** Durée d'affichage d'une story avant de passer à la suivante. */
const STORY_MS = 7000;

/**
 * Regroupe les stories par auteur, en gardant l'ordre d'arrivée.
 *
 * L'entrée est triée du plus récent au plus ancien : la personne qui
 * vient de publier passe donc en tête. À l'intérieur d'une série,
 * l'ordre est **chronologique** — c'est l'ordre dans lequel on la
 * regarde.
 */
export function groupStoriesByAuthor(
  stories: StoryWithAuthor[],
): { authorId: string; author: StoryWithAuthor["author"]; items: StoryWithAuthor[] }[] {
  const order: string[] = [];
  const groups = new Map<string, StoryWithAuthor[]>();

  for (const s of stories) {
    if (!groups.has(s.author_id)) order.push(s.author_id);
    const list = groups.get(s.author_id) ?? [];
    list.push(s);
    groups.set(s.author_id, list);
  }

  return order.map((authorId) => {
    const items = [...(groups.get(authorId) ?? [])].sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
    );
    return { authorId, author: items[0]?.author ?? null, items };
  });
}

export function StoryRail({
  stories,
  me,
  onOpen,
  onPublish,
}: {
  stories: StoryWithAuthor[];
  /** Le lecteur — pour marquer sa propre story d'un signe distinct. */
  me: string | null;
  onOpen: (authorId: string) => void;
  /** Ouvre la feuille de publication ; absent = on ne propose pas d'écrire. */
  onPublish?: () => void;
}) {
  const groups = groupStoriesByAuthor(stories);

  // Sans story et sans possibilité d'en publier, le rail n'a rien à dire :
  // un titre « Dernières contributions » au-dessus du vide serait du bruit.
  if (groups.length === 0 && !onPublish) return null;

  const mine = groups.find((g) => g.authorId === me);

  return (
    <div className="mb-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="prompt-label text-chalk-2">Dernières contributions</h2>
        <span className="label-micro text-chalk-3">24 h</span>
      </div>

      <div className="-mx-(--gutter) flex gap-3 overflow-x-auto px-(--gutter) pb-2">
        {/* Le cercle d'écriture passe en tête quand on peut publier : c'est
            l'action, et une action se place là où l'œil arrive. */}
        {onPublish && (
          <button
            type="button"
            onClick={onPublish}
            className="group flex w-[64px] shrink-0 flex-col items-center gap-1.5"
          >
            <span
              className="relative flex size-[54px] items-center justify-center
                rounded-full border-[1.5px] border-dashed border-line-3 bg-surface p-[2px]
                transition-transform group-hover:-translate-y-0.5"
            >
              <span className="flex size-full items-center justify-center rounded-full bg-page">
                <Avatar
                  name={mine?.author?.prenom ?? "moi"}
                  color={mine?.author?.avatar_color ?? "av-lime"}
                  className="size-[38px] border-0 text-[14px]"
                />
              </span>
              <span
                className="absolute -right-0.5 -bottom-0.5 flex size-[18px] items-center
                  justify-center rounded-full border-[1.5px] border-void bg-signal text-void"
                style={{ boxShadow: "var(--shadow-sh-1)" }}
              >
                <Icon name="plus" size={11} strokeWidth={2.4} />
              </span>
            </span>
            <span className="label-micro w-full truncate text-center text-chalk-2">
              Votre story
            </span>
          </button>
        )}

        {groups.map((g) => (
          <button
            key={g.authorId}
            type="button"
            onClick={() => onOpen(g.authorId)}
            className="group flex w-[64px] shrink-0 flex-col items-center gap-1.5"
          >
            {/* Anneau « sonde » — la signature de marque.
                Le dégradé phosphor ambre→vert, d'un écran qui s'allume.
                Il remplace l'arc-en-ciel d'Instagram par une seule
                affirmation de la marque. */}
            <span
              className="relative flex size-[54px] items-center justify-center
                rounded-full p-[2px] transition-transform group-hover:-translate-y-0.5
                group-hover:animate-[pulse_1.8s_ease-continuous_infinite]"
            >
              <span
                className="relative flex size-full items-center justify-center
                  rounded-full border bg-void p-[2px]"
                style={{
                  background: "var(--story-ring-gradient)",
                  WebkitMask: "radial-gradient(circle, transparent 62%, black 63%)",
                  mask: "radial-gradient(circle, transparent 62%, black 63%)",
                }}
              >
                <span
                  className="flex size-full items-center justify-center
                    rounded-full bg-page"
                >
                  <Avatar
                    name={g.author?.prenom}
                    color={g.author?.avatar_color}
                    className="size-[38px] border-0 text-[14px]"
                  />
                </span>
              </span>
            </span>

            <span className="label-micro w-full truncate text-center text-chalk-2">
              {g.authorId === me ? "vous" : (g.author?.pseudo ?? "?")}
            </span>

            {/* Indicateur de nombre de stories (Instagram-style). */}
            {g.items.length > 1 && (
              <span className="label-micro flex items-center justify-center w-full text-chalk-4">
                {g.items.length}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lecteur                                                             */
/* ------------------------------------------------------------------ */

export function StoryViewer({
  stories,
  me,
  onClose,
  onDelete,
}: {
  /** Les stories d'**un seul** auteur, en ordre chronologique. */
  stories: StoryWithAuthor[];
  me: string | null;
  onClose: () => void;
  /** Retire la story courante — proposé seulement sur les siennes. */
  onDelete?: (id: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  /** Le lecteur vit dans un portail `body` : hors de la colonne de la
      page, ses ancêtres (qui défilent) ne peuvent pas le retenir. */
  const [monte, setMonte] = useState(false);
  const current = stories[index];

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonte(true);
  }, []);

  // Supprimer la story courante (ou la seule restante) laisse `index`
  // hors des bornes : sans protections, le lecteur afficherait une zone
  // vide avec le défilement verrouillé. On referme — la série vient de
  // changer, et personne ne suit une histoire qui n'existe plus.
  useEffect(() => {
    if (current) return;
    onClose();
  }, [current, onClose]);

  // L'appel à `onClose` vit **hors** de l'updater de `setIndex` : un
  // updater doit rester pur — React le rejoue pendant le rendu, et y
  // poser `setState` du parent déclenche « Cannot update a component
  // while rendering a different component ». On décide d'abord, on pose
  // l'état ensuite.
  const next = useCallback(() => {
    if (index + 1 >= stories.length) {
      onClose();
      return;
    }
    setIndex(index + 1);
  }, [index, stories.length, onClose]);

  const prev = useCallback(() => {
    setIndex((i) => (i === 0 ? 0 : i - 1));
  }, []);

  // Avance automatique. Se suspend au survol et au focus clavier :
  // personne ne peut lire un texte qu'on lui fait défiler.
  useEffect(() => {
    if (paused || !current) return;
    const t = setTimeout(next, STORY_MS);
    return () => clearTimeout(t);
  }, [index, paused, next, current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [next, prev, onClose]);

  if (!current) return null;
  if (typeof document === "undefined" || !monte) return null;

  const author = current.author;
  const mine = current.author_id === me;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Story"
      className="overlay-frost fixed inset-0 z-[var(--z-modal)] flex flex-col"
    >
      {/* Barres de progression. L'animation CSS repart à chaque story
          grâce à la `key`, ce qui évite de gérer un timer par barre. */}
      <div className="absolute inset-x-0 top-0 z-10 flex gap-1 p-3">
        {stories.map((s, i) => (
          <span key={s.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-void/25">
            <span
              key={`${s.id}-${i}-${index}`}
              className={`block h-full origin-left rounded-full bg-signal ${
                i < index
                  ? "scale-x-100"
                  : i === index
                    ? "animate-[storyBar_linear_forwards]"
                    : "scale-x-0"
              }`}
              // La durée vient de `STORY_MS` pour rester calée sur le
              // `setTimeout` qui fait avancer la série ; la pause **gèle**
              // la barre (`paused`) au lieu de la remettre à zéro.
              style={
                i === index
                  ? {
                      animationDuration: `${STORY_MS}ms`,
                      animationPlayState: paused ? "paused" : "running",
                    }
                  : undefined
              }
            />
          </span>
        ))}
      </div>

      <header className="absolute inset-x-0 top-0 z-10 flex items-center gap-2.5 px-3 pt-4">
        <Avatar
          name={author?.prenom}
          color={author?.avatar_color}
          className="size-[34px] border border-line-2/70 text-[13px]"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-chalk">
            {author?.prenom ?? "Quelqu'un"}
            <span className="ml-1.5 font-mono text-[11.5px] font-normal text-chalk/60">
              @{author?.pseudo ?? ""}
            </span>
          </div>
          <div className="text-[11px] text-chalk/60">{timeAgo(current.created_at)}</div>
        </div>

        {mine && onDelete && (
          <button
            type="button"
            onClick={() => onDelete(current.id)}
            aria-label="Supprimer cette story"
            className="flex size-[34px] items-center justify-center border
              border-line-2/30 text-chalk/70 transition-colors hover:border-danger hover:text-danger"
          >
            <Icon name="trash" size={14} />
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="flex size-[34px] items-center justify-center border
            border-line-2/30 text-chalk transition-colors hover:border-signal hover:bg-signal hover:text-void"
        >
          <Icon name="close" size={16} />
        </button>
      </header>

      {/* Zone de contenu. Les moitiés gauche/droite sont des zones de
          clic ; le contenu lui-même n'intercepte pas, sinon on ne pourrait
          jamais faire défiler un texte long. */}
      <div className="relative flex flex-1 items-center justify-center px-5 pt-20 pb-16">
        {/* La story est **encadrée par l'anneau de marque** : le même cadre
            qu'à la composition, pour que l'aperçu de rédaction soit la
            promesse tenue. Sans cadre, le texte flottait dans le flou sans
            dire où commençait la story et où finissait le fond. */}
        <div className="w-full max-w-[420px]">
          <div
            className="rounded-[calc(var(--radius-card)+4px)] p-[2px]"
            style={{ background: "var(--story-ring-gradient)" }}
          >
            <div className="flex max-h-[64vh] flex-col overflow-hidden rounded-[var(--radius-card)] bg-[var(--overlay-panel-bg)] shadow-sh-3">
              <div className="flex items-center gap-2 border-b border-line-2 px-4 py-2.5">
                <Icon name="spark" size={11} strokeWidth={2.4} className="text-signal-d" />
                <span className="label-micro text-chalk-3">Story</span>
                <span className="label-micro ml-auto text-chalk-4">
                  {timeAgo(current.created_at)}
                </span>
              </div>

              {current.media_url ? (
                // Le média viendra du stockage : une story sans média se lit
                // quand même, et c'est le cas courant aujourd'hui.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={current.media_url}
                  alt=""
                  className="max-h-[46vh] w-full bg-void/5 object-cover"
                />
              ) : null}

              <p className="min-h-[72px] overflow-y-auto whitespace-pre-wrap px-4 py-4
                text-[16.5px] leading-[1.6] text-chalk">
                {current.caption}
              </p>
            </div>
          </div>
        </div>

        {/* Zones de navigation — laissées au-dessus, hors du contenu */}
        <button
          type="button"
          onClick={prev}
          aria-label="Précédent"
          disabled={index === 0}
          className="absolute inset-y-0 left-0 w-[22%] cursor-w-resize"
        />
        <button
          type="button"
          onClick={next}
          aria-label="Suivant"
          className="absolute inset-y-0 right-0 w-[22%] cursor-e-resize"
        />
      </div>

      {/* Pause au survol : le geste naturel sur un contenu long. */}
      <button
        type="button"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        className="absolute inset-x-[22%] top-20 bottom-14 cursor-default"
        aria-hidden="true"
        tabIndex={-1}
      />

      <footer className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-2 pb-6">
        <span className="label-micro text-chalk/45">
          {index + 1} / {stories.length}
        </span>
        <span className="label-micro text-chalk/25">·</span>
        <span className="label-micro text-chalk/45">← → pour naviguer</span>
      </footer>
    </div>,
    document.body,
  );
}
