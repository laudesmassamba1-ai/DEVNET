/**
 * L'import « fichiers + historique » d'un dépôt GitHub.
 *
 * `POST /api/github/import` avec `{ owner, repo, branch? }` — renvoie la
 * **suite des révisions** du dépôt distant, sous une forme que le client
 * peut rejouer dans DevNet pour reconstruire l'historique.
 *
 * ## Pourquoi le route ne construit pas le dépôt lui-même
 *
 * Écrire un dépôt DevNet (projet, fichiers, commits, référence) est le
 * travail de `lib/repo.ts`, qui passe par Supabase. Une route qui le
 * ferait contournerait §9 — la règle « pas de route handler ». Le route
 * ne fait donc **que** parler à GitHub : il lit les arbres et les blobs,
 * réduit le tout à une suite de modifications, et la renvoie. C'est le
 * client qui rejoue l'histoire dans le dépôt DevNet.
 *
 * ## Pourquoi un fil de modifications, pas des instantanés
 *
 * Un instantané complet par révision ferait grossir la réponse comme
 * l'histoire du dépôt. On envoie donc la première révision en `full`,
 * puis chaque suivante en `delta` — les seuls chemins ajoutés ou
 * modifiés, et la liste des supprimés. Le client reconstruit l'état
 * cumulatif en appliquant les deltas dans l'ordre.
 *
 * ## Les bornes
 *
 * L'import est volontairement borné : nombre de révisions, taille d'un
 * blob, octets totaux de la réponse. Un dépôt qui dépasse ces bornes est
 * importé **partiellement**, et le drapeau `truncated` le dit à l'écran.
 * Mieux vaut un import court et vrai qu'une attente qui n'aboutit pas.
 */

import type {
  GithubImportCommit,
  GithubImportFile,
  GithubImportPayload,
} from "@/lib/types";
import {
  errorResponse,
  ghJson,
  githubErrorCode,
  jsonResponse,
  parseOwnerRepo,
  requireToken,
} from "@/lib/github/api";

const MAX_COMMITS = 40;
/** Un blob plus gros n'a pas sa place dans un import de code source. */
const MAX_BLOB_BYTES = 200_000;
/** Plafond de la réponse sérialisée : on s'arrête avant de la rendre énorme. */
const MAX_TOTAL_BYTES = 6_000_000;

const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg",
  "pdf", "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "wav", "ogg", "flac", "mp4", "mov", "avi", "mkv", "webm",
  "wasm", "so", "dylib", "dll", "exe", "bin", "class", "o", "a", "pyc",
]);

export async function POST(request: Request) {
  const auth = await requireToken(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => null)) as
    | { owner?: string; repo?: string; branch?: string }
    | null;

  const ref = parseOwnerRepo(body?.owner ?? null, body?.repo ?? null);
  if (!ref) return errorResponse("not-found", 400);

  const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const token = auth.token;

  let branch = body?.branch?.trim() || "";
  if (!branch) {
    const repo = await ghJson<{ default_branch?: string }>(token, base);
    if (!repo.ok) return errorResponse(githubErrorCode(repo.status));
    branch = repo.data.default_branch || "main";
  }

  const list = await ghJson<RawCommit[]>(
    token,
    `${base}/commits?sha=${encodeURIComponent(branch)}&per_page=${MAX_COMMITS}`,
  );
  if (!list.ok) return errorResponse(githubErrorCode(list.status));
  if (!Array.isArray(list.data) || list.data.length === 0) {
    return errorResponse("not-found");
  }

  // GitHub rend du plus récent au plus ancien ; on remonte le temps dans
  // l'ordre pour que chaque commit ait son parent déjà construit.
  const commits = [...list.data].reverse();

  const blobCache = new Map<string, string | null>();
  let truncated = commits.length === MAX_COMMITS || list.data.length === MAX_COMMITS;
  let totalBytes = 0;

  let previous = new Map<string, string>();
  const out: GithubImportCommit[] = [];

  for (let i = 0; i < commits.length; i++) {
    const raw = commits[i];
    if (!raw.sha) continue;

    const files = await snapshotFiles({ owner: ref.owner, repo: ref.repo, token, sha: raw.sha, blobCache });
    if (!files) return errorResponse("api");
    if (files.truncated) truncated = true;

    const current = files.map;
    const delta: GithubImportFile[] = [];
    const deleted: string[] = [];

    for (const [path, content] of current) {
      if (previous.get(path) !== content) delta.push({ path, content });
    }
    for (const path of previous.keys()) {
      if (!current.has(path)) deleted.push(path);
    }

    const isFirst = i === 0;
    const payloadFiles = isFirst
      ? [...current].map(([path, content]) => ({ path, content }))
      : delta;

    const bytes = measure({ message: raw.commit?.message ?? "", files: payloadFiles });
    if (totalBytes + bytes > MAX_TOTAL_BYTES) {
      truncated = true;
      break;
    }
    totalBytes += bytes;

    out.push({
      message: (raw.commit?.message ?? "").trim() || `Import GitHub ${raw.sha.slice(0, 7)}`,
      authorName: raw.commit?.author?.name || raw.author?.login || "GitHub",
      authorEmail: raw.commit?.author?.email || "",
      when: toSeconds(raw.commit?.author?.date),
      mode: isFirst ? "full" : "delta",
      files: payloadFiles,
      deleted,
    });

    previous = current;
  }

  if (out.length === 0) return errorResponse("not-found");

  const payload: GithubImportPayload = {
    owner: ref.owner,
    repo: ref.repo,
    branch,
    truncated,
    commits: out,
  };

  return jsonResponse({ payload });
}

