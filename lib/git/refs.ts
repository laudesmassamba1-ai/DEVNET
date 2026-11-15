/**
 * Noms de branche.
 *
 * ## Pourquoi une règle aussi tatillonne
 *
 * Le nom d'une branche n'est pas un libellé : c'est une **clé**. Il entre
 * dans une URL, dans une requête de base, et il finit dans le nom d'une
 * branche du dépôt. Une branche nommée `feat/../../main` ou `main ` n'est
 * pas une branche mal écrite, c'est une branche qui **pointe ailleurs**.
 *
 * On applique donc les règles de `git check-ref-format --branch`, celles
 * que git lui-même refuse. Elles sont écrites ici, en un seul endroit, et
 * testées sans base ni interface : voir `scripts/test-repo.ts`.
 *
 * La contrainte SQL de la migration 012 est **volontairement plus
 * grossière**. Elle ne reprend qu'une fraction de ces règles, parce
 * qu'une contrainte SQL qui refuse ce que l'écran a accepté est pire
 * qu'une contrainte absente : elle donne une erreur que personne ne sait
 * expliquer. Ici, c'est un filet de dernier recours ; l'autorité, c'est
 * cette fonction.
 */

/** Raison pour laquelle un nom de branche est refusé. */
export type RefRejection =
  | "vide"
  | "trop-long"
  | "espace"
  | "controle"
  | "interdit"
  | "point"
  | "composante"
  | "verrou"
  | "at";

export type RefCheck =
  | { ok: true; name: string }
  | { ok: false; reason: RefRejection };

/** Longueur maximale — celle de git. */
const MAX = 255;

/**
 * Caractères qu'un nom de chemin de référence ne peut pas contenir.
 *
 * `~ ^ : ? * [` sont interdits par git parce qu'ils servent à la syntaxe
 * des révisions (`HEAD~1`). Le `\` ferme la séquence d'échappement Windows,
 * ce qui produirait deux chemins là où on en a écrit un.
 */
const FORBIDDEN = /[~^:?*[\\]/;

/**
 * Le nom contient-il un caractère de contrôle ?
 *
 * On ne passe pas par une expression régulière : un motif de contrôle
 * s'écrit avec des octets littéraux ou avec des échappements, et les
 * deux finissent mal — un caractère brut dans le fichier source le rend
 * binaire pour les outils, et un motif mal refermé se met à refuser
 * silencieusement presque tout. Une boucle sur les points de code ne peut
 * pas tomber dans l'un ou l'autre.
 *
 * On refuse 0x00–0x1f et 0x7f. Le reste de la plage n'est pas rejetée :
 * un nom peut contenir un accent, et un projet africain s'écrit avec.
 */
function hasControl(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * Valide un nom de branche et le rend canonique.
 *
 * « Canonique » signifie : on rogne les espaces de bord avant de juger.
 * Une personne qui colle `  amelioration  ` veut écrire `amelioration` ;
 * refuser la saisie serait plus sévère que nécessaire, alors que la
 * rognature ne change pas ce qu'elle veut dire.
 */
export function validateBranchName(input: string): RefCheck {
  const name = input.trim();

  if (name.length === 0) return { ok: false, reason: "vide" };
  if (name.length > MAX) return { ok: false, reason: "trop-long" };
  if (hasControl(name)) return { ok: false, reason: "controle" };
  if (FORBIDDEN.test(name)) return { ok: false, reason: "interdit" };
  if (/\s/.test(name)) return { ok: false, reason: "espace" };

  // `@` seul désigne HEAD dans la syntaxe de git. Il est interdit comme
  // nom de branche, mais parfaitement légal au milieu d'un autre nom.
  if (name === "@") return { ok: false, reason: "at" };

  // Un nom qui commence ou finit par `/` a un composant vide : `a/` et
  // `/a` désignent la même chose que `a`, et deux écritures pour une
  // branche feraient deux branches.
  if (name.startsWith("/") || name.endsWith("/")) {
    return { ok: false, reason: "composante" };
  }

  // `..` est le danger réel : en chemin, il remonte. `feat/../main`
  // désignerait `main` sans jamais l'avoir écrit.
  if (name.includes("..")) return { ok: false, reason: "point" };

  // Un composant qui commence par `.` est invisible dans un dossier, et
  // `.` seul désigne le répertoire courant — donc n'importe quel fichier.
  if (name.split("/").some((c) => c.startsWith("."))) {
    return { ok: false, reason: "composante" };
  }

  // `.lock` à la fin d'un composant est la façon dont git marque un
  // fichier verrouillé ; un nom qui se termine ainsi ne peut pas être
  // écrit sur le disque.
  if (name.split("/").some((c) => c.endsWith(".lock"))) {
    return { ok: false, reason: "verrou" };
  }

  // Un nom qui finit par un point est un nom qu'aucun système de
  // fichiers ne peut écrire, et Windows le tronque sans prévenir.
  if (name.endsWith(".")) return { ok: false, reason: "point" };

  return { ok: true, name };
}

/** Message d'une erreur, dans la langue de l'interface. */
export function branchErrorText(reason: RefRejection): string {
  switch (reason) {
    case "vide":
      return "Le nom d'une branche ne peut pas être vide.";
    case "trop-long":
      return `Nom trop long — ${MAX} caractères au maximum.`;
    case "espace":
      return "Pas d'espace dans un nom de branche : il entre dans une ligne de commande.";
    case "controle":
      return "Ce nom contient un caractère invisible.";
    case "interdit":
      return "Ce caractère est interdit dans un nom de branche.";
    case "point":
      return "Un nom de branche ne peut ni contenir « .. » ni finir par un point.";
    case "composante":
      return "Un nom ne peut ni commencer ni finir par « / », ni contenir un composant commençant par « . ».";
    case "verrou":
      return "Un composant ne peut pas finir par « .lock » : c'est la marque d'un fichier verrouillé.";
    case "at":
      return "« @ » désigne HEAD dans git — ce n'est pas un nom de branche.";
  }
}

/**
 * Le nom de branche par défaut d'un projet.
 *
 * `main` plutôt que `master` : c'est le nom que git et GitHub utilisent
 * par défaut depuis 2020, et le choix doit être fait une fois, au même
 * endroit, pas par chaque projet.
 */
export const DEFAULT_BRANCH = "main";

/** Le nom d'une branche peut-il être supprimé ? */
export function canDeleteBranch(options: {
  name: string;
  /** La branche par défaut du projet — celle qui ne disparaît pas. */
  defaultBranch: string;
  /** Nombre de branches : on garde au moins la branche par défaut. */
  remaining: number;
}): { ok: boolean; reason?: string } {
  if (options.name === options.defaultBranch) {
    return { ok: false, reason: "La branche par défaut ne peut pas être supprimée." };
  }
  if (options.remaining <= 1) {
    return { ok: false, reason: "Un dépôt doit garder au moins une branche." };
  }
  return { ok: true };
}