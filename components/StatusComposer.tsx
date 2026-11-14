"use client";

/**
 * Éditeur de statut — un seul écran, comme dans WhatsApp, Instagram ou
 * Snapchat : un fond, un texte qu'on tape et qu'on déplace, un bouton.
 *
 * Il remplace l'Atelier à calques : plus d'inspecteur, de transformations en
 * pourcentage ni de filtres. Ce qu'on voit est exactement ce qui est publié,
 * parce que la scène et l'export partagent le même dessin (canvas 1080 × 1920).
 *
 * Une vidéo n'est pas réencodée : elle part telle quelle et le texte est
 * joint comme légende. Une photo ou un fond de couleur est composé en image,
 * texte compris, pour que le rendu soit identique chez tous les lecteurs.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GifPicker } from "@/components/GifPicker";
import { Icon } from "@/components/Icon";
import type { Gif } from "@/lib/gifs";

const STAGE_W = 1080;
const STAGE_H = 1920;

/**
 * Fonds proposés, dans l'ordre du cycle « Fond ».
 *
 * Chaque entrée nomme deux variables CSS ; l'aperçu les compose en
 * dégradé et l'export relit la valeur calculée. Aucune couleur n'est
 * écrite ici : le thème reste la seule source.
 */
const BACKGROUNDS: [string, string][] = [
  ["--story-bg-1-a", "--story-bg-1-b"],
  ["--story-bg-2-a", "--story-bg-2-b"],
  ["--story-bg-3-a", "--story-bg-3-b"],
  ["--story-bg-4-a", "--story-bg-4-b"],
  ["--story-bg-5-a", "--story-bg-5-b"],
  ["--story-bg-6-a", "--story-bg-6-b"],
  ["--story-bg-7-a", "--story-bg-7-b"],
  ["--story-bg-8-a", "--story-bg-8-b"],
];

/** Encres du texte, du blanc au vert phosphor, en variables. */
const TEXT_COLORS = ["--story-ink-1", "--story-ink-2", "--story-ink-3", "--story-ink-4"];
/** Fractions de la largeur de scène : l'échelle suit l'écran, comme sur
 *  Instagram, au lieu de figer 76 px qui débordent sur un téléphone. */
const TEXT_SIZES = [0.09, 0.07, 0.052];
/** Noms des tailles, dans le même ordre — pour que le bouton dise sa valeur. */
const TEXT_SIZE_LABEL = ["Grand", "Moyen", "Petit"] as const;
/** Noms des encres, dans l'ordre de `TEXT_COLORS`. */
const TEXT_COLOR_LABEL = ["Blanc", "Encre", "Ambre", "Menthe"] as const;

/**
 * Ambiances, dans l'ordre du cycle « Filtre ».
 *
 * Ce sont des fonctions CSS : le canvas les accepte telles quelles, donc
 * l'aperçu et le fichier publié reçoivent **la même** chaîne. Un filtre
 * décrit ici ne peut pas mentir à l'export.
 */
const FILTERS: { label: string; css: string }[] = [
  { label: "Naturel", css: "none" },
  { label: "Chaud", css: "saturate(1.08) sepia(0.22) brightness(1.03)" },
  { label: "Froid", css: "saturate(0.94) hue-rotate(-10deg) brightness(1.03)" },
  { label: "Vintage", css: "sepia(0.4) saturate(0.82) contrast(0.94) brightness(1.04)" },
  { label: "Cinéma", css: "contrast(1.16) saturate(0.88) brightness(0.96)" },
  { label: "Noir et blanc", css: "grayscale(1) contrast(1.06)" },
  { label: "Contrasté", css: "contrast(1.24) saturate(1.08)" },
  { label: "Doux", css: "brightness(1.06) contrast(0.92) saturate(0.9)" },
];

/** Alignement du bloc de texte, dans l'ordre du cycle. */
const ALIGNMENTS = [
  { label: "gauche", css: "left", canvas: "left" },
  { label: "centre", css: "center", canvas: "center" },
  { label: "droite", css: "right", canvas: "right" },
] as const;

/**
 * Valeur réelle d'une variable de thème.
 *
 * Le canvas n'accepte pas `var(...)` : il lui faut la couleur résolue.
 * On la lit une fois, au moment de dessiner.
 */
function themeColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

type Source = { file: File; url: string; kind: "image" | "video" };

