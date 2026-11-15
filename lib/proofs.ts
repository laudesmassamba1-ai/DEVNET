/**
 * Les preuves — l'objet central de DevNet.
 *
 * ## La thèse, en une ligne
 *
 * « Un développeur se fait connaître par ce qu'il *dit* de lui ; sur
 * DevNet, sa réputation vient du *travail réel*. »
 *
 * Une preuve n'est donc **jamais une déclaration**. C'est un fait déjà
 * présent ailleurs dans la base : un commit existe dans `git_commits`, une
 * correction acceptée existe dans `review_corrections`, un snippet existe
 * dans `snippets`. La preuve ne fait que *nommer* ce fait, pour qu'il
 * puisse être compté, classé par langage et vérifié.
 *
 * ## Pourquoi une empreinte
 *
 * Chaque preuve porte une empreinte : le SHA-1 d'une forme **canonique**
 * de ses champs. Comme l'empreinte est recalculable, n'importe qui peut
 * rejouer les preuves — c'est-à-dire les recalculer depuis la source et
 * comparer. Une preuve dont l'empreinte ne se recalcule pas est une preuve
 * fausse, et le bouton « Rejouer les preuves » le dit.
 *
 * On réutilise `sha1Hex` de `lib/git/objects.ts` : le projet calcule déjà
 * du SHA-1 conforme à git 2.43. Une seconde implémentation de hachage
 * serait une seconde source de vérité pour la même primitive.
 *
 * ## Pourquoi les preuves n'ont pas toutes le même poids
 *
 * Courir ne vaut pas aider quelqu'un à corriger son code. Le barème est
 * explicite (`KIND_WEIGHT`) et documenté, plutôt que noyé dans un compteur
 * unique : c'est ce qui permet de dire *pourquoi* une réputation est haute,
 * au lieu d'afficher un nombre.
 *
 * Le module est **pur** : aucun import Supabase, aucun accès réseau. C'est
 * ce qui permet de le tester à fond dans `scripts/test-proofs.ts`.
 */

import { sha1Hex } from "./git/objects";

/* ------------------------------------------------------------------ */
/* Nature d'une preuve                                                 */
/* ------------------------------------------------------------------ */

/**
 * Les sept actes qui comptent comme preuve.
 *
 * `github` existe à côté de `commit` parce que le premier est un travail
 * **poussé depuis l'extérieur** : il prouve la même chose, mais il prouve
 * aussi que le travail n'est pas resté dans DevNet. On les distingue pour
 * pouvoir le dire, pas pour le cacher.
 */
export type ProofKind =
  | "commit"
  | "github"
  | "review"
  | "task"
  | "project"
  | "snippet"
  | "execution"
  | "fork";

export interface ProofKindSpec {
  kind: ProofKind;
  /** Libellé affiché. */
  label: string;
  /** Poids dans la réputation. */
  weight: number;
  /** Icône du registre `Icon`. */
  icon: string;
  /** Ce que la preuve certifie, en clair. */
  certifies: string;
}

/**
 * Le barème.
 *
 * L'ordre est celui de la **valeur du geste** : une correction acceptée
 * (`review`, 8) prouve qu'on a aidé quelqu'un *et* que ce qu'on a proposé
 * était juste ; un commit (`commit`, 5) prouve qu'on a écrit du code ;
 * exécuter (`execution`, 1) est le seuil minimal — tout le monde le fait,
 * donc ça ne distingue personne.
 */
export const PROOF_KINDS: Record<ProofKind, ProofKindSpec> = {
  review: {
    kind: "review",
    label: "Correction acceptée",
    weight: 8,
    icon: "check-double",
    certifies: "Ton code a corrigé celui de quelqu'un d'autre, et l'auteur l'a accepté.",
  },
  fork: {
    kind: "fork",
    label: "Fork",
    weight: 3,
    icon: "fork",
    certifies: "Tu as greffé un dépôt de la communauté pour t'en servir de base — ton travail s'appuie sur celui d'un autre.",
  },
  project: {
    kind: "project",
    label: "Contribution à un projet",
    weight: 6,
    icon: "package",
    certifies: "Tu as rejoint un projet, été accepté, et tu y as travaillé.",
  },
  commit: {
    kind: "commit",
    label: "Commit",
    weight: 5,
    icon: "branch",
    certifies: "Tu as écrit du code et l'as enregistré dans un dépôt.",
  },
  github: {
    kind: "github",
    label: "Commit GitHub",
    weight: 4,
    icon: "globe",
    certifies: "Ton travail a été poussé sur GitHub — il existe hors de DevNet.",
  },
  task: {
    kind: "task",
    label: "Tâche terminée",
    weight: 3,
    icon: "target",
    certifies: "Tu as mené à bien une tâche que ton équipe avait écrite.",
  },
  snippet: {
    kind: "snippet",
    label: "Snippet publié",
    weight: 2,
    icon: "code",
    certifies: "Tu as publié un fragment de code qui s'exécute.",
  },
  execution: {
    kind: "execution",
    label: "Exécution réussie",
    weight: 1,
    icon: "terminal",
    certifies: "Ton code a tourné jusqu'au bout, sans erreur.",
  },
};

