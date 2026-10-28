/**
 * Jeu de démonstration — espaces de groupe, projets, dépôt interne.
 *
 * Séparé de `data.ts` pour une raison précise : les identifiants des
 * commits sont **calculés par le moteur** au lieu d'être écrits en dur.
 * Un jeu de données à sha inventés afficherait des arbres qui ne
 * correspondent à aucun contenu — et quelqu'un le remarquerait, parce
 * qu'il suffit d'ouvrir le dépôt et de recalculer.
 *
 * Le reste du fichier suit la même règle que `data.ts` : mêmes colonnes,
 * mêmes types, mêmes chaînes que celles que renvoie Postgres.
 */

import { createCommit, type Commit, type RepoFile } from "@/lib/git/history";
import { hashBlob } from "@/lib/git/objects";
import { appliquerBranche, messageFusion } from "@/lib/git/pull";
import type {
  Channel, ChannelMember, ChannelRole, GitCommit, GitCommitFile, GitFile, GitRef, GithubConnection,
  Project, ProjectLink, ProjectMember, ProjectSession,
} from "@/lib/types";
import { DEMO_GROUPS } from "./data";

const t0 = Date.parse("2026-10-03T14:00:00Z");
const ago = (ms: number): string => new Date(t0 - ms).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const AUTHOR = {
  id: "u-koffi",
  name: "Koffi",
  email: "koffi@devnet.africa",
};

// ── Canaux ──────────────────────────────────────

export const DEMO_CHANNELS: Channel[] = [
  {
    id: "ch-1",
    group_id: "g-1",
    slug: "general",
    name: "général",
    topic: "Tout ce qui ne trouve pas mieux sa place.",
    position: 0,
    is_private: false,
    created_by: "u-koffi",
    created_at: ago(60 * DAY),
  },
  {
    id: "ch-2",
    group_id: "g-1",
    slug: "dev",
    name: "développement",
    topic: "Le code du projet, les revues, les commits.",
    position: 1,
    is_private: false,
    created_by: "u-aminata",
    created_at: ago(58 * DAY),
  },
  {
    id: "ch-3",
    group_id: "g-1",
    slug: "aide",
    name: "aide",
    topic: "Bloqué sur un bug ? Demandez ici, jamais en message privé.",
    position: 2,
    is_private: false,
    created_by: "u-koffi",
    created_at: ago(58 * DAY),
  },
  {
    id: "ch-5",
    group_id: "g-3",
    slug: "general",
    name: "général",
    topic: "",
    position: 0,
    is_private: false,
    created_by: "u-thabo",
    created_at: ago(20 * DAY),
  },
  {
    id: "ch-4",
    group_id: "g-2",
    slug: "general",
    name: "général",
    topic: "",
    position: 0,
    is_private: false,
    created_by: "u-thabo",
    created_at: ago(40 * DAY),
  },
];

/**
 * Les membres des canaux.
 *
 * Un canal n'a pas qu'un fondateur : il a les membres du groupe. Sans
 * eux, le « lu par 2 sur 5 » du groupe n'aurait jamais de dénominateur,
 * et l'accusé de lecture d'un canal ne pourrait pas s'afficher — la
 * fonctionnalité serait là, invérifiable, donc inexistante pour qui
 veut la montrer.
 *
 * `last_read_at` est volontairement `null` au départ : personne n'a
 * encore ouvert le canal dans la démo, et c'est le seul état initial
 * honnête. Une valeur à la création ferait afficher « lu par 4 sur 4 »
 * sur des messages que personne n'a ouverts — le même mensonge que
 * `likes: 34` sur deux lignes de `post_likes`.
 */
export const DEMO_CHANNEL_MEMBERS: ChannelMember[] = DEMO_CHANNELS.flatMap((c) => {
  const groupe = DEMO_GROUPS.find((g) => g.id === c.group_id);
  const membres = groupe?.members ?? [c.created_by];

  return membres.map((userId, i) => ({
    channel_id: c.id,
    user_id: userId,
    role: (userId === c.created_by ? "owner" : "member") as ChannelRole,
    muted: false,
    joined_at: new Date(Date.parse(c.created_at) + i * HOUR).toISOString(),
    last_read_at: null,
  }));
});

// ── Projet ──────────────────────────────────────

