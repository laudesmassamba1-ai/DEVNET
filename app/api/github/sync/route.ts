/**
 * Route de poussée vers GitHub.
 *
 * C'est le seul endroit du projet qui parle à GitHub **avec un
 * jeton d'accès**. Tout le reste du flux OAuth est un échange de
 * protocole : il ne touche aucun objet applicatif. Ici, c'est
 * l'inverse : il touche GitHub, mais ne touche **rien** de DevNet,
 * ce qui est pourquoi il peut exister sans violer §9 en douceur.
 *
 * Le route lit **un seul cookie** (`devnet_gh`), déchiffre le
 * jeton dedans, appelle `api.github.com` trois à cinq fois, et
 * renvoie un résultat. Il ne lit jamais `github_connections`,
 * ne lit jamais le localStorage, et ne modifie jamais la base
 * DevNet —DevNet lui-même reste la source de vérité, GitHub est
 * la destination. Si quelqu'un triche sur le cookie, le pire qui
 * arrive est une tentative de push GitHub qui rejette ou rate —
 * pas une lecture de données DevNet.
 *
 * ## Le protocole de poussée (Git Data API)
 *
 * Une poussée est un enchaînement :
 *
 *   1. Lecture du sha distant **réel** de `refs/heads/{branch}`.
 *      Pendant la migration, il peut ne pas exister : c'est la
 *      branche vide auquel cas `expectRemoteSha` doit être "".
 *   2. Comparaison sha distant réel ↔ sha distant attendu. Différent
 *      = écrasement en vue → refus.
 *   3. Upload de chaque fichier comme un **blob** (`git/blobs::create`).
 *      Chaque blob rapporte son sha.
 *   4. Construction d'un **arbre**. Les fichiers discrepants reçoivent
 *      des entrées `blob` ; les fichiers inconnus du bocal local obtiennent
 *      leurs entrées du **nouvel arbre** pur — on ne l'inspecte pas, on le
 *      construit. Le mode est `4096` pour les répertoires.
 *   5. Création du **commit** (`git/commits::create`) référençant le
 *      parent (le sha distant si existant, sinon l'ancêteconnu ; crée la
 *      racine si premier push) puis l'arbre nouvel.
 *   6. Mise à jour de la **référence** (`git/refs::update`) pour que le
 *      commit devienne la tête de la branche.
 *
 * Le tout sans jamais faire confiance au contenu Accepter n'importe
 * quel chemin ne signifie pas qu'on l'inspecte les enfants. L'analyse
 * des chemins est faite dans `validateSyncPayload`.
 *
 * ## Les états
 *
 * Un outcome est soit un succès soit un échec explicite. Il n'y a
 * pas de "partiel" : si un blob rate le commit est irrelevant, et
 * la poussée n'est pas tentée. Ce n'est pas par prudence morale —
 * c'est parce qu'un commit partiel qui pointe des blobs inexistants
 * serait un commit orphelin dans GitHub, et orphelin c'est pire qu'
 * échec.
 *
 * ## Ce que refusent les variantes
 *
 * - `no-token` : cookie absent ou déchiffré vide (token expiré ou
 *   session volée).
 * - `identity` : le jeton ne permet même pas à GitHub de dire qui
 *   on est.
 * - `not-owner` : poussée sur un dépôt qu'on ne possède pas.
 * - `diverged` : GitHub a avancé sans nous.
 * - `api` : GitHub a répondu avec une erreur (repo manquant, branche
 *   protégée, jeton sans scope, rate limit, etc.).
 * - `bad-request` : ce n'est pas un échec GitHub — c'est une charge
 *   que le route a déjà refusée avant d'appeler GitHub.
 */

import { NextRequest, NextResponse } from "next/server";
import { decryptValue, hasVaultKey } from "@/lib/github/crypto";
import {
  validateSyncPayload,
  type SyncOutcome,
} from "@/lib/github/sync";

const GH_BASE = "https://api.github.com";
const ACCEPT_TREE = "application/vnd.github+json";

