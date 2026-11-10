/**
 * Compatibilité `devnetApi` : un sous-ensemble volontairement petit de SemVer.
 *
 * Formes acceptées : `1.2.3`, `^1.2.3`, `~1.2.3`, `*`.
 * On refuse tout le reste plutôt que d'interpréter approximativement : un
 * manifeste qui demande une plage inconnue ne doit pas se charger « à peu
 * près ».
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(input: string): SemVer | null {
  const match = VERSION_RE.exec(input.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

export type VersionRange =
  | { kind: "any" }
  | { kind: "exact"; version: SemVer }
  | { kind: "caret"; version: SemVer }
  | { kind: "tilde"; version: SemVer };

export function parseRange(input: string): VersionRange | null {
  const raw = input.trim();
  if (raw === "*") return { kind: "any" };

  const prefix = raw[0];
  if (prefix === "^" || prefix === "~") {
    const version = parseVersion(raw.slice(1));
    if (!version) return null;
    return { kind: prefix === "^" ? "caret" : "tilde", version };
  }

  const version = parseVersion(raw);
  return version ? { kind: "exact", version } : null;
}

export function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // Une version finale précède une pré-version de même numéro (SemVer §11).
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

/** Borne supérieure exclusive d'une plage `^` ou `~`. */
function upperBound(range: Exclude<VersionRange, { kind: "any" | "exact" }>): SemVer {
  const { major, minor, patch } = range.version;
  if (range.kind === "tilde") {
    return { major, minor: minor + 1, patch: 0, prerelease: null };
  }
  if (major > 0) return { major: major + 1, minor: 0, patch: 0, prerelease: null };
  if (minor > 0) return { major: 0, minor: minor + 1, patch: 0, prerelease: null };
  return { major: 0, minor: 0, patch: patch + 1, prerelease: null };
}

export function isVersionInRange(range: VersionRange, version: SemVer): boolean {
  switch (range.kind) {
    case "any":
      return true;
    case "exact":
      return compareVersions(range.version, version) === 0;
    case "caret":
    case "tilde":
      return (
        compareVersions(version, range.version) >= 0
        && compareVersions(version, upperBound(range)) < 0
      );
  }
}

/** Raccourci : la plage déclarée est-elle satisfaite par `version` ? */
export function isCompatible(declaredRange: string, version: string): boolean {
  const range = parseRange(declaredRange);
  const parsed = parseVersion(version);
  if (!range || !parsed) return false;
  return isVersionInRange(range, parsed);
}
