/**
 * Preuves et tables qui en produisent — jeu de démonstration.
 *
 * ## Ce fichier ne contient **aucune** preuve écrite à la main
 *
 * Les preuves sont **dérivées** : `replayProofs` rejoue exactement les
 * déclencheurs de `023_proofs.sql` à partir des tables sources (commits,
 * snippets, corrections, tâches, candidatures). C'est le même choix que
 * pour les notifications (010) et les compteurs (005) : un jeu de données
 * qui écrirait ses preuves à la main finirait par ne plus correspondre
 * aux faits dont elle prétend parler — et une preuve qui ne correspond
 * pas à son fait est pire qu'une preuve absente.
 *
 * Seule exception, comme en base : les **exécutions**, qui viennent du
 * client et n'ont pas de ligne source. Le rejeu les préserve telles
 * quelles au lieu de les écraser.
 */

import type {
  ProjectApplication, ProjectTask, ReviewCorrection, Snippet,
} from "@/lib/types";
import { makeProof } from "@/lib/proofs";
import type { DemoStore, Row } from "./store";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const t0 = Date.now();
const ago = (ms: number): string => new Date(t0 - ms).toISOString();

/* ------------------------------------------------------------------ */
/* Snippets (§4)                                                       */
/* ------------------------------------------------------------------ */

/**
 * Tous les snippets de démonstration ont `ran_at` : un snippet qui n'a
 * jamais tourné ne serait pas une preuve, et la démonstration doit
 * montrer des preuves.
 */
export const DEMO_SNIPPETS: Snippet[] = [
  {
    id: "sn-1",
    author_id: "u-koffi",
    title: "Normaliser un numéro de téléphone",
    language: "Rust",
    code:
      "fn normaliser(tel: &str) -> String {\n    tel.chars().filter(|c| c.is_ascii_digit()).collect()\n}\n\nfn main() {\n    println!(\"{}\", normaliser(\"+229 97 12 34 56\"));\n}\n",
    output: "22997123456",
    ran_at: ago(2 * DAY),
    created_at: ago(2 * DAY),
  },
  {
    id: "sn-2",
    author_id: "u-koffi",
    title: "Somme d'une liste avec récursion",
    language: "Python",
    code:
      "def somme(xs):\n    if not xs:\n        return 0\n    return xs[0] + somme(xs[1:])\n\nprint(somme([1, 2, 3, 4]))\n",
    output: "10",
    ran_at: ago(6 * DAY),
    created_at: ago(6 * DAY),
  },
  {
    id: "sn-3",
    author_id: "u-koffi",
    title: "Compter les mots d'un texte",
    language: "JavaScript",
    code:
      "const compter = (texte) =>\n  texte.split(/\\s+/).filter(Boolean).length;\n\nconsole.log(compter(\"le travail se prouve\"));\n",
    output: "4",
    ran_at: ago(9 * DAY),
    created_at: ago(9 * DAY),
  },
  {
    id: "sn-4",
    author_id: "u-aminata",
    title: "Lire un fichier CSV ligne à ligne",
    language: "Go",
    code:
      "package main\n\nimport (\n\t\"fmt\"\n\t\"strings\"\n)\n\nfunc main() {\n\tfor _, l := range strings.Split(\"a,b\\nc,d\", \"\\n\") {\n\t\tfmt.Println(strings.ToUpper(l))\n\t}\n}\n",
    output: "A,B\nC,D",
    ran_at: ago(4 * DAY),
    created_at: ago(4 * DAY),
  },
  {
    id: "sn-5",
    author_id: "u-thabo",
    title: "Débattre une liste d'identifiants",
    language: "TypeScript",
    code:
      "const dedupe = <T,>(xs: T[]): T[] => [...new Set(xs)];\n\nconsole.log(dedupe([1, 2, 2, 3, 1]).join(\",\"));\n",
    output: "1,2,3",
    ran_at: ago(3 * DAY),
    created_at: ago(3 * DAY),
  },
  {
    id: "sn-6",
    author_id: "u-chioma",
    title: "Moyenne mobile pondérée",
    language: "Python",
    code:
      "def moyenne(xs):\n    return sum(xs) / len(xs) if xs else 0\n\nprint(round(moyenne([12, 15, 9]), 2))\n",
    output: "12.0",
    ran_at: ago(11 * DAY),
    created_at: ago(11 * DAY),
  },
];