export async function POST(request: NextRequest) {
  // ── 0. Configuration ──────────────────────────────────────
  if (!hasVaultKey()) {
    return jsonError("no-token");
  }

  const token = await readToken(request);
  if (!token) return jsonError("no-token");

  const identity = await fetchIdentity(token);
  if (!identity) return jsonError("identity");

  const body = await request.json().catch(() => null);
  const payloadResult = validateSyncPayload(body);
  if (!payloadResult.ok) {
    return jsonResult({ status: "error", code: "bad-request", message: payloadResult.reason });
  }
  const payload = payloadResult.value;

  // ── 1. Vérifier l'identité GitHub ↔ propriétaire du dépôt ──
  if (identity.login.toLowerCase() !== payload.owner.toLowerCase()) {
    return jsonError("not-owner");
  }

  // ── 2. Lire l'état distant réel ───────────────────────────
  let remoteRefSha: string;
  try {
    remoteRefSha = await fetchRemoteSha({
      owner: payload.owner,
      repo: payload.repo,
      branch: payload.branch,
      token,
    });
  } catch {
    // Branche protégée, jeton sans scope, rate limit… : une lecture qui
    // rate n'est pas une divergence — l'écran verrait « échec » au lieu
    // d'un mensonge sur l'état du dépôt.
    return jsonError("api");
  }

  // Premier push : on n'a pas de préimage de référence.
  if (remoteRefSha === "NO_REF" && payload.expectedRemoteSha) {
    return jsonError("diverged");
  }
  // Aucune divergence : les deux têtes sont au même sha, ou la branche
  // distante est vide et on la crée. `NO_REF` (distant vide) et `""`
  // (client qui n'a jamais synchronisé) disent la même chose pour un
  // premier envoi : les comparer à la lettre interdirait tout premier
  // envoi vers un dépôt neuf.
  const remoteMatches =
    remoteRefSha === payload.expectedRemoteSha ||
    (remoteRefSha === "NO_REF" && payload.expectedRemoteSha === "");
  if (!remoteMatches) {
    return jsonError("diverged");
  }

  // ── 3–6. Pousser ─────────────────────────────────────────
  const result = await pushBranch({
    owner: payload.owner,
    repo: payload.repo,
    branch: payload.branch,
    headSha: payload.headSha,
    expectedRemoteSha: remoteRefSha,
    message: payload.message,
    files: payload.files,
    token,
  });

  if (result.ok) {
    return jsonResult({
      status: "pushed",
      sha: result.commitSha,
      files: payload.files.length,
    });
  }

  // La divergence (sha distant réel différent de l'attendu au moment
  // du commit) est peut-être apparue entre les deux requêtes ; on
  // ne rejette pas le travail, on dit la vérité.
  return jsonError(result.reason);
}

/* ── Jetons et identité ─────────────────────────────────── */

async function readToken(request: NextRequest): Promise<string | null> {
  const raw = request.cookies.get("devnet_gh")?.value;
  if (!raw) return null;
  const plain = await decryptValue(process.env.GITHUB_CRYPT_KEY ?? "", raw);
  return plain ?? null;
}

