/**
 * Le rapprochement — stades, rôles, et pourcentage de compatibilité.
 *
 * Le §6 de la vision : un projet se publie avec son **stade** et les
 * **rôles** qu'il cherche ; les autres filtrent, voient un **pourcentage
 * de compatibilité calculé à partir de leurs preuves**, et postulent.
 *
 * Le mot qui compte est « preuves ». Partout ailleurs, la compatibilité
 * se calcule sur des cases cochées : je dis que je sais faire du Rust,
 * donc je sais faire du Rust. Ici elle se calcule sur ce qui a été
 * **prouvé** — d'où la dépendance à `lib/proofs.ts`, et d'où le fait que
 * `Candidate` reçoive une réputation par langage au lieu d'une liste de
 * langages.
 *
 * Comme tout le reste du produit, le module est **pur** : il ne lit que
 * ce qu'on lui donne, donc il se teste exactement.
 */

import { PROOF_KINDS, type ProofKind } from "./proofs";

/* ------------------------------------------------------------------ */
/* Stade d'un projet                                                   */
/* ------------------------------------------------------------------ */

export type ProjectStage = "idea" | "prototype" | "mvp" | "production" | "maintenance";

export interface StageSpec {
  id: ProjectStage;
  label: string;
  /** Ce que le stade promet à qui rejoint — dit sans euphémisme. */
  hint: string;
}

/**
 * Cinq stades, du plus vague au plus engageant.
 *
 * Ils sont **ordonnés** : `STAGE_ORDER` sert au tri et au sens des
 * filtres (« au moins un prototype »). Un stade n'est pas une décoration :
 * rejoindre une idée et rejoindre une production en maintenance ne
 * demandent pas la même disponibilité.
 */
export const PROJECT_STAGES: StageSpec[] = [
  { id: "idea", label: "Idée", hint: "Rien n'est écrit. On cherche des gens pour décider ensemble." },
  { id: "prototype", label: "Prototype", hint: "Ça tourne à moitié, l'architecture bouge encore." },
  { id: "mvp", label: "MVP", hint: "Le cœur fonctionne. On comble les trous." },
  { id: "production", label: "Production", hint: "Des gens l'utilisent. On livre sans casser." },
  { id: "maintenance", label: "Maintenance", hint: "Stable. On corrige et on transmet." },
];

export const STAGE_ORDER: ProjectStage[] = [
  "idea", "prototype", "mvp", "production", "maintenance",
];

export function stageSpec(stage: ProjectStage): StageSpec {
  return PROJECT_STAGES.find((s) => s.id === stage) ?? PROJECT_STAGES[0];
}

/** Rang d'un stade dans l'échelle — un stade inconnu retombe sur « idée ». */
export function stageRank(stage: ProjectStage): number {
  const i = STAGE_ORDER.indexOf(stage);
  return i === -1 ? 0 : i;
}

/* ------------------------------------------------------------------ */
/* Rôles recherchés                                                    */
/* ------------------------------------------------------------------ */

export type SeekingRole =
  | "developpement" | "frontend" | "backend" | "mobile"
  | "data" | "devops" | "design" | "qualite" | "documentation";

export interface RoleSpec {
  id: SeekingRole;
  label: string;
  hint: string;
  /** Icône du registre `Icon`. */
  icon: string;
}

export const SEEKING_ROLES: RoleSpec[] = [
  { id: "developpement", label: "Développement", hint: "Écrire le code, sans spécialité fixée.", icon: "code" },
  { id: "frontend", label: "Front-end", hint: "L'interface : écrans, états, accessibilité.", icon: "layers" },
  { id: "backend", label: "Back-end", hint: "Les données, les API, la logique serveur.", icon: "server" },
  { id: "mobile", label: "Mobile", hint: "Application Android ou iOS.", icon: "grid" },
  { id: "data", label: "Data", hint: "Collecte, modèles, visualisation.", icon: "chart" },
  { id: "devops", label: "DevOps", hint: "Intégration continue, déploiement, serveurs.", icon: "package" },
  { id: "design", label: "Design", hint: "Parcours, maquettes, identité visuelle.", icon: "cursor" },
  { id: "qualite", label: "Qualité", hint: "Tests, relecture, reproduction des bogues.", icon: "check-double" },
  { id: "documentation", label: "Documentation", hint: "Écrire et tenir la documentation.", icon: "file" },
];

export function roleSpec(role: SeekingRole): RoleSpec | null {
  return SEEKING_ROLES.find((r) => r.id === role) ?? null;
}

