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
 * Plafond de l'envoi **en une seule requête** : 4 Mo.
 *
 * C'est le corps de requête que les fonctions Vercel acceptent (4,5 Mo).
 * Au-delà, la plateforme renvoie un 413 opaque. Une vidéo plus lourde passe
 * donc par l'envoi par morceaux, qui va du navigateur directement à R2.
 */
export const MAX_IMAGE_BYTES = 4 * MB;
/**
 * Plafond d'une vidéo : 100 Mo, envoyée par morceaux.
 *
 * Les morceaux (8 à 12 Mo) partent du navigateur vers R2 avec une URL
 * signée : le fichier ne traverse plus Vercel, donc la limite de 4,5 Mo du
 * corps de requête ne s'applique plus. 100 Mo est notre choix : au-delà, un
 * envoi mobile dure des dizaines de minutes et le stockage gratuit déborde.
 */
export const MAX_VIDEO_BYTES = 100 * MB;

/**
 * Plafond de **sélection** d'une photo : 20 Mo.
 *
 * Une photo est redimensionnée à 1920 px et réencodée en WebP avant
 * l'envoi : ce qu'on choisit n'est presque jamais ce qu'on téléverse. Le
 * refus portait donc sur un fichier qui n'aurait jamais été envoyé tel
 * quel, et écartait les photos de téléphone (5 à 8 Mo courantes) pour un
 * poids qui n'existait plus après compression. La vidéo n'est pas
 * réencodée : sa limite de sélection reste celle de l'envoi.
 */
export const MAX_IMAGE_INPUT_BYTES = 20 * MB;
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

export type UploadProgress = { sent: number; total: number };

/** Parties envoyées en même temps : trois suffit à saturer une 4G. */
const PARALLEL_PARTS = 3;
const PART_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MultipartPlan {
  uploadId: string;
  partSize: number;
  partCount: number;
  urls: string[];
}

async function multipartAction(
  payload: Record<string, unknown>,
): Promise<{ response: Response; body: Record<string, unknown> | null }> {
  const response = await fetch("/api/media/multipart", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { response, body };
}

/**
 * Envoi direct vers R2, partie par partie.
 *
 * Les URL signées sont demandées en une fois (une petite requête JSON qui,
 * elle, traverse Vercel), puis les morceaux partent en parallèle vers
 * Cloudflare. Un morceau échoué est repris deux fois avant d'abandonner : sur
 * mobile, une coupure d'une seconde ne doit pas faire perdre 80 Mo déjà
 * transférés.
 */
async function uploadInParts(
  prepared: File,
  path: string,
  kind: MediaKind,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  const { response, body } = await multipartAction({
    action: "create",
    path,
    size: prepared.size,
    contentType: prepared.type,
  });

  if (response.status === 501) {
    return {
      ok: false,
      error: "L'envoi des fichiers volumineux n'est pas configuré sur ce serveur.",
    };
  }
  if (!response.ok || !body?.uploadId) {
    return { ok: false, error: String(body?.error ?? "L'envoi a échoué.") };
  }

  const plan = body as unknown as MultipartPlan;
  const uploadId = plan.uploadId;
  const etags: { partNumber: number; etag: string }[] = [];
  let sent = 0;
  let cursor = 0;
  let failed = false;

  async function worker(): Promise<void> {
    while (!failed) {
      const index = cursor++;
      if (index >= plan.partCount) return;
      const start = index * plan.partSize;
      const chunk = prepared.slice(start, Math.min(start + plan.partSize, prepared.size));

      for (let attempt = 0; ; attempt += 1) {
        try {
          const put = await fetch(plan.urls[index], {
            method: "PUT",
            body: chunk,
            headers: { "Content-Type": prepared.type },
          });
          if (!put.ok) throw new Error(`partie ${index + 1} : ${put.status}`);
          const etag = put.headers.get("etag");
          if (!etag) throw new Error(`partie ${index + 1} : étiquette absente`);
          etags[index] = { partNumber: index + 1, etag };
          sent += chunk.size;
          onProgress?.({ sent, total: prepared.size });
          break;
        } catch (error) {
          if (attempt >= PART_RETRIES) {
            failed = true;
            throw error;
          }
          await sleep(600 * (attempt + 1));
        }
      }
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL_PARTS, plan.partCount) }, worker),
    );
    const done = await multipartAction({
      action: "complete",
      path,
      uploadId,
      size: prepared.size,
      contentType: prepared.type,
      parts: etags.filter(Boolean),
    });
    if (!done.response.ok || !done.body?.url) {
      return { ok: false, error: String(done.body?.error ?? "L'assemblage a échoué.") };
    }
    return {
      ok: true,
      media: { url: String(done.body.url), kind },
    };
  } catch {
    // Sans abandon, les parties déjà reçues resteraient facturées.
    void multipartAction({ action: "abort", path, uploadId });
    return {
      ok: false,
      error: "L'envoi s'est interrompu. Vérifiez la connexion et réessayez.",
    };
  }
}

/**
 * Met un fichier en ligne et rend son URL.
 *
 * Ne lève jamais : les composeurs affichent l'erreur telle quelle dans un
 * toast, sans écran blanc ni promesse rejetée non gérée.
 */
export async function uploadMedia(
  file: File,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  const kind = mediaKindOf(file);
  if (!kind) {
    return { ok: false, error: "Formats acceptés : photos et vidéos." };
  }

  // Photos : on borne la sélection, pas le fichier compressé.
  if (kind === "image" && file.size > MAX_IMAGE_INPUT_BYTES) {
    return {
      ok: false,
      error: `Photo trop lourde (${formatBytes(file.size)}) — ${formatBytes(MAX_IMAGE_INPUT_BYTES)} maximum avant compression.`,
    };
  }
  if (kind === "video" && file.size > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      error: `Vidéo trop lourde (${formatBytes(file.size)}) — ${formatBytes(MAX_VIDEO_BYTES)} maximum.`,
    };
  }

  const prepared = kind === "image" ? await compressImage(file) : file;
  // Une photo compressée reste sous 4 Mo ; une vidéo plus lourde passe par
  // l'envoi par morceaux, directement vers R2.
  const max = MAX_IMAGE_BYTES;
  if (kind === "image" && prepared.size > max) {
    return {
      ok: false,
      error: `Photo trop lourde (${formatBytes(prepared.size)}) — ${formatBytes(max)} maximum.`,
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

  if (kind === "video" && prepared.size > MAX_IMAGE_BYTES) {
    return uploadInParts(prepared, path, kind, onProgress);
  }

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