/**
 * Quatre projets, volontairement **différents en tout** : un dépôt à
 * quatre membres bien avancé, un prototype qui recrute dans deux
 * langages, une idée qui cherche tout le monde, et une maintenance qui
 * ne cherche plus personne. Sans cette variété, les filtres du §6
 * n'auraient rien à démontrer — et un filtre qu'on ne peut pas essayer
 * est un filtre dont on ne sait pas s'il marche.
 */
export const DEMO_PROJECTS: Project[] = [
  {
    id: "p-1",
    group_id: "g-1",
    created_by: "u-koffi",
    name: "Coopérative Numérique",
    slug: "cooperative-numerique",
    description:
      "Un registre partagé pour les coopératives du quartier : qui a livré quoi, et quand.",
    emoji: "layers",
    language: "Python",
    visibility: "group",
    default_branch: "main",
    stage: "production",
    seeking: true,
    demand_languages: ["Python", "SQL"],
    demand_roles: ["backend", "data"],
    created_at: ago(30 * DAY),
  },
  {
    id: "p-2",
    group_id: "g-1",
    created_by: "u-aminata",
    name: "Météo du Sahel",
    slug: "meteo-du-sahel",
    description:
      "Agréger des relevés pluviométriques ouverts et les rendre lisibles par les agriculteurs.",
    emoji: "chart",
    language: "Rust",
    visibility: "public",
    default_branch: "main",
    stage: "prototype",
    seeking: true,
    demand_languages: ["Rust", "Go"],
    demand_roles: ["backend", "data"],
    created_at: ago(18 * DAY),
  },
  {
    id: "p-3",
    group_id: "g-1",
    created_by: "u-thabo",
    name: "Carnet de quartier",
    slug: "carnet-de-quartier",
    description:
      "Une idée encore vague : un carnet où chacun note ce qui manque dans son quartier.",
    emoji: "edit",
    language: "TypeScript",
    visibility: "public",
    default_branch: "main",
    stage: "idea",
    seeking: true,
    demand_languages: ["TypeScript", "JavaScript"],
    demand_roles: ["frontend", "design", "documentation"],
    created_at: ago(5 * DAY),
  },
  {
    id: "p-4",
    group_id: "g-1",
    created_by: "u-chioma",
    name: "Gestion des cotisations",
    slug: "gestion-des-cotisations",
    description:
      "Suivi des cotisations d'une tontine. Stable depuis un an, on ne fait que corriger.",
    emoji: "package",
    language: "Go",
    visibility: "group",
    default_branch: "main",
    stage: "maintenance",
    seeking: false,
    demand_languages: [],
    demand_roles: [],
    created_at: ago(400 * DAY),
  },
];

export const DEMO_PROJECT_MEMBERS: ProjectMember[] = [
  { project_id: "p-1", user_id: "u-koffi", role: "owner", added_at: ago(30 * DAY) },
  { project_id: "p-1", user_id: "u-aminata", role: "maintainer", added_at: ago(29 * DAY) },
  { project_id: "p-1", user_id: "u-thabo", role: "editor", added_at: ago(28 * DAY) },
  { project_id: "p-1", user_id: "u-chioma", role: "viewer", added_at: ago(20 * DAY) },
  // `u-koffi` est **membre** du prototype météo : c'est ce qui rend les
  // tâches du §7 lisibles et l'onglet Équipe utile dans la démonstration.
  { project_id: "p-2", user_id: "u-aminata", role: "owner", added_at: ago(18 * DAY) },
  { project_id: "p-2", user_id: "u-koffi", role: "editor", added_at: ago(16 * DAY) },
  { project_id: "p-3", user_id: "u-thabo", role: "owner", added_at: ago(5 * DAY) },
  { project_id: "p-4", user_id: "u-chioma", role: "owner", added_at: ago(400 * DAY) },
];

// ── Dépôt : trois états successifs ──────────────
//
// L'historique est rejoué pour de vrai, donc le fichier courant, les
// compteurs d'insertion et les sha sont exacts. On ne triche pas.

const MAIN_V1 = `def calculer_total(lignes):
    total = 0
    for ligne in lignes:
        total += ligne["montant"]
    return total
`;

