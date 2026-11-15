/**
 * Contrôle d'accessibilité — moteur interne, licences vérifiées.
 *
 * ## Pourquoi pas `axe-core`
 *
 * `axe-core` (et son enveloppe `@axe-core/playwright`) est publié sous
 * **MPL-2.0**, hors de la liste autorisée par la CADEV 2026 (article 6). La
 * règle interne de DEVNET est de l'écarter par précaution.
 *
 * `accessibility-checker` d'IBM (Apache-2.0) a été examiné : il installe
 * Chromium et Chromedriver en plus de Playwright (deux navigateurs pour un
 * seul test), charge ses règles par un moteur séparé, et active
 * `@ibm/telemetry-js` par défaut. Deux piles de navigateurs et une télémétrie
 * pour un contrôle qui tient dans une page, ce n'est pas un bon échange —
 * l'analyse est documentée dans `docs/legal/LICENSE_CLEANUP_REPORT.md`.
 *
 * ## Ce que ce moteur fait
 *
 * Il exécute, dans la page, les règles qui décident réellement de
 * l'utilisabilité des écrans de DEVNET : noms accessibles, alternatives
 * textuelles, contraste calculé sur les couleurs réellement rendues, structure
 * de titres, ARIA minimal, ordre de tabulation, titre et langue du document.
 *
 * L'API imite volontairement celle d'`AxeBuilder` (`withTags`, `exclude`,
 * `analyze`, `violations[].impact`) : les tests existants n'ont pas eu à être
 * réécrits, et le jour où un outil externe redevient acceptable, le
 * remplacement se fait à un seul endroit.
 *
 * Aucune dépendance : le fichier est du code DEVNET, sous la licence du
 * dépôt (MIT).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

export type Impact = "minor" | "moderate" | "serious" | "critical";

export type AuditNode = {
  /** Sélecteur CSS de l'élément fautif. */
  target: string[];
  /** Extrait du HTML, borné : de quoi retrouver l'élément sans noyer le log. */
  html: string;
  failureSummary: string;
};

export type Violation = {
  id: string;
  impact: Impact;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: AuditNode[];
};

export type AuditResults = {
  violations: Violation[];
  passes: { id: string; tags: string[] }[];
  incomplete: { id: string; reason: string }[];
};

type RuleMeta = {
  impact: Impact;
  help: string;
  description: string;
  tags: string[];
};

/**
 * Métadonnées des règles.
 *
 * Les étiquettes (`tags`) suivent celles d'`axe-core` : une règle marquée
 * `best-practice` n'est pas une exigence WCAG, et ne doit donc pas faire
 * échouer une porte qui filtre sur `wcag2a`/`wcag2aa`. C'est ce qui permet de
 * garder les tests existants tels quels.
 */
