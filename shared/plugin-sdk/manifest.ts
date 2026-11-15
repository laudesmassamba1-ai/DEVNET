/**
 * Manifeste de plugin : schéma strict, vérifié au démarrage et en CI.
 *
 * Contrairement au manifeste de la place de marché (029), qui tolère les
 * sections illisibles, celui-ci **refuse** tout ce qu'il ne comprend pas. Un
 * plugin est du code de confiance ajouté à la compilation : mieux vaut un
 * build rouge qu'un paquet à moitié interprété.
 */
import { isValidCapability } from "./catalog";
import { parseRange, parseVersion } from "./semver";

export type PluginLevel = 1 | 2 | 3;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  devnetApi: string;
  level: PluginLevel;
  requires: string[];
  conflicts: string[];
  capabilities: string[];
  network: { outbound: string[] };
  settings?: string;
  migrations?: string;
  entry: { server: string; client?: string };
  i18n: string[];
  dataCategories: string[];
}

export interface ManifestIssue {
  path: string;
  message: string;
}

export type ManifestValidation =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; issues: ManifestIssue[] };

const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const HOST_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const SCRIPT_RE = /\.(?:ts|tsx)$/;
const ALLOWED_KEYS = new Set([
  "id",
  "name",
  "version",
  "devnetApi",
  "level",
  "requires",
  "conflicts",
  "capabilities",
  "network",
  "settings",
  "migrations",
  "entry",
  "i18n",
  "dataCategories",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(path: string, message: string): ManifestIssue {
  return { path, message };
}

function isSafeRelativePath(value: string): boolean {
  if (value.startsWith("/") || value.includes("\\")) return false;
  return !value.split("/").some((part) => part === ".." || part === "");
}

function readString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: ManifestIssue[],
  options: { optional?: boolean } = {},
): string | undefined {
  const value = source[key];
  if (value === undefined) {
    if (!options.optional) issues.push(issue(path, "champ obligatoire absent"));
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(issue(path, "chaîne non vide attendue"));
    return undefined;
  }
  return value.trim();
}

function readStringArray(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: ManifestIssue[],
  options: { optional?: boolean } = {},
): string[] {
  const value = source[key];
  if (value === undefined) {
    if (!options.optional) issues.push(issue(path, "tableau obligatoire absent"));
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push(issue(path, "tableau attendu"));
    return [];
  }

  const out: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      issues.push(issue(`${path}[${index}]`, "chaîne non vide attendue"));
      return;
    }
    out.push(entry.trim());
  });
  return out;
}

function rejectDuplicates(values: string[], path: string, issues: ManifestIssue[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) issues.push(issue(path, `doublon : ${value}`));
    seen.add(value);
  }
}