const MAIN_V2 = `def calculer_total(lignes):
    """Somme les montants d'un registre de livraisons."""
    total = 0
    for ligne in lignes:
        if ligne.get("annule"):
            continue
        total += ligne["montant"]
    return round(total, 2)
`;

const MAIN_V3 = `${MAIN_V2}
def repartition_par_cooperative(lignes):
    """Regroupe les livraisons par coopérative."""
    total = {}
    for ligne in lignes:
        if ligne.get("annule"):
            continue
        nom = ligne["cooperative"]
        total[nom] = round(total.get(nom, 0) + ligne["montant"], 2)
    return total
`;

const TEST_V1 = `from registre import calculer_total

def test_total():
    assert calculer_total([]) == 0
`;

const TEST_V2 = `${TEST_V1}
def test_annule():
    lignes = [{"montant": 10, "annule": True}, {"montant": 5}]
    assert calculer_total(lignes) == 5
`;

const LISEUR_V1 = `import csv

def lire_chemin(chemin):
    with open(chemin, newline="") as f:
        return list(csv.DictReader(f))
`;

interface Step {
  /** Date ISO de l'étape ; l'horodatage git en est déduit. */
  at: string;
  author: { id: string; name: string; email: string };
  message: string;
  files: RepoFile[];
}

/** Les trois étapes de l'histoire, du premier au dernier commit. */
const STEPS: Step[] = [
  {
    at: ago(21 * DAY),
    author: AUTHOR,
    message: "Squelette du registre",
    files: [
      { path: "registre.py", content: MAIN_V1 },
      { path: "tests/test_registre.py", content: TEST_V1 },
    ],
  },
  {
    at: ago(12 * DAY),
    author: { id: "u-aminata", name: "Aminata", email: "aminata@devnet.africa" },
    message: "Ignore les livraisons annulées",
    files: [
      { path: "registre.py", content: MAIN_V2 },
      { path: "tests/test_registre.py", content: TEST_V2 },
    ],
  },
  {
    // Ce commit est l'**ancêtre** de la fusion, pas l'inverse : c'est le
    // sommet de `main` avant l'intégration de la branche de journalisation,
    // qui date de `t0 − 6 jours`. Il portait `ago(2 * HOUR)`, donc une date
    // **postérieure à son propre enfant** — une histoire qui remonte le
    // temps. Invisible dans un diff, visible au premier regard sur une
    // liste de commits datés ou sur une courbe : les dates reculent.
    //
    // git tolère des dates désordonnées (horloge déréglée, rebase) ; une
    // démonstration ne le peut pas, parce qu'elle est la vitrine du produit.
    // L'invariant est vérifié par `scripts/test-repo.ts`.
    at: ago(9 * DAY),
    author: { id: "u-thabo", name: "Thabo", email: "thabo@devnet.africa" },
    message: "Répartition par coopérative",
    files: [
      { path: "registre.py", content: MAIN_V3 },
      { path: "lecteur.py", content: LISEUR_V1 },
      { path: "tests/test_registre.py", content: TEST_V2 },
    ],
  },
];

/**
 * Rejoue l'historique, et garde l'instantané de **chaque** révision.
 *
 * L'instantané de chaque commit n'est pas un luxe : c'est ce qui permet
 * de trouver la base de deux branches, donc de répondre à « cette
 * demande apporte quoi ? » et « la fusion peut-elle avoir lieu ? ». Sans
 * les révisions anciennes, toute demande ouverte serait refusée — et le
 * refus serait exact : on ne sait pas d'où elle part.
 */
function replay(): {
  commits: Commit[];
  files: RepoFile[];
  snapshots: { sha: string; files: RepoFile[] }[];
} {
  const commits: Commit[] = [];
  const snapshots: { sha: string; files: RepoFile[] }[] = [];
  let previousFiles: RepoFile[] = [];
  let parent: Commit | null = null;

  for (const step of STEPS) {
    const when = Math.floor(Date.parse(step.at) / 1000);
    const commit = createCommit({
      files: step.files,
      parent,
      parentFiles: previousFiles,
      authorId: step.author.id,
      authorName: step.author.name,
      authorEmail: step.author.email,
      message: step.message,
      when,
      now: () => step.at,
    });

    if (!commit) continue;
    commits.push(commit);
    snapshots.push({ sha: commit.sha, files: step.files });
    parent = commit;
    previousFiles = step.files;
  }

  return { commits, files: previousFiles, snapshots };
}

