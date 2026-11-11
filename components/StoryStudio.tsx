"use client";

/**
 * Studio de statut — on compose dans le cadre final.
 *
 * Le cadre 9:16 n'est pas une vignette à côté d'un formulaire : c'est le
 * brouillon. La légende s'écrit dedans, le média s'y dépose, et les gestes
 * de lecture (pause, son) sont ceux du lecteur. Ce qu'on voit avant de
 * publier est ce que les autres verront après.
 *
 * La vidéo suit le même chemin que la photo : elle est montrée localement,
 * puis re-encodée par le serveur (MP4/H.264, 15 s, 720 px) avant d'être
 * publiée. Rien du fichier d'origine n'est servi tel quel.
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

type DraftMedia = {
  file: File;
  url: string;
  kind: "image" | "video";
  size: number;
};

/** Mêmes bornes que le serveur : on refuse tôt, avec une phrase utile. */
const IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const VIDEO_MAX_BYTES = 40 * 1024 * 1024;
const VIDEO_MAX_SECONDS = 15;

function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
    : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

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
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  function reset() {
    setCaption("");
    setBusy(false);
    setError(null);
    setDuration(null);
    setMuted(true);
    setPlaying(true);
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
    const isImage = file.type.startsWith("image/");
    if (!isVideo && !isImage) {
      setError("Choisis une photo ou une vidéo.");
      return;
    }
    if (isVideo && file.size > VIDEO_MAX_BYTES) {
      setError(`Vidéo trop lourde (${formatSize(VIDEO_MAX_BYTES)} maximum).`);
      return;
    }
    if (isImage && file.size > IMAGE_MAX_BYTES) {
      setError(`Photo trop lourde (${formatSize(IMAGE_MAX_BYTES)} maximum).`);
      return;
    }

    setError(null);
    setDuration(null);
    setPlaying(true);
    setMuted(true);
    setMedia((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return {
        file,
        url: URL.createObjectURL(file),
        kind: isVideo ? "video" : "image",
        size: file.size,
      };
    });
  }

  function removeMedia() {
    URL.revokeObjectURL(media?.url ?? "");
    setMedia(null);
    setDuration(null);
    setPlaying(true);
    setError(null);
  }

  async function publish() {
    if (!profile || busy) return;
    const text = caption.trim();
    if (!text && !media) {
      setError("Écris une légende ou choisis un média.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (media) {
        const { id, error: uploadError } = await publishStoryMedia(text, media.file);
        if (uploadError || !id) {
          setError(uploadError ?? "Réponse vide du serveur.");
          return;
        }
      } else {
        const { error: publishError } = await publishStory(profile.id, text);
        if (publishError) {
          setError(publishError);
          return;
        }
      }
      await onPublished();
      toast("Statut publié · 24 h");
      close();
    } finally {
      setBusy(false);
    }
  }

  const canPublish = Boolean(profile) && !busy && (caption.trim().length > 0 || media !== null);
  const nearLimit = caption.length > STORY_MAX - 20;
  const tooLong = duration !== null && duration > VIDEO_MAX_SECONDS + 0.5;
  const shownDuration = formatDuration(duration);

  /** La scène accepte le dépôt : le geste naturel d'un média. */
  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    pickMedia(event.dataTransfer.files?.[0]);
  }

  return (
    <Sheet open={open} onClose={close} title="Studio de statut" size="wide">
      <div className="md:grid md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] md:gap-6">
        {/* ── La scène : le cadre final, éditable ───────────────────── */}
        <div>
          <div className="mx-auto w-full max-w-[280px] md:max-w-none">
            <div
              className="rounded-[calc(var(--radius-card)+4px)] p-[2px]"
              style={{ background: "var(--story-ring-gradient)" }}
            >
              <div
                className="relative overflow-hidden rounded-[var(--radius-card)] bg-void"
                style={{ aspectRatio: "9 / 16" }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={onDrop}
              >
                {media ? (
                  media.kind === "video" ? (
                    <video
                      ref={videoRef}
                      src={media.url}
                      muted={muted}
                      loop
                      autoPlay={playing}
                      playsInline
                      aria-label="Aperçu de la vidéo du statut"
                      onLoadedMetadata={(event) => {
                        const seconds = event.currentTarget.duration;
                        setDuration(Number.isFinite(seconds) ? seconds : null);
                      }}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      className="size-full object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={media.url}
                      alt="Aperçu de la photo du statut"
                      className="size-full object-cover"
                    />
                  )
                ) : (
                  <div
                    aria-hidden="true"
                    className="size-full"
                    style={{
                      background:
                        "radial-gradient(120% 80% at 20% 10%, var(--color-surface-2), var(--color-void) 62%)",
                    }}
                  >
                    <div className="flex size-full items-center justify-center px-6 text-center">
                      <p className="font-display text-[15px] leading-snug text-chalk-4">
                        Dépose une photo ou une vidéo,
                        <br />
                        ou écris simplement.
                      </p>
                    </div>
                  </div>
                )}

                {/* Identité et échéance, comme dans le lecteur. */}
                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-void/85 to-transparent px-3 pt-3 pb-8">
                  <Avatar
                    name={profile?.prenom ?? "moi"}
                    color={profile?.avatar_color}
                    className="size-7 text-xs"
                  />
                  <span className="min-w-0 truncate text-xs font-bold text-chalk">
                    @{profile?.pseudo ?? "moi"}
                  </span>
                  <span className="label-micro ml-auto shrink-0 text-chalk/70">24 h</span>
                </div>

                {/* Contrôles du média, posés sur l'image comme dans un lecteur. */}
                {media && (
                  <div className="absolute top-12 right-2 flex flex-col gap-1.5">
                    {media.kind === "video" && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const element = videoRef.current;
                            if (!element) return;
                            if (element.paused) void element.play();
                            else element.pause();
                          }}
                          aria-label={playing ? "Mettre la vidéo en pause" : "Lire la vidéo"}
                          className="flex size-8 items-center justify-center rounded-full border border-chalk/20 bg-void/60 text-chalk backdrop-blur-sm hover:bg-void/85"
                        >
                          <Icon name={playing ? "pause" : "play"} size={14} strokeWidth={2} fill="currentColor" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setMuted((value) => !value)}
                          aria-label={muted ? "Activer le son de la vidéo" : "Couper le son de la vidéo"}
                          className="flex size-8 items-center justify-center rounded-full border border-chalk/20 bg-void/60 text-chalk backdrop-blur-sm hover:bg-void/85"
                        >
                          <Icon name={muted ? "volume-off" : "volume"} size={14} strokeWidth={1.9} />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={removeMedia}
                      aria-label="Retirer le média"
                      className="flex size-8 items-center justify-center rounded-full border border-chalk/20 bg-void/60 text-chalk backdrop-blur-sm hover:border-danger hover:text-danger"
                    >
                      <Icon name="close" size={14} strokeWidth={2.2} />
                    </button>
                  </div>
                )}

                {/* La légende s'écrit à l'endroit où elle sera lue. */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-void/90 via-void/60 to-transparent px-3 pt-10 pb-3">
                  <label htmlFor="story-caption" className="sr-only">
                    Légende du statut
                  </label>
                  <textarea
                    id="story-caption"
                    value={caption}
                    onChange={(event) => setCaption(event.target.value)}
                    rows={3}
                    maxLength={STORY_MAX}
                    placeholder="Ta légende…"
                    className="w-full resize-none bg-transparent text-[15px] leading-snug
                      text-chalk placeholder:text-chalk/55"
                  />
                </div>

                {tooLong && (
                  <span className="absolute inset-x-3 top-12 rounded-chip border border-warn/50 bg-void/80 px-2 py-1 font-mono text-[10px] text-warn backdrop-blur-sm">
                    {shownDuration} — la vidéo sera coupée à {VIDEO_MAX_SECONDS} s
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mx-auto mt-2 flex w-full max-w-[280px] items-center justify-between font-mono text-[10px] text-chalk-4 md:max-w-none">
            <span>Aperçu · 9:16</span>
            <span className={nearLimit ? "tnum text-warn" : "tnum"}>
              {caption.length}/{STORY_MAX}
            </span>
          </div>
        </div>

        {/* ── Les outils : média, contraintes, publication ──────────── */}
        <div className="mt-5 min-w-0 md:mt-0 md:flex md:flex-col">
          <div className="flex items-center justify-between gap-3">
            <h3 className="label-micro text-chalk-3">Média</h3>
            {media && (
              <button
                type="button"
                onClick={removeMedia}
                disabled={busy}
                className="font-mono text-[10.5px] text-chalk-4 underline decoration-line-3 underline-offset-2 hover:text-danger"
              >
                Retirer
              </button>
            )}
          </div>

          {media ? (
            <div className="mt-2 rounded-input border border-line-2 bg-surface px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-chip border border-line-2 bg-surface-2 text-signal">
                  <Icon name={media.kind === "video" ? "video" : "image"} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-chalk">
                    {media.file.name}
                  </span>
                  <span className="block font-mono text-[10px] text-chalk-4">
                    {media.kind === "video" ? "Vidéo" : "Photo"} · {formatSize(media.size)}
                    {shownDuration ? ` · ${shownDuration}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="shrink-0 rounded-chip border border-line-2 px-2 py-1 font-mono text-[10px] text-chalk-3 hover:border-signal hover:text-signal"
                >
                  Changer
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop}
              disabled={busy}
              className="mt-2 flex w-full flex-col items-center gap-2 rounded-input border border-dashed border-line-3
                bg-surface/40 px-4 py-5 text-center transition-colors hover:border-signal hover:bg-surface"
            >
              <span className="flex size-10 items-center justify-center rounded-full border border-line-2 bg-surface-2 text-signal">
                <Icon name="video" size={18} />
              </span>
              <span className="text-xs font-bold text-chalk-2">Photo ou vidéo</span>
              <span className="font-mono text-[10px] leading-relaxed text-chalk-4">
                Glisse un fichier ici · 6 Mo photo · 40 Mo vidéo · 15 s
              </span>
            </button>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            className="sr-only"
            aria-label="Choisir une photo ou une vidéo pour le statut"
            onChange={(event) => {
              pickMedia(event.target.files?.[0]);
              event.target.value = "";
            }}
          />

          {error && (
            <p role="alert" className="mt-2 rounded-input border border-danger/40 bg-danger/8 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          <p className="mt-3 text-[11.5px] leading-relaxed text-chalk-4">
            Le serveur re-encode chaque média : WebP borné à 1080 px pour une
            photo, MP4/H.264 720 px et 15 s au plus pour une vidéo. Le fichier
            d&apos;origine n&apos;est jamais publié tel quel.
          </p>

          <div className="mt-4 flex gap-2 md:mt-auto md:pt-6">
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="mo-press flex h-11 flex-1 items-center justify-center rounded-input
                border border-line-3 bg-surface text-sm font-medium text-chalk-2 disabled:opacity-40"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void publish()}
              disabled={!canPublish}
              className="mo-press flex h-11 flex-[1.4] items-center justify-center gap-2
                rounded-input border border-line-3 bg-signal text-sm font-bold text-void
                shadow-sh-2 disabled:opacity-40"
            >
              <Icon name="spark" size={14} strokeWidth={2} />
              {busy ? "Publication…" : "Publier · 24 h"}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
