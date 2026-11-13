/**
 * Ce que l'appareil peut dire sans qu'on regarde l'écran.
 *
 * Trois capacités, et elles ne sont pas équivalentes :
 *
 * 1. **Le badge** (`navigator.setAppBadge`) — le petit chiffre sur l'icône,
 *    quand la plateforme le permet (iOS 16.4+ pour une application
 *    installée, Chrome/Android sans installation). Il se met à jour
 *    depuis le compteur de non-lus, celui de la cloche : un seul chiffre,
 *    donc pas de désaccord entre l'icône et l'écran.
 * 2. **La bannière** (`Notification` ou `ServiceWorkerRegistration.showNotification`)
 *    — elle n'existe que si la personne a dit oui. Sur iOS, seul le
 *    service worker peut en afficher, et seulement depuis une application
 *    ajoutée à l'écran d'accueil.
 * 3. **Le son** — un court carillon synthétisé, sans fichier à charger.
 *    iOS n'autorise l'audio qu'après un geste : on débloque le contexte
 *    au premier appui, et on ne promet pas de son avant.
 *
 * Rien ici ne ment sur ce qui est possible : chaque fonction échoue
 * silencieusement si l'appareil ou la permission ne suivent pas, et
 * `notificationState()` dit la vérité à l'écran de réglages.
 */

const BADGE_SUPPORTED = typeof navigator !== "undefined" && "setAppBadge" in navigator;

type NavigatorWithBadge = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Met à jour le chiffre de l'icône. Zéro retire le badge. */
export async function syncBadge(count: number): Promise<void> {
  if (!BADGE_SUPPORTED) return;
  const nav = navigator as NavigatorWithBadge;
  try {
    if (count > 0) await nav.setAppBadge?.(count);
    else await nav.clearAppBadge?.();
  } catch {
    // Un badge refusé n'est pas une panne de l'application.
  }
}

/** Les notifications sont-elles demandables sur cet appareil ? */
export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** État courant, sans jamais demander la permission. */
export function notificationState(): "unsupported" | "default" | "granted" | "denied" {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission as "default" | "granted" | "denied";
}

/**
 * Demande la permission. À appeler sur un geste — un navigateur refuse
 * une demande faite au chargement, et iOS ne pose même pas la question.
 */
export async function requestNotifications(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission as NotificationPermission;
  }
}

/**
 * Affiche une bannière. Le service worker est préféré quand il existe :
 * sur iOS, `new Notification()` lève une `TypeError` dans une application
 * installée, alors que la voie service worker fonctionne.
 */
export async function showNotification(input: {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}): Promise<void> {
  if (notificationState() !== "granted") return;
  const options: NotificationOptions & { renotify?: boolean } = {
    body: input.body,
    // Une notification de message remplace celle du même tag : dix
    // messages de la même personne ne doivent pas empiler dix bannières.
    tag: input.tag,
    renotify: true,
    data: { url: input.url ?? "/messages" },
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-96.png",
  };

  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.active) {
      await registration.showNotification(input.title, options);
      return;
    }
    new Notification(input.title, options);
  } catch {
    // Permission retirée entre-temps, ou appareil qui refuse : rien.
  }
}

/**
 * Abonnement aux notifications poussées.
 *
 * La bannière locale (ci-dessus) ne vit que tant que l'application est
 * ouverte. Le push, lui, réveille le service worker : c'est le seul
 * moyen d'être prévenu sur un écran verrouillé.
 *
 * Trois refus possibles, et ils ne se confondent pas : pas de clé VAPID
 * côté serveur, pas de permission côté navigateur, pas de service worker
 * actif. Chacun se dit à l'écran des réglages.
 */
export type PushState = "unsupported" | "denied" | "off" | "on" | "error";

/** Clé VAPID : base64url vers les octets attendus par `pushManager`. */
function decodeKey(base64: string): Uint8Array<ArrayBuffer> | null {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  try {
    const raw = atob(normalized);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

async function pushConfig(): Promise<{ configured: boolean; publicKey: string | null }> {
  try {
    const response = await fetch("/api/push/subscription", { cache: "no-store" });
    if (!response.ok) return { configured: false, publicKey: null };
    const data = (await response.json()) as { configured?: boolean; publicKey?: string | null };
    return { configured: Boolean(data.configured), publicKey: data.publicKey ?? null };
  } catch {
    return { configured: false, publicKey: null };
  }
}

export async function subscribeToPush(): Promise<PushState> {
  if (!notificationsSupported() || !("serviceWorker" in navigator)) return "unsupported";
  if (notificationState() !== "granted") return "denied";

  const config = await pushConfig();
  if (!config.configured || !config.publicKey) return "unsupported";
  const key = decodeKey(config.publicKey);
  if (!key) return "error";

  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      }));

    const response = await fetch("/api/push/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    return response.ok ? "on" : "error";
  } catch {
    return "error";
  }
}

export async function unsubscribeFromPush(): Promise<PushState> {
  if (!("serviceWorker" in navigator)) return "unsupported";
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return "off";
    await fetch("/api/push/subscription", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    }).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
    return "off";
  } catch {
    return "error";
  }
}

/** L'appareil est-il déjà abonné, et le serveur peut-il pousser ? */
export async function currentPushState(): Promise<PushState> {
  if (!("serviceWorker" in navigator)) return "unsupported";
  const config = await pushConfig();
  if (!config.configured) return "unsupported";
  if (notificationState() === "denied") return "denied";
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription ? "on" : "off";
  } catch {
    return "error";
  }
}

let audio: AudioContext | null = null;

/** Débloque l'audio au premier geste — iOS l'exige. */
export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  if (audio) {
    if (audio.state === "suspended") void audio.resume();
    return;
  }
  const Ctor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    audio = new Ctor();
  } catch {
    audio = null;
  }
}

/**
 * Le carillon d'un message : deux notes courtes, synthétisées.
 *
 * Pas de fichier : un son de notification est un signal, pas un contenu,
 * et un `.mp3` de plus serait un octet de plus à télécharger sur un
 * réseau mobile. Les deux notes montent — c'est ce qui rend le son
 * audible sans être agressif.
 */
export function playChime(): void {
  if (!audio || audio.state !== "running") return;
  const now = audio.currentTime;
  for (const [index, frequency] of [880, 1174.7].entries()) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    const start = now + index * 0.09;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.24);
  }
}
