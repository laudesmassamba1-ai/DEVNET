import { supabase } from "@/lib/supabase/client";
import { AUTHOR_COLUMNS } from "@/lib/social";
import { slugify, uniqueSlug } from "@/lib/groups/channels";
import type {
  Extension, ExtensionCategory, ExtensionCommand, ExtensionInstall,
  ExtensionManifest, ExtensionSnippet, ExtensionWithAuthor,
} from "@/lib/types";

/**
 * La place de marché des extensions (migration 029).
 *
 * Cette couche ne décide de **rien** : la RLS tranche ce qui est lisible et
 * modifiable ; ici on ne fait que le révéler à l'écran, pour qu'un bouton
 * n'apparaisse que là où il fonctionnera. Même frontière que `lib/communities.ts`.
 *
 * Une extension n'exécute **pas** de code : c'est un manifeste déclaratif.
 * La validation de forme ci-dessous est donc la seule barrière entre un
 * manifeste bancal et un éditeur qui plante — on la fait donc sérieusement,
 * et on ignore silencieusement ce qu'on ne sait pas lire plutôt que de tout
 * rejeter.
 */

const EXTENSION_COLUMNS =
  "id, slug, name, description, version, icon, category, manifest, owner_id, installs, created_at";

/** Libellés des catégories, pour les filtres et les puces. */
export const CATEGORY_LABELS: Record<ExtensionCategory, string> = {
  theme: "Thème",
  snippets: "Extraits",
  language: "Langage",
  tool: "Outil",
  ai: "IA",
  other: "Autre",
};

export const CATEGORY_ORDER: ExtensionCategory[] = [
  "snippets", "theme", "language", "tool", "ai", "other",
];

/**
 * Un manifeste, validé.
 *
 * On ne **jette** pas une extension dont une partie est illisible : on garde
 * ce qui est utilisable. Une extension qui n'aurait qu'un snippet bancal
 * reste installable pour ses commandes. C'est le contraire d'un validateur
 * strict, et c'est délibéré : sur une place de marché, une entrée
 * partiellement utile vaut mieux qu'une entrée invisible dont personne ne
 * sait pourquoi elle l'est.
 */
export function normalizeManifest(raw: unknown): ExtensionManifest {
  const out: ExtensionManifest = {};
  if (!raw || typeof raw !== "object") return out;
  const m = raw as Record<string, unknown>;

  if (Array.isArray(m.snippets)) {
    out.snippets = m.snippets
      // Un préfixe vide ne se tape pas, un corps vide n'insère rien : les
      // deux rendent l'extrait inutilisable, donc on les écarte plutôt que
      // de les proposer dans la complétion comme des entrées inertes.
      .filter((s): s is ExtensionSnippet =>
        !!s && typeof s === "object"
        && typeof (s as ExtensionSnippet).prefix === "string"
        && (s as ExtensionSnippet).prefix.trim() !== ""
        && typeof (s as ExtensionSnippet).body === "string"
        && (s as ExtensionSnippet).body.trim() !== "",
      )
      .map((s) => ({
        language: typeof s.language === "string" ? s.language : "*",
        prefix: s.prefix,
        body: s.body,
        description: typeof s.description === "string" ? s.description : undefined,
      }));
  }

  if (Array.isArray(m.commands)) {
    out.commands = m.commands
      .filter((c): c is { id: string; title: string; body?: unknown } =>
        !!c && typeof c === "object"
        && typeof (c as { id?: unknown }).id === "string"
        && (c as { id: string }).id.trim() !== ""
        && typeof (c as { title?: unknown }).title === "string"
        && (c as { title: string }).title.trim() !== "",
      )
      .map((c) => ({
        id: c.id,
        title: c.title,
        // Le corps est ce que la commande insère. Une commande qui n'en a
        // pas reste lisible — elle vient d'un manifeste antérieur — mais
        // `executableCommands` ne la proposera pas dans l'éditeur.
        body: typeof c.body === "string" ? c.body : undefined,
      }));
  }

  if (Array.isArray(m.settings)) {
    out.settings = m.settings
      .filter((s): s is { key: string; label: string; type: "string" | "boolean" | "number"; default: string | boolean | number } =>
        !!s && typeof s === "object"
        && typeof (s as { key?: unknown }).key === "string"
        && (s as { key: string }).key.trim() !== ""
        && typeof (s as { label?: unknown }).label === "string"
        && (s as { label: string }).label.trim() !== ""
        && ["string", "boolean", "number"].includes(String((s as { type?: unknown }).type)),
      )
      .map((s) => ({ key: s.key, label: s.label, type: s.type, default: s.default }));
  }

  return out;
}