export const PROOF_KIND_LIST: ProofKind[] = [
  "review", "project", "commit", "github", "task", "snippet", "execution",
];

/* ------------------------------------------------------------------ */
/* La preuve                                                           */
/* ------------------------------------------------------------------ */

export interface Proof {
  id: string;
  user_id: string;
  kind: ProofKind;
  /**
   * Langage de la preuve. Chaîne vide quand l'acte n'en porte pas — une
   * tâche de coordination, par exemple. Elle n'est jamais inventée : une
   * preuve sans langage ne compte dans **aucune** réputation par langage,
   * ce qui est plus honnête qu'un rattachement approximatif.
   */
  language: string;
  /** Projet auquel la preuve se rattache, ou `null`. */
  project_id: string | null;
  /**
   * L'objet prouvé : le sha du commit, l'id du snippet, le chemin du
   * fichier… C'est ce qui permet de remonter à la source lors du rejeu.
   */
  subject: string;
  /** SHA-1 du contenu canonique — voir `fingerprintOf`. */
  fingerprint: string;
  /** Résumé figé, lisible : « 3f2a1c — fix: normaliser les chemins ». */
  summary: string;
  created_at: string;
}

/** Ce qu'il faut fournir pour créer une preuve — l'empreinte se calcule. */
export interface ProofInput {
  id: string;
  user_id: string;
  kind: ProofKind;
  language?: string;
  project_id?: string | null;
  subject: string;
  summary?: string;
  created_at?: string;
}

/**
 * Forme canonique d'une preuve, avant hachage.
 *
 * Une ligne par champ, dans un ordre **fixe**, séparées par `\n`. L'ordre
 * et le séparateur comptent : deux formes différentes du même fait
 * donneraient deux empreintes, donc un rejeu en échec alors que la preuve
 * est authentique. Le `created_at` en fait partie — sinon on pourrait
 * antidater une preuve sans que rien ne le signale.
 *
 * `id` et `fingerprint` n'en font **pas** partie : l'identifiant est une
 * commodité de base, et l'empreinte ne peut pas se contenir elle-même.
 */
export function canonicalForm(p: {
  user_id: string;
  kind: ProofKind;
  language: string;
  project_id: string | null;
  subject: string;
  summary: string;
  created_at: string;
}): string {
  return [
    p.kind,
    p.user_id,
    p.language,
    p.project_id ?? "",
    p.subject,
    p.summary,
    p.created_at,
  ].join("\n");
}

/** L'empreinte d'une preuve : SHA-1 de sa forme canonique. */
export function fingerprintOf(p: {
  user_id: string;
  kind: ProofKind;
  language: string;
  project_id: string | null;
  subject: string;
  summary: string;
  created_at: string;
}): string {
  return sha1Hex(new TextEncoder().encode(canonicalForm(p)));
}

/**
 * Fabrique une preuve complète à partir d'une entrée.
 *
 * Point important : l'empreinte est calculée **ici**, jamais fournie par
 * l'appelant. Une empreinte que le client choisit ne prouverait rien —
 * elle pourrait être recopiée d'une autre preuve.
 */
export function makeProof(input: ProofInput): Proof {
  const normalized = {
    user_id: input.user_id,
    kind: input.kind,
    language: (input.language ?? "").trim(),
    project_id: input.project_id ?? null,
    subject: input.subject,
    summary: (input.summary ?? "").trim(),
    created_at: input.created_at ?? new Date().toISOString(),
  };

  return {
    id: input.id,
    ...normalized,
    fingerprint: fingerprintOf(normalized),
  };
}

/* ------------------------------------------------------------------ */
/* Rejeu : vérifier une preuve                                         */
/* ------------------------------------------------------------------ */

export interface ReplayResult {
  /** La preuve est-elle vérifiée ? */
  ok: boolean;
  /** L'empreinte recalculée. */
  recomputed: string;
}

/**
 * Rejoue **une** preuve : recalcule son empreinte et la compare.
 *
 * C'est la définition opérationnelle de « vérifiable » : la preuve n'est
 * pas crue parce qu'elle est stockée, elle est crue parce qu'elle se
 * recalcule à l'identique.
 */
export function replayProof(proof: Proof): ReplayResult {
  const recomputed = fingerprintOf(proof);
  return { ok: recomputed === proof.fingerprint, recomputed };
}

export interface ReplayReport {
  total: number;
  verified: number;
  /** Les preuves dont l'empreinte ne se recalcule pas. */
  broken: Proof[];
  /** Vrai si toutes les preuves passent. */
  allVerified: boolean;
}

/** Rejoue un lot de preuves — ce que fait le bouton « Rejouer les preuves ». */
export function replayAll(proofs: Proof[]): ReplayReport {
  const broken = proofs.filter((p) => !replayProof(p).ok);
  return {
    total: proofs.length,
    verified: proofs.length - broken.length,
    broken,
    allVerified: broken.length === 0,
  };
}

