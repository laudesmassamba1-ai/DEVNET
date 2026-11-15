/**
 * Génère `platform/registry.generated.ts` à partir des manifestes.
 *
 * Aucun chargement dynamique : le registre contient des **imports statiques**,
 * que Next.js peut analyser et découper. Le script est aussi le validateur de
 * la CI : un manifeste invalide, une dépendance absente ou un cycle fait
 * échouer la construction.
 *
 *   npm run plugins:gen       écrit le registre
 *   npm run plugins:validate  vérifie qu'il est à jour (CI)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_MODULES } from "../shared/plugin-sdk/catalog";
import {
  validateManifest,
  type ManifestIssue,
  type PluginManifest,
} from "../shared/plugin-sdk/manifest";

const PLUGINS_DIR = "plugins";
const OUTPUT_FILE = "platform/registry.generated.ts";

export interface RegistryEntry {
  manifest: PluginManifest;
  importPath: string;
}

export type RegistryBuild =
  | { ok: true; entries: RegistryEntry[] }
  | { ok: false; issues: string[] };

export interface PluginSource {
  dirName: string;
  manifest: PluginManifest;
}

function fail(issues: ManifestIssue[], file: string): string[] {
  return issues.map((entry) => `${file} → ${entry.path} : ${entry.message}`);
}

/** Lit et valide tous les manifestes, sans encore construire le registre. */
export function readPluginSources(root = process.cwd()): {
  sources: PluginSource[];
  issues: string[];
} {
  const dir = join(root, PLUGINS_DIR);
  const issues: string[] = [];
  if (!existsSync(dir)) return { sources: [], issues };

  const sources: PluginSource[] = [];
  const dirNames = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();

  for (const dirName of dirNames) {
    const manifestPath = join(dir, dirName, "plugin.json");
    if (!existsSync(manifestPath)) {
      issues.push(`${PLUGINS_DIR}/${dirName} → plugin.json absent`);
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      issues.push(
        `${PLUGINS_DIR}/${dirName}/plugin.json → JSON invalide : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }

    const validation = validateManifest(raw);
    if (!validation.ok) {
      issues.push(...fail(validation.issues, `${PLUGINS_DIR}/${dirName}/plugin.json`));
      continue;
    }

    if (validation.manifest.id !== dirName) {
      issues.push(
        `${PLUGINS_DIR}/${dirName}/plugin.json → l'id « ${validation.manifest.id} » `
          + `doit égaler le nom du dossier « ${dirName} »`,
      );
      continue;
    }

    const pluginDir = join(dir, dirName);
    const serverPath = join(pluginDir, validation.manifest.entry.server);
    if (!existsSync(serverPath)) {
      issues.push(
        `${PLUGINS_DIR}/${dirName}/plugin.json → entrée serveur introuvable : `
          + validation.manifest.entry.server,
      );
      continue;
    }

    if (
      validation.manifest.settings
      && !existsSync(join(pluginDir, validation.manifest.settings))
    ) {
      issues.push(
        `${PLUGINS_DIR}/${dirName}/plugin.json → schéma de réglages introuvable : `
          + validation.manifest.settings,
      );
      continue;
    }

    if (
      validation.manifest.migrations
      && !existsSync(join(pluginDir, validation.manifest.migrations))
    ) {
      issues.push(
        `${PLUGINS_DIR}/${dirName}/plugin.json → dossier de migrations introuvable : `
          + validation.manifest.migrations,
      );
      continue;
    }

    sources.push({ dirName, manifest: validation.manifest });
  }

  return { sources, issues };
}

/**
 * Vérifie le graphe : identifiants uniques, `requires` et `conflicts` connus,
 * absence de cycle. Un module du cœur n'est pas un nœud du graphe de plugins.
 */