/** Le manifeste d'une ligne brute, validé. */
function withManifest(row: Extension): Extension {
  return { ...row, manifest: normalizeManifest(row.manifest) };
}

/** Toutes les extensions de la place de marché, les plus installées d'abord. */
export async function fetchExtensions(): Promise<ExtensionWithAuthor[]> {
  const { data } = await supabase
    .from("extensions")
    .select(`*, author:users!extensions_owner_id_fkey(${AUTHOR_COLUMNS})`)
    .order("installs", { ascending: false })
    .order("created_at", { ascending: false });

  return ((data as ExtensionWithAuthor[] | null) ?? []).map((e) => ({
    ...e,
    manifest: normalizeManifest(e.manifest),
  }));
}

/** Une extension par son adresse publique. */
export async function fetchExtensionBySlug(
  slug: string,
): Promise<ExtensionWithAuthor | null> {
  const { data } = await supabase
    .from("extensions")
    .select(`*, author:users!extensions_owner_id_fkey(${AUTHOR_COLUMNS})`)
    .eq("slug", slug)
    .maybeSingle();

  const row = data as ExtensionWithAuthor | null;
  return row ? { ...row, manifest: normalizeManifest(row.manifest) } : null;
}

/**
 * Mes installations, indexées par `extension_id`.
 *
 * La RLS ne renvoie que **mes** lignes (029, `extension_installs_read`) — le
 * filtre `user_id` est donc une ceinture, pas la sécurité. Il rend en plus la
 * requête lisible : on voit d'un coup d'œil à qui appartient le résultat.
 */
export async function fetchMyInstalls(
  userId: string,
): Promise<Map<string, ExtensionInstall>> {
  const { data } = await supabase
    .from("extension_installs")
    .select("extension_id, user_id, enabled, settings, installed_at")
    .eq("user_id", userId);

  const rows = (data as ExtensionInstall[] | null) ?? [];
  return new Map(rows.map((r) => [r.extension_id, r]));
}

/**
 * Les commandes qui **font** quelque chose : celles qui portent un corps.
 *
 * Le manifeste accepte une commande sans corps pour ne pas invisibiliser
 * un vieux manifeste auquel il manque ce champ ; l'éditeur, lui, ne
 * propose que ce qui produit un effet. Une entrée de palette qui ne fait
 * rien est un clic perdu — le défaut exact qu'on corrige ici.
 */
export function executableCommands(
  commands: ExtensionCommand[] | undefined,
): ExtensionCommand[] {
  return (commands ?? []).filter(
    (c) => typeof c.body === "string" && c.body.trim() !== "",
  );
}

/** Ce qu'une extension active apporte à l'IDE, en une seule lecture. */
export interface ActiveContributions {
  snippets: ExtensionSnippet[];
  commands: ExtensionCommand[];
}

/**
 * Les contributions des extensions **activées** par l'utilisateur, à plat.
 *
 * C'est ce que l'IDE charge dans Monaco : on ne veut pas de la liste des
 * extensions mais les deux flux qu'elles alimentent — les gabarits de
 * complétion et les commandes de la palette. Une extension désactivée ne
 * contribue rien, même si elle reste installée.
 *
 * Une seule lecture pour les deux : deux appels séparés referaient deux
 * fois la même cascade installations → extensions, et pourraient lire deux
 * états différents si l'on désinstalle entre les deux.
 */