const {
  commits: demoCommits,
  files: demoFiles,
  snapshots: demoSnapshots,
} = replay();

export const DEMO_GIT_COMMITS: GitCommit[] = demoCommits.map((c) => ({
  ...c,
  project_id: "p-1",
}));

export const DEMO_GIT_REFS: GitRef[] = [
  {
    project_id: "p-1",
    name: "main",
    kind: "branch",
    sha: demoCommits[demoCommits.length - 1]?.sha ?? "",
    updated_at: ago(2 * HOUR),
  },
];

/**
 * La branche par défaut, nommée en un seul endroit.
 *
 * Elle est écrite ici comme constante plutôt que répétée : le nom de la
 * branche de tête est lu dans `git_refs`, dans le sélecteur et dans les
 * tests. Trois chaînes différentes pour une seule notion, c'est trois
 * occasions de diverger — et une divergence ici est silencieuse, parce
 * qu'une branche inconnue affiche simplement un dépôt vide.
 */
export const DEMO_DEFAULT_BRANCH = "main";

/* ── Branches et demandes ────────────────────────────────────────
 *
 * Un dépôt de démonstration sans branche n'illustre pas une pull
 * request : le panneau afficherait « rien à comparer », ce qui est
 * exactement ce qu'on veut éviter de montrer.
 *
 * Les branches sont **rejouées avec le moteur**, pas écrites à la main :
 * leurs sha sont donc ceux que produirait `git`, et la cohérence de
 * l'historique — parent, instantané, sommet — est garantie par le même
 * code qui sert dans les tests.
 *
 * - `lecture-code-barres` : branche **ouverte**, dont la demande attend
 *   une relecture. Son travail n'est pas dans `main`, donc l'onglet
 *   affiche un diff réel.
 * - `journal-audit` : branche dont la demande a été **fusionnée**,
 *   puis supprimée — ce qui arrive sur GitHub, et ce que fait
 *   la migration 014. Le commit de fusion vit sur `main`, il a donc
 *   été rejoué lui aussi.
 */

/**
 * Le fichier que la branche `journal-audit` ajoute, puis que la fusion
 * intègre à `main`.
 */
const JOURNAL_AUDIT = `"""Journal des livraisons.

Une ligne par livraison, dans l'ordre d'arrivée : c'est ce qui permet de
répondre à « qui a livré, et quand ».
"""


def journaliser(lignes, journal):
    for ligne in lignes:
        journal.append({"cooperative": ligne["cooperative"], "montant": ligne["montant"]})
    return journal
`;

/** Le lecteur de la branche `lecture-code-barres`, encore ouverte. */
const LISEUR_CODE_BARRES = `import csv
import re

CODE_BARRE = re.compile(r"^[0-9]{13}$")


def code_valide(texte):
    """Un code-barres EAN-13 fait treize chiffres."""
    return bool(CODE_BARRE.match(texte.strip()))


def lire_chemin(chemin):
    with open(chemin, newline="") as f:
        return list(csv.DictReader(f))
`;

/** Un commit de branche, avec l'état de fichiers qu'il produit. */
interface Branche {
  commit: Commit;
  files: RepoFile[];
}

/**
 * Créer un commit de branche à partir de `main`.
 *
 * La seule différence avec le rejeu de l'historique est le fichier
 * `lecteur.py` : tout le reste est repris tel quel, ce qui rend le diff
 * d'une pull request lisible — une seule fonction changée, comme dans
 * la vraie vie.
 */
function creerBranche(options: {
  parent: Commit;
  parentFiles: RepoFile[];
  /** Fichiers que la branche modifie ou ajoute, par rapport à la base. */
  apport: RepoFile[];
  authorId: string;
  authorName: string;
  authorEmail: string;
  message: string;
  at: string;
}): Branche | null {
  const parChemin = new Map(options.parentFiles.map((f) => [f.path, f]));

  for (const f of options.apport) parChemin.set(f.path, f);

  const files: RepoFile[] = [...parChemin.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );

  const commit = createCommit({
    files,
    parent: options.parent,
    parentFiles: options.parentFiles,
    authorId: options.authorId,
    authorName: options.authorName,
    authorEmail: options.authorEmail,
    message: options.message,
    when: Math.floor(Date.parse(options.at) / 1000),
    now: () => options.at,
  });

  return commit ? { commit, files } : null;
}

