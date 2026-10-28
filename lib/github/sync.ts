/**
 * Ce qu'une synchronisation envoie au route de poussée, et ce
 * qu'il répond.
 *
 * ## Pourquoi valider ici
 *
 * Le route de synchronisation est le seul endroit où DevNet parle
 * à GitHub **avec** un jeton. Tout ce qui arrive depuis le
 * navigateur y arrivera comme hostile : un chemin avec `..` un
 * sha qui en est pas un une liste vide ou infinie. Les règles
 * sont posées ici — pures sans le réseau — pour la même raison
 * que `parseRepo` : une règle qu'un test peut tenir est une
 * règle qui reste vraie.
 *
 * ## Le sha attendu du distant
 *
 * `expectedRemoteSha` est le dernier sha que DevNet sait avoir
 * synchronisé. Le route le compare au sha **réel** du distant :
 * s'ils diffèrent, GitHub a avancé sans nous, et pousser
 * écraserait l'historique d'un autre. C'est la même sémantique
 * que `planSync` — refus pas fusion — mais vérifiée contre le
 * vrai dépôt pas contre ce que l'on croit.
 */

/** Un fichier à pousser tel que le dépôt le range. */
export interface SyncFile {
  path: string;
  content: string;
}

/** La demande de poussée. */
export interface SyncPayload {
  owner: string;
  repo: string;
  branch: string;
  /** Tête locale à publier. */
  headSha: string;
  /** Dernier sha distant connu de DevNet ("" si jamais synchronisé). */
  expectedRemoteSha: string;
  /** Message du commit de synchronisation. */
  message: string;
  files: SyncFile[];
}

/** Ce que le route répond. */
export type SyncOutcome =
  | { status: "pushed"; sha: string; files: number }
  | { status: "nothing" }
  | { status: "error"; code: SyncErrorCode; message?: string };

export type SyncErrorCode =
  | "no-token"
  | "identity"
  | "not-owner"
  | "diverged"
  | "api"
  | "bad-request";

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const PATH = /^(?!\/)[^\n\r\0\\]+$/;

/**
 * Valide une charge de poussée.
 *
 * Un chemin valide : relatif sans traversée (`..`) sans antislash
 * (Windows écrirait sinon des chemins que git ne lira pas) sans
 * octet nul dans la limite de git. La liste est bornée à 200
 * fichiers — assez pour un projet pas assez pour une attaque par
 * volume.
 */
export function validateSyncPayload(
  input: unknown,
): { ok: true; value: SyncPayload } | { ok: false; reason: string } {
  const p = input as Partial<SyncPayload> | null;
  if (!p || typeof p !== "object") {
    return { ok: false, reason: "Charge absente." };
  }

  if (
    typeof p.owner !== "string" ||
    typeof p.repo !== "string" ||
    typeof p.branch !== "string" ||
    typeof p.headSha !== "string" ||
    typeof p.message !== "string"
  ) {
    return { ok: false, reason: "Charge absente." };
  }

  for (const [key, value] of [
    ["owner", p.owner],
    ["repo", p.repo],
    ["branch", p.branch],
    ["headSha", p.headSha],
    ["message", p.message],
  ] as const) {
    if (!value.trim()) {
      return { ok: false, reason: `Champ « ${key} » absent.` };
    }
  }

  if (typeof p.expectedRemoteSha !== "string") {
    return { ok: false, reason: "Champ « expectedRemoteSha » absent." };
  }
  if (p.expectedRemoteSha && !SHA.test(p.expectedRemoteSha)) {
    return { ok: false, reason: "Sha distant attendu invalide." };
  }
  if (!SHA.test(p.headSha)) {
    return { ok: false, reason: "Tête locale invalide." };
  }

  if (!Array.isArray(p.files) || p.files.length === 0) {
    return { ok: false, reason: "Aucun fichier à pousser." };
  }
  if (p.files.length > 200) {
    return { ok: false, reason: "Trop de fichiers pour une poussée." };
  }

  for (const file of p.files) {
    const f = file as Partial<SyncFile>;
    if (!f || typeof f.path !== "string" || !PATH.test(f.path)) {
      return { ok: false, reason: "Chemin de fichier invalide." };
    }
    if (f.path.includes("..") || f.path.startsWith("/")) {
      return { ok: false, reason: "Chemin de fichier invalide." };
    }
    if (f.path.length > 255) {
      return { ok: false, reason: "Chemin de fichier trop long." };
    }
    if (typeof f.content !== "string") {
      return { ok: false, reason: `Contenu absent pour « ${(f as SyncFile).path} ».` };
    }
  }

  return {
    ok: true,
    value: {
      owner: p.owner.trim(),
      repo: p.repo.trim(),
      branch: p.branch.trim(),
      headSha: p.headSha,
      expectedRemoteSha: p.expectedRemoteSha,
      message: p.message.trim().slice(0, 200),
      files: p.files.map((f) => ({
        path: (f as SyncFile).path,
        content: (f as SyncFile).content,
      })),
    } as SyncPayload,
  };
}

/** Le texte de chaque échec — ce que l'écran montre. */
export const SYNC_ERROR_TEXT: Record<SyncErrorCode, string> = {
  "no-token": "Session GitHub expirée. Reconnectez-vous.",
  identity: "Le jeton GitHub ne permet pas de lire votre identité.",
  "not-owner":
    "Le compte GitHub connecté n'est pas le propriétaire de ce dépôt.",
  diverged:
    "GitHub a avancé depuis la dernière synchronisation. Réconciliez à la main : DevNet n'écrase pas.",
  api: "L'API GitHub a refusé la poussée. Vérifiez le dépôt et la branche.",
  "bad-request": "Demande de synchronisation mal formée.",
};
