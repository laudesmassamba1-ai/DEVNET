"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { usePrefersReducedMotion } from "./Motion";
import type { StoryWithAuthor } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { STORY_REPLY_MAX } from "@/modules/stories";
import {
  fetchStoryFeed,
  markStorySeen,
  placeStorySticker,
  replyToStory,
  toggleStoryLike,
  type PlacedSticker,
  type StickerCatalogEntry,
} from "@/lib/stories";

/**
 * Lecteur de stories — likes, réponses privées, stickers posés.
 *
 * ## Ce que le lecteur possède
 *
 * La série vient du parent (il a déjà chargé les stories) ; l'**état
 * d'interaction** est chargé par le lecteur lui-même, en une requête à
 * `/api/stories` : aimé, vu, stickers posés, catalogue. Un lecteur qui
 * s'ouvre ne doit pas dépendre du parent pour savoir s'il aime.
 *
 * ## Ce que fait chaque geste
 *
 * - **Aimer** : double-clic ou double-tap sur la story, ou bouton. Le
 *   like est une ligne ; le compteur n'est affiché qu'à l'auteur.
 * - **Répondre** : la réponse part en privé vers l'auteur. Elle est
 *   enregistrée comme réponse de story, lisible par les deux personnes.
 *   Ce n'est pas un commentaire public.
 * - **Sticker** : on choisit dans le catalogue, puis on **touche la
 *   story** à l'endroit voulu. Les coordonnées sont normalisées (0–1),
 *   donc la position tient sur téléphone comme sur bureau.
 *
 * ## Automatisme et mouvement
 *
 * L'avance automatique se suspend dès qu'on écrit, qu'on choisit un
 * sticker ou qu'on place le doigt, et ne tourne pas dans un onglet caché.
 * Sous `prefers-reduced-motion`, la barre de progression ne s'anime pas :
 * elle reste un repère fixe, et la série avance au rythme prévu.
 */

/** Durée d'affichage d'une story avant de passer à la suivante. */
const STORY_MS = 7000;

interface Feedback {
  kind: "ok" | "error";
  text: string;
}

/**
 * Un sticker, quelle que soit sa matière. Un glyphe du catalogue de la maison
 * garde ses jetons de couleur vides : il s'affiche comme avant, sans pastille.
 */