/* ------------------------------------------------------------------ */
/* Revue de code (§5)                                                  */
/* ------------------------------------------------------------------ */

export const DEMO_REVIEW_CORRECTIONS: ReviewCorrection[] = [
  {
    id: "rc-1",
    project_id: "p-1",
    path: "registre.py",
    line_no: 12,
    original: "    if prix > 0:",
    proposed: "    if prix is not None and prix > 0:",
    language: "Python",
    author_id: "u-koffi",
    status: "acceptee",
    comment: "Un prix nul est légitime ; c'est l'absence de prix qui doit freiner.",
    decided_by: "u-aminata",
    decided_at: ago(5 * DAY),
    created_at: ago(6 * DAY),
  },
  {
    id: "rc-2",
    project_id: "p-1",
    path: "registre.py",
    line_no: 28,
    original: "    total = total + ligne",
    proposed: "    total += ligne",
    language: "Python",
    author_id: "u-thabo",
    status: "acceptee",
    comment: "",
    decided_by: "u-koffi",
    decided_at: ago(2 * DAY),
    created_at: ago(3 * DAY),
  },
  {
    id: "rc-3",
    project_id: "p-2",
    path: "agreger.rs",
    line_no: 41,
    original: "    let somme: f64 = 0.0;",
    proposed: "    let mut somme: f64 = 0.0;",
    language: "Rust",
    author_id: "u-koffi",
    status: "proposee",
    comment: "Il manque le mot-clé mut, sans lequel += est refusé par le compilateur.",
    decided_by: null,
    decided_at: null,
    created_at: ago(20 * HOUR),
  },
];

/* ------------------------------------------------------------------ */
/* Tâches d'équipe (§7)                                                */
/* ------------------------------------------------------------------ */

export const DEMO_PROJECT_TASKS: ProjectTask[] = [
  {
    id: "tk-1", project_id: "p-1", title: "Importer les reçus de la coopérative",
    body: "Un CSV par mois, douze lignes de colonnes.", status: "done", position: 0,
    assignee: "u-koffi", language: "Python", created_by: "u-aminata",
    done_at: ago(7 * DAY), created_at: ago(12 * DAY),
  },
  {
    id: "tk-2", project_id: "p-1", title: "Écrire les tests du calcul de solde",
    body: "", status: "doing", position: 0,
    assignee: "u-thabo", language: "Python", created_by: "u-koffi",
    done_at: null, created_at: ago(9 * DAY),
  },
  {
    id: "tk-3", project_id: "p-1", title: "Documenter l'API interne",
    body: "Une page par fonction publique.", status: "todo", position: 0,
    assignee: null, language: "", created_by: "u-koffi",
    done_at: null, created_at: ago(4 * DAY),
  },
  {
    id: "tk-4", project_id: "p-2", title: "Brancher la source de pluviométrie",
    body: "", status: "done", position: 0,
    assignee: "u-aminata", language: "Go", created_by: "u-aminata",
    done_at: ago(10 * DAY), created_at: ago(15 * DAY),
  },
  {
    id: "tk-5", project_id: "p-2", title: "Écrire le désérialiseur CSV en Rust",
    body: "", status: "doing", position: 0,
    assignee: "u-koffi", language: "Rust", created_by: "u-aminata",
    done_at: null, created_at: ago(2 * DAY),
  },
  {
    id: "tk-6", project_id: "p-3", title: "Dessiner le parcours d'ajout d'une note",
    body: "", status: "done", position: 0,
    assignee: "u-thabo", language: "TypeScript", created_by: "u-thabo",
    done_at: ago(1 * DAY), created_at: ago(3 * DAY),
  },
  {
    id: "tk-7", project_id: "p-4", title: "Corriger le calcul des intérêts",
    body: "", status: "todo", position: 0,
    assignee: "u-chioma", language: "Go", created_by: "u-chioma",
    done_at: null, created_at: ago(6 * HOUR),
  },
];

/* ------------------------------------------------------------------ */
/* Candidatures (§6)                                                   */
/* ------------------------------------------------------------------ */