const sommetMain = demoCommits[demoCommits.length - 1] ?? null;

const brancheLecture = sommetMain
  ? creerBranche({
      parent: sommetMain,
      parentFiles: demoFiles,
      apport: [{ path: "lecteur.py", content: LISEUR_CODE_BARRES }],
      authorId: "u-zainab",
      authorName: "Zainab",
      authorEmail: "zainab@devnet.africa",
      message: "Valide le code-barres à la lecture",
      at: ago(2 * DAY),
    })
  : null;

const brancheJournal = sommetMain
  ? creerBranche({
      parent: sommetMain,
      parentFiles: demoFiles,
      apport: [{ path: "journal.py", content: JOURNAL_AUDIT }],
      authorId: "u-aminata",
      authorName: "Aminata",
      authorEmail: "aminata@devnet.africa",
      message: "Journalise les livraisons",
      at: ago(7 * DAY),
    })
  : null;

/**
 * Le commit de fusion, sur `main`.
 *
 * Il est produit par le même `appliquerDiff` et le même `createCommit`
 * que la fusion réelle : c'est donc exactement le commit que
 * produirait une fusion faite depuis l'écran. Si le moteur change un jour,
 * la démonstration changera avec lui — et non à côté d'une divergence
 * silencieuse.
 */
const commitFusion =
  sommetMain && brancheJournal
    ? createCommit({
        files: appliquerBranche({ base: demoFiles, cible: demoFiles, source: brancheJournal.files }),
        parent: sommetMain,
        parentFiles: demoFiles,
        authorId: "u-koffi",
        authorName: "Koffi",
        authorEmail: "koffi@devnet.africa",
        // Le même texte que la fonction de fusion produit : le message
        // décrit par une machine et celui écrit à la main ne doivent pas
        // pouvoir se distinguer dans l'historique.
        message: messageFusion(1, "Journal d'audit des livraisons"),
        when: Math.floor(Date.parse(ago(6 * DAY)) / 1000),
        now: () => ago(6 * DAY),
      })
    : null;

/** Les fichiers de l'état de fusion, une fois la branche intégrée. */
const fichiersFusion: RepoFile[] = brancheJournal && commitFusion
  ? appliquerBranche({ base: demoFiles, cible: demoFiles, source: brancheJournal.files })
  : demoFiles;

/** Une ligne de `git_files`, à partir d'un fichier et d'une branche. */
function ligneFichier(f: RepoFile, branch: string, userId: string, at: string): GitFile {
  return {
    project_id: "p-1",
    branch,
    path: f.path,
    content: f.content,
    blob_sha: hashBlob(f.content),
    size: new TextEncoder().encode(f.content).length,
    updated_by: userId,
    updated_at: at,
  };
}

/** Une ligne d'instantané, pour le commit de sommet d'une branche. */
function lignesInstantane(commit: Commit | null, files: RepoFile[]): GitCommitFile[] {
  if (!commit) return [];
  return files.map((f) => ({
    project_id: "p-1",
    sha: commit.sha,
    path: f.path,
    content: f.content,
    blob_sha: hashBlob(f.content),
  }));
}

/**
 * `main` pointe sur le commit de fusion.
 *
 * La référence de départ est reprise telle quelle, seule sa date change :
 * la démonstration ne doit pas inventer une branche que le projet n'a pas.
 */
export const DEMO_GIT_REFS_BRANCHES: GitRef[] = [
  ...DEMO_GIT_REFS.map((r) =>
    r.name === DEMO_DEFAULT_BRANCH && commitFusion
      ? { ...r, sha: commitFusion.sha, updated_at: ago(6 * DAY) }
      : r,
  ),
  ...(brancheLecture
    ? [
        {
          project_id: "p-1",
          name: "lecture-code-barres",
          kind: "branch" as const,
          sha: brancheLecture.commit.sha,
          updated_at: ago(2 * DAY),
        },
      ]
    : []),
];