export function validateGraph(manifests: PluginManifest[]): string[] {
  const issues: string[] = [];
  const byId = new Map<string, PluginManifest>();

  for (const manifest of manifests) {
    if (byId.has(manifest.id)) {
      issues.push(`graphe → identifiant dupliqué : ${manifest.id}`);
      continue;
    }
    byId.set(manifest.id, manifest);
  }

  const core = new Set<string>(CORE_MODULES);
  for (const manifest of manifests) {
    for (const dependency of manifest.requires) {
      if (core.has(dependency)) continue;
      if (!byId.has(dependency)) {
        issues.push(`graphe → ${manifest.id} exige « ${dependency} », qui n'existe pas`);
      }
    }
    for (const conflict of manifest.conflicts) {
      if (!core.has(conflict) && !byId.has(conflict)) {
        issues.push(`graphe → ${manifest.id} déclare un conflit inconnu : ${conflict}`);
      }
    }
  }

  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  function visit(id: string): void {
    const current = state.get(id);
    if (current === "done") return;
    if (current === "visiting") {
      const cycle = [...stack, id].join(" → ");
      issues.push(`graphe → cycle de dépendances : ${cycle}`);
      return;
    }

    state.set(id, "visiting");
    stack.push(id);
    const manifest = byId.get(id);
    for (const dependency of manifest?.requires ?? []) {
      if (byId.has(dependency)) visit(dependency);
    }
    stack.pop();
    state.set(id, "done");
  }

  for (const id of byId.keys()) visit(id);
  return issues;
}

export function renderRegistry(entries: RegistryEntry[]): string {
  const imports = entries
    .map((entry, index) => `import plugin${index} from ${JSON.stringify(entry.importPath)};`)
    .join("\n");

  const objects = entries
    .map((entry, index) => {
      const manifest = JSON.stringify(entry.manifest, null, 2)
        .split("\n")
        .map((line, lineIndex) => (lineIndex === 0 ? line : `    ${line}`))
        .join("\n");
      return `  {\n    manifest: ${manifest},\n    definition: plugin${index},\n  },`;
    })
    .join("\n");

  return `/**
 * FICHIER GÉNÉRÉ — ne pas modifier à la main.
 * Source de vérité : plugins/<id>/plugin.json
 * Régénérer : npm run plugins:gen
 */
import type { PluginDefinition, PluginManifest } from "@devnet/plugin-sdk";
${imports ? `\n${imports}\n` : ""}
export interface RegisteredPlugin {
  readonly manifest: PluginManifest;
  readonly definition: PluginDefinition;
}

export const REGISTERED_PLUGINS: readonly RegisteredPlugin[] = [
${objects}${objects ? "\n" : ""}];
`;
}

export function buildRegistry(root = process.cwd()): RegistryBuild {
  const { sources, issues } = readPluginSources(root);
  if (issues.length > 0) return { ok: false, issues };

  const graphIssues = validateGraph(sources.map((source) => source.manifest));
  if (graphIssues.length > 0) return { ok: false, issues: graphIssues };

  const entries: RegistryEntry[] = sources.map((source) => ({
    manifest: source.manifest,
    importPath: `@/plugins/${source.dirName}/${source.manifest.entry.server.replace(
      /\.(?:ts|tsx)$/,
      "",
    )}`,
  }));

  return { ok: true, entries };
}

function main(): void {
  const check = process.argv.includes("--check");
  const root = process.cwd();
  const built = buildRegistry(root);

  if (!built.ok) {
    console.error("✗ Manifestes de plugin invalides :");
    for (const issue of built.issues) console.error(`  · ${issue}`);
    process.exitCode = 1;
    return;
  }

  const content = renderRegistry(built.entries);
  const outputPath = join(root, OUTPUT_FILE);

  if (check) {
    if (!existsSync(outputPath)) {
      console.error(`✗ ${OUTPUT_FILE} est absent. Lancez npm run plugins:gen.`);
      process.exitCode = 1;
      return;
    }
    if (readFileSync(outputPath, "utf8") !== content) {
      console.error(`✗ ${OUTPUT_FILE} n'est pas à jour. Lancez npm run plugins:gen.`);
      process.exitCode = 1;
      return;
    }
    console.log(`✓ ${built.entries.length} plugin(s), registre à jour.`);
    return;
  }

  writeFileSync(outputPath, content, "utf8");
  console.log(`✓ ${built.entries.length} plugin(s) → ${OUTPUT_FILE}`);
}

if (process.argv[1] && process.argv[1].endsWith("plugins-gen.ts")) {
  main();
}