const RULES: Record<string, RuleMeta> = {
  "image-alt": {
    impact: "critical",
    help: "Les images doivent avoir une alternative textuelle",
    description: "Une image porteuse d'information doit avoir un texte alternatif.",
    tags: ["wcag2a", "wcag111"],
  },
  "input-image-alt": {
    impact: "critical",
    help: "Les boutons image doivent avoir une alternative textuelle",
    description: "Un <input type=\"image\"> doit avoir un texte alternatif.",
    tags: ["wcag2a", "wcag111"],
  },
  "area-alt": {
    impact: "critical",
    help: "Les zones cliquables d'une image doivent avoir un texte alternatif",
    description: "Un <area> doit avoir un attribut alt.",
    tags: ["wcag2a", "wcag111", "wcag244"],
  },
  "button-name": {
    impact: "critical",
    help: "Les boutons doivent avoir un nom accessible",
    description: "Un bouton sans nom accessible est annoncé « bouton » et rien d'autre.",
    tags: ["wcag2a", "wcag412"],
  },
  "link-name": {
    impact: "serious",
    help: "Les liens doivent avoir un nom accessible",
    description: "Un lien sans texte est inutilisable au lecteur d'écran.",
    tags: ["wcag2a", "wcag412", "wcag244"],
  },
  label: {
    impact: "critical",
    help: "Les champs de formulaire doivent avoir une étiquette",
    description: "Un champ sans étiquette n'indique pas ce qu'il attend.",
    tags: ["wcag2a", "wcag131", "wcag412"],
  },
  "select-name": {
    impact: "critical",
    help: "Les listes déroulantes doivent avoir un nom accessible",
    description: "Une liste sans nom accessible ne dit pas ce qu'elle choisit.",
    tags: ["wcag2a", "wcag131", "wcag412"],
  },
  "color-contrast": {
    impact: "serious",
    help: "Le contraste texte/fond doit être suffisant",
    description:
      "Le texte doit atteindre 4,5:1 (3:1 pour le grand texte), y compris dans chaque thème.",
    tags: ["wcag2aa", "wcag143"],
  },
  "document-title": {
    impact: "serious",
    help: "Le document doit avoir un titre",
    description: "Le titre apparaît dans l'onglet et dans la liste des fenêtres.",
    tags: ["wcag2a", "wcag242"],
  },
  "html-has-lang": {
    impact: "serious",
    help: "Le document doit déclarer sa langue",
    description: "Sans langue, la synthèse vocale lit le français avec la prononciation anglaise.",
    tags: ["wcag2a", "wcag311"],
  },
  "html-lang-valid": {
    impact: "serious",
    help: "La langue déclarée doit être valide",
    description: "L'attribut lang doit être une étiquette de langue (BCP 47).",
    tags: ["wcag2a", "wcag311"],
  },
  "heading-order": {
    impact: "moderate",
    help: "Les niveaux de titres doivent se suivre",
    description: "Sauter de h2 à h5 casse la navigation par titres.",
    tags: ["best-practice"],
  },
  "page-has-heading-one": {
    impact: "moderate",
    help: "La page doit avoir un titre de niveau 1",
    description: "Le h1 annonce le sujet de l'écran.",
    tags: ["best-practice"],
  },
  "landmark-one-main": {
    impact: "moderate",
    help: "La page doit avoir une région principale unique",
    description: "Un seul <main> permet d'aller directement au contenu.",
    tags: ["best-practice"],
  },
  "duplicate-id-aria": {
    impact: "serious",
    help: "Les identifiants référencés par ARIA doivent être uniques",
    description: "Un identifiant dupliqué rend la référence ARIA ambiguë.",
    tags: ["wcag2a", "wcag411"],
  },
  "aria-valid-attr": {
    impact: "critical",
    help: "Les attributs ARIA doivent exister",
    description: "Un attribut aria-* inconnu est ignoré par les technologies d'assistance.",
    tags: ["wcag2a", "wcag412"],
  },
  "aria-required-attr": {
    impact: "critical",
    help: "Les rôles ARIA doivent porter leurs attributs obligatoires",
    description: "Un role=\"checkbox\" sans aria-checked n'annonce aucun état.",
    tags: ["wcag2a", "wcag412"],
  },
  "aria-hidden-focus": {
    impact: "serious",
    help: "Un élément masqué aux lecteurs d'écran ne doit pas être focusable",
    description:
      "Un contrôle focusable dans une zone aria-hidden=true est atteignable au clavier mais invisible.",
    tags: ["wcag2a", "wcag412"],
  },
  tabindex: {
    impact: "serious",
    help: "L'ordre de tabulation doit suivre le document",
    description: "Un tabindex positif sort du flux naturel de tabulation.",
    tags: ["best-practice"],
  },
  "meta-viewport": {
    // « moderate » comme `axe-core` : le zoom est bridé, ce n'est pas un
    // contrôle sans nom. Le défaut reste réel et consigné dans
    // `docs/legal/LICENSE_CLEANUP_REPORT.md` (recommandation, pas blocage).
    impact: "moderate",
    help: "Le zoom ne doit pas être désactivé",
    description: "user-scalable=no ou maximum-scale=1 empêche d'agrandir le texte.",
    tags: ["wcag2aa", "wcag144"],
  },
  "frame-title": {
    impact: "serious",
    help: "Les cadres doivent avoir un titre",
    description: "Un iframe sans titre est annoncé comme un cadre sans nom.",
    tags: ["wcag2a", "wcag412", "wcag241"],
  },
  list: {
    impact: "serious",
    help: "Les listes ne doivent contenir que des éléments de liste",
    description: "Un <ul> dont l'enfant direct n'est pas un <li> perd sa structure.",
    tags: ["wcag2a", "wcag131"],
  },
  "duplicate-id": {
    impact: "minor",
    help: "Les identifiants doivent être uniques",
    description: "Deux éléments de même identifiant rendent les ancres et les labels imprévisibles.",
    tags: ["best-practice"],
  },
};