/**
 * L'état de travail de `main`.
 *
 * C'est `fichiersFusion`, **pas** `demoFiles` : la démonstration contient
 * une demande déjà fusionnée, donc le sommet de `main` est le commit de
 * fusion et son arbre n'est plus celui d'avant. Laisser les fichiers
 * d'avant aurait produit un dépôt qui affiche un contenu que son propre
 * commit ne contient pas — invisible à l'écran, et assez pour faire
 * échouer la fusion suivante : le moteur verrait des changements que
 * personne n'a faits.
 */
export const DEMO_GIT_FILES: GitFile[] = fichiersFusion.map((f) => ({
  project_id: "p-1",
  // Les lignes de `main` naissent sur la branche par défaut (migration
  // 012). Les autres branches sont créées en copiant celles-ci : c'est ce
  // que fait `createBranch`, et la démonstration doit se lire comme un
  // dépôt réel.
  branch: DEMO_DEFAULT_BRANCH,
  path: f.path,
  content: f.content,
  blob_sha: hashBlob(f.content),
  size: new TextEncoder().encode(f.content).length,
  updated_by: "u-thabo",
  updated_at: ago(2 * HOUR),
}));

/**
 * L'état des fichiers au commit de sommet (migration 008).
 *
 * On rattache l'état courant à la dernière révision de `main` — donc au
 * commit de fusion, puisque c'est lui le sommet. C'est le report que
 * fait la migration 008 en SQL.
 *
 * Les commits plus anciens n'ont pas d'instantané : on ne les affichera
 * pas dans un diff tant qu'un nouveau commit ne les aura pas écrits.
 */
export const DEMO_GIT_COMMIT_FILES: GitCommitFile[] = DEMO_GIT_FILES.map((f) => ({
  project_id: f.project_id,
  sha: DEMO_GIT_REFS_BRANCHES[0]?.sha ?? "",
  path: f.path,
  content: f.content,
  blob_sha: f.blob_sha,
}));

export const DEMO_GIT_FILES_BRANCHES: GitFile[] = brancheLecture
  ? brancheLecture.files.map((f) =>
      ligneFichier(f, "lecture-code-barres", "u-zainab", ago(2 * DAY)),
    )
  : [];

export const DEMO_GIT_COMMITS_BRANCHES: GitCommit[] = [
  ...(brancheJournal ? [{ ...brancheJournal.commit, project_id: "p-1" }] : []),
  ...(brancheLecture ? [{ ...brancheLecture.commit, project_id: "p-1" }] : []),
  ...(commitFusion ? [{ ...commitFusion, project_id: "p-1" }] : []),
];

export const DEMO_GIT_COMMIT_FILES_BRANCHES: GitCommitFile[] = [
  // Les instantanés des trois révisions de `main` : c'est ce qui permet
  // de retrouver la base de deux branches. Sans eux, toute demande
  // ouverte serait refusée, et le refus serait exact — on ne saurait pas
  // d'où elle part.
  ...demoSnapshots.flatMap(({ sha, files }) =>
    files.map((f) => ({
      project_id: "p-1",
      sha,
      path: f.path,
      content: f.content,
      blob_sha: hashBlob(f.content),
    })),
  ),
  ...lignesInstantane(brancheJournal?.commit ?? null, brancheJournal?.files ?? []),
  ...lignesInstantane(brancheLecture?.commit ?? null, brancheLecture?.files ?? []),
  ...lignesInstantane(commitFusion, fichiersFusion),
];

/**
 * Les demandes de démonstration, dans l'ordre où la base les numéroterait.
 *
 * Les numéros sont écrits, pas calculés : le déclencheur ne s'exerce qu'à
 * l'insertion, et une ligne insérée à la main dans un jeu de données
 * existe déjà. C'est la même entorse que `DEMO_ISSUES`, et pour la même
 * raison.
 */
