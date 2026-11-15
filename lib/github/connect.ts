import { api } from "@/lib/api/client";
import {
  canLink,
  needsRelink,
  parseRepo,
  planSync,
  type LinkResult,
  type RepoRef,
  type SyncMode,
  type SyncPlan,
} from "@/lib/github/link";
import type { GithubConnection, ProjectLink } from "@/lib/types";

/**
 * La connexion GitHub, côté données.
 *
 * ## Ce module ne parle pas à GitHub
 *
 * Il manipule deux tables — `github_connections` (par personne) et
 * `project_links` (par projet) — et **rien d'autre**. Le transfert réel
 * vers GitHub demande un jeton et un appel réseau, deux choses que
 * l'application n'a pas : le jeton vit dans un coffre (Vault), et
 * l'application interroge Supabase directement, sans route handler (c'est
 * une décision de la section 9 du MEMO). Ce qui est livré ici est donc la
 * moitié qui manquait dans `app/` : **l'écran** au-dessus d'un moteur
 * déjà écrit et testé (`lib/github/link.ts`).
 *
 * ## Ce que « connecter » veut dire, précisément
 *
 * On enregistre une **identité** GitHub (le `login`) et une référence
 * opaque vers le coffre. Le jeton lui-même n'est jamais dans cette table :
 * une seule fuite de RLS exposerait sinon tous les comptes. `token_ref`
 * n'est pas le jeton, c'est le nom sous lequel il est rangé — exactement
 * la décision de la migration 004.
 *
 * ## Pas d'`upsert` : deux chemins lisibles
 *
 * La contrainte d'unicité est `(user_id, provider)` pour la connexion et
 * `(project_id)` pour le lien — des clés **multi-colonnes**, que le
 * `onConflict` du client ne désigne pas simplement. On lit d'abord, puis
 * on insère ou on met à jour : deux chemins sans ambiguïté, et pas de
 * dépendance à la forme exacte d'un nom de contrainte.
 */

const PROVIDER = "github";

/** La forme acceptée d'un identifiant GitHub (elle-même validée par l'API). */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/* ── Connexion (par personne) ────────────────────────────────────── */

export async function fetchConnection(me: string): Promise<GithubConnection | null> {
  if (!me) return null;

  const { data } = await api
    .from("github_connections")
    .select("*")
    .eq("user_id", me)
    .eq("provider", PROVIDER)
    .maybeSingle();

  return (data as GithubConnection) ?? null;
}

/**
 * Enregistre (ou met à jour) la connexion GitHub de `me`.
 *
 * On refuse un identifiant qui ne peut pas exister **avant** d'écrire :
 * une ligne avec un login invalide serait un état que GitHub ne
 * reconnaîtrait jamais, et l'écran afficherait « connecté » pour un
 * compte qui n'existe pas. Le refus vient donc d'ici, pas de l'API.
 */
export async function connectGithub(
  me: string,
  login: string,
): Promise<{ connection: GithubConnection | null; error: string | null }> {
  const clean = login.trim().replace(/^@/, "");
  if (!LOGIN.test(clean)) {
    return { connection: null, error: "Identifiant GitHub invalide" };
  }

  const existing = await fetchConnection(me);

  if (existing) {
    const { data, error } = await api
      .from("github_connections")
      .update({ login: clean })
      .eq("id", existing.id)
      .select()
      .single();

    return error
      ? { connection: null, error: error.message }
      : { connection: data as GithubConnection, error: null };
  }

  const { data, error } = await api
    .from("github_connections")
    .insert({
      user_id: me,
      provider: PROVIDER,
      login: clean,
      // Jamais le jeton : le nom sous lequel il est rangé au coffre.
      token_ref: `vault://github/${me}`,
      scopes: ["repo", "read:user"],
      // La base poserait `now()` elle-même, mais la démonstration
      // renvoie la ligne telle qu'insérée : on pose la date ici pour
      // que l'écran « connecté il y a… » soit vrai dans les deux modes.
      connected_at: new Date().toISOString(),
    })
    .select()
    .single();

  return error
    ? { connection: null, error: error.message }
    : { connection: data as GithubConnection, error: null };
}

/** Retire la connexion — et la RLS n'autorise que la sienne. */
export async function disconnectGithub(id: string): Promise<{ error: string | null }> {
  const { error } = await api.from("github_connections").delete().eq("id", id);
  return { error: error?.message ?? null };
}

/* ── Les autres fournisseurs ─────────────────────────────────────── */

/**
 * Le catalogue des fournisseurs que l'écran sait présenter.
 *
 * On ne le déduit pas des lignes existantes : un fournisseur sans
 * connexion n'apparaîtrait alors jamais, et on ne pourrait jamais le
 * connecter — l'écran ne proposerait que ce qui est déjà fait. Le
 * catalogue est donc **la** liste, et une connexion dont le `provider`
 * n'y figure pas s'affiche quand même (avec son nom brut) plutôt que de
 * disparaître.
 */
