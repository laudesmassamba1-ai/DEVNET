/**
 * La synchronisation GitHub « live » — la décision, pure.
 *
 * ## Pourquoi un module à part
 *
 * Le panneau GitHub savait seulement *lier* un dépôt et *montrer* ce qu'une
 * poussée ferait. Le mode live ajoute une boucle : lire GitHub à
 * intervalle, comparer, puis tirer ou pousser. La comparaison est la
 * partie délicate — elle doit être **testable sans réseau** — donc elle
 * vit ici, loin du hook qui, lui, parle vraiment à GitHub.
 *
 * ## On ne compare pas des sha qui ne se comparent pas
 *
 * Les sha DevNet sont recalculés par notre moteur (`lib/git`) et ne sont
 * **pas** ceux de GitHub : `importRepoHistory` le dit explicitement. On ne
 * peut donc jamais faire `localHead === remoteHead`. On compare chaque
 * camp à ce qu'on a mémorisé de **lui** :
 *
 * - le distant à `remote_sha` (dernier sha vu sur GitHub) ;
 * - le local à `local_sha` (tête DevNet à la dernière synchro).
 *
 * Un camp a « changé » quand sa tête diffère de la mémoire qu'on en a.
 */

import type { SyncMode } from "./link";

/** Ce qu'un tick de synchronisation doit faire. */
export type LiveAction =
  | { kind: "none"; reason: string }
  | { kind: "pull"; reason: string }
  | { kind: "push"; reason: string }
  | { kind: "diverged"; reason: string };

/** Tout ce dont la décision a besoin. */
export interface LiveState {
  mode: SyncMode;
  /** Tête locale de la branche (sha DevNet ramené par `fetchBranches`). */
  localHead: string;
  /** Tête distante lue à l'instant sur GitHub (sha GitHub). */
  remoteHead: string;
  /** Colonne `remote_sha` du lien. */
  lastRemoteSha: string;
  /** Colonne `local_sha` du lien. */
  lastLocalSha: string;
}

/** Le mode déclenche-t-il une boucle automatique ? */
export function liveEnabled(mode: SyncMode): boolean {
  return mode !== "manuel";
}

/** Ce mode lit-il GitHub ? */
export function canPull(mode: SyncMode): boolean {
  return mode === "pull" || mode === "bidirectionnel";
}

/** Ce mode écrit-il dans GitHub ? (Réservé aux dépôts possédés.) */
export function canPush(mode: SyncMode): boolean {
  return mode === "push" || mode === "bidirectionnel";
}

/**
 * La décision d'un tick.
 *
 * Quatre issues, du plus sûr au plus prudent :
 *
 * - `none` — rien à faire, ou impossible de lire GitHub ;
 * - `pull` — GitHub a avancé, on importe ;
 * - `push` — DevNet a avancé et GitHub non, on envoie ;
 * - `diverged` — les deux ont bougé : on **refuse**, on n'écrase rien.
 */
export function planLive(state: LiveState): LiveAction {
  if (!liveEnabled(state.mode)) {
    return { kind: "none", reason: "Synchro live désactivée." };
  }
  if (!state.remoteHead) {
    return { kind: "none", reason: "GitHub n'a pas répondu." };
  }

  // `lastRemoteSha === ""` compte comme « changé » : on n'avait aucune
  // base, donc le premier tick établit la référence (en tirant si le mode
  // le permet, sinon en l'adoptant — voir `shouldAdoptBaseline`).
  const remoteChanged = state.remoteHead !== state.lastRemoteSha;
  const localChanged =
    state.lastLocalSha !== "" && state.localHead !== state.lastLocalSha;

  if (remoteChanged && localChanged) {
    return {
      kind: "diverged",
      reason: "GitHub et DevNet ont avancé : réconciliez à la main.",
    };
  }
  if (remoteChanged && canPull(state.mode)) {
    return { kind: "pull", reason: "GitHub a des commits que vous n'avez pas." };
  }
  if (localChanged && canPush(state.mode) && !remoteChanged) {
    return { kind: "push", reason: "Vous avez des commits à envoyer." };
  }
  if (remoteChanged && !canPull(state.mode)) {
    return {
      kind: "none",
      reason: "GitHub a avancé (mode sans tirage) — référence mise à jour.",
    };
  }
  return { kind: "none", reason: "À jour." };
}

/**
 * Faut-il mémoriser l'état observé sans rien transférer ?
 *
 * Oui pour un « rien à faire » ordinaire — c'est ainsi qu'on pose la
 * première référence — mais non quand GitHub n'a pas répondu : adopter un
 * sha vide effacerait la base et rejouerait un tirage au prochain tick.
 * Une divergence, elle, n'est même pas un `none`.
 */
export function shouldAdoptBaseline(action: LiveAction): boolean {
  return action.kind === "none" && action.reason !== "GitHub n'a pas répondu.";
}

/** Les cadences proposées dans les paramètres associés. */
export const LIVE_INTERVALS: { seconds: number; label: string }[] = [
  { seconds: 15, label: "15 s" },
  { seconds: 30, label: "30 s" },
  { seconds: 60, label: "1 min" },
  { seconds: 300, label: "5 min" },
];

/** Le libellé d'une cadence, même si elle ne figure pas au catalogue. */
export function intervalLabel(seconds: number): string {
  return LIVE_INTERVALS.find((i) => i.seconds === seconds)?.label ?? `${seconds} s`;
}

/**
 * L'événement qui prévient le moteur qu'un réglage a changé.
 *
 * Le panneau écrit le lien ; le hook qui fait tourner la boucle le lit.
 * Sans cet événement, un changement de mode n'agirait qu'après un tick —
 * jusqu'à cinq minutes d'attente pour un clic. On préfère un canal
 * explicite à un raccourci de re-rendu.
 */
export const LINK_CHANGED_EVENT = "devnet:github-link";