export const DEMO_PULL_REQUESTS = [
  {
    id: "pr-1",
    project_id: "p-1",
    author_id: "u-aminata",
    number: 1,
    source_branch: "journal-audit",
    target_branch: "main",
    title: "Journal d'audit des livraisons",
    body:
      "Chaque livraison est désormais consignée dans un journal, avec la coopérative.\n\n" +
      "Cela permet de répondre à la question posée en réunion : qui a livré, et quand.",
    status: "fusionnee",
    merged_at: ago(6 * DAY),
    merged_by: "u-koffi",
    closed_at: null,
    created_at: ago(7 * DAY),
    updated_at: ago(6 * DAY),
  },
  {
    id: "pr-2",
    project_id: "p-1",
    author_id: "u-zainab",
    number: 2,
    source_branch: "lecture-code-barres",
    target_branch: "main",
    title: "Valider le code-barres dès la lecture",
    body:
      "Le code est déjà sur l'étiquette, mais rien ne le vérifie : une saisie faute\n" +
      "passe en base et se retrouve dans le registre.\n\n" +
      "La validation est faite à la lecture, avec un test. Ce sont deux choses, et non\n" +
      "pas la refonte du lecteur.",
    status: "ouverte",
    merged_at: null,
    merged_by: null,
    closed_at: null,
    created_at: ago(2 * DAY),
    updated_at: ago(2 * DAY),
  },
];


// ── Connexions sortantes ────────────────────────
//
// La table garde son nom d'origine (`github_connections`) mais porte
// désormais plusieurs fournisseurs (030). On en garnit trois : GitHub, pour
// que le panneau de dépôt ait de quoi lier ; un tunnel VS Code **actif**,
// pour montrer le cas nominal ; une API **en attente**, parce que la
// distinction `active` / `pending` est exactement ce que l'écran doit
// rendre lisible sans mentir.

export const DEMO_GITHUB_CONNECTIONS: GithubConnection[] = [
  {
    id: "gh-1",
    user_id: "u-koffi",
    provider: "github",
    login: "koffi-devnet",
    external_id: "88451207",
    avatar_url: "",
    scopes: ["repo", "read:user"],
    // Jamais le jeton : uniquement la référence vers le coffre. Une démo
    // qui contiendrait un jeton finirait un jour dans un dépôt public.
    token_ref: "vault://github/u-koffi",
    endpoint: "",
    status: "active",
    used_at: ago(2 * HOUR),
    metadata: {},
    connected_at: ago(28 * DAY),
  },
  {
    id: "gh-vscode",
    user_id: "u-koffi",
    provider: "vscode",
    login: "cooperative-dev",
    external_id: "",
    avatar_url: "",
    scopes: ["files", "terminal"],
    token_ref: "vault://vscode/u-koffi",
    endpoint: "https://cooperative-dev.devtunnels.ms",
    status: "active",
    used_at: ago(5 * HOUR),
    metadata: { editor: "vscode", remote: "tunnel" },
    connected_at: ago(12 * DAY),
  },
  {
    id: "gh-api",
    user_id: "u-koffi",
    provider: "api",
    login: "ci-maison",
    external_id: "",
    avatar_url: "",
    scopes: ["POST commit", "POST pull_request"],
    token_ref: "vault://api/u-koffi",
    endpoint: "https://ci.exemple.dev",
    // Enregistrée mais jamais jointe : l'afficher « active » promettrait un
    // service qu'on n'a pas encore appelé.
    status: "pending",
    used_at: null,
    metadata: {},
    connected_at: ago(2 * DAY),
  },
];

export const DEMO_PROJECT_LINKS: ProjectLink[] = [
  {
    id: "pl-1",
    project_id: "p-1",
    user_id: "u-koffi",
    owner: "koffi-devnet",
    repo: "cooperative-numerique",
    default_branch: "main",
    sync_mode: "manuel",
    last_push_sha: "",
    last_pull_sha: "",
    last_synced_at: null,
    remote_sha: "",
    local_sha: "",
    sync_interval_seconds: 30,
    created_at: ago(28 * DAY),
  },
];

// ── Présence ────────────────────────────────────

/**
 * La présence du seed.
 *
 * Contrairement au reste du fichier, `seen_at` est calculé **par rapport à
 * maintenant** et non par rapport à `t0`. Une présence datée du 3 octobre
 * n'est pas « une présence un peu ancienne » : c'est une présence qui a
 * expiré, et le rail serait vide à chaque ouverture. Le référentiel fixe
 * sert à raconter une histoire (des commits, une revue) ; la présence,
 * elle, ne parle que du présent.
 */
export const DEMO_PROJECT_SESSIONS: ProjectSession[] = [
  {
    project_id: "p-1",
    user_id: "u-thabo",
    file_path: "registre.py",
    cursor: { line: 7, column: 4 },
    color: "av-orange",
    seen_at: new Date(Date.now() - 20_000).toISOString(),
  },
];