function StickerFace({
  kind,
  glyph,
  fg,
  bg,
  assetId,
  size,
}: {
  kind: "texte" | "image" | "animé";
  glyph: string;
  fg: string;
  bg: string;
  assetId: string;
  size: number;
}) {
  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/stickers/${encodeURIComponent(assetId)}/asset`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="rounded-[26%] object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-[26%]"
      style={{
        width: fg && bg ? size : undefined,
        height: fg && bg ? size : undefined,
        backgroundColor: fg && bg ? `var(--color-${bg})` : "transparent",
        color: fg ? `var(--color-${fg})` : "inherit",
        fontSize: size * 0.66,
      }}
    >
      {glyph}
    </span>
  );
}

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
  const [monte, setMonte] = useState(false);

  // État d'interaction, chargé par le lecteur.
  const [catalog, setCatalog] = useState<StickerCatalogEntry[]>([]);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [placed, setPlaced] = useState<Record<string, PlacedSticker[]>>({});
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  // Composeur de réponse.
  const [replyOpen, setReplyOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // Stickers : choix, puis placement au toucher.
  const [trayOpen, setTrayOpen] = useState(false);
  const [placing, setPlacing] = useState<StickerCatalogEntry | null>(null);

  const reduced = usePrefersReducedMotion();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const seenRef = useRef<Set<string>>(new Set());

  const current = stories[index];
  const isMine = current?.author_id === me;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonte(true);
    closeRef.current?.focus();
  }, []);

  // Série qui se vide (suppression) : on referme au lieu d'afficher du vide.
  useEffect(() => {
    if (current) return;
    onClose();
  }, [current, onClose]);

  // Chargement de l'état d'interaction : une seule requête.
  useEffect(() => {
    let alive = true;
    fetchStoryFeed()
      .then((feed) => {
        if (!alive) return;
        if (!feed) {
          setState("unavailable");
          return;
        }
        setCatalog(feed.catalog);
        setLiked(new Set(feed.stories.filter((s) => s.liked).map((s) => s.id)));
        setLikeCounts(
          Object.fromEntries(feed.stories.map((s) => [s.id, s.likes] as const)),
        );
        setPlaced(
          Object.fromEntries(feed.stories.map((s) => [s.id, s.stickers] as const)),
        );
        setState("ready");
      })
      .catch(() => {
        if (alive) setState("unavailable");
      });
    return () => {
      alive = false;
    };
  }, []);

  // Vue : une seule fois par story et par ouverture.
  useEffect(() => {
    if (!current || !me) return;
    if (seenRef.current.has(current.id)) return;
    seenRef.current.add(current.id);
    void markStorySeen(current.id);
  }, [current, me]);

  const next = useCallback(() => {
    if (index + 1 >= stories.length) {
      onClose();
      return;
    }
    setIndex(index + 1);
    setFeedback(null);
    setReplyOpen(false);
    setDraft("");
    setTrayOpen(false);
    setPlacing(null);
  }, [index, stories.length, onClose]);

  const prev = useCallback(() => {
    setIndex((i) => (i === 0 ? 0 : i - 1));
    setFeedback(null);
    setReplyOpen(false);
    setDraft("");
    setTrayOpen(false);
    setPlacing(null);
  }, []);

  // Avance automatique : suspendue par la composition, le catalogue,
  // le placement, le survol du contenu et un onglet caché.
  useEffect(() => {
    if (paused || replyOpen || trayOpen || placing || !current) return;
    if (typeof document !== "undefined" && document.hidden) return;
    const timer = setTimeout(next, STORY_MS);
    return () => clearTimeout(timer);
  }, [index, paused, replyOpen, trayOpen, placing, next, current]);

  // Clavier : navigation, pause, fermeture. Le focus reste dans la surface.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (trayOpen) return setTrayOpen(false);
        if (placing) return setPlacing(null);
        if (replyOpen) {
          setReplyOpen(false);
          return;
        }
        onClose();
        return;
      }
      if (event.key === "ArrowRight" && !replyOpen) next();
      if (event.key === "ArrowLeft" && !replyOpen) prev();
      if (event.key === " " && !replyOpen) {
        event.preventDefault();
        setPaused((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [next, prev, onClose, replyOpen, trayOpen, placing]);

  const like = useCallback(async () => {
    if (!current || isMine) return;
    // Optimiste : le cœur répond au geste, l'échec le dit et revient.
    const before = liked.has(current.id);
    setLiked((prevSet) => {
      const copy = new Set(prevSet);
      if (before) copy.delete(current.id);
      else copy.add(current.id);
      return copy;
    });
    setLikeCounts((counts) => {
      if (!isMine) return counts;
      const value = counts[current.id] ?? 0;
      return { ...counts, [current.id]: Math.max(0, value + (before ? -1 : 1)) };
    });

    const result = await toggleStoryLike(current.id);
    if (!result.ok) {
      setLiked((prevSet) => {
        const copy = new Set(prevSet);
        if (before) copy.add(current.id);
        else copy.delete(current.id);
        return copy;
      });
      setFeedback({ kind: "error", text: result.error });
      return;
    }
    setLiked((prevSet) => {
      const copy = new Set(prevSet);
      if (result.liked) copy.add(current.id);
      else copy.delete(current.id);
      return copy;
    });
    if (result.likes >= 0) {
      setLikeCounts((counts) => ({ ...counts, [current.id]: result.likes }));
    }
  }, [current, isMine, liked]);

  async function sendReply() {
    if (!current) return;
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    const result = await replyToStory(current.id, body);
    setSending(false);
    if (!result.ok) {
      setFeedback({ kind: "error", text: result.error });
      return;
    }
    setDraft("");
    setReplyOpen(false);
    setFeedback({ kind: "ok", text: "Réponse envoyée en privé" });
  }

  async function place(sticker: StickerCatalogEntry, x: number, y: number) {
    if (!current) return;
    const result = await placeStorySticker(current.id, {
      stickerId: sticker.id,
      x,
      y,
      scale: 1,
      rotation: 0,
    });
    if (!result.ok) {
      setFeedback({ kind: "error", text: result.error });
      return;
    }
    setPlaced((all) => ({
      ...all,
      [current.id]: [...(all[current.id] ?? []), result.sticker],
    }));
    setPlacing(null);
    setTrayOpen(false);
  }

  if (!current) return null;
  if (typeof document === "undefined" || !monte) return null;

  const author = current.author;
  const currentPlaced = placed[current.id] ?? [];
  const currentLiked = liked.has(current.id);
  const count = likeCounts[current.id] ?? 0;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Story de ${author?.prenom ?? "quelqu'un"}`}
      className="overlay-frost fixed inset-0 z-[var(--z-modal)] flex flex-col"
      onPointerDown={(event) => {
        // Un appui sur la story met en pause le temps de la lecture.
        if (event.target === event.currentTarget) setPaused(true);
      }}
      onPointerUp={() => setPaused(false)}
    >
      {/* Barres de progression : un segment par story de la série. */}
      <div className="absolute inset-x-0 top-0 z-10 flex gap-1 p-3">
        {stories.map((story, i) => (
          <span key={story.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-void/25">
            <span
              key={`${story.id}-${paused}-${replyOpen}`}
              className={`block h-full origin-left rounded-full bg-signal ${
                i < index ? "scale-x-100" : i === index ? "animate-[storyBar_linear_forwards]" : "scale-x-0"
              }`}
              style={
                i === index
                  ? {
                      animationDuration: `${STORY_MS}ms`,
                      animationPlayState: paused || replyOpen ? "paused" : "running",
                      // Sous réduction de mouvement, on garde un repère fixe.
                      animationName: reduced ? "none" : undefined,
                      transform: reduced ? "scaleX(1)" : undefined,
                      opacity: reduced ? 0.4 : undefined,
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

        {isMine && (
          <span className="label-micro mr-1 flex items-center gap-1 text-chalk/70">
            <Icon name="eye" size={12} />
            {count > 0 ? `${count} j’aime` : ""}
          </span>
        )}

        {isMine && onDelete && (
          <button
            type="button"
            onClick={() => onDelete(current.id)}
            aria-label="Supprimer cette story"
            className="flex size-11 items-center justify-center border
              border-line-2/30 text-chalk/70 transition-colors hover:border-danger hover:text-danger"
          >
            <Icon name="trash" size={14} />
          </button>
        )}

        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="flex size-11 items-center justify-center border
            border-line-2/30 text-chalk transition-colors hover:border-signal hover:bg-signal hover:text-void"
        >
          <Icon name="close" size={16} />
        </button>
      </header>

      <div className="relative flex flex-1 items-center justify-center px-5 pt-20 pb-28">
        <div className="w-full max-w-[420px]">
          <div
            ref={surfaceRef}
            className="relative rounded-[calc(var(--radius-card)+4px)] p-[2px]"
            style={{ background: "var(--story-ring-gradient)" }}
            onDoubleClick={() => void like()}
            onClick={(event) => {
              if (!placing) return;
              const rect = event.currentTarget.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) return;
              const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
              const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
              void place(placing, x, y);
            }}
          >
            <div className="relative flex max-h-[64vh] min-h-[240px] flex-col overflow-hidden rounded-[var(--radius-card)] bg-[var(--overlay-panel-bg)] shadow-sh-3">
              <div className="flex items-center gap-2 border-b border-line-2 px-4 py-2.5">
                <Icon name="spark" size={11} strokeWidth={2.4} className="text-signal-d" />
                <span className="label-micro text-chalk-3">Story</span>
                <span className="label-micro ml-auto text-chalk-4">
                  {index + 1} / {stories.length}
                </span>
              </div>

              {current.media_url ? (
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

              {/* Stickers posés — positionnés en fraction de la surface. */}
              {currentPlaced.map((sticker) => (
                <span
                  key={sticker.id}
                  title={sticker.name}
                  className="pointer-events-none absolute select-none"
                  style={{
                    left: `${sticker.x * 100}%`,
                    top: `${sticker.y * 100}%`,
                    transform: `translate(-50%, -50%) rotate(${sticker.rotation}deg) scale(${sticker.scale})`,
                    fontSize: "34px",
                    lineHeight: 1,
                  }}
                >
                  <StickerFace
                    kind={sticker.kind}
                    glyph={sticker.glyph}
                    fg={sticker.fg}
                    bg={sticker.bg}
                    assetId={sticker.stickerId}
                    size={46}
                  />
                </span>
              ))}

              {placing ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-signal/40 bg-void/60 px-3 py-2 text-center">
                  <span className="label-micro text-chalk">
                    Touche la story pour poser {placing.glyph} {placing.name}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={prev}
          aria-label="Story précédente"
          disabled={index === 0}
          className="absolute inset-y-0 left-0 w-[18%] cursor-w-resize disabled:cursor-default"
        />
        <button
          type="button"
          onClick={next}
          aria-label="Story suivante"
          className="absolute inset-y-0 right-0 w-[18%] cursor-e-resize"
        />
      </div>

      {feedback ? (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          className={`absolute inset-x-0 bottom-24 mx-auto w-fit rounded-full px-3 py-1.5
            label-micro ${feedback.kind === "error" ? "bg-danger text-void" : "bg-ok text-void"}`}
        >
          {feedback.text}
        </p>
      ) : null}

      {state === "loading" ? (
        <p className="absolute inset-x-0 bottom-24 text-center label-micro text-chalk/50">
          Chargement des interactions…
        </p>
      ) : null}

      {state === "unavailable" && !feedback ? (
        <p className="absolute inset-x-0 bottom-24 mx-auto w-fit rounded-full bg-void/70 px-3 py-1.5 label-micro text-chalk/70">
          Interactions indisponibles (mode démonstration)
        </p>
      ) : null}

      <footer className="absolute inset-x-0 bottom-0 z-10 px-3 pb-4">
        {replyOpen ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void sendReply();
            }}
          >
            <label className="sr-only" htmlFor="story-reply">
              Répondre en privé
            </label>
            <input
              id="story-reply"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={STORY_REPLY_MAX}
              autoFocus
              placeholder="Répondre en privé…"
              className="min-w-0 flex-1 rounded-[var(--radius-input)] border border-line-2
                bg-surface px-3 py-2 text-[14px] text-chalk placeholder:text-chalk-4"
            />
            <button
              type="submit"
              disabled={sending || draft.trim().length === 0}
              className="flex h-11 items-center rounded-[var(--radius-input)] bg-signal px-3
                text-[13px] font-bold text-void disabled:opacity-50"
            >
              {sending ? "Envoi…" : "Envoyer"}
            </button>
            <button
              type="button"
              onClick={() => setReplyOpen(false)}
              aria-label="Fermer la réponse"
              className="flex size-11 items-center justify-center text-chalk/70"
            >
              <Icon name="close" size={14} />
            </button>
          </form>
        ) : trayOpen ? (
          <div className="rounded-[var(--radius-card)] border border-line-2 bg-surface p-2">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="label-micro text-chalk-3">Choisir un sticker</span>
              <button
                type="button"
                onClick={() => setTrayOpen(false)}
                aria-label="Fermer les stickers"
                className="flex size-9 items-center justify-center text-chalk/70"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            {state === "loading" ? (
              <p className="px-1 py-2 label-micro text-chalk/50">Chargement…</p>
            ) : catalog.length === 0 ? (
              <p className="px-1 py-2 label-micro text-chalk/50">
                Aucun sticker disponible dans ce mode.
              </p>
            ) : (
              <div className="grid grid-cols-6 gap-1">
                {catalog.map((sticker) => (
                  <button
                    key={sticker.id}
                    type="button"
                    onClick={() => setPlacing(sticker)}
                    aria-label={`Poser ${sticker.name}`}
                    className="flex h-11 items-center justify-center rounded-[var(--radius-chip)]
                      text-[22px] hover:bg-surface-2"
                  >
                    <StickerFace
                      kind={sticker.kind}
                      glyph={sticker.glyph}
                      fg={sticker.fg}
                      bg={sticker.bg}
                      assetId={sticker.id}
                      size={30}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReplyOpen(true)}
              disabled={isMine || !me}
              className="flex h-11 flex-1 items-center gap-2 rounded-full border border-line-2/70
                bg-void/40 px-3 text-[13px] text-chalk/70 disabled:opacity-40"
            >
              <Icon name="messages" size={14} />
              Répondre en privé…
            </button>

            <button
              type="button"
              onClick={() => void like()}
              disabled={isMine || !me}
              aria-pressed={currentLiked}
              aria-label={currentLiked ? "Retirer le j’aime" : "Aimer cette story"}
              className={`flex size-11 items-center justify-center rounded-full border
                transition-colors disabled:opacity-40 ${
                  currentLiked
                    ? "border-signal bg-signal text-void"
                    : "border-line-2/70 bg-void/40 text-chalk"
                }`}
            >
              <span aria-hidden="true" className="text-[17px] leading-none">
                {currentLiked ? "♥" : "♡"}
              </span>
            </button>

            {isMine && (
              <button
                type="button"
                onClick={() => setTrayOpen(true)}
                aria-label="Poser un sticker"
                className="flex size-11 items-center justify-center rounded-full border
                  border-line-2/70 bg-void/40 text-chalk"
              >
                <Icon name="spark" size={16} />
              </button>
            )}
          </div>
        )}

        <p className="mt-2 text-center label-micro text-chalk/35">
          ← → naviguer · Espace pause · double-clic aimer
        </p>
      </footer>
    </div>,
    document.body,
  );
}
