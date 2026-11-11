/**
 * Client du studio de stickers.
 *
 * Le navigateur n'envoie jamais d'identifiant d'auteur : la session le donne.
 * Une image part en data URL, le serveur la re-encode — ce que l'on reçoit en
 * retour n'est jamais le fichier envoyé.
 */
import type { StickerColorToken } from "@/modules/stickers";

export interface StickerRowView {
  id: string;
  /**
   * Nom de fichier d'une image **embarquée** (`public/stickers/<nom>.svg`).
   * Absent pour un sticker venu de la base, dont les octets sont servis par
   * la route d'asset.
   */
  builtin?: string;
  pack: string;
  kind: "texte" | "image" | "animé";
  glyph: string;
  name: string;
  visibility: "prive" | "public";
  status: "actif" | "retire";
  fg: string;
  bg: string;
  mine: boolean;
  byteSize: number;
  createdAt: string;
}

export type StickerResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function call<T>(body: unknown): Promise<StickerResult<T>> {
  try {
    const response = await fetch("/api/stickers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as
      | (T & { error?: string })
      | null;
    if (!response.ok) {
      return { ok: false, error: data?.error ?? "Le sticker n’a pas été enregistré." };
    }
    return { ok: true, value: (data ?? {}) as T };
  } catch {
    return { ok: false, error: "Connexion interrompue. Réessaie dans un instant." };
  }
}

export async function fetchStickers(): Promise<StickerRowView[]> {
  try {
    const response = await fetch("/api/stickers", { cache: "no-store" });
    if (!response.ok) return [];
    const data = (await response.json()) as { stickers?: StickerRowView[] };
    return data.stickers ?? [];
  } catch {
    return [];
  }
}

export function createTextSticker(input: {
  name: string;
  glyph: string;
  fg: StickerColorToken;
  bg: StickerColorToken;
  visibility: "prive" | "public";
}): Promise<StickerResult<{ sticker: StickerRowView }>> {
  return call({ action: "texte", ...input });
}

export function createImageSticker(input: {
  name: string;
  dataUrl: string;
  visibility: "prive" | "public";
}): Promise<StickerResult<{ sticker: StickerRowView }>> {
  return call({ action: "image", ...input });
}

export function retireSticker(stickerId: string): Promise<StickerResult<{ ok: true }>> {
  return call({ action: "retire", stickerId });
}

/** URL des octets d'un sticker d'image — servie par une route dédiée. */
export function stickerAssetUrl(stickerId: string): string {
  return `/api/stickers/${encodeURIComponent(stickerId)}/asset`;
}
