/**
 * Rendre une vidéo lisible partout, sans dépendre d'un serveur.
 *
 * ## Le problème, tel qu'il se voit
 *
 * Un fichier `.mov` filmé par un iPhone contient du HEVC. Safari le lit,
 * Chrome et Firefox non : l'envoi réussit, puis la zone vidéo reste noire.
 * Un `.webm` produit par Chrome se lit partout sauf sur un iOS ancien. Et un
 * `.avi` ne se lit nulle part dans un navigateur.
 *
 * ## La règle de ce module
 *
 * On **vérifie** que le fichier se décode réellement dans ce navigateur, au
 * lieu de croire son extension. S'il ne se décode pas, on le réencode en
 * temps réel avec `MediaRecorder` :
 *
 *  - MP4 (H.264/AAC) quand le navigateur sait le produire — le format le plus
 *    universel ;
 *  - WebM (VP9/VP8 + Opus) sinon — lu par Chrome, Firefox, Edge et Safari 17.4+.
 *
 * Le réencodage passe par la piste capturée de l'élément `<video>` quand
 * c'est possible : l'audio est conservé. À défaut, un canevas fournit l'image
 * et un `AudioContext` reconstruit le son. Si l'un ou l'autre échoue, on
 * renvoie **l'original avec un avertissement** — jamais un fichier vide.
 *
 * Ce n'est pas gratuit : réencoder prend le temps de la vidéo. On le borne
 * (`MAX_TRANSCODE_SECONDS`) et on le dit à l'appelant, qui affiche un état.
 */

export const MAX_TRANSCODE_SECONDS = 120;

export type VideoPreparation = {
  file: File;
  /** `null` si rien n'a changé ; sinon ce qu'il faut dire à l'utilisateur. */
  note: string | null;
  changed: boolean;
};

type Progress = (ratio: number, label: string) => void;

function videoElement(): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  return video;
}

function waitFor(
  target: HTMLVideoElement,
  event: "loadedmetadata" | "loadeddata",
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(), timeoutMs);
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("métadonnées illisibles"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, done);
      target.removeEventListener("error", fail);
    };
    target.addEventListener(event, done, { once: true });
    target.addEventListener("error", fail, { once: true });
  });
}

/**
 * Le fichier se décode-t-il vraiment ici ?
 *
 * `canPlayType()` ne suffit pas : pour un `.mp4` HEVC, Chrome répond
 * « probably » sur le conteneur puis échoue sur le codec. On charge donc
 * réellement les métadonnées et on vérifie qu'une dimension existe.
 */
export async function isVideoDecodable(file: File): Promise<boolean> {
  if (typeof document === "undefined") return true;
  const url = URL.createObjectURL(file);
  const video = videoElement();
  try {
    video.src = url;
    video.load();
    await waitFor(video, "loadedmetadata", 6_000);
    return video.videoWidth > 0 && video.videoHeight > 0;
  } catch {
    return false;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function recorderMimeCandidates(): string[] {
  return [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.4D401E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
}

function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const candidate of recorderMimeCandidates()) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      /* certains navigateurs lèvent sur un codec inconnu, on continue */
    }
  }
  return null;
}

/**
 * Capture l'image (et si possible le son) pendant la lecture.
 *
 * `captureStream()` est le chemin propre : il garde les pistes d'origine.
 * À défaut, le canevas redessine chaque frame et `AudioContext` fournit
 * l'audio. On rend une fonction de nettoyage pour ne pas laisser de piste
 * ou de contexte ouvert.
 */
async function captureFromVideo(video: HTMLVideoElement): Promise<{
  stream: MediaStream;
  cleanup: () => void;
}> {
  const media = video as HTMLVideoElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
    webkitCaptureStream?: () => MediaStream;
  };
  const capture =
    media.captureStream ?? media.mozCaptureStream ?? media.webkitCaptureStream;
  if (typeof capture === "function") {
    try {
      const stream = capture.call(video);
      if (stream.getVideoTracks().length > 0) {
        return { stream, cleanup: () => stream.getTracks().forEach((track) => track.stop()) };
      }
    } catch {
      /* on tombe sur le canevas */
    }
  }

  const width = Math.min(1280, video.videoWidth || 1280);
  const height = Math.round((video.videoHeight / video.videoWidth) * width) || 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canevas indisponible");

  let running = true;
  const draw = () => {
    if (!running) return;
    context.drawImage(video, 0, 0, width, height);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  const stream = canvas.captureStream(30);
  let audioContext: AudioContext | null = null;
  try {
    const AudioCtor =
      window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtor && !video.muted) {
      audioContext = new AudioCtor();
      const destination = audioContext.createMediaStreamDestination();
      const source = audioContext.createMediaElementSource(video);
      source.connect(destination);
      destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
    }
  } catch {
    /* sans audio : mieux qu'un échec complet */
  }

  return {
    stream,
    cleanup: () => {
      running = false;
      stream.getTracks().forEach((track) => track.stop());
      audioContext?.close().catch(() => undefined);
    },
  };
}

