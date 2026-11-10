/**
 * Re-encodage serveur des médias de statut.
 *
 * Une image (ou un GIF) est bornée à 1080 px et convertie en WebP — animée
 * pour un GIF. Une vidéo est transcodée en MP4/H.264, 15 secondes au plus,
 * 720 px de haut, sans jamais publier le fichier reçu.
 *
 * ffmpeg est un binaire du serveur : ce module vit côté serveur, jamais dans
 * le paquet du navigateur.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

export const STORY_IMAGE_INPUT_MAX = 6 * 1024 * 1024;
export const STORY_VIDEO_INPUT_MAX = 40 * 1024 * 1024;
export const STORY_VIDEO_MAX_SECONDS = 15;
export const STORY_MEDIA_OUTPUT_MAX = 8 * 1024 * 1024;

export type StoryMediaKind = "image" | "video";

export interface StoryMediaInput {
  mime: string;
  bytes: Buffer;
}

export interface EncodedStoryMedia {
  mime: string;
  bytes: Buffer;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  kind: StoryMediaKind;
}

export function mediaKind(mime: string): StoryMediaKind | null {
  if (/^image\/(png|jpeg|webp|gif)$/.test(mime)) return "image";
  if (/^video\/(mp4|webm|quicktime)$/.test(mime)) return "video";
  return null;
}

export function checkStoryMediaInput(input: StoryMediaInput): string | null {
  const kind = mediaKind(input.mime);
  if (!kind) return "format de média non accepté (image, GIF ou vidéo MP4/WebM)";
  if (kind === "image" && input.bytes.length > STORY_IMAGE_INPUT_MAX) {
    return "image trop lourde (6 Mo maximum)";
  }
  if (kind === "video" && input.bytes.length > STORY_VIDEO_INPUT_MAX) {
    return "vidéo trop lourde (40 Mo maximum)";
  }
  if (input.bytes.length === 0) return "média vide";
  return null;
}

export type StoryMediaResult =
  | { ok: true; media: EncodedStoryMedia }
  | { ok: false; error: string };

export async function encodeStoryMedia(input: StoryMediaInput): Promise<StoryMediaResult> {
  const refusal = checkStoryMediaInput(input);
  if (refusal) return { ok: false, error: refusal };

  return mediaKind(input.mime) === "video"
    ? encodeVideo(input.bytes)
    : encodeImage(input.bytes);
}

async function encodeImage(source: Buffer): Promise<StoryMediaResult> {
  try {
    const metadata = await sharp(source, { limitInputPixels: 40_000_000 }).metadata();
    const animated = (metadata.pages ?? 1) > 1;
    if (animated && (metadata.pages ?? 0) > 120) {
      return { ok: false, error: "GIF trop long (120 images maximum)" };
    }

    for (const quality of [78, 65, 52]) {
      const { data, info } = await sharp(source, {
        limitInputPixels: 40_000_000,
        animated,
      })
        .rotate()
        .resize({ width: 1080, height: 1920, fit: "inside", withoutEnlargement: true })
        .webp({ quality, alphaQuality: 85, effort: 4 })
        .toBuffer({ resolveWithObject: true });

      if (data.length <= (animated ? 3 * 1024 * 1024 : 900 * 1024)) {
        return {
          ok: true,
          media: {
            mime: "image/webp",
            bytes: data,
            width: info.width,
            height: info.height,
            durationMs: null,
            kind: "image",
          },
        };
      }
    }
    return { ok: false, error: "image trop lourde après re-encodage" };
  } catch {
    return { ok: false, error: "image illisible" };
  }
}

async function encodeVideo(source: Buffer): Promise<StoryMediaResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "devnet-story-"));
  const input = path.join(dir, "entree");
  const output = path.join(dir, "sortie.mp4");

  try {
    await writeFile(input, source);
    const duration = await probeDuration(input);
    if (duration !== null && duration > STORY_VIDEO_MAX_SECONDS + 0.5) {
      return { ok: false, error: `vidéo trop longue (${STORY_VIDEO_MAX_SECONDS} s maximum)` };
    }

    const result = await run("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-i", input,
      "-t", String(STORY_VIDEO_MAX_SECONDS),
      "-vf", "scale='min(720,iw)':-2",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "26",
      "-pix_fmt", "yuv420p",
      "-map", "0:v:0",
      "-map", "0:a?",
      "-c:a", "aac",
      "-b:a", "96k",
      "-movflags", "+faststart",
      "-y",
      output,
    ]);

    if (result.code !== 0) return { ok: false, error: "vidéo illisible ou non transcodable" };

    const encoded = await readFile(output);
    if (encoded.length > STORY_MEDIA_OUTPUT_MAX) {
      return { ok: false, error: "vidéo trop lourde après transcodage (8 Mo maximum)" };
    }

    const dimensions = await probeDimensions(output);
    return {
      ok: true,
      media: {
        mime: "video/mp4",
        bytes: encoded,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        durationMs: duration === null ? null : Math.round(duration * 1000),
        kind: "video",
      },
    };
  } catch {
    return { ok: false, error: "transcodage vidéo impossible sur ce serveur" };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function probeDuration(file: string): Promise<number | null> {
  const result = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1",
    file,
  ]);
  const value = Number.parseFloat(result.stdout.trim());
  return Number.isFinite(value) ? value : null;
}

async function probeDimensions(file: string): Promise<{ width: number; height: number } | null> {
  const result = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=s=x:p=0",
    file,
  ]);
  const [width, height] = result.stdout.trim().split("x").map(Number);
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
}