async function fetchIdentity(token: string): Promise<{ login: string } | null> {
  const res = await fetch(`${GH_BASE}/user`, {
    headers: {
      Accept: ACCEPT_TREE,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { login?: string } | null;
  return data?.login ? { login: data.login } : null;
}

/* ── État distant ───────────────────────────────────────── */

/** Lit le sha distant de la branche, ou signale qu'elle n'existe pas. */
async function fetchRemoteSha(input: {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}): Promise<string> {
  const url = `${GH_BASE}/repos/${encodeURIComponent(
    input.owner,
  )}/${encodeURIComponent(input.repo)}/git/refs/heads/${encodeURIComponent(
    input.branch,
  )}`;
  const res = await fetch(url, {
    headers: {
      Accept: ACCEPT_TREE,
      Authorization: `Bearer ${input.token}`,
    },
  });

  if (res.status === 404) return "NO_REF";
  if (!res.ok) throw new NetworkError(`remote read failed`);

  const data = (await res.json().catch(() => null)) as { object?: { sha?: string } } | null;
  const sha = data?.object?.sha;
  if (!sha || !SHA.test(sha)) throw new NetworkError(`remote read invalid`);
  return sha;
}

/* ── Poussée ────────────────────────────────────────────── */

async function pushBranch(input: {
  owner: string;
  repo: string;
  branch: string;
  headSha: string;
  expectedRemoteSha: string;
  message: string;
  files: { path: string; content: string }[];
  token: string;
}): Promise<{ ok: true; commitSha: string } | { ok: false; reason: "api" }> {
  const remoteExists = input.expectedRemoteSha !== "NO_REF";

  // 3. Upload des blobs.
  const blobs = await Promise.all(
    input.files.map(
      async (file): Promise<{ path: string; sha: string } | null> => {
        const sha = await createBlob({
          owner: input.owner,
          repo: input.repo,
          token: input.token,
          data: file.content,
        });
        if (!sha) return null;
        return { path: file.path, sha };
      },
    ),
  );

  if (blobs.some((b) => b === null)) {
    return { ok: false, reason: "api" };
  }

  // 4. Arbre. La base n'est **pas** le sha du commit distant (l'API des
  // refs renvoie la tête de branche, qui est un commit) : `base_tree`
  // attend le sha de l'**arbre** de ce commit. On le résout avant de
  // construire, sinon GitHub refuserait une base invalide.
  const baseTreeSha = remoteExists
    ? await fetchTreeSha({
        owner: input.owner,
        repo: input.repo,
        commitSha: input.expectedRemoteSha,
        token: input.token,
      })
    : null;
  if (remoteExists && !baseTreeSha) return { ok: false, reason: "api" };

  const treeSha = await createTree({
    owner: input.owner,
    repo: input.repo,
    token: input.token,
    tree: blobs.map((b) => ({ path: b!.path, mode: "100644", type: "blob", sha: b!.sha })),
    baseTreeSha,
  });
  if (!treeSha) return { ok: false, reason: "api" };

  // 5. Commit.
  const commitSha = await createCommit({
    owner: input.owner,
    repo: input.repo,
    token: input.token,
    message: input.message,
    treeSha,
    parents: remoteExists ? [input.expectedRemoteSha] : [],
  });
  if (!commitSha) return { ok: false, reason: "api" };

  // 6. Référence : la branche existe déjà (cas courant — on **met à
  // jour** la tête) ou pas encore (premier push — on la **crée**).
  // `POST /git/refs` sur une branche existante répond 422 ; le choix
  // du verbe dépend donc de l'état distant, pas d'un goût.
  const refOk = await updateRef({
    owner: input.owner,
    repo: input.repo,
    token: input.token,
    branch: input.branch,
    sha: commitSha,
    create: !remoteExists,
  });

  return refOk ? { ok: true, commitSha } : { ok: false, reason: "api" };
}

async function createBlob(input: {
  owner: string;
  repo: string;
  token: string;
  data: string;
}): Promise<string | null> {
  const res = await fetch(
    `${GH_BASE}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/blobs`,
    {
      method: "POST",
      headers: {
        Accept: ACCEPT_TREE,
        Authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: input.data, encoding: "utf-8" }),
    },
  );
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { sha?: string } | null;
  return data?.sha ? data.sha : null;
}

async function createTree(input: {
  owner: string;
  repo: string;
  token: string;
  tree: { path: string; mode: string; type: "blob"; sha: string }[];
  baseTreeSha: string | null;
}): Promise<string | null> {
  const body: Record<string, unknown> = { tree: input.tree };
  if (input.baseTreeSha) body.base_tree = input.baseTreeSha;

  const res = await fetch(
    `${GH_BASE}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/trees`,
    {
      method: "POST",
      headers: {
        Accept: ACCEPT_TREE,
        Authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { sha?: string } | null;
  return data?.sha ? data.sha : null;
}

async function createCommit(input: {
  owner: string;
  repo: string;
  token: string;
  message: string;
  treeSha: string;
  parents: string[];
}): Promise<string | null> {
  const res = await fetch(
    `${GH_BASE}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/commits`,
    {
      method: "POST",
      headers: {
        Accept: ACCEPT_TREE,
        Authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: input.message,
        tree: input.treeSha,
        parents: input.parents,
      }),
    },
  );
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { sha?: string } | null;
  return data?.sha ? data.sha : null;
}

/** Le sha de l'arbre d'un commit — pour `base_tree` d'un nouvel arbre. */
async function fetchTreeSha(input: {
  owner: string;
  repo: string;
  commitSha: string;
  token: string;
}): Promise<string | null> {
  const res = await fetch(
    `${GH_BASE}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/commits/${encodeURIComponent(input.commitSha)}`,
    {
      headers: {
        Accept: ACCEPT_TREE,
        Authorization: `Bearer ${input.token}`,
      },
    },
  );
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { tree?: { sha?: string } } | null;
  return data?.tree?.sha ?? null;
}

async function updateRef(input: {
  owner: string;
  repo: string;
  token: string;
  branch: string;
  sha: string;
  create: boolean;
}): Promise<boolean> {
  // Création (`refs/heads/{branch}` inexistant) et mise à jour ne
  // partagent pas le même verbe GitHub : `POST /git/refs` crée,
  // `PATCH /git/refs/heads/{branch}` remplace la tête. Forcer l'un pour
  // l'autre fait 422 sur une branche existante.
  const url = input.create
    ? `${GH_BASE}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/refs`
    : `${GH_BASE}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/refs/heads/${encodeURIComponent(input.branch)}`;
  const res = await fetch(url, {
    method: input.create ? "POST" : "PATCH",
    headers: {
      Accept: ACCEPT_TREE,
      Authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(
      input.create
        ? { ref: `refs/heads/${input.branch}`, sha: input.sha }
        : { sha: input.sha, force: false },
    ),
  });
  if (!res.ok) return false;
  return true;
}

/* ── Réponses ───────────────────────────────────────────── */

function jsonError(code: "no-token" | "identity" | "not-owner" | "diverged" | "api" | "bad-request") {
  // Le message est fourni par la couche `SYNC_ERROR_TEXT` côté client ;
  // ici on renvoie le code seul, moins de fuite dans la réponse.
  return NextResponse.json(
    { status: "error", code },
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  ) as unknown as NextResponse<SyncOutcome>;
}

function jsonResult(outcome: SyncOutcome) {
  return NextResponse.json(outcome, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/* ── Modes de secours ───────────────────────────────────── */

class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