export const DEMO_PROJECT_APPLICATIONS: ProjectApplication[] = [
  {
    id: "ap-1", project_id: "p-1", user_id: "u-thabo", role: "backend",
    message: "J'ai déjà écrit deux analyseurs CSV, je peux prendre l'import.",
    status: "acceptee", decided_by: "u-koffi", decided_at: ago(25 * DAY),
    created_at: ago(27 * DAY),
  },
  {
    id: "ap-2", project_id: "p-2", user_id: "u-chioma", role: "data",
    message: "Je travaille sur des séries pluviométriques.",
    status: "attente", decided_by: null, decided_at: null,
    created_at: ago(2 * DAY),
  },
  {
    id: "ap-3", project_id: "p-2", user_id: "u-zainab", role: "frontend",
    message: "Je fais du TypeScript, pas du Rust.",
    status: "refusee", decided_by: "u-aminata", decided_at: ago(8 * DAY),
    created_at: ago(9 * DAY),
  },
];

/* ------------------------------------------------------------------ */
/* Rejeu : les sources deviennent des preuves                          */
/* ------------------------------------------------------------------ */

/**
 * Reconstruit `store.proofs` depuis les tables sources.
 *
 * L'ordre et les libellés reproduisent exactement les déclencheurs de
 * `023_proofs.sql` — mêmes `subject`, mêmes résumés — parce que
 * l'empreinte dépend du sujet et du résumé : diverger ici produirait des
 * preuves que le rejeu déclarerait fausses.
 */
export function replayProofs(store: DemoStore): void {
  const derived: Row[] = [];
  const seen = new Set<string>();

  const push = (
    userId: unknown,
    kind: Parameters<typeof makeProof>[0]["kind"],
    language: string,
    projectId: string | null,
    subject: string,
    summary: string,
    createdAt: string,
  ) => {
    if (typeof userId !== "string" || !userId) return;
    const key = `${userId}|${kind}|${subject}`;
    if (seen.has(key)) return; // équivalent de `proofs_unique_source`
    seen.add(key);

    derived.push(
      makeProof({
        id: `proof-${kind}-${subject}`,
        user_id: userId,
        kind,
        language,
        project_id: projectId,
        subject,
        summary,
        created_at: createdAt,
      }) as unknown as Row,
    );
  };

  const projectLanguage = new Map<string, string>();
  for (const p of store.projects) {
    projectLanguage.set(String(p.id), String(p.language ?? ""));
  }

  for (const c of store.git_commits) {
    push(
      c.author_id,
      c.source === "github" ? "github" : "commit",
      "",
      (c.project_id as string) ?? null,
      `commit:${c.sha}`,
      String(c.message ?? "").slice(0, 80),
      String(c.created_at),
    );
  }

  for (const s of store.snippets) {
    if (!s.ran_at) continue;
    push(s.author_id, "snippet", String(s.language ?? ""), null,
      `snippet:${s.id}`, String(s.title ?? "").slice(0, 80), String(s.ran_at));
  }

  for (const r of store.review_corrections) {
    if (r.status !== "acceptee") continue;
    push(r.author_id, "review", String(r.language ?? ""), (r.project_id as string) ?? null,
      `correction:${r.id}`, `${r.path} L${r.line_no}`,
      String(r.decided_at ?? r.created_at));
  }

  for (const t of store.project_tasks) {
    if (t.status !== "done") continue;
    push(t.assignee ?? t.created_by, "task", String(t.language ?? ""),
      (t.project_id as string) ?? null, `tache:${t.id}`,
      String(t.title ?? "").slice(0, 80), String(t.done_at ?? t.created_at));
  }

  for (const a of store.project_applications) {
    if (a.status !== "acceptee") continue;
    push(a.user_id, "project", projectLanguage.get(String(a.project_id)) ?? "",
      (a.project_id as string) ?? null, `projet:${a.project_id}`,
      `candidature:${a.id}`, String(a.decided_at ?? a.created_at));
  }

  // Migration 025 : un fork de la table `project_forks` est une preuve
  // `fork`. Comme les autres, dérivée : supprimer la ligne du fork
  // retire la preuve au prochain rejeu — le mot « preuve » garde son
  // sens. Le langage est celui du projet forké.
  for (const f of store.project_forks) {
    push(f.forked_by, "fork", projectLanguage.get(String(f.fork_id)) ?? "",
      (f.fork_id as string) ?? null, `fork:${f.fork_id}`,
      `fork:${f.source_id}`, String(f.forked_at));
  }

  // Les exécutions viennent du client : aucune source ne les reconstruit,
  // donc on les garde au lieu de les perdre au rejeu.
  const executions = store.proofs.filter((p) => p.kind === "execution");

  store.proofs = [...derived, ...executions];
}
