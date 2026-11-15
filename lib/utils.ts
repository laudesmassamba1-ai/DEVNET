import type { AvatarColor } from "./types";

/** Échappe le HTML — indispensable car on injecte du texte via dangerouslySetInnerHTML. */
export function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br/>");
}

/**
 * Temps relatif en français : « à l'instant », « il y a 12 min »…
 *
 * Les paliers sont posés dans l'ordre et **couvrants** : chaque seuil est
 * la borne de ce qui précède, donc 3600 puis 86400 puis 604800. Un
 * décalage entre deux bornes ne coûte rien ; un jour de trop, en revanche,
 * ne renvoie pas une date fausse mais « il y a 0 j » — c'est-à-dire
 * « à l'instant », puisque 0 est aussi ce que renvoie un texte de moins
 * d'une minute.
 *
 * C'était le cas ici : le seuil des jours divisait par 864800 au lieu de
 * 86400. Le fil, les commentaires, l'historique et les notifications
 * affichaient
 * donc tous « à l'instant » pendant sept jours. Une application dont tout
 * semble écrit à l'instant où l'on regarde paraît vide — et le défaut est
 * invisible en relecture, parce que « il y a 0 j » se lit très bien.
 */
export function timeAgo(input: string | Date | null | undefined): string {
  if (!input) return "à l'instant";
  const d = typeof input === "string" ? new Date(input) : input;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);

  if (Number.isNaN(s)) return "à l'instant";
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 604800) return `il y a ${Math.floor(s / 86400)} j`;

  return d.toLocaleDateString("fr", { day: "numeric", month: "short" });
}

/**
 * Un nombre écrit **en français** : virgule décimale, et jamais « -0,0 ».
 *
 * Deux détails qui ne sont pas de la coquetterie : une pente affichée
 * « 5.4 pt/révision » dans une interface française se lit comme un code
 * postal, et un écart-type de 0,03 point s'écrit « -0,0 » si l'on n'y prend
 * pas garde — un zéro négatif existe en flottant, pas dans la langue. Deux
 * écrans montrent ces nombres (le panneau de score et la trajectoire d'un
 * profil) : ils passent donc par la même fonction.
 */
export function frNumber(value: number, digits = 1): string {
  const negligeable = Math.abs(value) < 0.5 * 10 ** -digits;
  return (negligeable ? 0 : value).toFixed(digits).replace(".", ",");
}

export function clockTime(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  return d.toLocaleTimeString("fr", { hour: "2-digit", minute: "2-digit" });
}

/** Classes Tailwind par couleur d'avatar. */
export const AVATAR_CLASS: Record<AvatarColor, string> = {
  "av-lime":   "bg-av-lime-bg text-av-lime-fg border-av-lime-fg",
  "av-sage":   "bg-av-sage-bg text-av-sage-fg border-av-sage-fg",
  "av-pink":    "bg-av-pink-bg text-av-pink-fg border-av-pink-fg",
  "av-orange":  "bg-av-orange-bg text-av-orange-fg border-av-orange-fg",
  "av-violet":  "bg-av-violet-bg text-av-violet-fg border-av-violet-fg",
};

export function avatarClass(color: string | null | undefined): string {
  return AVATAR_CLASS[(color ?? "av-sage") as AvatarColor] ?? AVATAR_CLASS["av-sage"];
}

/** Étiquette lisible pour le type de compte. */
export function accountLabel(type: string | null | undefined): string {
  return type === "professional" ? "Professionnel" : "Étudiant";
}

export function initials(name: string | null | undefined): string {
  return (name?.trim()?.[0] ?? "?").toUpperCase();
}

/** `Koffi ship · L3` */
export function profileMeta(filiere?: string, niveau?: string): string {
  return [filiere, niveau].filter(Boolean).join(" · ");
}
/**
 * Message d'erreur d'authentification lisible.
 *
 * Distingue un vrai échec d'identification d'une panne réseau :
 * dire « mot de passe incorrect » quand le serveur est injoignable
 * envoie l'utilisateur vérifier un mot de passe parfaitement valide.
 */
export function authErrorMessage(err: { message: string } | null): string {
  if (!err) return "Connexion impossible.";

  const msg = err.message.toLowerCase();
  const network =
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("timeout") ||
    msg.includes("load failed");

  if (network) {
    return "Serveur injoignable. Vérifie ta connexion internet, puis réessaie.";
  }
  if (msg.includes("confirm") || msg.includes("verify")) {
    return "Confirme ton adresse email avant de te connecter.";
  }
  return "Email ou mot de passe incorrect.";
}