export function roleLabel(role: string): string {
  return SEEKING_ROLES.find((r) => r.id === role)?.label ?? role;
}

export function isValidRole(role: string): role is SeekingRole {
  return SEEKING_ROLES.some((r) => r.id === role);
}

/* ------------------------------------------------------------------ */
/* Compatibilité                                                       */
/* ------------------------------------------------------------------ */

/**
 * Ce qu'un projet demande. `seeking: false` = projet fermé : il ne
 * cherche personne, donc il n'a de compatibilité avec personne — le
 * pourcentage vaut alors 100 par convention et ne s'affiche pas.
 */
export interface ProjectDemand {
  stage: ProjectStage;
  /** Langages recherchés. */
  languages: string[];
  /** Rôles recherchés. */
  roles: string[];
  /** Le projet recrute-t-il ? */
  seeking: boolean;
}

/**
 * Ce qu'un candidat **prouve**.
 *
 * `reputation` vient de `reputationByLanguage` : c'est le poids des
 * preuves par langage. `languages` est la déclaration du profil, utilisée
 * seulement pour l'identité — jamais pour la compatibilité technique,
 * parce qu'une déclaration n'est pas une preuve.
 */
export interface Candidate {
  /** Preuves par langage, avec leur poids. */
  reputation: { language: string; weight: number }[];
  /** Langages déclarés sur le profil. */
  languages: string[];
  /** Nombre total de preuves. */
  totalProofs: number;
  /** Rôles que la personne dit savoir tenir. */
  roles?: string[];
  hasBio: boolean;
}

export interface CompatibilityParts {
  /** Adéquation technique, mesurée sur les preuves. */
  language: number;
  /** Volume de travail prouvé. */
  activity: number;
  /** Profil renseigné et rôles correspondants. */
  identity: number;
}

export interface Compatibility {
  /** 0…100, arrondi. */
  score: number;
  parts: CompatibilityParts;
  verdict: { label: string; tone: "ok" | "warn" | "danger" };
}

/**
 * Poids de preuves au-delà duquel on considère un langage **acquis**.
 *
 * Dix : le poids d'une correction acceptée (8) plus deux commits. En
 * dessous, la personne a touché au langage ; au-dessus, elle y a
 * travaillé. C'est une convention, et elle est écrite ici pour être
 * discutable — pas enfouie dans une formule.
 */
export const LANGUAGE_CONFIDENT_WEIGHT = 10;

/** Preuves au-delà desquelles le volume n'améliore plus la note. */
export const ACTIVITY_FULL = 30;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Le pourcentage de compatibilité, de 0 à 100.
 *
 *     score = 100 × (0,55·langage + 0,30·activité + 0,15·identité)
 *
 * **Langage (55 %)** — pour chaque langage demandé, on mesure la
 * profondeur des preuves du candidat, plafonnée à `LANGUAGE_CONFIDENT_WEIGHT` :
 *
 *     langage = (1/n) · Σ min(1, poids_i / 10)
 *
 * Une simple **présence** ne suffit donc pas : il faut des preuves
 * substantielles dans *chaque* langage demandé. Un projet qui demande
 * Rust et Go ne peut pas être « compatible » avec quelqu'un qui n'a
 * prouvé que du Rust.
 *
 * **Activité (30 %)** — proportion de `ACTIVITY_FULL` preuves atteinte.
 * Elle ne départage que les profils techniquement proches.
 *
 * **Identité (15 %)** — bio renseignée, langages déclarés, et
 * recouvrement des rôles recherchés. C'est le seul endroit où la
 * déclaration compte, et elle ne pèse que 15 %.
 *
 * Un projet qui ne cherche personne obtient **100** : il n'a rien demandé,
 * donc personne n'y est incompatible.
 */
export function compatibility(candidate: Candidate, demand: ProjectDemand): Compatibility {
  if (!demand.seeking) {
    return {
      score: 100,
      parts: { language: 1, activity: 1, identity: 1 },
      verdict: { label: "ouvert à tous", tone: "ok" },
    };
  }

  const weights = new Map(candidate.reputation.map((r) => [r.language, r.weight]));

  const language = demand.languages.length === 0
    ? 1
    : demand.languages.reduce(
        (a, lang) => a + Math.min(1, (weights.get(lang) ?? 0) / LANGUAGE_CONFIDENT_WEIGHT),
        0,
      ) / demand.languages.length;

  const activity = clamp01(candidate.totalProofs / ACTIVITY_FULL);

  const roleFit = demand.roles.length === 0
    ? 1
    : demand.roles.filter((r) => (candidate.roles ?? []).includes(r)).length / demand.roles.length;

  const identity =
    0.4 * (candidate.hasBio ? 1 : 0) +
    0.3 * (candidate.languages.length > 0 ? 1 : 0) +
    0.3 * roleFit;

  const raw = 0.55 * language + 0.3 * activity + 0.15 * identity;
  const score = Math.round(100 * clamp01(raw));

  return {
    score,
    parts: { language, activity, identity },
    verdict: verdictFor(score),
  };
}