export async function fetchActiveContributions(
  userId: string,
): Promise<ActiveContributions> {
  const installs = await fetchMyInstalls(userId);
  const active = new Set(
    [...installs.values()].filter((i) => i.enabled).map((i) => i.extension_id),
  );
  if (active.size === 0) return { snippets: [], commands: [] };

  const chosen = (await fetchExtensions()).filter((e) => active.has(e.id));
  return {
    snippets: chosen.flatMap((e) => e.manifest.snippets ?? []),
    commands: executableCommands(chosen.flatMap((e) => e.manifest.commands ?? [])),
  };
}

/**
 * Publier une extension.
 *
 * Le slug se dérive du nom puis se rend unique contre les slugs existants :
 * c'est l'adresse d'installation, elle ne doit pas collisionner. Le
 * manifeste est normalisé **avant** l'envoi, pour ne pas stocker une forme
 * qu'on ne saurait pas relire.
 */
export async function createExtension(
  input: {
    name: string;
    description: string;
    version: string;
    icon: string;
    category: ExtensionCategory;
    manifest: ExtensionManifest;
  },
  ownerId: string,
): Promise<{ extension: Extension | null; error: string | null }> {
  const taken = await fetchExtensions();
  const slug = uniqueSlug(slugify(input.name), taken.map((e) => e.slug));

  const { data, error } = await supabase
    .from("extensions")
    .insert({
      slug,
      name: input.name.trim(),
      description: input.description.trim(),
      version: input.version.trim() || "0.0.1",
      icon: input.icon,
      category: input.category,
      manifest: normalizeManifest(input.manifest),
      owner_id: ownerId,
    })
    .select(EXTENSION_COLUMNS)
    .single();

  if (error) return { extension: null, error: error.message };
  return { extension: withManifest(data as Extension), error: null };
}

/** Mettre à jour une extension dont on est l'auteur. */
export async function updateExtension(
  id: string,
  patch: Partial<Pick<Extension, "name" | "description" | "version" | "icon" | "category">>
    & { manifest?: ExtensionManifest },
): Promise<{ error: string | null }> {
  const body = { ...patch };
  if (patch.manifest) body.manifest = normalizeManifest(patch.manifest);

  const { error } = await supabase.from("extensions").update(body).eq("id", id);
  return { error: error?.message ?? null };
}

/** Supprimer une extension — l'auteur seul (`029`). */
export async function deleteExtension(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("extensions").delete().eq("id", id);
  return { error: error?.message ?? null };
}

/**
 * Installer une extension — la ligne est **la sienne** et `enabled` part à
 * vrai : on installe pour s'en servir, pas pour la collectionner.
 */
export async function installExtension(
  extensionId: string,
  userId: string,
  settings: Record<string, string | boolean | number> = {},
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("extension_installs")
    .insert({ extension_id: extensionId, user_id: userId, enabled: true, settings });

  return { error: error?.message ?? null };
}

/** Désinstaller — sa propre ligne. */
export async function uninstallExtension(
  extensionId: string,
  userId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("extension_installs")
    .delete()
    .eq("extension_id", extensionId)
    .eq("user_id", userId);

  return { error: error?.message ?? null };
}

/** Activer / désactiver sans désinstaller — le geste de VSCode. */
export async function setExtensionEnabled(
  extensionId: string,
  userId: string,
  enabled: boolean,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("extension_installs")
    .update({ enabled })
    .eq("extension_id", extensionId)
    .eq("user_id", userId);

  return { error: error?.message ?? null };
}

/** Enregistrer les réglages d'une installation. */
export async function setExtensionSettings(
  extensionId: string,
  userId: string,
  settings: Record<string, string | boolean | number>,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("extension_installs")
    .update({ settings })
    .eq("extension_id", extensionId)
    .eq("user_id", userId);

  return { error: error?.message ?? null };
}

/** Le nombre d'extensions actives — pour la pastille de l'onglet IDE. */
export function activeCount(installs: Map<string, ExtensionInstall>): number {
  return [...installs.values()].filter((i) => i.enabled).length;
}

/** Construit le slug unique d'un nom d'extension, contre les slugs pris. */
export function extensionSlug(name: string, taken: string[]): string {
  return uniqueSlug(slugify(name), taken);
}
