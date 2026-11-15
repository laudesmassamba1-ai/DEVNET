/**
 * Réencodage des vidéos côté serveur — quand un `ffmpeg` est disponible.
 *
 * ## Le problème
 *
 * Un iPhone filme en HEVC et exporte un `.mov`. Le fichier s'envoie, se
 * stocke, et ne se lit pas sur Chrome ni Firefox : la zone vidéo reste noire
 * et rien ne dit pourquoi. À l'inverse, un `.webm` produit par Chrome ne se
 * lit pas sur un vieil iOS. « Ça marche chez moi » n'est pas une compatibilité.
 *
 * ## La réponse, en deux étages
 *
 *  1. **Ici** : si `ffmpeg` existe, on réencode en H.264/AAC dans un MP4
 *     `+faststart` (moov avant mdat, donc lecture immédiate) et on produit une
 *     vignette WebP. C'est le format que tous les navigateurs et tous les
 *     téléphones lisent.
 *  2. **Dans le navigateur** (`lib/video-compat.ts`) : sur une plateforme sans
 *     `ffmpeg` — Vercel n'en embarque pas — c'est le client qui prépare le
 *     fichier avant l'envoi. Le serveur reste la référence quand il peut.
 *
 * ## Ce que ce module refuse de faire
 *
 * Il ne prétend pas transcoder quand il ne peut pas : sans binaire, il rend
 * `null`, l'appelant garde l'original et le signale. Un échec silencieux
 * laisserait croire à une vidéo universelle qui ne l'est pas.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Un réencodage est borné : au-delà, on préfère rendre l'original. */
const TRANSCODE_TIMEOUT_MS = 90_000;
const PROBE_TIMEOUT_MS = 2_000;
/** Plafond du fichier d'entrée accepté par le réencodage synchrone. */
export const TRANSCODE_MAX_INPUT_BYTES = 4 * 1024 * 1024;
/** Côté le plus long : 1280 px suffit pour un fil social et divise le poids. */
const MAX_EDGE = 1280;

export type TranscodeResult = {
  bytes: Buffer;
  mime: string;
  poster: Buffer | null;
  posterMime: string | null;
  /** Vrai quand les octets diffèrent réellement de l'entrée. */
  transcoded: boolean;
};

let availability: Promise<boolean> | null = null;

/** `ffmpeg` est-il utilisable ? La réponse est mémorisée pour le processus. */
export function ffmpegAvailable(): Promise<boolean> {
  if (process.env.MEDIA_TRANSCODE === "off") return Promise.resolve(false);
  availability ??= run("ffmpeg", ["-version"], { timeout: PROBE_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  return availability;
}

type ProbeInfo = { video: string | null; audio: string | null; container: string | null };

async function probe(file: string): Promise<ProbeInfo | null> {
  try {
    const { stdout } = await run(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "stream=codec_type,codec_name",
        "-show_entries", "format=format_name",
        "-of", "json",
        file,
      ],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 256 * 1024 },
    );
    const parsed = JSON.parse(stdout) as {
      streams?: { codec_type?: string; codec_name?: string }[];
      format?: { format_name?: string };
    };
    const video = parsed.streams?.find((s) => s.codec_type === "video")?.codec_name ?? null;
    const audio = parsed.streams?.find((s) => s.codec_type === "audio")?.codec_name ?? null;
    return { video, audio, container: parsed.format?.format_name ?? null };
  } catch {
    return null;
  }
}

/** H.264 + AAC dans un MP4 : la combinaison lue partout. */
function alreadyUniversal(info: ProbeInfo | null): boolean {
  if (!info) return false;
  return (
    info.video === "h264"
    && info.container !== null
    && /mp4|mov/.test(info.container)
  );
}

/**
 * Réencode une vidéo et rend sa vignette.
 *
 * `null` signifie « je n'ai pas pu » — jamais « ce n'est pas la peine ». Un
 * appelant qui reçoit `null` doit conserver l'original et le dire.
 */
export async function transcodeVideo(
  input: Buffer,
  mime: string,
): Promise<TranscodeResult | null> {
  if (!(await ffmpegAvailable())) return null;
  if (input.length === 0 || input.length > TRANSCODE_MAX_INPUT_BYTES) return null;

  let directory: string | null = null;
  try {
    directory = await mkdtemp(join(tmpdir(), "devnet-video-"));
    const source = join(directory, "source");
    const target = join(directory, "out.mp4");
    const poster = join(directory, "poster.webp");
    await writeFile(source, input);

    const info = await probe(source);
    if (alreadyUniversal(info)) {
      // Déjà lisible partout : on ne paie pas un réencodage qui dégraderait
      // l'image pour rien. On produit seulement la vignette.
      const posterBytes = await extractPoster(source, poster, directory);
      return {
        bytes: input,
        mime: mime === "video/mp4" ? mime : "video/mp4",
        poster: posterBytes,
        posterMime: posterBytes ? "image/webp" : null,
        transcoded: false,
      };
    }

    await run(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", source,
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "26",
        "-pix_fmt", "yuv420p",
        // `-2` garde une hauteur paire, exigée par H.264.
        "-vf", `scale='min(${MAX_EDGE},iw)':-2`,
        "-c:a", "aac",
        "-b:a", "128k",
        "-ac", "2",
        "-movflags", "+faststart",
        "-max_muxing_queue_size", "1024",
        target,
      ],
      { timeout: TRANSCODE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
    );

    const bytes = await readFile(target);
    if (bytes.length === 0) return null;
    const posterBytes = await extractPoster(target, poster, directory);
    return {
      bytes,
      mime: "video/mp4",
      poster: posterBytes,
      posterMime: posterBytes ? "image/webp" : null,
      transcoded: true,
    };
  } catch (error) {
    console.error(
      "[media] réencodage vidéo impossible",
      error instanceof Error ? error.message.slice(0, 200) : String(error),
    );
    return null;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function extractPoster(
  video: string,
  target: string,
  directory: string,
): Promise<Buffer | null> {
  try {
    // 0,1 s plutôt que 0 s : la première image d'un MP4 est souvent noire.
    await run(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-ss", "0.1", "-i", video,
        "-frames:v", "1",
        "-vf", "scale='min(640,iw)':-2",
        "-c:v", "libwebp", "-quality", "80",
        target,
      ],
      { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 },
    );
    return await readFile(target);
  } catch {
    void directory;
    return null;
  }
}
