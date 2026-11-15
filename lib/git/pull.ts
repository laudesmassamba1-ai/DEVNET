/**
 * Pull requests — ce qui décide si une fusion a lieu, et ce qu'elle écrit.
 *
 * Comme `history.ts`, ce module ne connaît **ni la base, ni le réseau** :
 * il raisonne sur des objets et en renvoie d'autres. C'est ce qui permet
 * d'écrire des tests sur la partie difficile — « peut-on fusionner ? » —
 * sans Postgres, sans navigateur, et donc sans que la réponse soit
 * simplement « ça marche sur ma machine ».
 *
 * ## La règle : pas de fusion automatique
 *
 * `history.ts` l'écrit déjà pour les commits : une fusion qui choisit un
 * camp sans le dire donne l'illusion que tout va bien alors qu'une
 * modification est perdue. Une pull request ajoute une difficulté — la
 * branche cible a pu bouger entre l'ouverture et la fusion.
 *
 * Ce module neinvente donc pas de fusion à trois voies. Il distingue
 * trois situations, et une seule aboutit :
 *
 * 1. **La source est déjà dans la cible** — rien à faire. Git appelle ça
 *    « déjà à jour » ; nous refusons, avec une phrase qui le dit.
 * 2. **La cible a bougé sur les mêmes fichiers** — refus, avec la liste
 *    des fichiers en cause. C'est le conflit, et il est nommé.
 * 3. **La cible a bougé ailleurs** — la fusion est possible : on copie le
 *    contenu de la source sur les seuls fichiers que la source a
 *    modifiés, et on laisse le reste de la cible intact.
 *
 * Le cas 3 est le seul des trois cas où la fusion ne perd rien. Il faut le
 * dire précisément : ce n'est pas « la cible peut être relue », c'est
 * « personne ne touche au même fichier ».
 */

import { diffTrees, type FileDiff, type RepoFile } from "./history";

/** Ce que sait le moteur sur une branche : ses fichiers et son sommet. */
export interface Branche {
  nom: string;
  fichiers: RepoFile[];
  /** sha du commit de sommet ; chaîne vide si la branche n'a rien. */
  sommet: string;
}

/**
 * Le verdict de fusion.
 *
 * `fusionnable` est vrai **seulement** quand la fusion ne peut rien
 * perdre. Les trois motifs sont distincts parce que l'écran n'a pas à les
 * traiter différemment : il affiche `raison`, et `fichiers` quand il y en
 * a. Un `fichiers` vide avec `fusionnable: false` signifie « rien à
 * fusionner », un non-vide signifie « conflit ».
 */
export interface Verdict {
  fusionnable: boolean;
  /** Phrase affichable, déjà rédigée, en français. */
  raison: string;
  /** Fichiers en cause dans un conflit. */
  fichiers: string[];
}

/**
 * Les commits de la cible que la source ne contient pas.
 *
 * C'est la question « la cible a-t-elle bougé depuis que la branche est
 * partie ? », et elle se répond par l'ancêtre commun : on prend la
 * chaîne de la cible, on retire ce que la source contient déjà.
 *
 * La garde de cycle est celle de `ancestorsOf` : une chaîne parentée
 *ambi¬gue ne doit pas faire boucler la fusion.
 */
export function commitsAbsentsDe(
  commits: { sha: string; parent_sha: string }[],
  cible: string,
  source: string,
): string[] {
  const parSha = new Map(commits.map((c) => [c.sha, c]));

  const shasDe = (depart: string): Set<string> => {
    const out = new Set<string>();
    let cursor = parSha.get(depart);
    while (cursor && !out.has(cursor.sha)) {
      out.add(cursor.sha);
      cursor = cursor.parent_sha ? parSha.get(cursor.parent_sha) : undefined;
    }
    return out;
  };

  const dejaLa = shasDe(source);
  const absents: string[] = [];

  let cursor = parSha.get(cible);
  const vus = new Set<string>();
  while (cursor && !vus.has(cursor.sha)) {
    vus.add(cursor.sha);
    if (!dejaLa.has(cursor.sha)) absents.push(cursor.sha);
    cursor = cursor.parent_sha ? parSha.get(cursor.parent_sha) : undefined;
  }

  return absents;
}

