/**
 * Raccordement à GitHub.
 *
 * ## Le modèle : DevNet d'abord, GitHub ensuite
 *
 * Un projet DevNet possède son propre dépôt, avec son propre historique.
 * Le lien vers GitHub est un **raccordement**, pas une migration : rien ne
 * disparaît de DevNet, et rien n'est importé automatiquement. Ce choix
 * répond à deux contraintes réelles :
 *
 * - la connexion GitHub est **par personne**. Personne ne peut pousser avec
 *   le jeton de quelqu'un d'autre, ce qui veut dire qu'une seule révocation
 *   ne casse pas tout le groupe ;
 * - déconnecter GitHub laisse le projet intact et utilisable. Le groupe
 *   continue de coder offline si le service tombe.
 *
 * Le sens par défaut est donc **manuel**, et le push automatique est un
 * choix explicite, jamais le défaut : pousser vers GitHub rend le code
 * public, et « public » est une décision, pas un effet de bord.
 */

/** Référence à un dépôt GitHub. */
export interface RepoRef {
  owner: string;
  repo: string;
}

/** Comment le projet et GitHub restent synchronisés. */
export type SyncMode = "manuel" | "pull" | "push" | "bidirectionnel";

export type LinkError =
  | "url-invalide"
  | "proprietaire-invalide"
  | "depot-invalide"
  | "modes-differents"
  | "branche-invalide";

export type LinkResult =
  | { ok: true; ref: RepoRef; branch: string }
  | { ok: false; reason: LinkError };

/**
 * Règles de nommage GitHub.
 *
 * On les rejoue ici plutôt que de laisser l'API rejeter : une erreur
 * retournée par GitHub arrive en anglais, en différé, et après que
 * l'utilisateur a déjà saisi le reste du formulaire.
 */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
/** Les branches ne peuvent pas contenir ces séquences : c'est la règle de git. */
const BRANCH_BAD = /[\s~^:?*\[\\]|\.\.|@\{|\.lock$|\/$/;

/**
 * Extrait un dépôt d'une URL GitHub ou d'une chaîne `propriétaire/dépôt`.
 *
 * On accepte `git@github.com:o/r.git` aussi bien que `https://…` : les
 * gens copient les deux, et refuser la forme SSH pour une raison
 * d'esthétique serait absurde.
 */
export function parseRepo(input: string): LinkResult {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: "url-invalide" };

  // `git@github.com:o/r.git` → `o/r`
  const ssh = /^git@github\.com:(.+)$/.exec(raw);
  let body = raw;

  // Les gens collent aussi le domaine collé au chemin (`github.com/o/r`).
  // On le retire avant de passer dans l'analyse d'URL, sinon il compterait
  // comme un segment de dépôt.
  body = body.replace(/^(www\.)?github\.com\//, "");

  if (ssh) {
    body = ssh[1];
  } else {
    try {
      const url = new URL(body.startsWith("http") ? body : `https://github.com/${body}`);
      if (url.hostname !== "github.com") return { ok: false, reason: "url-invalide" };
      body = url.pathname;
    } catch {
      return { ok: false, reason: "url-invalide" };
    }
  }

  body = body.replace(/^\/+/, "").replace(/\.git$/, "");
  const parts = body.split("/").filter(Boolean);
  if (parts.length !== 2) return { ok: false, reason: "url-invalide" };

  const [owner, repo] = parts;
  if (!OWNER.test(owner)) return { ok: false, reason: "proprietaire-invalide" };
  if (!REPO.test(repo)) return { ok: false, reason: "depot-invalide" };

  return { ok: true, ref: { owner, repo }, branch: "main" };
}

/** `propriétaire/dépôt`, forme canonique d'affichage. */
export const repoSlug = (ref: RepoRef): string => `${ref.owner}/${ref.repo}`;

/** Une branche est-elle acceptable ? */
export function isValidBranch(branch: string): boolean {
  const b = branch.trim();
  if (!b || b.length > 255) return false;
  return !BRANCH_BAD.test(b);
}

/**
 * Vérifie qu'un projet peut être raccordé à un dépôt.
 *
 * La seule contrainte structurelle est le mode : un projet en
 * synchronisation bidirectionnelle écrit dans GitHub, donc son dépôt doit
 * être le sien — on ne pousse jamais vers un dépôt qu'on ne possède pas.
 * Le reste est vérifié à la connexion, quand l'API répond.
 */
export function canLink(mode: SyncMode, ref: RepoRef, ownedByViewer: boolean): LinkResult {
  // `manuel` ne transfère rien ; `pull` ne fait que **lire** GitHub, donc
  // un dépôt qu'on ne possède pas est acceptable. Seuls les modes qui
  // écrivent exigent la propriété.
  if (mode === "manuel" || mode === "pull") return { ok: true, ref, branch: "main" };
  if (!ownedByViewer) return { ok: false, reason: "modes-differents" };
  return { ok: true, ref, branch: "main" };
}

/** Ce qu'une synchronisation va faire, avant de la faire. */
export type SyncAction =
  | "aucun-changement"
  | "push"
  | "pull"
  | "divergence";

export interface SyncPlan {
  action: SyncAction;
  /** Explication en une ligne, affichée avant confirmation. */
  reason: string;
  /** Commits qui seront poussés, du plus ancien au plus récent. */
  outbound: number;
}

/**
 * Prépare une synchronisation.
 *
 * On ne pousse ni ne tire jamais sans avoir dit ce qui allait se passer :
 * une synchronisation automatique qui écrase trois commits sans prévenir est
 * la pire façon de perdre du travail. Trois cas seulement :
 *
 * - rien à faire des deux côtés ;
 * - on est en avance → `push` ;
 * - GitHub a des commits que nous n'avons pas → `pull`, et si les deux
 *   camps ont avancé, on **refuse** plutôt que de choisir.
 */
export function planSync(input: {
  mode: SyncMode;
  localSha: string;
  remoteSha: string;
  /** Le dernier sha connu des deux côtés lors de la dernière synchro. */
  lastSyncedLocal?: string;
}): SyncPlan {
  const { localSha, remoteSha, lastSyncedLocal } = input;

  if (input.mode === "manuel") {
    return {
      action: "aucun-changement",
      reason: "Synchronisation manuelle : rien n'est envoyé sans votre confirmation.",
      outbound: 0,
    };
  }

  if (localSha === remoteSha) {
    return { action: "aucun-changement", reason: "Dépôt déjà à jour.", outbound: 0 };
  }

  if (!lastSyncedLocal) {
    return {
      action: "divergence",
      reason:
        "Aucune synchronisation précédente : on ne peut pas savoir qui est en avance.",
      outbound: 0,
    };
  }

  if (lastSyncedLocal === localSha) {
    return { action: "pull", reason: "GitHub a des commits que vous n'avez pas.", outbound: 0 };
  }

  if (lastSyncedLocal === remoteSha) {
    return { action: "push", reason: "Vous avez des commits à envoyer.", outbound: 1 };
  }

  return {
    action: "divergence",
    reason: "Des deux côtés ont changé depuis la dernière synchronisation : réconciliez à la main.",
    outbound: 0,
  };
}

/** Le lien est-il encore d'actualité, ou faut-il le refaire ? */
export function needsRelink(lastSyncedAt: string | null, maxDays = 30): boolean {
  if (!lastSyncedAt) return true;
  const then = new Date(lastSyncedAt).getTime();
  if (Number.isNaN(then)) return true;
  return Date.now() - then > maxDays * 86_400_000;
}