"use client";

/**
 * Studio de story — on compose ce qu'on verra.
 *
 * L'ancienne feuille demandait un texte dans un cadre : correct, mais on
 * ne voyait ni la forme finale, ni ce que devenait le média. Ici le
 * cadre 9:16 est le brouillon **et** l'aperçu : la légende s'y écrit, la
 * photo s'y pose, et l'anneau de marque rappelle l'échéance de 24 h.
 *
 * Deux chemins de publication, ceux qui existent déjà :
 * - texte seul → `publishStory` (table `stories`) ;
 * - photo ou vidéo → `publishStoryMedia`, qui monte le fichier et le
 *   fait re-encoder par le serveur.
 *
 * Aucun état n'est inventé côté client : si le serveur refuse un média,
 * on le dit et la story n'est pas publiée à moitié.
 */
import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Motion } from "./Motion";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { publishStory, publishStoryMedia, STORY_MAX } from "@/lib/stories";

type StudioProfile = {
  id: string;
  prenom: string;
  pseudo?: string;
  avatar_color?: string;
};

/** Un média choisi, avec son aperçu local — rien n'est envoyé avant Publier. */
type DraftMedia = { file: File; url: string; kind: "image" | "video" };

export function StoryStudio({
  open,
  onClose,
  profile,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  profile: StudioProfile | null;
  onPublished: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [caption, setCaption] = useState("");
  const [media, setMedia] = useState<DraftMedia | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Un brouillon ne survit pas à la fermeture : une story est un geste,
  // pas un document en cours. L'aperçu média, lui, doit être révoqué.
  function reset() {
    setCaption("");
    setBusy(false);
    setMedia((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  function close() {
    reset();
    onClose();
  }

  useEffect(() => {
    return () => {
      if (media) URL.revokeObjectURL(media.url);
    };
  }, [media]);

  function pickMedia(file: File | undefined) {
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    if (!isVideo && !file.type.startsWith("image/")) {
      toast("Choisis une photo ou une vidéo", "err");
      return;
    }
    setMedia((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { file, url: URL.createObjectURL(file), kind: isVideo ? "video" : "image" };
    });
  }

  async function publish() {
    if (!profile || busy) return;
    const text = caption.trim();
    if (!text && !media) return;

    setBusy(true);
    try {
      if (media) {
        const { id, error } = await publishStoryMedia(text, media.file);
        if (error || !id) {
          toast(`Story non publiée : ${error ?? "réponse vide"}`, "err");
          return;
        }
      } else {
        const { error } = await publishStory(profile.id, text);
        if (error) {
          toast(`Story non publiée : ${error}`, "err");
          return;
        }
      }
      await onPublished();
      toast("Story publiée · 24 h");
      close();
    } finally {
      setBusy(false);
    }
  }

  const canPublish = Boolean(profile) && !busy && (caption.trim().length > 0 || media !== null);
  const nearLimit = caption.length > STORY_MAX - 20;

  return (
    <Sheet open={open} onClose={close} title="Studio de story">
      {/* ── L'aperçu : le cadre final, à l'échelle du pouce ── */}
      <Motion role="scale" className="mx-auto mb-4 w-full max-w-60">
        <div className="rounded-card p-0.5" style={{ background: "var(--story-ring-gradient)" }}>
          <div
            className="relative overflow-hidden rounded-chip bg-void"
            style={{ aspectRatio: "9 / 16" }}
          >
            {media ? (
              media.kind === "video" ? (
                <video
                  src={media.url}
                  muted
                  loop
                  autoPlay
                  playsInline
                  aria-label="Aperçu de la vidéo de la story"
                  className="size-full object-cover"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={media.url}
                  alt="Aperçu de la photo de la story"
                  className="size-full object-cover"
                />
              )
            ) : (
              <div
                aria-hidden="true"
                className="size-full"
                style={{
                  background:
                    "linear-gradient(165deg, var(--color-surface-2), var(--color-void) 62%)",
                }}
              />
            )}

            {/* Qui parle, et jusqu'à quand — la même ligne que le lecteur. */}
            <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-void/80 to-transparent px-3 pt-3 pb-6">
              <Avatar
                name={profile?.prenom ?? "moi"}
                color={profile?.avatar_color}
                className="size-7 text-xs"
              />
              <span className="min-w-0 truncate text-xs font-bold text-chalk">
                @{profile?.pseudo ?? "moi"}
              </span>
              <span className="label-micro ml-auto shrink-0 text-chalk-3">24 h</span>
            </div>

            {/* La légende s'écrit là où elle sera lue. */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-void/85 to-transparent px-3 pt-8 pb-4">
              <p className="min-h-9 whitespace-pre-wrap break-words text-sm leading-snug text-chalk">
                {caption.trim() || (
                  <span className="text-chalk-4">Ta légende apparaîtra ici…</span>
                )}
              </p>
            </div>
          </div>
        </div>
      </Motion>

      {/* ── Le texte ── */}
      <label htmlFor="story-caption" className="label-micro mb-1.5 block text-chalk-3">
        Légende
      </label>
      <textarea
        id="story-caption"
        value={caption}
        onChange={(event) => setCaption(event.target.value)}
        rows={3}
        maxLength={STORY_MAX}
        placeholder="Ce que la story raconte…"
        className="w-full resize-none rounded-input border border-line-3 bg-surface px-3.5
          py-2.5 text-base leading-normal text-chalk shadow-sh-1
          placeholder:text-chalk-4 focus:border-signal"
      />

      <div className="mt-1.5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="mo-press flex min-h-11 items-center gap-1.5 rounded-chip border
            border-line-3 bg-surface px-3 text-xs font-medium text-chalk-2
            transition-colors hover:text-signal disabled:opacity-40"
        >
          <Icon name="image" size={16} strokeWidth={1.8} />
          {media ? "Changer le média" : "Photo ou vidéo"}
        </button>
        <span className={nearLimit ? "tnum font-mono text-xs text-warn" : "tnum font-mono text-xs text-chalk-4"}>
          {caption.length}/{STORY_MAX}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          className="sr-only"
          aria-label="Choisir une photo ou une vidéo pour la story"
          onChange={(event) => {
            pickMedia(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      {media && (
        <Motion
          role="slide"
          className="mt-2.5 flex items-center gap-2 rounded-input border border-line-2
            bg-surface-2/60 px-3 py-2"
        >
          <Icon name="image" size={14} className="shrink-0 text-signal" />
          <span className="min-w-0 flex-1 truncate text-xs text-chalk-2">
            {media.file.name}
          </span>
          <button
            type="button"
            onClick={() => {
              URL.revokeObjectURL(media.url);
              setMedia(null);
            }}
            aria-label="Retirer le média"
            className="flex size-9 shrink-0 items-center justify-center rounded-full
              text-chalk-4 transition-colors hover:text-danger"
          >
            <Icon name="close" size={14} strokeWidth={2.2} />
          </button>
        </Motion>
      )}

      <p className="mt-2.5 text-xs leading-relaxed text-chalk-4">
        Une photo est re-encodée par le serveur avant publication ; une vidéo
        est bornée à 15 s. Sans média, la légende suffit.
      </p>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={close}
          className="mo-press flex h-11 flex-1 items-center justify-center rounded-input
            border border-line-3 bg-surface text-sm font-medium text-chalk-2"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={() => void publish()}
          disabled={!canPublish}
          className="mo-press flex h-11 flex-1 items-center justify-center gap-2
            rounded-input border border-line-3 bg-signal text-sm font-bold text-void
            shadow-sh-2 disabled:opacity-40"
        >
          <Icon name="spark" size={14} strokeWidth={2} />
          {busy ? "Publication…" : "Publier"}
        </button>
      </div>
    </Sheet>
  );
}