export type ConnectionProviderId = "github" | "vscode" | "api";

export interface ConnectionProvider {
  id: ConnectionProviderId;
  label: string;
  hint: string;
  /** Ce qu'on demande comme identité (le champ `login`). */
  identityLabel: string;
  identityPlaceholder: string;
  /** Un `endpoint` est-il requis ? GitHub n'en a pas ; un tunnel, oui. */
  needsEndpoint: boolean;
  endpointLabel: string;
  endpointPlaceholder: string;
  /** Capacités demandées, telles qu'on les affiche. */
  scopes: string[];
  icon: string;
  /** Ce que le pont vers ce fournisseur fait, dit sans promettre. */
  effect: string;
}

export const CONNECTION_PROVIDERS: ConnectionProvider[] = [
  {
    id: "github",
    label: "GitHub",
    hint: "Copie le dépôt vers GitHub ; DevNet reste la source.",
    identityLabel: "Identifiant GitHub",
    identityPlaceholder: "koffi-devnet",
    needsEndpoint: false,
    endpointLabel: "",
    endpointPlaceholder: "",
    scopes: ["repo", "read:user"],
    icon: "branch",
    effect: "Jeton propre à votre compte, rangé au coffre.",
  },
  {
    id: "vscode",
    label: "Tunnel VS Code",
    hint: "Ouvrir ce dépôt dans un VS Code distant.",
    identityLabel: "Nom du tunnel",
    identityPlaceholder: "cooperative-dev",
    needsEndpoint: true,
    endpointLabel: "URL du tunnel",
    endpointPlaceholder: "https://cooperative-dev.devtunnels.ms",
    scopes: ["files", "terminal"],
    icon: "terminal",
    effect: "Le tunnel est joint depuis VS Code ; on n'en garde que l'adresse.",
  },
  {
    id: "api",
    label: "API / webhook",
    hint: "Prévenir un service quand le dépôt change.",
    identityLabel: "Nom du service",
    identityPlaceholder: "ci-maison",
    needsEndpoint: true,
    endpointLabel: "URL de base",
    endpointPlaceholder: "https://ci.exemple.dev",
    scopes: ["POST commit", "POST pull_request"],
    icon: "server",
    effect: "Le secret de signature vit au coffre, jamais ici.",
  },
];

/** La fiche d'un fournisseur, ou `null` s'il est inconnu. */
export function providerInfo(id: string): ConnectionProvider | null {
  return CONNECTION_PROVIDERS.find((p) => p.id === id) ?? null;
}

/**
 * Une adresse est-elle utilisable comme destination ?
 *
 * On exige `http(s)` : une destination sans schéma ne se joint pas, et
 * `javascript:` ou `data:` ne sont pas des services. Le refus vient ici,
 * avant l'écriture — une ligne pointant vers rien afficherait « connecté »
 * pour une destination qui n'existe pas.
 */
