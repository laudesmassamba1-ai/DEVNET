/**
 * Tests des extensions — la place de marché (migration 029).
 *
 * Exécuter avec :  npx tsx scripts/test-extensions.ts
 *
 * Deux familles d'invariants :
 *  - le manifeste n'est **pas** du code exécuté : sa validation doit garder
 *    ce qui est utilisable et ignorer le reste, sans jamais jeter toute
 *    l'extension ;
 *  - la RLS de la 029 doit se comporter comme la base : place de marché
 *    publique, installations privées, compteur dérivé, cascade à la
 *    suppression. Une divergence ici ferait enseigner le contraire du
 *    produit par la démo.
 */

import {
  CATEGORY_LABELS, CATEGORY_ORDER, activeCount, extensionSlug,
  normalizeManifest,
} from "../lib/extensions";
import { demoFrom } from "../lib/demo/query";
import { getStore, resetStore } from "../lib/demo/store";
import { saveSessionId } from "../lib/demo/session";
import type { ExtensionInstall } from "../lib/types";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, { actual, expected });
}

interface Rowish { [k: string]: unknown }

async function main(): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* 1. La validation du manifeste                                     */
  /* ---------------------------------------------------------------- */

  check("manifeste : une valeur nulle ne lève pas", Object.keys(normalizeManifest(null)).length === 0);
  check("manifeste : un objet vide reste vide", Object.keys(normalizeManifest({})).length === 0);
  check("manifeste : une chaîne ne lève pas", Object.keys(normalizeManifest("oops")).length === 0);

  // Un extrait sans préfixe ou sans corps est ignoré, pas propagé.
  const mixed = normalizeManifest({
    snippets: [
      { language: "python", prefix: "def", body: "def ${1}:\n  pass" },
      { prefix: "", body: "sans préfixe" },
      { prefix: "orphelin", body: "" },
      { prefix: "nolang", body: "x" },
      "pas un objet",
    ],
  });
  eq("extraits : seuls les complets survivent", mixed.snippets?.length, 2);
  eq("extraits : un langage absent devient « tous »", mixed.snippets?.[1].language, "*");
  eq("extraits : le préfixe est conservé", mixed.snippets?.[0].prefix, "def");

  const commands = normalizeManifest({
    commands: [{ id: "a", title: "A" }, { id: "b" }, { title: "sans id" }],
  });
  eq("commandes : id et titre requis", commands.commands?.length, 1);

  const settings = normalizeManifest({
    settings: [
      { key: "k", label: "K", type: "string", default: "v" },
      { key: "n", label: "N", type: "number", default: 3 },
      { key: "b", label: "B", type: "boolean", default: true },
      { key: "z", label: "Z", type: "couleur", default: "#fff" },
      { key: "noLabel", type: "string", default: "x" },
    ],
  });
  eq("réglages : seuls les types connus passent", settings.settings?.length, 3);
  eq("réglages : le type est préservé", settings.settings?.[1].type, "number");

  // Une section invalide n'emporte pas les autres.
  const partial = normalizeManifest({ snippets: "pas un tableau", commands: [{ id: "x", title: "X" }] });
  eq("manifeste : une section invalide n'emporte pas les autres", partial.commands?.length, 1);
  check("manifeste : la section invalide reste absente", partial.snippets === undefined);

  /* ---------------------------------------------------------------- */
  /* 2. Les aides pures                                                */
  /* ---------------------------------------------------------------- */

  eq("catégories : chaque catégorie a un libellé", CATEGORY_ORDER.every((c) => !!CATEGORY_LABELS[c]), true);
  eq("catégories : l'ordre couvre les six catégories", CATEGORY_ORDER.length, 6);

  eq(
    "slug : dérivé du nom et rendu unique",
    extensionSlug("Extraits Rust", ["extraits-rust"]),
    "extraits-rust-2",
  );
  eq(
    "slug : libre quand il ne collisionne pas",
    extensionSlug("Thème Nuit", []),
    "theme-nuit",
  );

  const installs = new Map<string, ExtensionInstall>([
    ["a", { extension_id: "a", user_id: "u", enabled: true, settings: {}, installed_at: "" }],
    ["b", { extension_id: "b", user_id: "u", enabled: false, settings: {}, installed_at: "" }],
    ["c", { extension_id: "c", user_id: "u", enabled: true, settings: {}, installed_at: "" }],
  ]);
  eq("activeCount : ne compte que les activées", activeCount(installs), 2);
  eq("activeCount : zéro sur un ensemble vide", activeCount(new Map()), 0);

  /* ---------------------------------------------------------------- */
  /* 3. La place de marché est publique, les installations privées     */
  /* ---------------------------------------------------------------- */

  resetStore();
  saveSessionId(null);

  const market = await demoFrom("extensions").select("id, slug, installs, category");
  eq("la place de marché est lisible hors session", (market.data as Rowish[]).length, 5);

  const hidden = await demoFrom("extension_installs").select("extension_id");
  eq("les installations sont invisibles hors session", (hidden.data as Rowish[]).length, 0);

  const anonInstall = await demoFrom("extension_installs").insert({
    extension_id: "e-2", user_id: "u-koffi", enabled: true, settings: {},
  });
  check("on n'installe pas sans session", anonInstall.error !== null);

  /* ---------------------------------------------------------------- */
  /* 4. Installer, activer, désinstaller                               */
  /* ---------------------------------------------------------------- */

  saveSessionId("u-koffi");

  const mine = await demoFrom("extension_installs").select("extension_id").eq("user_id", "u-koffi");
  eq("Koffi démarre avec deux installations", (mine.data as Rowish[]).length, 2);

  const spoof = await demoFrom("extension_installs").insert({
    extension_id: "e-2", user_id: "u-zainab", enabled: true, settings: {},
  });
  check("on n'installe pas une extension pour autrui", spoof.error !== null);

  const before = getStore().extensions.find((e) => e.id === "e-2")!.installs as number;
  const ok = await demoFrom("extension_installs").insert({
    extension_id: "e-2", user_id: "u-koffi", enabled: true, settings: {},
  });
  check("on installe pour soi", ok.error === null);
  eq("le compteur d'installations est recalculé", getStore().extensions.find((e) => e.id === "e-2")!.installs, before + 1);

  const dup = await demoFrom("extension_installs").insert({
    extension_id: "e-2", user_id: "u-koffi", enabled: true, settings: {},
  });
  check("on n'installe pas deux fois", !!dup.error && /duplicate|unique/i.test(dup.error.message));

  const off = await demoFrom("extension_installs")
    .update({ enabled: false })
    .eq("extension_id", "e-2").eq("user_id", "u-koffi").select("enabled");
  eq("on désactive sa propre installation", (off.data as Rowish[])[0]?.enabled, false);

  const badStamp = await demoFrom("extension_installs")
    .update({ installed_at: "2020-01-01T00:00:00Z" })
    .eq("extension_id", "e-2").eq("user_id", "u-koffi");
  check("la date d'installation ne se réécrit pas", badStamp.error !== null);

  // L'`update` d'une ligne qui n'est pas la sienne est **silencieusement**
  // ignoré, comme la RLS le fait : aucune ligne touchée, pas d'erreur.
  const intrude = await demoFrom("extension_installs")
    .update({ enabled: true })
    .eq("extension_id", "e-2").eq("user_id", "u-zainab").select("enabled");
  eq("on ne modifie pas l'installation d'autrui", (intrude.data as Rowish[]).length, 0);

  saveSessionId("u-zainab");
  const zainabRow = await demoFrom("extension_installs")
    .select("enabled").eq("extension_id", "e-2").eq("user_id", "u-zainab");
  eq("l'installation d'autrui est restée intacte", (zainabRow.data as Rowish[])[0]?.enabled, true);

  saveSessionId("u-koffi");
  const beforeUn = getStore().extensions.find((e) => e.id === "e-2")!.installs as number;
  await demoFrom("extension_installs").delete().eq("extension_id", "e-2").eq("user_id", "u-koffi");
  eq("désinstaller décrémente le compteur", getStore().extensions.find((e) => e.id === "e-2")!.installs, beforeUn - 1);

  const notMineDel = await demoFrom("extension_installs")
    .delete().eq("extension_id", "e-2").eq("user_id", "u-zainab").select("user_id");
  eq("on ne désinstalle pas pour autrui", (notMineDel.data as Rowish[]).length, 0);

  /* ---------------------------------------------------------------- */
  /* 5. Publier, régler, retirer une extension                         */
  /* ---------------------------------------------------------------- */

  const pushed = await demoFrom("extensions").insert({
    slug: "mon-ext-a-moi", name: "Mon extension", owner_id: "u-koffi",
    category: "tool", manifest: { commands: [{ id: "x", title: "Faire" }] },
  }).select("id");
  check("on publie une extension à son nom", pushed.error === null);
  const extId = (pushed.data as Rowish[])[0]?.id as string;

  const stolen = await demoFrom("extensions").insert({
    slug: "au-nom-dun-autre", name: "Volée", owner_id: "u-zainab", category: "tool", manifest: {},
  });
  check("on ne publie pas une extension au nom d'un autre", stolen.error !== null);

  const badCat = await demoFrom("extensions").insert({
    slug: "categorie-inconnue", name: "X", owner_id: "u-koffi", category: "nope", manifest: {},
  });
  check("une catégorie inconnue est refusée", badCat.error !== null);

  const badInstalls = await demoFrom("extensions").update({ installs: 999 }).eq("slug", "mon-ext-a-moi");
  check("le compteur d'installations ne se réécrit pas", badInstalls.error !== null);

  const badSlug = await demoFrom("extensions").update({ slug: "autre" }).eq("slug", "mon-ext-a-moi");
  check("le slug ne se réécrit pas", badSlug.error !== null);

  const edit = await demoFrom("extensions")
    .update({ description: "mise à jour" }).eq("slug", "mon-ext-a-moi").select("description");
  eq("l'auteur règle sa propre extension", (edit.data as Rowish[])[0]?.description, "mise à jour");

  saveSessionId("u-zainab");
  const foreignEdit = await demoFrom("extensions")
    .update({ description: "piraté" }).eq("slug", "mon-ext-a-moi").select("description");
  eq("on ne modifie pas l'extension d'autrui", (foreignEdit.data as Rowish[]).length, 0);

  const foreignDelete = await demoFrom("extensions")
    .delete().eq("slug", "mon-ext-a-moi").select("slug");
  eq("on ne supprime pas l'extension d'autrui", (foreignDelete.data as Rowish[]).length, 0);

  // Cascade : l'auteur retire son extension, ses installations disparaissent.
  saveSessionId("u-koffi");
  await demoFrom("extension_installs").insert({ extension_id: extId, user_id: "u-koffi", enabled: true, settings: {} });
  eq("l'extension publiée est installée", getStore().extension_installs.filter((i) => i.extension_id === extId).length, 1);
  await demoFrom("extensions").delete().eq("id", extId);
  eq("supprimer une extension emporte ses installations", getStore().extension_installs.filter((i) => i.extension_id === extId).length, 0);
}

main()
  .then(() => {
    console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
    if (failures.length) {
      for (const f of failures) console.log(`  ✗ ${f}`);
      process.exit(1);
    }
    console.log("  ✓ Les extensions se valident et la RLS de la 029 est respectée\n");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