export function validateManifest(raw: unknown): ManifestValidation {
  const issues: ManifestIssue[] = [];
  if (!isRecord(raw)) {
    return { ok: false, issues: [issue("$", "objet JSON attendu")] };
  }

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) issues.push(issue(key, "champ inconnu"));
  }

  const id = readString(raw, "id", "id", issues);
  if (id !== undefined && !ID_RE.test(id)) {
    issues.push(issue("id", "minuscules, chiffres et tirets attendus"));
  }

  const name = readString(raw, "name", "name", issues);
  const version = readString(raw, "version", "version", issues);
  if (version !== undefined && !SEMVER_RE.test(version)) {
    issues.push(issue("version", "version SemVer attendue (ex. 1.0.0)"));
  }

  const devnetApi = readString(raw, "devnetApi", "devnetApi", issues);
  if (devnetApi !== undefined && !parseRange(devnetApi)) {
    issues.push(issue("devnetApi", "plage attendue : ^1.0.0, ~1.2.0, 1.2.3 ou *"));
  }

  const levelRaw = raw.level;
  let level: PluginLevel | undefined;
  if (levelRaw !== 1 && levelRaw !== 2 && levelRaw !== 3) {
    issues.push(issue("level", "niveau 1, 2 ou 3 attendu (le niveau 4 est hors SDK)"));
  } else {
    level = levelRaw;
  }

  const requires = readStringArray(raw, "requires", "requires", issues, { optional: true });
  const conflicts = readStringArray(raw, "conflicts", "conflicts", issues, { optional: true });
  for (const [field, values] of [
    ["requires", requires],
    ["conflicts", conflicts],
  ] as const) {
    rejectDuplicates(values, field, issues);
    values.forEach((value, index) => {
      if (!ID_RE.test(value)) {
        issues.push(issue(`${field}[${index}]`, "identifiant de module ou de plugin attendu"));
      }
    });
  }
  if (id !== undefined && requires.includes(id)) issues.push(issue("requires", "auto-dépendance"));
  if (id !== undefined && conflicts.includes(id)) issues.push(issue("conflicts", "auto-conflit"));

  const capabilities = readStringArray(raw, "capabilities", "capabilities", issues, {
    optional: true,
  });
  rejectDuplicates(capabilities, "capabilities", issues);
  capabilities.forEach((capability, index) => {
    if (!isValidCapability(capability)) {
      issues.push(issue(`capabilities[${index}]`, `capacité inconnue : ${capability}`));
    }
  });

  const networkRaw = raw.network;
  let outbound: string[] = [];
  if (!isRecord(networkRaw)) {
    issues.push(issue("network", "objet { outbound: [] } attendu"));
  } else {
    for (const key of Object.keys(networkRaw)) {
      if (key !== "outbound") issues.push(issue(`network.${key}`, "champ inconnu"));
    }
    outbound = readStringArray(networkRaw, "outbound", "network.outbound", issues, {
      optional: true,
    });
    rejectDuplicates(outbound, "network.outbound", issues);
    outbound.forEach((host, index) => {
      if (host.includes("://") || host.includes("/") || host.includes(":")) {
        issues.push(issue(`network.outbound[${index}]`, "nom d'hôte seul attendu, sans protocole ni chemin"));
      } else if (!HOST_RE.test(host)) {
        issues.push(issue(`network.outbound[${index}]`, "nom d'hôte invalide"));
      }
    });
  }

  const settings = readString(raw, "settings", "settings", issues, { optional: true });
  if (settings !== undefined && !isSafeRelativePath(settings)) {
    issues.push(issue("settings", "chemin relatif attendu"));
  }
  const migrations = readString(raw, "migrations", "migrations", issues, { optional: true });
  if (migrations !== undefined && !isSafeRelativePath(migrations)) {
    issues.push(issue("migrations", "chemin relatif attendu"));
  }

  const entryRaw = raw.entry;
  let server: string | undefined;
  let client: string | undefined;
  if (!isRecord(entryRaw)) {
    issues.push(issue("entry", "objet { server: … } attendu"));
  } else {
    for (const key of Object.keys(entryRaw)) {
      if (key !== "server" && key !== "client") {
        issues.push(issue(`entry.${key}`, "champ inconnu"));
      }
    }
    server = readString(entryRaw, "server", "entry.server", issues);
    client = readString(entryRaw, "client", "entry.client", issues, { optional: true });
    if (server !== undefined) {
      if (!isSafeRelativePath(server) || !SCRIPT_RE.test(server)) {
        issues.push(issue("entry.server", "fichier .ts ou .tsx relatif attendu"));
      }
    }
    if (client !== undefined) {
      if (!isSafeRelativePath(client) || !SCRIPT_RE.test(client)) {
        issues.push(issue("entry.client", "fichier .ts ou .tsx relatif attendu"));
      }
    }
  }

  const i18n = readStringArray(raw, "i18n", "i18n", issues, { optional: true });
  i18n.forEach((code, index) => {
    if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(code)) {
      issues.push(issue(`i18n[${index}]`, "code de langue attendu (fr, en, fr-FR…)"));
    }
  });
  rejectDuplicates(i18n, "i18n", issues);

  const dataCategories = readStringArray(raw, "dataCategories", "dataCategories", issues, {
    optional: true,
  });
  rejectDuplicates(dataCategories, "dataCategories", issues);

  if (issues.length > 0) return { ok: false, issues };

  // Les champs obligatoires sont garantis par l'absence d'issue.
  return {
    ok: true,
    manifest: {
      id: id as string,
      name: name as string,
      version: version as string,
      devnetApi: devnetApi as string,
      level: level as PluginLevel,
      requires,
      conflicts,
      capabilities,
      network: { outbound },
      settings,
      migrations,
      entry: { server: server as string, client },
      i18n,
      dataCategories,
    },
  };
}

/** Vérifie aussi la forme de la version déclarée (utilisé par le générateur). */
export function isSemVer(value: string): boolean {
  return parseVersion(value) !== null;
}