/**
 * Le commit où les deux branches se sont séparées — la **base de fusion**.
 *
 * C'est le dernier commit de la chaîne de la destination que la source
 * contient déjà, et c'est lui qui donne le sens de toute la suite : sans
 * lui, une pull request compare deux sommets, et une fusion applique
 * « ce qui manque à la destination » — c'est-à-dire **défait** le travail
 * de ceux qui n'ont pas fusionné.
 *
 * Sur une histoire linéaire, c'est simplement le parent du premier commit
 * propre à la destination. Sur une histoire où la destination n'a pas
 * bougé, c'est son propre sommet.
 *
 * Une chaîne vide signifie « aucune base trouvée » : l'appelant doit
 * alors refuser, plutôt que supposer la base.
 */
export function baseDeFusion(
  commits: { sha: string; parent_sha: string }[],
  cible: string,
  source: string,
): string {
  const parSha = new Map(commits.map((c) => [c.sha, c]));

  const shasDe = (depart: string): Set<string> => {
    const out = new Set<string>();
    let cursor = parSha.get(depart);
    while (cursor && !out.has(cursor.sha)) {
      out.add(cursor.sha);
      cursor = cursor.parent_sha ? parSha.get(cursor.parent_sha) : undefined;
    }
    return out;
  };

  const dejaLa = shasDe(source);
  const vus = new Set<string>();
  let cursor = parSha.get(cible);

  while (cursor && !vus.has(cursor.sha)) {
    if (dejaLa.has(cursor.sha)) return cursor.sha;
    vus.add(cursor.sha);
    cursor = cursor.parent_sha ? parSha.get(cursor.parent_sha) : undefined;
  }

  // La destination n'a pas bougé depuis le départ de la branche : sa
  // propre tête est la base.
  return cible;
}

/**
 * Décide si une branche peut être fusionnée dans une autre.
 *
 * @param base Chemins de l'état des fichiers à la base de fusion. C'est
 *   la seule chose qui permette de distinguer « la branche a retiré ce
 *   fichier » de « la destination l'avait déjà retiré ».
 * @param cheminsCibles Chemins touchés par les commits que la cible a en
 *   propre. Information que seul l'appelant possède — il faut lire les
 *   instantanés de commits (`git_commit_files`), donc la base. Passer
 *   `null` signifie « je ne sais pas » et **refuse** : mieux vaut un refus
 *   qu'une fusion aveugle.
 */
export function verifierFusion(options: {
  source: Branche;
  cible: Branche;
  /** État des fichiers à la base de fusion, ou `null` si elle est introuvable. */
  base: RepoFile[] | null;
  commits: { sha: string; parent_sha: string }[];
  /** Chemins touchés par les commits propres à la cible, ou `null`. */
  cheminsCibles: string[] | null;
}): Verdict {
  const { source, cible, base, commits, cheminsCibles } = options;

  if (source.nom === cible.nom) {
    return {
      fusionnable: false,
      raison: "Une branche ne peut pas être fusionnée dans elle-même.",
      fichiers: [],
    };
  }

  if (base === null) {
    return {
      fusionnable: false,
      raison:
        "Le point de départ des deux branches n'a pas pu être retrouvé : " +
        "la fusion est refusée plutôt que devinée.",
      fichiers: [],
    };
  }

  // Ce que la **branche** apporte. Jamais la comparaison des deux
  // sommets : celle-ci afficherait comme suppressions tout ce que la
  // destination a fait depuis le départ de la branche.
  const apport = diffTrees(base, source.fichiers);

  if (apport.length === 0) {
    return {
      fusionnable: false,
      raison: "Rien à fusionner : cette branche n'apporte aucun changement.",
      fichiers: [],
    };
  }

  const absents = commitsAbsentsDe(commits, cible.sommet, source.sommet);

  // La destination n'a pas bougé depuis que la branche est partie : la
  // fusion ne peut rien perdre, quels que soient les contenus.
  if (absents.length === 0) {
    return {
      fusionnable: true,
      raison: "La branche de destination n'a pas bougé depuis le départ de la branche.",
      fichiers: [],
    };
  }

  if (cheminsCibles === null) {
    return {
      fusionnable: false,
      raison:
        `La branche de destination a reçu ${absents.length} commit(s) depuis, ` +
        "et ses fichiers n'ont pas pu être lus : la fusion est refusée plutôt que devinée.",
      fichiers: [],
    };
  }

  // L'intersection est le conflit : un fichier que **les deux** côtés ont
  // touché depuis la base. Les chemins de la cible viennent de ses
  // commits propres, donc un fichier modifié avant la création de la
  // branche n'apparaît pas — c'est exact.
  const ensemble = new Set(cheminsCibles);
  const conflits = apport
    .map((c) => c.path)
    .filter((path) => ensemble.has(path))
    .sort();

  if (conflits.length > 0) {
    return {
      fusionnable: false,
      raison:
        `Conflit : ${conflits.length} fichier(s) ont été modifiés des deux côtés ` +
        `depuis le départ de la branche (${absents.length} commit(s) sur la destination).`,
      fichiers: conflits,
    };
  }

  return {
    fusionnable: true,
    raison:
      `La destination a reçu ${absents.length} commit(s), sur des fichiers ` +
      "que cette branche ne touche pas : la fusion ne peut rien perdre.",
    fichiers: [],
  };
}

