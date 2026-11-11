import type { ExtensionCategory, ExtensionManifest } from "@/lib/types";

/**
 * L’extension d’exemple, définie **une seule fois**.
 *
 * Elle sert de référence à trois endroits : la démonstration (fixture
 * `e-5`), la place de marché (carte « exemple ») et les tests de contrat.
 * Son intérêt est de couvrir les quatre contributions qu’un manifeste peut
 * porter aujourd’hui — extraits, commandes, réglages, cartes de slot — sans
 * exécuter une ligne de code.
 *
 * En démonstration, elle est installée et active pour koffi : les extraits
 * apparaissent dans l’IDE, les commandes dans la palette F1, les cartes dans
 * Découvrir et Extensions. Sur un backend réel, le bouton « Publier
 * l’exemple » la crée pour l’utilisateur connecté — aucune migration n’est
 * nécessaire.
 */
export const EXAMPLE_EXTENSION: {
  slug: string;
  name: string;
  description: string;
  version: string;
  icon: string;
  category: ExtensionCategory;
  manifest: ExtensionManifest;
} = {
  slug: "kit-demarrage-devnet",
  name: "Kit de démarrage DevNet",
  description:
    "L’exemple complet : deux extraits, deux commandes, un réglage et des cartes dans Découvrir et Extensions. Tout vient d’un seul manifeste.",
  version: "1.1.0",
  icon: "package",
  category: "snippets" as ExtensionCategory,
  manifest: {
    snippets: [
      {
        language: "typescript",
        prefix: "dnet-composant",
        body: [
          "export function ${1:Nom}() {",
          "  return <div className=\"p-4\">${2:contenu}</div>;",
          "}",
        ].join("\n"),
        description: "Un composant React minimal, prêt à compléter.",
      },
      {
        // `*` : l’extrait se propose quel que soit le langage du fichier.
        language: "*",
        prefix: "dnet-readme",
        body: [
          "# ${1:Nom du projet}",
          "",
          "${2:Ce que le projet fait.}",
          "",
          "## Lancer",
          "",
          "```bash",
          "npm install",
          "npm run dev",
          "```",
        ].join("\n"),
        description: "Un README de projet, avec la commande de lancement.",
      },
    ],
    commands: [
      {
        id: "module-header",
        title: "Insérer l’en-tête de module",
        body: "\"\"\"Module.\n\nDécris ici ce que fait ce fichier.\n\"\"\"\n",
      },
      {
        id: "test-plan",
        title: "Insérer un plan de tests",
        body: [
          "// Tests à écrire :",
          "// 1. cas nominal",
          "// 2. cas limite",
          "// 3. erreur attendue",
          "",
        ].join("\n"),
      },
    ],
    settings: [
      {
        key: "maxLineLength",
        label: "Longueur de ligne maximale",
        type: "number",
        default: 88,
      },
    ],
    slots: [
      {
        slot: "discover.sidebar",
        title: "Kit de démarrage actif",
        body: "Deux extraits et deux commandes sont disponibles dans l’IDE.",
        href: "/extensions",
      },
      {
        slot: "extensions.page",
        title: "Tout vient du même manifeste",
        body: "Extraits, commandes, réglage et cartes : aucune ligne de code exécutée.",
        href: "/extensions",
      },
    ],
  },
};

/** Le slug de l’exemple, pour le retrouver dans la place de marché. */
export const EXAMPLE_EXTENSION_SLUG = EXAMPLE_EXTENSION.slug;

/** Les emplacements que l’exemple cible réellement. */
export const EXAMPLE_SLOT_IDS = ["discover.sidebar", "extensions.page"] as const;

/** Vrai si un manifeste normalisé porte les quatre contributions de l’exemple. */
export function isCompleteExample(manifest: ExtensionManifest): boolean {
  return Boolean(
    manifest.snippets?.length
    && manifest.commands?.length
    && manifest.settings?.length
    && manifest.slots?.length,
  );
}