type ComposerProps = {
  open: boolean;
  onClose: () => void;
  /** Média déjà joint (reprise d'un brouillon). */
  initialMedia?: { url: string; kind: "image" | "video"; name?: string } | null;
  /** Fichier choisi avant l'ouverture. */
  sourceFile?: File | null;
  onUse: (file: File) => void | Promise<void>;
  onUseSource?: (file: File) => void | Promise<void>;
  /** GIF choisi : il part en **lien**, animé, sans passer par le canvas. */
  onUseGif?: (gif: Gif) => void | Promise<void>;
  onLayersChange?: (text: string) => void;
};

/**
 * L'éditeur est remonté à chaque ouverture, avec un média neuf : l'état
 * initial se calcule au rendu, sans effet ni remise à zéro manuelle.
 */
export function StatusComposer(props: ComposerProps) {
  if (!props.open) return null;
  const seed = props.sourceFile
    ? `${props.sourceFile.name}:${props.sourceFile.size}:${props.sourceFile.lastModified}`
    : (props.initialMedia?.url ?? "neuf");
  return <EditorShell key={seed} {...props} />;
}

function EditorShell({
  onClose,
  initialMedia = null,
  sourceFile = null,
  onUse,
  onUseSource,
  onUseGif,
  onLayersChange,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(true);
  const [background, setBackground] = useState(0);
  const [color, setColor] = useState(0);
  const [size, setSize] = useState(0);
  const [pos, setPos] = useState({ x: 50, y: 46 });
  const [filter, setFilter] = useState(0);
  const [align, setAlign] = useState(1);
  const [stageWidth, setStageWidth] = useState(360);
  const [source, setSource] = useState<Source | null>(() => {
    if (sourceFile) {
      return {
        file: sourceFile,
        url: URL.createObjectURL(sourceFile),
        kind: sourceFile.type.startsWith("video/") ? "video" : "image",
      };
    }
    if (initialMedia) {
      return {
        file: new File([], initialMedia.name ?? "media"),
        url: initialMedia.url,
        kind: initialMedia.kind,
      };
    }
    return null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** GIF choisi — il remplace le média et reste animé. */
  const [gif, setGif] = useState<Gif | null>(null);
  const [gifOpen, setGifOpen] = useState(false);

  const mediaInput = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const createdUrl = useRef<string | null>(source && sourceFile ? source.url : null);

  useEffect(() => {
    if (!createdUrl.current) return;
    return () => {
      if (createdUrl.current) URL.revokeObjectURL(createdUrl.current);
    };
  }, []);

  // La taille du texte suit la largeur réelle de la scène : c'est elle qui
  // décide si le texte tient, pas la fenêtre.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStageWidth(entry.contentRect.width);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    onLayersChange?.(text);
  }, [text, onLayersChange]);

  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => textRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  /**
   * Le champ grandit avec son texte.
   *
   * Un `textarea` de hauteur fixe défile : au-delà de deux lignes, le
   * début du statut disparaissait au-dessus du cadre — on écrivait à
   * l'aveugle dans ce qu'on croyait être une story.
   */
  useEffect(() => {
    const field = textRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [text, size, stageWidth, editing]);

  const pickFile = useCallback((file: File | null) => {
    if (!file) return;
    const kind = file.type.startsWith("video/")
      ? "video"
      : file.type.startsWith("image/")
        ? "image"
        : null;
    if (!kind) {
      setError("Choisis une photo ou une vidéo.");
      return;
    }
    setError(null);
    setGif(null);
    // Une nouvelle image invalide le cache de rendu : sans ça, l'export
    // canvas réutiliserait l'image précédente déjà décodée.
    imageRef.current = null;
    if (createdUrl.current) URL.revokeObjectURL(createdUrl.current);
    const url = URL.createObjectURL(file);
    createdUrl.current = url;
    setSource({ file, url, kind });
    setPos({ x: 50, y: 46 });
    setEditing(true);
  }, []);

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (editing) return;
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return;
    dragRef.current = {
      dx: pos.x - ((event.clientX - stage.left) / stage.width) * 100,
      dy: pos.y - ((event.clientY - stage.top) / stage.height) * 100,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!dragRef.current || !stage) return;
    const x = ((event.clientX - stage.left) / stage.width) * 100 + dragRef.current.dx;
    const y = ((event.clientY - stage.top) / stage.height) * 100 + dragRef.current.dy;
    setPos({ x: Math.min(92, Math.max(8, x)), y: Math.min(94, Math.max(6, y)) });
  }

  function endDrag() {
    dragRef.current = null;
  }

  /** Dessine exactement la scène affichée, en 1080 × 1920. */
  async function renderStage(): Promise<Blob | null> {
    const canvas = document.createElement("canvas");
    canvas.width = STAGE_W;
    canvas.height = STAGE_H;
    const context = canvas.getContext("2d");
    if (!context) return null;

    if (source?.kind === "image") {
      if (!imageRef.current) {
        imageRef.current = await new Promise<HTMLImageElement | null>((resolve) => {
          const image = new Image();
          image.crossOrigin = "anonymous";
          image.onload = () => resolve(image);
          image.onerror = () => resolve(null);
          image.src = source.url;
        });
      }
      const image = imageRef.current;
      if (image) {
        const scale = Math.max(STAGE_W / image.width, STAGE_H / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        // Le filtre est cuit dans les pixels : ce que l'on voit est ce qui
        // part sur le serveur, sans dépendre d'une propriété stockée.
        context.filter = FILTERS[filter].css;
        context.drawImage(image, (STAGE_W - width) / 2, (STAGE_H - height) / 2, width, height);
        context.filter = "none";
      } else {
        context.fillStyle = themeColor("--story-bg-1-a", "black");
        context.fillRect(0, 0, STAGE_W, STAGE_H);
      }
    } else {
      const palette = backgroundPalette();
      const gradient = context.createLinearGradient(0, 0, STAGE_W, STAGE_H);
      gradient.addColorStop(0, palette[0]);
      gradient.addColorStop(1, palette[1]);
      context.fillStyle = gradient;
      context.fillRect(0, 0, STAGE_W, STAGE_H);
    }

    const body = text.trim();
    if (body) {
      const fontSize = Math.round(TEXT_SIZES[size] * STAGE_W);
      const maxWidth = STAGE_W * 0.82;
      context.font = `800 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
      const alignCss = ALIGNMENTS[align].css;
      context.textAlign = alignCss;
      context.textBaseline = "middle";
      const lines = wrap(context, body, maxWidth);
      const lineHeight = fontSize * 1.22;
      // Aligné à gauche, le bloc s'ancre sur son bord gauche ; à droite, sur
      // son bord droit. Le centre reste le centre — la position du doigt.
      const x =
        align === 0
          ? (pos.x / 100) * STAGE_W - maxWidth / 2
          : align === 2
            ? (pos.x / 100) * STAGE_W + maxWidth / 2
            : (pos.x / 100) * STAGE_W;
      const startY = (pos.y / 100) * STAGE_H - ((lines.length - 1) * lineHeight) / 2;
      context.fillStyle = themeColor(TEXT_COLORS[color], "white");
      // Une ombre douce garde le texte lisible sur n'importe quelle photo.
      context.shadowColor = "rgba(0,0,0,0.45)";
      context.shadowBlur = 18;
      lines.forEach((line, index) => {
        context.fillText(line, x, startY + index * lineHeight, maxWidth);
      });
    }

    return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  }

  function backgroundPalette(): [string, string] {
    return [
      themeColor(BACKGROUNDS[background][0], "black"),
      themeColor(BACKGROUNDS[background][1], "black"),
    ];
  }

  async function publish() {
    if (busy) return;
    setError(null);
    // Un GIF part en lien : le réencoder en image figerait l'animation.
    // Le texte voyage alors comme légende, comme pour une vidéo.
    if (gif) {
      if (!onUseGif) {
        setError("Les GIF ne sont pas disponibles ici.");
        return;
      }
      setBusy(true);
      try {
        await onUseGif(gif);
        onClose();
      } catch {
        setError("La publication du GIF a échoué. Réessaie.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!source && !text.trim()) {
      setError("Ajoute un texte, une photo ou un GIF.");
      return;
    }
    // Une vidéo part intacte : la réencoder au navigateur détruirait sa
    // durée. Le texte voyage alors comme légende.
    if (source?.kind === "video" && source.file.size > 0) {
      setBusy(true);
      try {
        await (onUseSource ?? onUse)(source.file);
        onClose();
      } catch {
        setError("La publication de la vidéo a échoué. Réessaie.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!source && !text.trim()) return;
    setBusy(true);
    try {
      const blob = await renderStage();
      if (!blob) {
        setError("Le rendu a échoué.");
        return;
      }
      const file = new File([blob], `statut-${Date.now()}.webp`, {
        type: "image/webp",
        lastModified: Date.now(),
      });
      await onUse(file);
      onClose();
    } catch {
      setError("La publication a échoué. Réessaie.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Éditeur de statut"
      className="fixed inset-0 z-(--z-modal) flex flex-col bg-void text-chalk"
      style={{ paddingTop: "var(--h-safe-top)", paddingBottom: "var(--h-safe-bottom)" }}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-2 bg-surface/95 px-4 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-(--h-tap) items-center gap-2 rounded-(--radius-chip) px-2 text-sm font-medium text-chalk-3 transition-colors hover:bg-surface-2 hover:text-chalk"
        >
          <Icon name="close" size={18} />
          Fermer
        </button>
        <span className="text-[13px] font-semibold tracking-wide text-chalk">
          Nouveau statut
        </span>
        <button
          type="button"
          onClick={() => void publish()}
          disabled={busy}
          className="inline-flex min-h-(--h-tap) items-center justify-center rounded-(--radius-chip) bg-signal px-4 text-sm font-semibold text-void transition-opacity disabled:opacity-50"
        >
          {busy ? "Envoi…" : "Publier"}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center bg-page px-3 py-3">
        <div
          ref={stageRef}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => setEditing(true)}
          className="relative h-full max-h-full overflow-hidden rounded-(--radius-card) border border-line-2 shadow-sh-1"
          style={{
            aspectRatio: "9 / 16",
            background: gif
              ? "var(--color-void)"
              : source
                ? "var(--color-void)"
                : `linear-gradient(160deg, var(${BACKGROUNDS[background][0]}), var(${BACKGROUNDS[background][1]}))`,
          }}
        >
          {gif ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={gif.url}
              alt={gif.alt}
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : null}
          {source?.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={source.url}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
              style={{ filter: FILTERS[filter].css }}
            />
          ) : null}
          {source?.kind === "video" ? (
            <video
              src={source.url}
              className="absolute inset-0 h-full w-full object-cover"
              playsInline
              autoPlay
              loop
              muted
            />
          ) : null}

          <div
            className="absolute w-full -translate-x-1/2 -translate-y-1/2 px-6"
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              textAlign: ALIGNMENTS[align].css,
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
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onBlur={() => setEditing(false)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      setEditing(false);
                    }
                  }}
                  rows={1}
                  placeholder="Votre statut"
                  className="status-text-field w-full resize-none appearance-none border-0
                    bg-transparent font-extrabold leading-tight shadow-none ring-0
                    placeholder:text-chalk-3"
                  style={{ color: `var(${TEXT_COLORS[color]})`, fontSize: Math.round(TEXT_SIZES[size] * stageWidth), textShadow: "var(--story-text-shadow)" }}
                />
              </>
            ) : text.trim() ? (
              <p
                className="whitespace-pre-wrap break-words font-extrabold leading-tight"
                style={{ color: `var(${TEXT_COLORS[color]})`, fontSize: Math.round(TEXT_SIZES[size] * stageWidth), textShadow: "var(--story-text-shadow)" }}
              >
                {text}
              </p>
            ) : gif ? null : (
              // Sur un GIF, l'invite se posait au milieu de l'image, à
              // l'endroit même qu'on regarde. Le bouton « Texte » de la
              // barre reste là pour ajouter une légende.
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-chip bg-void/70 px-4 py-2 font-mono text-xs uppercase tracking-wide text-chalk"
              >
                Ajouter du texte
              </button>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <p role="alert" className="px-4 pb-1 text-center text-sm text-danger">
          {error}
        </p>
      ) : null}

      {/*
        Deux rangs, et pas davantage : les gestes rares (GIF, média, texte,
        fond, filtre) sur une ligne qui ne se casse jamais — cinq colonnes
        égales tiennent dans les 320 px — puis les réglages du texte, qui
        servent à chaque fois qu'on écrit.

        Avant, huit boutons enroulés occupaient trois rangs et la moitié de
        l'écran : la scène devenait une vignette. Un éditeur de statut se
        juge à la place que prend l'image qu'on fabrique.
      */}
      <footer className="shrink-0 border-t border-line-2 bg-surface/95 px-2 pb-1.5 pt-1">
        <div className="mx-auto flex max-w-xl items-stretch">
          <ToolItem
            label="GIF"
            icon="gif"
            active={Boolean(gif)}
            onClick={() => setGifOpen(true)}
          />
          <ToolItem label="Média" icon="image" onClick={() => mediaInput.current?.click()} />
          <ToolItem label="Texte" icon="edit" active={editing} onClick={() => setEditing(true)} />
          <ToolItem
            label="Fond"
            icon="droplet"
            // Sur une photo, un GIF ou une vidéo, le fond est couvert : le
            // bouton qui ne change rien à l'écran est un bouton qui ment.
            disabled={Boolean(source) || Boolean(gif)}
            title={
              source || gif ? "Retire le média pour changer de fond." : undefined
            }
            onClick={() => setBackground((value) => (value + 1) % BACKGROUNDS.length)}
          />
          <ToolItem
            label="Filtre"
            icon="layers"
            active={filter > 0}
            disabled={source?.kind === "video"}
            title={
              source?.kind === "video"
                ? "Un filtre vidéo demande un recodage serveur : la vidéo part sans filtre."
                : `Filtre : ${FILTERS[filter].label}`
            }
            onClick={() => setFilter((value) => (value + 1) % FILTERS.length)}
          />
        </div>

        <div className="mx-auto mt-1 flex max-w-xl items-stretch gap-1.5 border-t border-line-2 pt-1.5">
          <ToolButton
            icon="grid"
            label={TEXT_SIZE_LABEL[size]}
            hint="Taille"
            active={size > 0}
            onClick={() => setSize((value) => (value + 1) % TEXT_SIZES.length)}
          />
          <ToolButton
            icon="sun"
            label={TEXT_COLOR_LABEL[color]}
            hint="Couleur"
            active={color > 0}
            onClick={() => setColor((value) => (value + 1) % TEXT_COLORS.length)}
          />
          <ToolButton
            icon="align"
            label={ALIGNMENTS[align].label}
            hint="Alignement"
            active={align !== 1}
            onClick={() => setAlign((value) => (value + 1) % ALIGNMENTS.length)}
          />
        </div>

        {text.trim() && !editing ? (
          <p className="mt-1 text-center text-12 leading-tight text-chalk-3">
            Glisse le texte pour le placer · double-clic pour le modifier
          </p>
        ) : null}

        <label htmlFor="status-composer-media" className="sr-only">
          Photo ou vidéo du statut
        </label>
        <input
          id="status-composer-media"
          ref={mediaInput}
          type="file"
          accept="image/*,video/*"
          className="sr-only"
          onChange={(event) => {
            pickFile(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
      </footer>

      <GifPicker
        open={gifOpen}
        onClose={() => setGifOpen(false)}
        onPick={(picked) => {
          setGif(picked);
          // Un GIF et une photo ne se superposent pas : le dernier choix
          // gagne, sinon la scène montrerait deux histoires différentes.
          if (createdUrl.current) URL.revokeObjectURL(createdUrl.current);
          createdUrl.current = null;
          setSource(null);
        }}
      />
    </div>,
    document.body,
  );
}

/**
 * Une entrée de la ligne d'outils : icône au-dessus, mot en dessous.
 *
 * Cinq entrées de largeur égale tiennent sur un écran de 320 px sans
 * défiler — c'est la contrainte qui a décidé de cette forme, pas le goût.
 */
function ToolItem({
  label,
  icon,
  onClick,
  active = false,
  disabled = false,
  title,
}: {
  label: string;
  icon: "image" | "edit" | "droplet" | "layers" | "gif";
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title}
      className={`flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-1
        rounded-(--radius-chip) px-1 text-12 font-semibold
        transition-colors disabled:cursor-not-allowed disabled:opacity-35
        ${active ? "text-signal" : "text-chalk-3 hover:text-chalk"}`}
    >
      <Icon name={icon} size={18} />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

/**
 * Un réglage du texte. Le nom du réglage (« Taille ») reste lisible à
 * côté de sa valeur (« Grand ») : un cycle qui n'affiche que sa valeur
 * oblige à le presser pour savoir ce qu'il règle.
 */
function ToolButton({
  label,
  hint,
  icon,
  onClick,
  active = false,
}: {
  label: string;
  hint: string;
  icon: "grid" | "sun" | "align";
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${hint} — ${label}`}
      className={`flex min-h-(--h-tap) flex-1 items-center justify-center gap-1.5
        rounded-(--radius-chip) border px-2 text-12 font-semibold
        transition-colors min-w-0
        ${active ? "border-signal/60 bg-signal/10 text-chalk" : "border-line-3 bg-surface text-chalk-3 hover:border-line-2 hover:text-chalk"}`}
    >
      <Icon name={icon} size={14} />
      <span className="truncate capitalize">{label}</span>
    </button>
  );
}

function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}