/* ── Instantané d'un commit ─────────────────────────────── */

async function snapshotFiles(input: {
  owner: string;
  repo: string;
  token: string;
  sha: string;
  blobCache: Map<string, string | null>;
}): Promise<{ map: Map<string, string>; truncated: boolean } | null> {
  const { owner, repo, token, sha, blobCache } = input;
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const tree = await ghJson<RawTree>(token, `${base}/git/trees/${encodeURIComponent(sha)}?recursive=1`);
  if (!tree.ok) return null;

  const blobs = (tree.data.tree ?? []).filter(
    (e): e is { path: string; type: "blob"; sha: string; size?: number } =>
      e.type === "blob" && typeof e.path === "string" && typeof e.sha === "string",
  );

  let truncated = Boolean(tree.data.truncated);

  // On ne demande que les blobs qu'on n'a pas déjà, et on tient un
  // plafond de concurrence pour ne pas ouvrir 500 connexions d'un coup.
  const wanted = blobs.filter((b) => !blobCache.has(b.sha));
  await pool(wanted, 8, async (blob) => {
    if (typeof blob.size === "number" && blob.size > MAX_BLOB_BYTES) {
      blobCache.set(blob.sha, null);
      return;
    }
    if (BINARY_EXT.has(ext(blob.path))) {
      blobCache.set(blob.sha, null);
      return;
    }
    const res = await ghJson<RawBlob>(token, `${base}/git/blobs/${blob.sha}`);
    if (!res.ok || res.data.encoding !== "base64" || typeof res.data.content !== "string") {
      blobCache.set(blob.sha, null);
      return;
    }
    const decoded = decodeBase64(res.data.content);
    blobCache.set(blob.sha, decoded);
  });

  const map = new Map<string, string>();
  for (const blob of blobs) {
    const content = blobCache.get(blob.sha);
    if (content === undefined || content === null) {
      truncated = true; // fichier ignoré (binaire, trop gros, illisible)
      continue;
    }
    map.set(blob.path, content);
  }

  return { map, truncated };
}

/* ── Utilitaires ────────────────────────────────────────── */

interface RawCommit {
  sha?: string;
  commit?: {
    message?: string;
    author?: { name?: string; email?: string; date?: string } | null;
  };
  author?: { login?: string } | null;
}

interface RawTree {
  truncated?: boolean;
  tree?: { path?: string; type?: string; sha?: string; size?: number }[];
}

interface RawBlob {
  content?: string;
  encoding?: string;
}

function decodeBase64(value: string): string {
  return Buffer.from(value.replace(/\n/g, ""), "base64").toString("utf8");
}

function ext(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

function toSeconds(date: string | undefined): number {
  const ms = date ? Date.parse(date) : Number.NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

function measure(commit: { message: string; files: GithubImportFile[] }): number {
  let bytes = commit.message.length;
  for (const f of commit.files) bytes += f.path.length + f.content.length;
  return bytes;
}

/** Exécute `work` sur `items` avec au plus `size` tâches en vol. */
async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await work(items[index]);
    }
  });
  await Promise.all(workers);
}
