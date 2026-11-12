/**
 * Photos et vidéos des publications et des messages.
 *
 * ## Compression avant l'envoi
 *
 * Une photo est redimensionnée (1920 px maximum) et réencodée en WebP
 * (qualité 82) dans le navigateur avant de quitter l'appareil. C'est ce qui
 * permet de rester sous la limite de 4 Mo des fonctions Vercel tout en
 * gardant une image nette. Le serveur refait la normalisation avec `sharp`
 * pour les appels qui ne passent pas par ce module. Un GIF est laissé intact
 * afin de conserver son animation.
 *
 * ## Où vit le fichier
 *
 * Avec `R2_*`, les octets sont déposés sur Cloudflare R2 (10 Go gratuits) et
 * la réponse rend l'URL publique. Sans configuration, ils restent dans
 * `public.media_files`, servis par `/api/media/<chemin>`. En démonstration, il
 * n'y a pas de base — le fichier devient une data URL rangée avec la
 * publication dans le store local.
 */

import { isDemoMode } from "@/lib/backend";

export type MediaKind = "image" | "video";

export type UploadedMedia = {
  /** URL publique (https en production, data URL en démonstration). */
  url: string;
  kind: MediaKind;
};

const MB = 1024 * 1024;

/**
 * Photos et vidéos : 4 Mo.
 *
 * La limite est celle du corps de requête des fonctions Vercel (4,5 Mo).
 * La dépasser côté client évite un 413 opaque rendu par la plateforme avant
 * même que `/api/media` puisse expliquer le refus.
 */
export const MAX_IMAGE_BYTES = 4 * MB;
export const MAX_VIDEO_BYTES = 4 * MB;
/** Démonstration : tout le store local doit tenir dans ~5 Mo. */
const DEMO_MAX_BYTES = 1.6 * MB;

/** Côté le plus long d'une photo après compression. */
const MAX_EDGE = 1920;
/** En dessous, une image déjà légère n'a pas besoin d'être réencodée. */
const SKIP_BELOW_BYTES = 256 * 1024;
const WEBP_QUALITY = 0.82;

/** Type de média déduit du fichier, ou `null` si le format n'est pas accepté. */
export function mediaKindOf(file: File): MediaKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

/** Taille lisible pour les messages d'erreur (« 7,2 Mo »). */
export function formatBytes(bytes: number): string {
  const mo = bytes / MB;
  return `${mo.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
    reader.readAsDataURL(file);
  });
}

interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

function loadImage(file: File): Promise<LoadedImage> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file).then((bitmap) => ({
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    }));
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () =>
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image illisible"));
    };
    image.src = url;
  });
}

/**
 * Réduit et réencode une photo en WebP. En cas d'échec (navigateur ancien,
 * format exotique), le fichier d'origine est renvoyé : la compression ne doit
 * jamais empêcher l'envoi.
 */
export async function compressImage(file: File): Promise<File> {
  if (file.type === "image/gif" || typeof document === "undefined") return file;

  try {
    const image = await loadImage(file);
    try {
      const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
      if (scale === 1 && file.size <= SKIP_BELOW_BYTES) return file;

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return file;

      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", WEBP_QUALITY),
      );
      if (!blob || blob.size >= file.size) return file;

      const base = file.name.replace(/\.[^.]+$/, "") || "photo";
      return new File([blob], `${base}.webp`, {
        type: "image/webp",
        lastModified: Date.now(),
      });
    } finally {
      image.close();
    }
  } catch {
    return file;
  }
}

export type UploadResult =
  | { ok: true; media: UploadedMedia }
  | { ok: false; error: string };

/**
 * Met un fichier en ligne et rend son URL.
 *
 * Ne lève jamais : les composeurs affichent l'erreur telle quelle dans un
 * toast, sans écran blanc ni promesse rejetée non gérée.
 */
export async function uploadMedia(file: File): Promise<UploadResult> {
  const kind = mediaKindOf(file);
  if (!kind) {
    return { ok: false, error: "Formats acceptés : photos et vidéos." };
  }

  const prepared = kind === "image" ? await compressImage(file) : file;
  const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (prepared.size > max) {
    return {
      ok: false,
      error: `${kind === "image" ? "Photo" : "Vidéo"} trop lourde (${formatBytes(prepared.size)}) — ${formatBytes(max)} maximum.`,
    };
  }

  if (isDemoMode()) {
    // Pas de stockage hors-ligne : le fichier est rangé avec la ligne,
    // sous forme de data URL. Au-delà de la limite, on le dit maintenant.
    if (prepared.size > DEMO_MAX_BYTES) {
      return {
        ok: false,
        error: `En démonstration, la limite est de ${formatBytes(DEMO_MAX_BYTES)} (le stockage local du navigateur).`,
      };
    }
    try {
      return { ok: true, media: { url: await readAsDataUrl(prepared), kind } };
    } catch {
      return { ok: false, error: "Le fichier n'a pas pu être lu." };
    }
  }

  const ext = (prepared.name.split(".").pop() ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const path = `${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
  const body = new FormData();
  body.set("path", path);
  body.set("file", prepared);
  const response = await fetch("/api/media", {
    method: "POST",
    credentials: "same-origin",
    body,
  });
  const payload = (await response.json().catch(() => null)) as
    | { path?: string; url?: string; error?: string }
    | null;
  if (!response.ok) {
    return { ok: false, error: payload?.error ?? "L'envoi a échoué." };
  }

  const stored = payload?.path ?? path;
  return {
    ok: true,
    media: {
      url: payload?.url ?? `/api/media/${encodeURIComponent(stored)}`,
      kind,
    },
  };
}