export function validEndpoint(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Toutes mes connexions, tous fournisseurs confondus.
 *
 * La RLS (004, `gh_self_read`) ne rend que les miennes : le filtre
 * `user_id` est une ceinture, pas la sécurité. Il rend aussi la requête
 * lisible — on voit d'un coup d'œil à qui appartient le résultat.
 */
export async function listConnections(me: string): Promise<GithubConnection[]> {
  if (!me) return [];

  const { data } = await api
    .from("github_connections")
    .select("*")
    .eq("user_id", me)
    .order("connected_at", { ascending: false });

  return (data as GithubConnection[] | null) ?? [];
}

/**
 * Connecter (ou mettre à jour) une destination.
 *
 * Même décision que `connectGithub` : on vérifie **avant** d'écrire, puis
 * on lit-puis-insère-ou-met-à-jour, parce que la contrainte d'unicité est
 * multi-colonnes et que l'`onConflict` du client ne la désigne pas
 * simplement.
 *
 * Le `token_ref` reprend le provider dans son chemin
 * (`vault://<provider>/<me>`) : le coffre range un jeton par fournisseur
 * et par personne, exactement comme la table.
 */
export async function connectProvider(input: {
  me: string;
  provider: ConnectionProviderId;
  login: string;
  endpoint?: string;
}): Promise<{ connection: GithubConnection | null; error: string | null }> {
  const info = providerInfo(input.provider);
  if (!info) return { connection: null, error: "Fournisseur inconnu" };

  const login = input.login.trim();
  if (!login) return { connection: null, error: `${info.identityLabel} requis` };

  const endpoint = (input.endpoint ?? "").trim();
  if (info.needsEndpoint && !validEndpoint(endpoint)) {
    return { connection: null, error: `${info.endpointLabel} invalide` };
  }

  const existing = await fetchConnectionOf(input.me, input.provider);

  if (existing) {
    const { data, error } = await api
      .from("github_connections")
      .update({ login })
      .eq("id", existing.id)
      .select()
      .single();

    return error
      ? { connection: null, error: error.message }
      : { connection: data as GithubConnection, error: null };
  }

  const { data, error } = await api
    .from("github_connections")
    .insert({
      user_id: input.me,
      provider: input.provider,
      login,
      endpoint,
      scopes: info.scopes,
      status: "active",
      // Jamais le jeton : le nom sous lequel il est rangé.
      token_ref: `vault://${input.provider}/${input.me}`,
    })
    .select()
    .single();

  return error
    ? { connection: null, error: error.message }
    : { connection: data as GithubConnection, error: null };
}

/** Une connexion donnée d'une personne, pour un fournisseur donné. */
export async function fetchConnectionOf(
  me: string,
  provider: string,
): Promise<GithubConnection | null> {
  if (!me) return null;

  const { data } = await api
    .from("github_connections")
    .select("*")
    .eq("user_id", me)
    .eq("provider", provider)
    .maybeSingle();

  return (data as GithubConnection) ?? null;
}

/** Déconnecter n'importe quel fournisseur — sa propre ligne (004). */
export async function disconnectConnection(id: string): Promise<{ error: string | null }> {
  const { error } = await api.from("github_connections").delete().eq("id", id);
  return { error: error?.message ?? null };
}

/**
 * Marque la connexion comme utilisée à l'instant.
 *
 * On ne peut « utiliser » une connexion qu'une fois qu'on l'a jointe, or
 * l'application ne parle à aucun service — c'est la décision « pas de route
 * handler ». Ce geste sert donc à **constater** un usage que l'appelant
 * connaît (un lien profond VS Code ouvert, un webhook déclenché à la
 * main) ; il ne prétend pas s'être connecté de lui-même.
 */
export async function touchConnection(id: string): Promise<{ error: string | null }> {
  const now = new Date().toISOString();
  const { error } = await api
    .from("github_connections")
    .update({ used_at: now, status: "active" })
    .eq("id", id);

  return { error: error?.message ?? null };
}

export async function fetchProjectLink(projectId: string): Promise<ProjectLink | null> {
  if (!projectId) return null;

  const { data } = await api
    .from("project_links")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();

  return (data as ProjectLink) ?? null;
}

/**
 * Lie un dépôt DevNet à un dépôt GitHub.
 *
 * L'URL est d'abord analysée par le moteur (`parseRepo`) — la même règle
 * que celle testée dans `lib/github/link.ts`, donc les deux modes
 * refusent exactement les mêmes entrées. Puis `canLink` vérifie la
 * contrainte structurelle : un projet en synchronisation bidirectionnelle
 * écrit dans GitHub, donc son dépôt doit être le sien.
 *
 * `ownedByViewer` est fourni par l'appelant (l'écran connaît le `login`
 * connecté). On ne le devine pas ici : deviner une propriété de dépôt
 * serait exactement la sorte d'inférence qui finit fausse.
 */
export async function linkProject(input: {
  projectId: string;
  me: string;
  url: string;
  mode: SyncMode;
  ownedByViewer: boolean;
  branch?: string;
}): Promise<{ link: ProjectLink | null; parsed: LinkResult; error: string | null }> {
  const parsed = parseRepo(input.url);
  if (!parsed.ok) return { link: null, parsed, error: null };

  const can = canLink(input.mode, parsed.ref, input.ownedByViewer);
  if (!can.ok) return { link: null, parsed: can, error: null };

  const branch = input.branch?.trim() || parsed.branch;

  const existing = await fetchProjectLink(input.projectId);

  if (existing) {
    const { data, error } = await api
      .from("project_links")
      .update({
        owner: parsed.ref.owner,
        repo: parsed.ref.repo,
        default_branch: branch,
        sync_mode: input.mode,
      })
      .eq("id", existing.id)
      .select()
      .single();

    return error
      ? { link: null, parsed: can, error: error.message }
      : { link: data as ProjectLink, parsed: can, error: null };
  }

  const { data, error } = await api
    .from("project_links")
    .insert({
      project_id: input.projectId,
      user_id: input.me,
      owner: parsed.ref.owner,
      repo: parsed.ref.repo,
      default_branch: branch,
      sync_mode: input.mode,
    })
    .select()
    .single();

  return error
    ? { link: null, parsed: can, error: error.message }
    : { link: data as ProjectLink, parsed: can, error: null };
}

export async function unlinkProject(linkId: string): Promise<{ error: string | null }> {
  const { error } = await api.from("project_links").delete().eq("id", linkId);
  return { error: error?.message ?? null };
}

/* ── Plan de synchronisation ─────────────────────────────────────── */

/**
 * Ce qu'une synchronisation ferait, calculé **sans le réseau**.
 *
 * On ne connaît pas le sha du dépôt distant : il demanderait un appel à
 * l'API GitHub. On le remplace par le **dernier sha enregistré comme
 * synchronisé** (`last_push_sha` ou `last_pull_sha`). C'est la seule
 * information locale qui ait un sens : si la tête locale a bougé depuis,
 * il y a des commits à envoyer ; sinon, rien.
 *
 * Conséquence assumée : ce plan ne peut pas voir un commit **distant**
 * que nous n'aurions pas. En mode bidirectionnel, il est donc optimiste.
 * On le dit dans l'interface au lieu de le cacher — un plan de
 * synchronisation qui promet plus qu'il ne sait est pire qu'une absence
 * de plan.
 */
export function localSyncPlan(link: ProjectLink, localSha: string): SyncPlan {
  // Le dernier état que le **distant** nous a montré : le dernier tir,
  // s'il y en a eu un, sinon la dernière poussée. Pour un compte
  // Bidirectionnel, confondre les deux (« poussé OU tiré ») comparerait
  // une branche de tir avec une branche d'envoi — le meilleur des deux
  // serait ignoré, et le plan annoncerait « à jour » quand il n'a pas
  // tout regardé.
  const remoteSha = link.last_pull_sha || link.last_push_sha || "";
  return planSync({
    mode: link.sync_mode,
    localSha,
    remoteSha,
    lastSyncedLocal: remoteSha || undefined,
  });
}

/** Le lien mérite-t-il d'être refait (jeton périmé, pas de synchro récente) ? */
export function linkStale(link: ProjectLink): boolean {
  return needsRelink(link.last_synced_at);
}

/**
 * Enregistre l'état synchronisé sans transférer.
 *
 * Le transfert réel dépend d'OAuth et du coffre, qui ne sont pas
 * branchés. Cette action écrit donc ce que **nous** savons : la tête
 * locale est désormais considérée comme synchronisée. Elle ne ment pas
 * tant que l'écran le dit — et il le dit.
 */
export async function markSynced(
  linkId: string,
  localSha: string,
): Promise<{ error: string | null; at: string }> {
  const at = new Date().toISOString();
  // « Synchronisé » veut dire « des deux côtés, à ce sha ». Enregistrer
  // seulement `last_push_sha` laissait `last_pull_sha` incomparé : un
  // plan de tir relirait un état antérieur que la synchronisation
  // venait pourtant de rejoindre.
  const { error } = await api
    .from("project_links")
    .update({ last_push_sha: localSha, last_pull_sha: localSha, last_synced_at: at })
    .eq("id", linkId);

  return { error: error?.message ?? null, at };
}

/** Le mode de synchronisation, tel qu'il s'affiche et se choisit. */
export const SYNC_MODES: { value: SyncMode; label: string; hint: string }[] = [
  {
    value: "manuel",
    label: "Manuel",
    hint: "Rien n'est automatique. Le défaut — vous poussez à la main.",
  },
  {
    value: "pull",
    label: "Live · tirer",
    hint: "DevNet récupère les nouveaux commits GitHub, à intervalle régulier.",
  },
  {
    value: "push",
    label: "Live · pousser",
    hint: "DevNet envoie ses commits. Le code devient public — votre dépôt seulement.",
  },
  {
    value: "bidirectionnel",
    label: "Live · bidirectionnel",
    hint: "Tirer et pousser. Refusé si les deux côtés ont divergé.",
  },
];

/**
 * Mémorise l'état observé d'une synchronisation live.
 *
 * On n'écrit que ce qu'on a réellement vu : `remote_sha` (sha de branche
 * GitHub) et `local_sha` (tête DevNet). Les colonnes `last_push_sha` et
 * `last_pull_sha` gardent leur ancien sens — elles servent au plan manuel
 * et au bouton « Enregistrer la synchro » — et ne sont donc pas touchées
 * ici : les confondre ferait comparer des sha de deux moteurs différents.
 */
export async function recordSync(
  linkId: string,
  input: { remoteSha: string; localSha: string },
): Promise<{ error: string | null }> {
  const { error } = await api
    .from("project_links")
    .update({
      remote_sha: input.remoteSha,
      local_sha: input.localSha,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", linkId);

  return { error: error?.message ?? null };
}

/** Change la cadence du polling. Bornée comme la contrainte de la base. */
export async function setSyncInterval(
  linkId: string,
  seconds: number,
): Promise<{ error: string | null }> {
  const clamped = Math.min(3600, Math.max(10, Math.round(seconds)));
  const { error } = await api
    .from("project_links")
    .update({ sync_interval_seconds: clamped })
    .eq("id", linkId);

  return { error: error?.message ?? null };
}

export type { RepoRef, SyncMode };