export function verdictFor(score: number): Compatibility["verdict"] {
  if (score >= 75) return { label: "très compatible", tone: "ok" };
  if (score >= 50) return { label: "compatible", tone: "ok" };
  if (score >= 25) return { label: "à découvrir", tone: "warn" };
  return { label: "débutant sur ce projet", tone: "danger" };
}

/** Trie des projets par compatibilité décroissante, à égalité par nom. */
export function sortByCompatibility<T>(
  items: T[],
  scoreOf: (item: T) => number,
  nameOf: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => scoreOf(b) - scoreOf(a) || (nameOf(a) < nameOf(b) ? -1 : 1));
}

/* ------------------------------------------------------------------ */
/* Filtres de la liste des projets                                     */
/* ------------------------------------------------------------------ */

export interface ProjectFilters {
  language: string;
  stage: ProjectStage | "";
  role: SeekingRole | "";
  /** Ne montrer que les projets qui recrutent. */
  seekingOnly: boolean;
}

export const EMPTY_FILTERS: ProjectFilters = {
  language: "",
  stage: "",
  role: "",
  seekingOnly: false,
};

export interface FilterableProject {
  language: string;
  stage: ProjectStage;
  seeking: boolean;
  /** Langages recherchés. */
  demandLanguages: string[];
  /** Rôles recherchés. */
  demandRoles: string[];
}

/**
 * Applique les filtres de la liste.
 *
 * Un filtre par langage accepte **le langage du projet ou un langage
 * demandé** : chercher « Rust » doit montrer aussi bien un projet écrit
 * en Rust qu'un projet qui recrute un développeur Rust. Ce sont deux
 * intentions différentes qui répondent à la même question.
 *
 * Un filtre de stade est un **seuil**, pas une égalité : choisir
 * « prototype » montre les prototypes et tout ce qui est plus avancé.
 * Personne ne cherche « exactement un MVP ».
 */
export function applyFilters<T extends FilterableProject>(
  projects: T[],
  filters: ProjectFilters,
): T[] {
  return projects.filter((p) => {
    if (filters.language) {
      const l = filters.language.toLowerCase();
      const inProject = p.language.toLowerCase() === l;
      const inDemand = p.demandLanguages.some((d) => d.toLowerCase() === l);
      if (!inProject && !inDemand) return false;
    }
    if (filters.stage && stageRank(p.stage) < stageRank(filters.stage)) return false;
    if (filters.role && !p.demandRoles.includes(filters.role)) return false;
    if (filters.seekingOnly && !p.seeking) return false;
    return true;
  });
}

/** Nombre de filtres actifs — pour savoir s'il faut proposer « tout voir ». */
export function activeFilterCount(f: ProjectFilters): number {
  return (f.language ? 1 : 0) + (f.stage ? 1 : 0) + (f.role ? 1 : 0) + (f.seekingOnly ? 1 : 0);
}

/* ------------------------------------------------------------------ */
/* Une preuve mérite-t-elle d'être créée ?                             */
/* ------------------------------------------------------------------ */

/**
 * Le pont avec `lib/proofs.ts` : quel acte produit quelle preuve.
 *
 * Cette table évite qu'un appelant invente un genre de preuve. Chaque
 * acte du produit qui doit laisser une trace est listé ici, avec la
 * nature de preuve qui lui correspond.
 */
export type ProofSource =
  | "commit_enregistre"
  | "execution_reussie"
  | "snippet_publie"
  | "correction_acceptee"
  | "tache_terminee"
  | "candidature_acceptee";

export const PROOF_OF_SOURCE: Record<ProofSource, ProofKind> = {
  commit_enregistre: "commit",
  execution_reussie: "execution",
  snippet_publie: "snippet",
  correction_acceptee: "review",
  tache_terminee: "task",
  candidature_acceptee: "project",
};

/** Poids affiché d'une source, dérivé du barème — jamais dupliqué. */
export function sourceWeight(source: ProofSource): number {
  return PROOF_KINDS[PROOF_OF_SOURCE[source]].weight;
}
