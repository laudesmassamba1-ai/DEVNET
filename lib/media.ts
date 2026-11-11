/**
 * Photos et vidéos des publications et des messages.
 *
 * ## Où vit le fichier
 *
 * En production, dans le bucket public `media` de Supabase Storage : la
 * base ne garde qu'une URL https, jamais de binaire. En démonstration,
 * il n'y a pas de Storage — le fichier devient une **data URL** rangée
 * avec la publication dans le store local. Cette différence est bornée
 * ici : aucun écran ne sait dans quel mode il tourne.
 *
 * ## Les bornes
 *
 * Une limite de taille n'est pas de la prudence décorative : un fichier
 * de 40 Mo dans une bulle bloque le fil sur un téléphone 3G. La
 * démonstration garde une limite basse (localStorage avoisine 5 Mo
 * pour tout l'origin) et le dit clairement au lieu d'échouer par
 * `QUOTA_EXCEEDED` quelques gestes plus tard.
 */

import { isDemoMode } from "@/lib/backend";
import { supabase } from "@/lib/supabase/client";

export type MediaKind = "image" | "video";

export type UploadedMedia = {
  /** URL publique (https en production, data URL en démonstration). */
  url: string;
  kind: MediaKind;
};

const MB = 1024 * 1024;

/** Photos : 6 Mo couvrent une photo de téléphone compressée par le système. */
export const MAX_IMAGE_BYTES = 6 * MB;
/** Vidéos : 20 Mo, courtes (moins d'une minute) et lisibles en mobile. */
export const MAX_VIDEO_BYTES = 20 * MB;
/** Démonstration : tout le store local doit tenir dans ~5 Mo. */
const DEMO_MAX_BYTES = 1.6 * MB;

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

  const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (file.size > max) {
    return {
      ok: false,
      error: `${kind === "image" ? "Photo" : "Vidéo"} trop lourde (${formatBytes(file.size)}) — ${formatBytes(max)} maximum.`,
    };
  }

  if (isDemoMode()) {
    // Pas de Storage hors-ligne : le fichier est rangé avec la ligne,
    // sous forme de data URL. Au-delà de la limite, on le dit maintenant.
    if (file.size > DEMO_MAX_BYTES) {
      return {
        ok: false,
        error: `En démonstration, la limite est de ${formatBytes(DEMO_MAX_BYTES)} (le stockage local du navigateur).`,
      };
    }
    try {
      return { ok: true, media: { url: await readAsDataUrl(file), kind } };
    } catch {
      return { ok: false, error: "Le fichier n'a pas pu être lu." };
    }
  }

  const ext = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
  const bucket = supabase.storage.from("media");
  const { error } = await bucket.upload(path, file, {
    cacheControl: "31536000",
    upsert: false,
    contentType: file.type,
  });
  if (error) return { ok: false, error: error.message };

  const { data } = bucket.getPublicUrl(path);
  if (!data?.publicUrl) {
    return { ok: false, error: "Le fichier est envoyé, mais son adresse est introuvable." };
  }
  return { ok: true, media: { url: data.publicUrl, kind } };
}