/**
 * Le contenu de la destination après intégration de la branche.
 *
 * On applique **les changements de la branche** — base → source — à
 * l'état de la destination. Les fichiers que la destination a modifiés
 * depuis la base restent intacts : c'est toute la différence entre une
 * fusion et un écrasement, et c'est exactement ce que le verdict
 * ci-dessus a promis.
 *
 * Appliquer l'ensemble du contenu de la source, à la place, donnerait à
 * la destination le contenu **d'avant** ses propres commits : le travail
 * de ceux qui n'ont pas fusionné disparaîtrait, en silence.
 *
 * Un fichier supprimé par la branche est supprimé de la destination ; un
 * fichier ajouté y est ajouté.
 */
export function appliquerBranche(options: {
  base: RepoFile[];
  cible: RepoFile[];
  source: RepoFile[];
}): RepoFile[] {
  const { base, cible, source } = options;

  const parChemin = new Map(cible.map((f) => [f.path, f]));
  const parSource = new Map(source.map((f) => [f.path, f]));

  for (const changement of diffTrees(base, source)) {
    if (changement.status === "suppression") {
      parChemin.delete(changement.path);
    } else {
      parChemin.set(changement.path, {
        path: changement.path,
        content: changement.after,
        blob_sha: parSource.get(changement.path)?.blob_sha,
      });
    }
  }

  return [...parChemin.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

/**
 * Le message du commit de fusion.
 *
 * Il est écrit ici et non par l'écran : deux personnes qui fusionnent la
 * même pull request doivent produire le même commit — sinon l'historique
 * raconte deux fins différentes pour la même chose.
 */
export function messageFusion(numero: number, titre: string): string {
  return `Fusion de la pull request #${numero} — ${titre.trim()}`;
}

/** Les chemins apportés par la branche — le contenu d'un onglet de demande. */
export function apportDeLaBranche(
  base: RepoFile[] | null,
  source: RepoFile[],
): FileDiff[] {
  return base === null ? [] : diffTrees(base, source);
}

/**
 * Résumé d'une pull request, tel qu'affiché sur une ligne.
 *
 * Le résumé ne dit **rien** de l'état de la relecture. Il n'y a pas
 * encore de demandes de revue (le lot suivant s'en charge) : annoncer
 * « en attente de revue » sur une ligne où aucun lecteur ne peut répondre
 * serait afficher un état qui n'existe pas.
 */
export function resumePullRequest(options: {
  numero: number;
  titre: string;
  source: string;
  cible: string;
  changements: FileDiff[];
}): string {
  const { numero, titre, source, cible, changements } = options;

  const fichiers =
    changements.length === 1 ? "1 fichier" : `${changements.length} fichiers`;
  const ajouts = changements.reduce((n, c) => n + c.insertions, 0);
  const retraits = changements.reduce((n, c) => n + c.deletions, 0);

  return `#${numero} ${titre} · ${source} → ${cible} · ${fichiers} +${ajouts} −${retraits}`;
}