/** Règles qui demandent un calcul de contraste (plus coûteux). */
const CONTRAST_RULE = "color-contrast";

type RawNode = { target: string; html: string; summary: string };
type RawFindings = { id: string; nodes: RawNode[]; incomplete?: string };

/**
 * Code exécuté dans la page, lu comme texte.
 *
 * Voir `collect-in-page.js` : un transpileur (esbuild via `tsx`) injecte des
 * appels `__name(...)` dans les fonctions qu'il transforme, et le navigateur
 * ne les connaît pas. Envoyer le source tel quel évite le problème.
 */
function readCollectSource(): string {
  // `import.meta` casserait la compilation CommonJS de Playwright et
  // `__dirname` n'existe pas en ESM : on remonte depuis le répertoire de
  // travail jusqu'à trouver le fichier. Les deux exécutants (Playwright,
  // `tsx` via un script npm) partent de la racine du dépôt.
  let directory = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(directory, "lib", "a11y", "collect-in-page.js");
    if (existsSync(candidate)) return readFileSync(candidate, "utf8").trim();
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(
    "lib/a11y/collect-in-page.js introuvable : exécuter depuis la racine du dépôt",
  );
}

const COLLECT_SOURCE = readCollectSource();


export class A11yAudit {
  private readonly page: Page;
  private tags: string[] = [];
  private excluded: string[] = [];
  private disabled = new Set<string>();
  private included: string[] = [];

  constructor({ page }: { page: Page }) {
    this.page = page;
  }

  /** Même sémantique qu'`axe` : on garde les règles qui portent un des tags. */
  withTags(tags: string[]): this {
    this.tags = tags;
    return this;
  }

  exclude(selector: string | string[]): this {
    this.excluded.push(...(Array.isArray(selector) ? selector : [selector]));
    return this;
  }

  include(selector: string | string[]): this {
    this.included.push(...(Array.isArray(selector) ? selector : [selector]));
    return this;
  }

  disableRules(rules: string | string[]): this {
    for (const rule of Array.isArray(rules) ? rules : [rules]) this.disabled.add(rule);
    return this;
  }

  private activeRules(): string[] {
    return Object.entries(RULES)
      .filter(([id, meta]) => {
        if (this.disabled.has(id)) return false;
        if (this.tags.length === 0) return true;
        return meta.tags.some((tag) => this.tags.includes(tag));
      })
      .map(([id]) => id);
  }

  async analyze(): Promise<AuditResults> {
    const active = new Set(this.activeRules());
    const needsContrast = active.has(CONTRAST_RULE);

    const argument = JSON.stringify({
      // Le contraste n'est calculé que s'il est demandé : c'est la règle la
      // plus coûteuse et elle ne concerne que les portes WCAG AA.
      contrast: needsContrast,
      exclude: this.excluded,
      include: this.included,
    });
    const raw = (await this.page.evaluate(
      `(${COLLECT_SOURCE})(${argument})`,
    )) as RawFindings[];

    const violations: Violation[] = [];
    const passes: { id: string; tags: string[] }[] = [];
    const incomplete: { id: string; reason: string }[] = [];

    for (const finding of raw) {
      const meta = RULES[finding.id];
      if (!meta) continue;
      if (finding.nodes.length === 0) {
        if (finding.incomplete && active.has(finding.id)) {
          incomplete.push({ id: finding.id, reason: finding.incomplete });
        }
        continue;
      }
      if (!active.has(finding.id)) continue;
      violations.push({
        id: finding.id,
        impact: meta.impact,
        description: meta.description,
        help: meta.help,
        helpUrl: `https://devnet.local/docs/accessibilite#${finding.id}`,
        tags: meta.tags,
        nodes: finding.nodes.map((node) => ({
          target: [node.target],
          html: node.html,
          failureSummary: node.summary,
        })),
      });
    }

    for (const id of active) {
      if (!violations.some((violation) => violation.id === id)) {
        passes.push({ id, tags: RULES[id].tags });
      }
    }

    return { violations, passes, incomplete };
  }
}

export default A11yAudit;

/** Liste des règles, pour la documentation et les tests du moteur. */
export const RULE_CATALOG: { id: string; impact: Impact; tags: string[]; help: string }[] =
  Object.entries(RULES).map(([id, meta]) => ({
    id,
    impact: meta.impact,
    tags: meta.tags,
    help: meta.help,
  }));