/* ------------------------------------------------------------------ */
/* Réputation                                                          */
/* ------------------------------------------------------------------ */

export interface LanguageReputation {
  language: string;
  /** Nombre de preuves dans ce langage. */
  count: number;
  /** Somme des poids — c'est le chiffre affiché. */
  weight: number;
  /** Répartition par nature, pour le détail. */
  kinds: { kind: ProofKind; count: number }[];
}

/**
 * Réputation **par langage**, recalculée depuis les preuves.
 *
 * Aucune colonne `users.reputation` : comme le score de gamification et
 * l'indice de maintenabilité, la valeur est dérivée. Conséquences : elle
 * ne peut pas mentir, tout retrait de preuve la corrige immédiatement, et
 * aucune migration n'est nécessaire pour qu'un nouveau langage apparaisse.
 *
 * Tri : poids décroissant, puis nombre, puis nom — l'ordre est **total**,
 * donc deux clients affichent la même liste.
 */
export function reputationByLanguage(proofs: Proof[]): LanguageReputation[] {
  const byLang = new Map<string, { weight: number; count: number; kinds: Map<ProofKind, number> }>();

  for (const p of proofs) {
    if (!p.language) continue;
    const bucket = byLang.get(p.language) ?? { weight: 0, count: 0, kinds: new Map() };
    bucket.weight += PROOF_KINDS[p.kind]?.weight ?? 0;
    bucket.count += 1;
    bucket.kinds.set(p.kind, (bucket.kinds.get(p.kind) ?? 0) + 1);
    byLang.set(p.language, bucket);
  }

  return [...byLang.entries()]
    .map(([language, b]) => ({
      language,
      count: b.count,
      weight: b.weight,
      kinds: PROOF_KIND_LIST
        .filter((k) => (b.kinds.get(k) ?? 0) > 0)
        .map((k) => ({ kind: k, count: b.kinds.get(k) ?? 0 })),
    }))
    .sort((a, b) =>
      b.weight - a.weight || b.count - a.count || (a.language < b.language ? -1 : 1),
    );
}

/** Poids total des preuves — la « réputation » globale, sans langage. */
export function reputationWeight(proofs: Proof[]): number {
  return proofs.reduce((a, p) => a + (PROOF_KINDS[p.kind]?.weight ?? 0), 0);
}

/** Compte par nature, dans l'ordre du barème. */
export function kindBreakdown(proofs: Proof[]): { kind: ProofKind; count: number }[] {
  const counts = new Map<ProofKind, number>();
  for (const p of proofs) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
  return PROOF_KIND_LIST
    .map((kind) => ({ kind, count: counts.get(kind) ?? 0 }))
    .filter((k) => k.count > 0);
}

/**
 * Le détail par langage au format « 12 preuves en JavaScript ».
 *
 * On tronque proprement plutôt que de couper un mot : le profil affiche
 * trois langages, et le dernier est marqué comme un reste.
 */
export function reputationSummary(list: LanguageReputation[], max = 3): string {
  if (list.length === 0) return "aucune preuve encore";
  const shown = list.slice(0, max).map((l) => `${l.count} en ${l.language}`);
  const rest = list.length - shown.length;
  return shown.join(", ") + (rest > 0 ? `, +${rest} autre${rest > 1 ? "s" : ""}` : "");
}

/* ------------------------------------------------------------------ */
/* Série de preuves (le rythme, pas le total)                          */
/* ------------------------------------------------------------------ */

/**
 * Nombre de jours consécutifs avec au moins une preuve.
 *
 * Même logique que les séries de `lib/gamification.ts`, mais sur les
 * preuves : une journée prouvée est une journée où l'on a **travaillé**,
 * pas seulement publié. Aujourd'hui n'est pas encore validé si rien n'a
 * été posé — c'est la seule lecture qui ne décourage pas à 9 h du matin.
 */
export function proofStreak(proofs: Proof[], today: string): number {
  const days = new Set(proofs.map((p) => p.created_at.slice(0, 10)));
  if (days.size === 0) return 0;

  const shift = (day: string, n: number): string => {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
  };

  const anchor = days.has(today) ? today : days.has(shift(today, -1)) ? shift(today, -1) : null;
  if (!anchor) return 0;

  let cursor = anchor;
  let count = 0;
  while (days.has(cursor)) {
    count++;
    cursor = shift(cursor, -1);
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* Filtres                                                             */
/* ------------------------------------------------------------------ */

/** Preuves d'un utilisateur, les plus récentes d'abord. */
export function proofsOf(proofs: Proof[], userId: string): Proof[] {
  return proofs
    .filter((p) => p.user_id === userId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/** Preuves rattachées à un projet. */
export function proofsForProject(proofs: Proof[], projectId: string): Proof[] {
  return proofs.filter((p) => p.project_id === projectId);
}
