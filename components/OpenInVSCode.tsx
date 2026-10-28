"use client";

import { Icon } from "./Icon";
import {
  cloneRepoUri,
  openFileUri,
  openFolderUri,
  openInVSCode,
} from "@/lib/vscode/bridge";

/**
 * « Ouvrir dans VS Code ».
 *
 * Le bouton ne fait pas de requête : il fabrique une URI `vscode://` et
 * la confie au navigateur. Deux cibles possibles, jamais les deux à la
 * fois : un chemin local (fichier ou dossier) ou l'URL d'un dépôt à
 * cloner. Sans cible, le bouton ne s'affiche pas — un bouton qui ne
 * mène nulle part est pire qu'un bouton absent.
 *
 * Le chemin est un chemin de la **machine de la personne** ; l'aperçu du
 * dépôt ne connaît d'ordinaire que des chemins relatifs. C'est à
 * l'appelant de fournir un chemin absolu, ou de s'en tenir au dépôt.
 */
export function OpenInVSCode({
  path,
  repo,
  line,
  column,
  folder = false,
  label,
  className = "",
}: {
  /** Chemin absolu d'un fichier (ou d'un dossier si `folder`). */
  path?: string;
  /** URL d'un dépôt à cloner dans VS Code. Prioritaire sur `path`. */
  repo?: string;
  /** Ligne, 1-indexée — fichier uniquement. */
  line?: number;
  /** Colonne, 1-indexée — nécessite `line`. */
  column?: number;
  /** Force l'ouverture d'un dossier. */
  folder?: boolean;
  /** Libellé ; par défaut « Ouvrir dans VS Code ». */
  label?: string;
  className?: string;
}) {
  const uri = buildUri({ path, repo, line, column, folder });
  if (!uri) return null;

  return (
    <button
      type="button"
      onClick={() => openInVSCode(uri)}
      title={uri}
      className={`mo-press inline-flex min-h-[var(--h-action)] items-center gap-1.5
        rounded-[var(--radius-chip)] border-[var(--bw-thin)] border-line glass-flat
        px-2.5 py-2 label text-chalk-3 transition-[color,border-color,background-color]
        duration-[var(--d-fast)] hover:border-signal hover:text-signal
        active:translate-y-px max-sm:min-h-[var(--h-tap)] ${className}`}
    >
      <Icon name="code" size={12} strokeWidth={2} />
      {label ?? "Ouvrir dans VS Code"}
    </button>
  );
}

/** La cible devient une URI ; l'absence de cible donne `null`. */
function buildUri({
  path,
  repo,
  line,
  column,
  folder,
}: {
  path?: string;
  repo?: string;
  line?: number;
  column?: number;
  folder: boolean;
}): string | null {
  if (repo?.trim()) return cloneRepoUri(repo);
  if (!path?.trim()) return null;
  return folder ? openFolderUri(path) : openFileUri(path, line, column);
}
