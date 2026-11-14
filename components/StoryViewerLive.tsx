"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useReducer,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { Avatar } from "./Avatar";
import { SectionIcon } from "./SectionIcon";
import { usePrefersReducedMotion } from "./Motion";
import type { StoryWithAuthor } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { STORY_REPLY_MAX } from "@/modules/stories";
import {
  initialStoryPlayback,
  storyPlaybackReducer,
} from "@/lib/story-playback";
import {
  CLOSE_SWIPE_PX,
  PAGE_SWIPE_PX,
  QUICK_REACTIONS,
  STORY_MS,
  isVideoUrl,
  storyTint,
} from "@/lib/story-viewer";
import { StoryStickerFace } from "./StoryStickerFace";
import {
  fetchStoryFeed,
  fetchStoryViewers,
  markStorySeen,
  moveStorySticker,
  placeStorySticker,
  removeStorySticker,
  replyToStory,
  storyMediaUrl,
  toggleStoryLike,
  type PlacedSticker,
  type StickerCatalogEntry,
  type StoryViewerEntry,
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

interface Feedback {
  kind: "ok" | "error";
  text: string;
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
  const [playback, dispatchPlayback] = useReducer(
    storyPlaybackReducer,
    initialStoryPlayback,
  );
  const { paused, hidden, status: state } = playback;
  const setPaused = (value: boolean) =>
    dispatchPlayback({ type: value ? "pause" : "resume" });
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [monte, setMonte] = useState(false);

  // État d'interaction, chargé par le lecteur.
  const [catalog, setCatalog] = useState<StickerCatalogEntry[]>([]);
  /** Médias par story : le type suffit, les octets ont leur route. */
  const [mediaById, setMediaById] = useState<Record<string, { mime: string } | null>>({});
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});

  // Insights : la liste des vues, chargée seulement quand l'auteur l'ouvre.
  const [viewersOpen, setViewersOpen] = useState(false);
  const [viewers, setViewers] = useState<StoryViewerEntry[] | null>(null);
  const [viewersFailed, setViewersFailed] = useState(false);

  // Geste en cours sur la surface : départ du doigt, pour distinguer un
  // glissement (tourner la page, fermer) d'un simple toucher.
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const [placed, setPlaced] = useState<Record<string, PlacedSticker[]>>({});

  // Composeur de réponse.
  const [replyOpen, setReplyOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  /** Suppression en cours — évite le double appui sur la corbeille. */
  const [deleting, setDeleting] = useState(false);

  // Stickers : choix, puis placement au toucher.
  const [trayOpen, setTrayOpen] = useState(false);
  const [placing, setPlacing] = useState<StickerCatalogEntry | null>(null);
  /** Sticker sélectionné : c'est lui qui porte la croix de retrait. */
  const [selected, setSelected] = useState<string | null>(null);

  /**
   * Geste en cours sur un sticker posé. Un seul doigt déplace, deux doigts
   * pincent (distance → échelle) et tournent (angle → rotation).
   */
  const dragRef = useRef<{
    id: string;
    rect: DOMRect;
    start: { x: number; y: number };
    origin: { x: number; y: number; scale: number; rotation: number };
    pointers: Map<number, { x: number; y: number }>;
    base: { distance: number; angle: number; centerX: number; centerY: number } | null;
    latest: { x: number; y: number; scale: number; rotation: number };
  } | null>(null);

  /**
   * Préchargement de la story suivante.
   *
   * Sans lui, passer à la suite laissait un cadre noir le temps d'un
   * aller-retour réseau — c'est le « ça met trop de temps à s'afficher »
   * qu'on ressent sur un téléphone. L'image suivante est demandée pendant
   * qu'on lit celle-ci ; le navigateur la sert depuis son cache ensuite.
   */
  useEffect(() => {
    const nextStory = stories[index + 1];
    if (!nextStory) return;
    // Le média en base a sa propre route ; une vidéo déposée sur le
    // stockage objet ne se précharge pas comme une image.
    const src = mediaById[nextStory.id]?.mime
      ? nextStory.media_url && !mediaById[nextStory.id]
        ? ""
        : storyMediaUrl(nextStory.id)
      : nextStory.media_url && !isVideoUrl(nextStory.media_url)
        ? nextStory.media_url
        : "";
    if (!src) return;
    const image = new Image();
    image.decoding = "async";
    image.src = src;
  }, [index, mediaById, stories]);

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
          dispatchPlayback({ type: "unavailable" });
          return;
        }
        setCatalog(feed.catalog);
        setMediaById(
          Object.fromEntries(feed.stories.map((s) => [s.id, s.media] as const)),
        );
        setLiked(new Set(feed.stories.filter((s) => s.liked).map((s) => s.id)));
        setLikeCounts(
          Object.fromEntries(feed.stories.map((s) => [s.id, s.likes] as const)),
        );
        setViewCounts(
          Object.fromEntries(feed.stories.map((s) => [s.id, s.views] as const)),
        );
        setPlaced(
          Object.fromEntries(feed.stories.map((s) => [s.id, s.stickers] as const)),
        );
        dispatchPlayback({ type: "loaded" });
      })
      .catch(() => {
        if (alive) dispatchPlayback({ type: "unavailable" });
      });
    return () => {
      alive = false;
    };
  }, []);

  // Insights : chargés à la demande. Tant que la liste n'est pas ouverte,
  // aucune requête n'est faite pour elle.
  useEffect(() => {
    if (!viewersOpen) return;
    const storyId = current?.id;
    if (!storyId) return;
    let alive = true;
    fetchStoryViewers(storyId).then((list) => {
      if (!alive) return;
      if (list === null) {
        setViewersFailed(true);
        return;
      }
      setViewers(list);
    });
    return () => {
      alive = false;
    };
  }, [viewersOpen, current?.id]);

  // Vue : une seule fois par story et par ouverture.
  useEffect(() => {
    if (!current || !me) return;
    if (seenRef.current.has(current.id)) return;
    seenRef.current.add(current.id);
    void markStorySeen(current.id);
  }, [current, me]);

  const next = useCallback(() => {
    // On ne tourne pas la page sous les doigts de quelqu'un qui écrit :
    // une réponse en cours doit rester en face de la story à laquelle
    // elle répond.
    if (replyOpen) return;
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
    setViewersOpen(false);
    setMediaDuration(null);
  }, [index, stories.length, onClose, replyOpen]);

  const prev = useCallback(() => {
    if (replyOpen) return;
    setIndex((i) => (i === 0 ? 0 : i - 1));
    setFeedback(null);
    setReplyOpen(false);
    setDraft("");
    setTrayOpen(false);
    setPlacing(null);
    setViewersOpen(false);
    setMediaDuration(null);
  }, [replyOpen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () =>
      dispatchPlayback({ type: "visibility", hidden: document.hidden });
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const storyDurationMs =
    mediaDuration && mediaDuration > 0 ? Math.max(1500, Math.round(mediaDuration * 1000)) : STORY_MS;

  // Avance automatique : suspendue par la composition, le catalogue,
  // le placement, un appui, un onglet caché ou un mouvement réduit.
  useEffect(() => {
    if (paused || hidden || replyOpen || trayOpen || placing || viewersOpen || !current) return;
    if (reduced) return;
    const timer = setTimeout(next, storyDurationMs);
    return () => clearTimeout(timer);
  }, [index, paused, hidden, replyOpen, trayOpen, placing, viewersOpen, next, current, storyDurationMs, reduced]);

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
      // Flèches sur un sticker sélectionné : le déplacement du sticker a
      // priorité sur la navigation entre stories.
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest("button[aria-pressed]") && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        return;
      }
      if (event.key === "ArrowRight" && !replyOpen) next();
      if (event.key === "ArrowLeft" && !replyOpen) prev();
      if (event.key === " " && !replyOpen) {
        event.preventDefault();
        dispatchPlayback({ type: "toggle-pause" });
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
    setPaused(false);
    setFeedback({ kind: "ok", text: "Réponse envoyée en privé" });
  }

  /**
   * Réaction rapide : un emoji part comme réponse privée.
   *
   * Pas de canal parallèle, pas de compteur public : l'emoji arrive dans
   * la conversation, exactement comme un mot tapé.
   */
  async function react(emoji: string) {
    if (!current) return;
    const result = await replyToStory(current.id, emoji);
    if (!result.ok) {
      setFeedback({ kind: "error", text: result.error });
      return;
    }
    setFeedback({ kind: "ok", text: `${emoji} envoyé à l’auteur` });
  }

  /**
   * Fin de geste sur la surface : un glissement tourne la page ou ferme, un
   * appui simple ne fait rien (les zones gauche/droite gardent leur rôle).
   *
   * Le geste part du média : un appui sur un bouton, une vidéo ou le champ
   * de réponse n'est jamais interprété comme une navigation.
   */
  function endSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, textarea, video, a, [role='button']")) return;
    if (placing) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > PAGE_SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) next();
      else prev();
      return;
    }
    if (dy > CLOSE_SWIPE_PX && Math.abs(dy) > Math.abs(dx) * 1.4) onClose();
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

  function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
  }

  function clampScale(value: number): number {
    return Math.min(3, Math.max(0.5, value));
  }

  /** Rotation ramenée dans (−180, 180] : un tour complet vaut zéro. */
  function clampRotation(value: number): number {
    const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
    return Math.round(wrapped * 10) / 10;
  }

  function setStickerValues(
    storyId: string,
    placedId: string,
    next: { x: number; y: number; scale: number; rotation: number },
  ) {
    setPlaced((all) => ({
      ...all,
      [storyId]: (all[storyId] ?? []).map((item) =>
        item.id === placedId ? { ...item, ...next } : item,
      ),
    }));
  }

  function beginDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    sticker: PlacedSticker,
  ) {
    if (!isMine || placing) return;
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(sticker.id);
    dragRef.current = {
      id: sticker.id,
      rect,
      start: { x: event.clientX, y: event.clientY },
      origin: { x: sticker.x, y: sticker.y, scale: sticker.scale, rotation: sticker.rotation },
      pointers: new Map([[event.pointerId, { x: event.clientX, y: event.clientY }]]),
      base: null,
      latest: { x: sticker.x, y: sticker.y, scale: sticker.scale, rotation: sticker.rotation },
    };
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    drag.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = [...drag.pointers.values()];

    let next: { x: number; y: number; scale: number; rotation: number };
    if (pointers.length >= 2) {
      const [a, b] = pointers;
      const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      const centerX = (a.x + b.x) / 2;
      const centerY = (a.y + b.y) / 2;
      if (!drag.base) drag.base = { distance, angle, centerX, centerY };
      next = {
        x: clamp01(drag.origin.x + (centerX - drag.base.centerX) / drag.rect.width),
        y: clamp01(drag.origin.y + (centerY - drag.base.centerY) / drag.rect.height),
        scale: clampScale(drag.origin.scale * (distance / drag.base.distance)),
        rotation: clampRotation(drag.origin.rotation + angle - drag.base.angle),
      };
    } else {
      const [point] = pointers;
      next = {
        x: clamp01(drag.origin.x + (point.x - drag.start.x) / drag.rect.width),
        y: clamp01(drag.origin.y + (point.y - drag.start.y) / drag.rect.height),
        scale: drag.origin.scale,
        rotation: drag.origin.rotation,
      };
    }

    drag.latest = next;
    if (current) setStickerValues(current.id, drag.id, next);
  }

  async function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    drag.pointers.delete(event.pointerId);

    if (drag.pointers.size > 0) {
      // Un doigt reste posé : on repart de la position atteinte.
      const [point] = [...drag.pointers.values()];
      drag.origin = { ...drag.latest };
      drag.start = { x: point.x, y: point.y };
      drag.base = null;
      return;
    }

    dragRef.current = null;
    const storyId = current?.id;
    if (!storyId) return;
    const next = drag.latest;
    const moved =
      next.x !== drag.origin.x ||
      next.y !== drag.origin.y ||
      next.scale !== drag.origin.scale ||
      next.rotation !== drag.origin.rotation;
    if (!moved) return;

    const result = await moveStorySticker(storyId, drag.id, next);
    if (!result.ok) {
      setStickerValues(storyId, drag.id, drag.origin);
      setFeedback({ kind: "error", text: result.error });
      return;
    }
    setStickerValues(storyId, drag.id, {
      x: result.sticker.x,
      y: result.sticker.y,
      scale: result.sticker.scale,
      rotation: result.sticker.rotation,
    });
  }

  async function nudge(event: React.KeyboardEvent<HTMLButtonElement>, sticker: PlacedSticker) {
    if (!isMine || !current) return;
    const step = event.shiftKey ? 0.1 : 0.02;
    const delta =
      event.key === "ArrowLeft"
        ? [-step, 0]
        : event.key === "ArrowRight"
          ? [step, 0]
          : event.key === "ArrowUp"
            ? [0, -step]
            : event.key === "ArrowDown"
              ? [0, step]
              : null;
    if (!delta) return;

    event.preventDefault();
    event.stopPropagation();
    const storyId = current.id;
    const next = {
      x: clamp01(sticker.x + delta[0]),
      y: clamp01(sticker.y + delta[1]),
      scale: sticker.scale,
      rotation: sticker.rotation,
    };
    setStickerValues(storyId, sticker.id, next);
    const result = await moveStorySticker(storyId, sticker.id, next);
    if (!result.ok) {
      setStickerValues(storyId, sticker.id, {
        x: sticker.x,
        y: sticker.y,
        scale: sticker.scale,
        rotation: sticker.rotation,
      });
      setFeedback({ kind: "error", text: result.error });
    }
  }

  async function removePlaced(sticker: PlacedSticker) {
    if (!current) return;
    const storyId = current.id;
    const before = placed[storyId] ?? [];
    setPlaced((all) => ({
      ...all,
      [storyId]: (all[storyId] ?? []).filter((item) => item.id !== sticker.id),
    }));
    setSelected(null);

    const result = await removeStorySticker(storyId, sticker.id);
    if (!result.ok) {
      setPlaced((all) => ({ ...all, [storyId]: before }));
      setFeedback({ kind: "error", text: result.error });
      return;
    }
    setFeedback({ kind: "ok", text: "Sticker retiré" });
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
      className="story-stage fixed inset-0 z-(--z-modal) flex flex-col"
      style={{
        // iPhone X et suivants : le contenu ne passe ni sous l'encoche ni
        // sous la barre d'accueil. `viewport-fit=cover` est déjà posé.
        paddingTop: "var(--h-safe-top)",
        paddingBottom: "var(--h-safe-bottom)",
      }}
      onPointerDown={(event) => {
        // Un appui sur la story met en pause le temps de la lecture.
        if (event.target === event.currentTarget) setPaused(true);
      }}
      onPointerUp={() => setPaused(false)}
    >
      {/* Barres de progression : un segment par story de la série. */}
      <div className="story-film absolute inset-x-0 top-0 z-10 flex gap-1 p-3">
        {stories.map((story, i) => (
          <span key={story.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-void/25">              <span
              key={`${story.id}-${index}-${paused}-${hidden}-${replyOpen}-${trayOpen}-${placing}-${viewersOpen}-${storyDurationMs}`}
              className={`block h-full origin-left rounded-full bg-signal will-change-transform ${
                i < index ? "scale-x-100" : i === index ? "animate-[storyBar_linear_forwards]" : "scale-x-0"
              }`}
              style={
                i === index
                  ? {
                      animationDuration: `${storyDurationMs}ms`,
                      animationPlayState:
                        paused || hidden || replyOpen || trayOpen || placing || viewersOpen ? "paused" : "running",
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

      <header className="story-credit absolute inset-x-0 top-0 z-10 flex items-center gap-2.5 px-3 pt-4">
        <Avatar
          name={author?.prenom}
          color={author?.avatar_color}
          src={author?.avatar_url}
          className="size-[34px] border border-line-2/70 text-13"
        />
        <div className="min-w-0 flex-1">
          <div className="text-13 font-bold text-chalk">
            {author?.prenom ?? "Quelqu'un"}
            <span className="ml-1.5 font-mono text-12 font-normal text-chalk/60">
              @{author?.pseudo ?? ""}
            </span>
          </div>
          <div className="text-12 text-chalk/60">{timeAgo(current.created_at)}</div>
        </div>

        {isMine && count > 0 && (
          <span className="label-micro mr-1 flex items-center gap-1 text-chalk/70">
            <SectionIcon name="heart" size={13} />
            {count}
          </span>
        )}

        {/* Insights : la porte des vues n'existe que chez l'auteur — la RLS
            répondrait « personne » à tout le monde d'autre, mais un bouton
            qui n'ouvre rien n'a pas à exister. */}
        {isMine && (
          <button
            type="button"
            onClick={() => {
              setViewers(null);
              setViewersFailed(false);
              setViewersOpen(true);
            }}
            aria-label="Voir qui a regardé ce statut"
            title="Qui a vu"
            className="story-control mr-1 flex h-11 items-center gap-1.5 px-2.5
              text-chalk/70 transition-colors hover:text-chalk"
          >
            <SectionIcon name="eye" size={14} />
            <span className="label-micro tnum">{viewCounts[current.id] ?? 0}</span>
          </button>
        )}

        {isMine && onDelete && (
          <button
            type="button"
            disabled={deleting}
            onClick={async () => {
              if (deleting) return;
              setDeleting(true);
              // La liste est tenue par le parent : c'est lui qui sait
              // quelle story reste à montrer après celle-ci.
              await onDelete(current.id);
              setDeleting(false);
              setFeedback({ kind: "ok", text: "Story supprimée" });
            }}
            aria-label="Supprimer cette story"
            title="Supprimer cette story"
            className="story-control flex size-11 items-center justify-center
              text-chalk/70 transition-colors hover:text-danger disabled:opacity-40"
          >
            <SectionIcon name="trash" size={15} />
          </button>
        )}

        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="story-control flex size-11 items-center justify-center
            text-chalk hover:border-signal hover:text-signal"
        >
          <SectionIcon name="close" size={16} strokeWidth={1.9} />
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <div className="h-full w-full max-w-[min(100%,540px)]">
          <div
            ref={surfaceRef}
            className="story-aperture relative h-full p-[1px]"
            style={{ background: "var(--color-line-2)" }}
            onDoubleClick={() => void like()}
            onPointerDown={(event) => {
              swipeRef.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerUp={endSwipe}
            onPointerCancel={() => {
              swipeRef.current = null;
            }}
            onClick={(event) => {
              if (!placing) return;
              const rect = event.currentTarget.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) return;
              const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
              const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
              void place(placing, x, y);
            }}
          >
            <div className="story-frame relative flex h-full min-h-0 flex-col overflow-hidden bg-void">

              {mediaById[current.id]?.mime.startsWith("video/") ? (
                <video
                  src={storyMediaUrl(current.id)}
                  playsInline
                  preload="auto"
                  autoPlay={!reduced}
                  className="absolute inset-0 h-full w-full bg-void object-contain"
                  onLoadedMetadata={(e) => {
                    const d = e.currentTarget.duration;
                    if (Number.isFinite(d) && d > 0) setMediaDuration(d);
                  }}
                  onEnded={() => next()}
                />
              ) : mediaById[current.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={storyMediaUrl(current.id)}
                  alt=""
                  decoding="async"
                  fetchPriority="high"
                  className="absolute inset-0 h-full w-full bg-void object-cover"
                />
              ) : current.media_url && isVideoUrl(current.media_url) ? (
                /* Vidéo déposée sur le stockage objet : ses octets ne sont
                   pas en base, mais elle se lit exactement comme les
                   autres. */
                <video
                  src={current.media_url}
                  playsInline
                  preload="auto"
                  autoPlay={!reduced}
                  className="absolute inset-0 h-full w-full bg-void object-contain"
                  onLoadedMetadata={(e) => {
                    const d = e.currentTarget.duration;
                    if (Number.isFinite(d) && d > 0) setMediaDuration(d);
                  }}
                  onEnded={() => next()}
                />
              ) : current.media_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={current.media_url}
                  alt=""
                  decoding="async"
                  fetchPriority="high"
                  className="absolute inset-0 h-full w-full bg-void object-cover"
                />
              ) : (
                /* Un statut sans média est du texte, et rien d'autre :
                   il se lit au centre, comme dans l'éditeur. Le texte
                   n'est pas répété sous une image — l'éditeur l'a déjà
                   gravé dans l'export, et deux fois le même mot, c'est
                   une faute d'affichage, pas une légende. */
                <div
                  className="grid min-h-0 flex-1 place-items-center px-8 py-16"
                  style={{
                    background: `linear-gradient(160deg, var(--story-bg-${storyTint(current.id)}-a), var(--story-bg-${storyTint(current.id)}-b))`,
                  }}
                >
                  <p
                    className="max-h-[70%] overflow-y-auto whitespace-pre-wrap text-center
                      text-[24px] leading-[1.4] font-semibold text-chalk"
                    style={{ textShadow: "var(--story-text-shadow)" }}
                  >
                    {current.caption || ""}
                  </p>
                </div>
              )}

              {/*
                Stickers posés — positionnés en fraction de la surface.

                Chez l'auteur, un sticker est un objet qu'on manipule : un
                doigt le déplace, deux doigts le pincent (échelle) et le
                tournent. Chez les autres, il reste une décoration : pas de
                poignée, pas de geste, rien qui laisse croire qu'on peut y
                toucher.
              */}
              {currentPlaced.map((sticker) => (
                <span
                  key={sticker.id}
                  className="absolute"
                  style={{ left: `${sticker.x * 100}%`, top: `${sticker.y * 100}%` }}
                >
                  {isMine ? (
                    <>
                      <button
                        type="button"
                        title={sticker.name}
                        aria-label={`Déplacer ${sticker.name} — un doigt pour déplacer, deux pour pincer et tourner, flèches pour ajuster`}
                        aria-pressed={selected === sticker.id}
                        onPointerDown={(event) => beginDrag(event, sticker)}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected(sticker.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Delete" || event.key === "Backspace") {
                            event.preventDefault();
                            void removePlaced(sticker);
                            return;
                          }
                          void nudge(event, sticker);
                        }}
                        className={`absolute flex items-center justify-center rounded-(--radius-chip) p-1
                          outline-2 outline-offset-2 outline-signal ${
                            placing ? "pointer-events-none" : "cursor-grab touch-none active:cursor-grabbing"
                          }`}
                        style={{
                          transform: `translate(-50%, -50%) rotate(${sticker.rotation}deg) scale(${sticker.scale})`,
                          outlineStyle: selected === sticker.id ? "solid" : "none",
                        }}
                      >
                        <StoryStickerFace
                          kind={sticker.kind}
                          glyph={sticker.glyph}
                          fg={sticker.fg}
                          bg={sticker.bg}
                          assetId={sticker.stickerId}
                          size={46}
                        />
                      </button>

                      {selected === sticker.id ? (
                        <button
                          type="button"
                          aria-label={`Retirer ${sticker.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void removePlaced(sticker);
                          }}
                          className="story-control absolute flex size-11 items-center justify-center
                            bg-void/85 text-chalk hover:text-danger"
                          style={{ transform: "translate(-50%, -165%)" }}
                        >
                          <SectionIcon name="close" size={14} />
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <span
                      title={sticker.name}
                      aria-hidden
                      className="pointer-events-none absolute select-none rounded-(--radius-chip) p-1"
                      style={{
                        transform: `translate(-50%, -50%) rotate(${sticker.rotation}deg) scale(${sticker.scale})`,
                      }}
                    >
                      <StoryStickerFace
                        kind={sticker.kind}
                        glyph={sticker.glyph}
                        fg={sticker.fg}
                        bg={sticker.bg}
                        assetId={sticker.stickerId}
                        size={46}
                      />
                    </span>
                  )}
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

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {feedback?.text ?? ""}
      </p>
      {feedback ? (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          className={`absolute inset-x-0 bottom-24 mx-auto w-fit rounded-full px-3 py-1.5
            label-micro ${feedback.kind === "error" ? "bg-danger text-void" : "bg-ok text-void"}`}
        >
          {feedback.text}
        </p>
      ) : null}

      {state === "unavailable" && !feedback ? (
        <p className="absolute inset-x-0 bottom-24 mx-auto w-fit rounded-full bg-void/70 px-3 py-1.5 label-micro text-chalk/70">
          Interactions indisponibles (mode démonstration)
        </p>
      ) : null}

      {/* ── Qui a vu — panneau de l'auteur ──────────────────────────── */}
      {viewersOpen ? (
        <div className="absolute inset-0 z-20 flex flex-col justify-end bg-void/60 sm:p-4">
          {/* Fermer est une action, donc un bouton : un fond cliquable en
              `div` ne serait ni annoncé, ni atteignable au clavier. */}
          <button
            type="button"
            aria-label="Fermer la liste des vues"
            onClick={() => setViewersOpen(false)}
            className="absolute inset-0 cursor-default"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Personnes ayant vu ce statut"
            className="story-tray relative mx-auto max-h-[70%] min-h-[132px] w-full
              max-w-[440px] overflow-y-auto rounded-t-(--radius-card) p-3
              pb-[max(12px,var(--h-safe-bottom))] sm:rounded-(--radius-card)"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="label-micro text-chalk-3">
                Vues · 24 h · {viewers?.length ?? viewCounts[current.id] ?? 0}
              </span>
              <button
                type="button"
                onClick={() => setViewersOpen(false)}
                aria-label="Fermer la liste des vues"
                className="flex size-11 items-center justify-center text-chalk/70"
              >
                <SectionIcon name="close" size={14} />
              </button>
            </div>

            {viewersFailed ? (
              // La démonstration n’a pas de vues nominatives : le total
              // reste vrai, le détail ne l’est pas. On le dit plutôt que de
              // laisser un panneau vide ou une promesse en l’air.
              <p className="px-1 py-2 label-micro text-chalk/60">
                Le détail des vues est indisponible ici. Le total, lui, est à jour.
              </p>
            ) : viewers === null ? (
              <p className="px-1 py-2 label-micro text-chalk/50">Chargement…</p>
            ) : viewers.length === 0 ? (
              <p className="px-1 py-2 label-micro text-chalk/60">
                Personne n’a encore regardé ce statut.
              </p>
            ) : (
              <ul className="flex flex-col">
                {viewers.map((viewer) => (
                  <li key={viewer.id} className="flex items-center gap-2.5 py-1.5">
                    <Avatar name={viewer.prenom} color={viewer.avatar_color} className="size-8 text-12" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-13 font-semibold text-chalk">
                        {viewer.prenom}
                      </span>
                      <span className="block truncate font-mono text-12 text-chalk/60">
                        @{viewer.pseudo}
                      </span>
                    </span>
                    <time dateTime={viewer.seenAt} className="label-micro shrink-0 text-chalk/50">
                      {timeAgo(viewer.seenAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
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
              className="min-w-0 flex-1 rounded-(--radius-input) border border-line-2
                bg-surface px-3 py-2 text-base text-chalk placeholder:text-chalk-4"
            />
            <button
              type="submit"
              disabled={sending || draft.trim().length === 0}
              className="flex h-11 items-center rounded-(--radius-input) bg-signal px-3
                text-13 font-bold text-void disabled:opacity-50"
            >
              {sending ? "Envoi…" : "Envoyer"}
            </button>
            <button
              type="button"
              onClick={() => {
                setReplyOpen(false);
                setPaused(false);
              }}
              aria-label="Fermer la réponse"
              className="story-control flex size-11 items-center justify-center text-chalk/70"
            >
              <SectionIcon name="close" size={14} />
            </button>
          </form>
        ) : trayOpen ? (
          <div className="story-tray p-2">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="label-micro text-chalk-3">Pellicule de stickers</span>
              <Link
                href="/stickers"
                className="ml-auto min-h-9 rounded-(--radius-chip) px-2
                  label-micro text-signal hover:bg-surface-2"
              >
                Créer les miens
              </Link>
              <button
                type="button"
                onClick={() => setTrayOpen(false)}
                aria-label="Fermer les stickers"
                className="flex size-11 items-center justify-center text-chalk/70"
              >
                <SectionIcon name="close" size={14} />
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
                    className="flex h-11 items-center justify-center rounded-(--radius-chip)
                      text-[22px] hover:bg-surface-2"
                  >
                    <StoryStickerFace
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
          <>
            {/* Réactions rapides : un geste, pas un clavier. Elles
                n'existent pas sur sa propre story — on ne s'écrit pas à
                soi-même. */}
            {!isMine && me ? (
              <div className="mb-2 flex items-center justify-center gap-1">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => void react(emoji)}
                    aria-label={`Réagir avec ${emoji}`}
                    className="story-control flex size-11 items-center justify-center
                      text-[20px] leading-none transition-transform active:scale-95"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}

          <div className="flex items-center gap-2">
            {/* Sur son propre statut, une barre de réponse et un cœur
                désactivés ne sont pas des contrôles : ce sont des
                reproches. On ne les affiche pas. */}
            {!isMine && me ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setPaused(true);
                    setReplyOpen(true);
                  }}
                  className="story-control flex h-11 flex-1 items-center gap-2 px-3
                    text-13 text-chalk/70"
                >
                  <SectionIcon name="reply" size={15} />
                  Répondre en privé…
                </button>

                <button
                  type="button"
                  onClick={() => void like()}
                  aria-pressed={currentLiked}
                  aria-label={currentLiked ? "Retirer le j’aime" : "Aimer cette story"}
                  className={`story-control flex size-11 items-center justify-center
                    transition-colors ${currentLiked ? "bg-signal text-void" : "text-chalk"}`}
                >
                  <SectionIcon
                    name="heart"
                    size={18}
                    strokeWidth={currentLiked ? 2.4 : 1.7}
                    style={currentLiked ? { fill: "currentColor" } : undefined}
                  />
                </button>
              </>
            ) : null}

            {isMine && (
              <button
                type="button"
                onClick={() => setTrayOpen(true)}
                aria-label="Poser un sticker"
                className="story-control flex size-11 items-center justify-center text-chalk"
              >
                <SectionIcon name="sticker" size={17} />
              </button>
            )}
          </div>
          </>
        )}

        {/* Raccourcis clavier : sur un téléphone, il n'y a pas de clavier
            et la ligne ne fait que pousser le pouce hors de l'écran. */}
        <p className="mt-2 hidden text-center label-micro text-chalk/35 sm:block">
          ← → naviguer · Espace pause · glisser pour fermer · double-clic aimer
        </p>
      </footer>
    </div>,
    document.body,
  );
}