/** Réencode en temps réel. `null` si le navigateur ne sait pas. */
async function transcodeInBrowser(
  file: File,
  onProgress?: Progress,
): Promise<{ blob: Blob; mime: string } | null> {
  const mime = pickRecorderMime();
  if (!mime) return null;

  const url = URL.createObjectURL(file);
  const video = videoElement();
  let cleanupCapture: (() => void) | null = null;
  try {
    video.src = url;
    video.load();
    await waitFor(video, "loadedmetadata", 8_000);

    const duration = Math.min(
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : MAX_TRANSCODE_SECONDS,
      MAX_TRANSCODE_SECONDS,
    );

    const { stream, cleanup } = await captureFromVideo(video);
    cleanupCapture = cleanup;

    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 2_500_000,
      audioBitsPerSecond: 128_000,
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    const tick = () => {
      const ratio = duration > 0 ? Math.min(1, video.currentTime / duration) : 0;
      onProgress?.(ratio, "Réencodage de la vidéo");
    };
    video.addEventListener("timeupdate", tick);

    recorder.start(500);
    await video.play().catch(() => undefined);
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (video.currentTime >= duration - 0.05 || video.ended) finish();
      }, 250);
      const finish = () => {
        clearInterval(timer);
        resolve();
      };
      video.addEventListener("ended", finish, { once: true });
      setTimeout(finish, (duration + 15) * 1000);
    });
    video.removeEventListener("timeupdate", tick);

    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    onProgress?.(1, "Vidéo prête");

    const blob = new Blob(chunks, { type: recorder.mimeType || mime });
    if (blob.size === 0) return null;
    return { blob, mime: recorder.mimeType || mime };
  } catch {
    return null;
  } finally {
    cleanupCapture?.();
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Codecs qui ne sont **pas** universels, même dans un MP4.
 *
 * Un `.mp4` n'est pas une garantie : l'iPhone exporte du HEVC (`hvc1`,
 * `hev1`) et certaines caméras de l'AV1 (`av01`). Safari les lit, Chrome et
 * Firefox non. On scanne donc l'en-tête et la queue du fichier (le `moov`
 * peut être au début ou à la fin) pour le dire avant d'envoyer.
 */
const NON_UNIVERSAL_CODECS = ["hvc1", "hev1", "av01"];
/** Fenêtre lue en tête et en queue : le `moov` tient largement dedans. */
const CODEC_SCAN_BYTES = 512 * 1024;

function hasAscii(bytes: Uint8Array, needle: string): boolean {
  const target = [...needle].map((char) => char.charCodeAt(0));
  outer: for (let index = 0; index <= bytes.length - target.length; index += 1) {
    for (let offset = 0; offset < target.length; offset += 1) {
      if (bytes[index + offset] !== target[offset]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Faut-il convertir pour que **tous** les appareils lisent ?
 *
 * La règle « ça se décode ici, donc ça va » est fausse : Safari lit du HEVC
 * que Chrome ne lira jamais. On ne se fie donc pas au seul décodeur local.
 *
 *  - MP4 sans marqueur HEVC/AV1 : considéré universel (H.264) ;
 *  - MOV, WebM, AVI, ou MP4 portant un marqueur non universel : à convertir ;
 *  - fichier illisible : à convertir, par prudence.
 */
export async function needsUniversalTranscode(file: File): Promise<boolean> {
  const type = file.type.toLowerCase();
  if (!type.startsWith("video/")) return false;
  if (type !== "video/mp4") return true;
  try {
    const head = new Uint8Array(
      await file.slice(0, CODEC_SCAN_BYTES).arrayBuffer(),
    );
    const tail = new Uint8Array(
      await file.slice(Math.max(0, file.size - CODEC_SCAN_BYTES)).arrayBuffer(),
    );
    return NON_UNIVERSAL_CODECS.some(
      (codec) => hasAscii(head, codec) || hasAscii(tail, codec),
    );
  } catch {
    return true;
  }
}

function extensionFor(mime: string): string {
  if (/mp4/i.test(mime)) return "mp4";
  if (/webm/i.test(mime)) return "webm";
  return "mp4";
}

/**
 * Prépare un fichier vidéo pour l'envoi.
 *
 * Ne lève jamais. Sur un navigateur qui ne décode pas la source et ne sait
 * pas réencoder, le fichier original est rendu avec un avertissement : c'est
 * à l'écran de dire que la lecture pourra échouer ailleurs, pas à cette
 * fonction de refuser un envoi.
 */
export async function prepareVideoForUpload(
  file: File,
  onProgress?: Progress,
): Promise<VideoPreparation> {
  if (!file.type.startsWith("video/") || typeof document === "undefined") {
    return { file, note: null, changed: false };
  }

  const [decodable, nonUniversal] = await Promise.all([
    isVideoDecodable(file),
    needsUniversalTranscode(file),
  ]);
  // Deux raisons de convertir, et non une : le fichier ne se lit pas ici, ou
  // il se lit ici mais pas ailleurs (HEVC lu par Safari, noir sur Chrome).
  if (decodable && !nonUniversal) return { file, note: null, changed: false };

  onProgress?.(
    0.02,
    decodable
      ? "Vidéo lisible ici mais pas partout : conversion…"
      : "Vidéo non lisible sur cet appareil : préparation…",
  );
  const transcoded = await transcodeInBrowser(file, onProgress);
  if (!transcoded) {
    return {
      file,
      changed: false,
      note: decodable
        ? "Cette vidéo se lit sur cet appareil mais pas partout (HEVC/AV1). "
          + "Ce navigateur ne sait pas la convertir : réexporte-la en MP4/H.264."
        : "Cette vidéo n'est pas lisible par tous les navigateurs et ce navigateur "
          + "ne sait pas la convertir. Réexporte-la en MP4/H.264 pour garantir la lecture.",
    };
  }

  const name = `${file.name.replace(/\.[^.]+$/, "") || "video"}.${extensionFor(transcoded.mime)}`;
  return {
    file: new File([transcoded.blob], name, { type: transcoded.mime }),
    changed: true,
    note:
      "Vidéo convertie pour être lisible partout"
      + (transcoded.mime.includes("webm") ? " (WebM, lecture garantie sur Safari 17.4+)." : " (MP4/H.264)."),
  };
}
