/**
 * Tests du socle d'extensibilité (Phase 2).
 *
 * Exécuter avec :  npx tsx scripts/test-plugins.ts
 *
 * Ce qui est verrouillé ici :
 *  - le manifeste est strict (capacité inventée, cycle, hôte réseau) ;
 *  - le registre généré est à jour et n'importe qu'à la compilation ;
 *  - l'activation vient de l'état, pas du déploiement ;
 *  - une capacité non accordée n'est jamais distribuée ;
 *  - un plugin défaillant ne fait pas tomber le cœur.
 */
import { readFileSync } from "node:fs";
import {
  definePlugin,
  isCompatible,
  validateManifest,
  type PluginDefinition,
  type PluginLogger,
  type PluginManifest,
} from "../shared/plugin-sdk";
import {
  createPluginRuntime,
  MemoryPluginStateRepository,
  PluginRuntimeError,
  type PluginState,
  type RegisteredPlugin,
} from "../platform/plugin-runtime";
import { REGISTERED_PLUGINS } from "../platform/registry.generated";
import { buildRegistry, renderRegistry, validateGraph } from "./plugins-gen";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, { actual, expected });
}

const silentLogger: PluginLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function baseManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "test-plugin",
    name: "Test",
    version: "1.0.0",
    devnetApi: "^1.0.0",
    level: 2,
    requires: [],
    conflicts: [],
    capabilities: [],
    network: { outbound: [] },
    entry: { server: "server.ts" },
    i18n: ["fr"],
    dataCategories: [],
    ...overrides,
  };
}

function state(overrides: Partial<PluginState> = {}): PluginState {
  return {
    pluginId: "test-plugin",
    enabled: true,
    version: "1.0.0",
    grantedCapabilities: [],
    settings: {},
    health: "ok",
    errorCount: 0,
    ...overrides,
  };
}

function registered(
  manifest: PluginManifest,
  definition: PluginDefinition = definePlugin(() => undefined),
): RegisteredPlugin {
  return { manifest, definition };
}

function verifyManifest(): void {
  const valid = validateManifest({
    id: "github-stars-badge",
    name: "Badge étoiles GitHub",
    version: "1.0.0",
    devnetApi: "^1.0.0",
    level: 2,
    requires: ["profiles"],
    conflicts: [],
    capabilities: [
      "events:subscribe:proof.verified@1",
      "ui:slot:profile.header.badge",
      "store:kv",
      "api:route:github/stars",
      "jobs:task:sync",
    ],
    network: { outbound: ["api.github.com"] },
    entry: { server: "server.ts", client: "client.tsx" },
    i18n: ["fr", "en"],
    dataCategories: ["profil public"],
  });
  check("manifeste : un manifeste complet est accepté", valid.ok);
  if (valid.ok) {
    eq("manifeste : les capacités sont conservées", valid.manifest.capabilities.length, 5);
    eq("manifeste : l'hôte sortant est conservé", valid.manifest.network.outbound[0], "api.github.com");
  }

  const invalid = (raw: unknown): boolean => !validateManifest(raw).ok;

  check(
    "manifeste : identifiant en majuscules refusé",
    invalid({ ...baseManifest(), id: "Bad-Id" }),
  );
  check(
    "manifeste : version non SemVer refusée",
    invalid({ ...baseManifest(), version: "1.0" }),
  );
  check(
    "manifeste : plage d'API inconnue refusée",
    invalid({ ...baseManifest(), devnetApi: "latest" }),
  );
  check(
    "manifeste : niveau 4 refusé (hors SDK)",
    invalid({ ...baseManifest(), level: 4 }),
  );
  check(
    "manifeste : capacité inventée refusée",
    invalid({ ...baseManifest(), capabilities: ["root:everything"] }),
  );
  check(
    "manifeste : emplacement inconnu refusé",
    invalid({ ...baseManifest(), capabilities: ["ui:slot:profile.avatar"] }),
  );
  check(
    "manifeste : événement inconnu refusé",
    invalid({ ...baseManifest(), capabilities: ["events:subscribe:post.hacked@1"] }),
  );
  check(
    "manifeste : hôte avec protocole refusé",
    invalid({ ...baseManifest(), network: { outbound: ["https://api.github.com"] } }),
  );
  check(
    "manifeste : champ inconnu refusé",
    invalid({ ...baseManifest(), superpowers: true }),
  );
  check(
    "manifeste : auto-dépendance refusée",
    invalid({ ...baseManifest(), requires: ["test-plugin"] }),
  );
  check(
    "manifeste : capacité dupliquée refusée",
    invalid({ ...baseManifest(), capabilities: ["store:kv", "store:kv"] }),
  );
  check(
    "manifeste : entrée serveur absente refusée",
    invalid({ ...baseManifest(), entry: {} }),
  );
  check(
    "manifeste : chemin d'entrée avec .. refusé",
    invalid({ ...baseManifest(), entry: { server: "../server.ts" } }),
  );
}

function verifySemver(): void {
  check("compatibilité : ^1.0.0 accepte 1.0.0", isCompatible("^1.0.0", "1.0.0"));
  check("compatibilité : ^1.0.0 accepte 1.9.9", isCompatible("^1.0.0", "1.9.9"));
  check("compatibilité : ^1.0.0 refuse 2.0.0", !isCompatible("^1.0.0", "2.0.0"));
  check("compatibilité : ~1.2.0 accepte 1.2.9", isCompatible("~1.2.0", "1.2.9"));
  check("compatibilité : ~1.2.0 refuse 1.3.0", !isCompatible("~1.2.0", "1.3.0"));
  check("compatibilité : exacte accepte la même version", isCompatible("1.2.3", "1.2.3"));
  check("compatibilité : exacte refuse une autre version", !isCompatible("1.2.3", "1.2.4"));
  check("compatibilité : ^0.2.3 refuse 0.3.0", !isCompatible("^0.2.3", "0.3.0"));
  check("compatibilité : ^0.0.3 refuse 0.0.4", !isCompatible("^0.0.3", "0.0.4"));
  check("compatibilité : * accepte tout", isCompatible("*", "9.9.9"));
  check("compatibilité : plage invalide refusée", !isCompatible(">=1.0.0", "1.0.0"));
}

function verifyRegistry(): void {
  const built = buildRegistry();
  check("registre : les manifestes se construisent", built.ok);
  if (!built.ok) return;

  eq("registre : un plugin de référence", built.entries.length, 1);
  eq("registre : identifiant du plugin", built.entries[0].manifest.id, "hello-devnet");
  eq(
    "registre : import statique sans extension",
    built.entries[0].importPath,
    "@/plugins/hello-devnet/server",
  );
  check(
    "registre : le fichier généré est à jour",
    readFileSync("platform/registry.generated.ts", "utf8") === renderRegistry(built.entries),
  );
  eq(
    "registre : le runtime importe le même plugin",
    REGISTERED_PLUGINS[0]?.manifest.id,
    "hello-devnet",
  );

  const cycle = validateGraph([
    baseManifest({ id: "a", requires: ["b"] }),
    baseManifest({ id: "b", requires: ["a"] }),
  ]);
  check(
    "graphe : un cycle est détecté",
    cycle.some((issue) => issue.includes("cycle")),
    cycle,
  );

  const missing = validateGraph([baseManifest({ id: "a", requires: ["absent"] })]);
  check(
    "graphe : une dépendance absente est détectée",
    missing.some((issue) => issue.includes("absent")),
    missing,
  );

  const core = validateGraph([baseManifest({ id: "a", requires: ["profiles"] })]);
  eq("graphe : un module du cœur est une dépendance valide", core.length, 0);
}

async function verifyRuntime(): Promise<void> {
  const definition = definePlugin((api) => {
    api.onEvent("post.created@1", () => undefined);
  });
  const manifest = baseManifest({
    capabilities: ["events:subscribe:post.created@1"],
  });
  const registry = [registered(manifest, definition)];

  const disabledRepo = new MemoryPluginStateRepository([
    state({ enabled: false }),
  ]);
  const disabled = createPluginRuntime({
    registry,
    repository: disabledRepo,
    logger: silentLogger,
  });
  const disabledSnapshot = await disabled.load();
  eq("runtime : un plugin désactivé n'est pas actif", disabledSnapshot.active.length, 0);
  eq("runtime : la raison est « disabled »", disabledSnapshot.inactive[0].reason, "disabled");

  const enabledRepo = new MemoryPluginStateRepository([
    state({ grantedCapabilities: ["events:subscribe:post.created@1"] }),
  ]);
  const enabled = createPluginRuntime({
    registry,
    repository: enabledRepo,
    logger: silentLogger,
  });
  const enabledSnapshot = await enabled.load();
  eq("runtime : un plugin activé est actif", enabledSnapshot.active.length, 1);
  eq(
    "runtime : l'abonnement accordé est distribué",
    enabled.handlersFor("post.created@1", enabledSnapshot).length,
    1,
  );

  const ungrantedRepo = new MemoryPluginStateRepository([state()]);
  const ungranted = createPluginRuntime({
    registry,
    repository: ungrantedRepo,
    logger: silentLogger,
  });
  const ungrantedSnapshot = await ungranted.load();
  eq(
    "runtime : une capacité non accordée n'est pas distribuée",
    ungranted.handlersFor("post.created@1", ungrantedSnapshot).length,
    0,
  );

  const incompatible = createPluginRuntime({
    registry,
    repository: enabledRepo,
    apiVersion: "2.0.0",
    logger: silentLogger,
  });
  const incompatibleSnapshot = await incompatible.load();
  eq(
    "runtime : une API incompatible est refusée",
    incompatibleSnapshot.inactive[0]?.reason,
    "incompatible-api",
  );

  const globalOff = createPluginRuntime({
    registry,
    repository: enabledRepo,
    globalDisabled: true,
    logger: silentLogger,
  });
  const globalSnapshot = await globalOff.load();
  eq("runtime : l'interrupteur global coupe tout", globalSnapshot.active.length, 0);
  eq(
    "runtime : la raison est « global-disabled »",
    globalSnapshot.inactive[0]?.reason,
    "global-disabled",
  );

  const needs = createPluginRuntime({
    registry: [
      registered(baseManifest({ id: "child", requires: ["parent"] })),
      registered(baseManifest({ id: "parent" })),
    ],
    repository: new MemoryPluginStateRepository([
      state({ pluginId: "child" }),
      state({ pluginId: "parent", enabled: false }),
    ]),
    logger: silentLogger,
  });
  const needsSnapshot = await needs.load();
  eq("runtime : une dépendance désactivée bloque", needsSnapshot.active.length, 0);
  eq(
    "runtime : la raison est « requires-disabled »",
    needsSnapshot.inactive.find((entry) => entry.id === "child")?.reason,
    "requires-disabled",
  );

  const conflict = createPluginRuntime({
    registry: [
      registered(baseManifest({ id: "a", conflicts: ["b"] })),
      registered(baseManifest({ id: "b" })),
    ],
    repository: new MemoryPluginStateRepository([
      state({ pluginId: "a" }),
      state({ pluginId: "b" }),
    ]),
    logger: silentLogger,
  });
  const conflictSnapshot = await conflict.load();
  eq(
    "runtime : un conflit retire le plugin",
    conflictSnapshot.active.some((plugin) => plugin.id === "a"),
    false,
  );

  const invalid = createPluginRuntime({
    registry: [
      registered({ ...baseManifest(), id: "Bad" } as PluginManifest),
    ],
    repository: new MemoryPluginStateRepository([state({ pluginId: "Bad" })]),
    logger: silentLogger,
  });
  const invalidSnapshot = await invalid.load();
  eq(
    "runtime : un manifeste invalide n'est pas chargé",
    invalidSnapshot.inactive[0]?.reason,
    "invalid-manifest",
  );

  let activations = 0;
  let deactivations = 0;
  const lifecycle = definePlugin((api) => {
    api.onActivate(() => {
      activations += 1;
    });
    api.onDeactivate(() => {
      deactivations += 1;
    });
  });
  const lifecycleRepo = new MemoryPluginStateRepository();
  const runtime = createPluginRuntime({
    registry: [registered(baseManifest(), lifecycle)],
    repository: lifecycleRepo,
    logger: silentLogger,
  });

  await runtime.setEnabled("test-plugin", true);
  eq("cycle de vie : l'activation déclenche le hook", activations, 1);
  eq("cycle de vie : l'état est persisté", (await lifecycleRepo.get("test-plugin"))?.enabled, true);

  await runtime.setEnabled("test-plugin", false);
  eq("cycle de vie : la désactivation déclenche le hook", deactivations, 1);
  eq("cycle de vie : l'état est persisté", (await lifecycleRepo.get("test-plugin"))?.enabled, false);

  let unknownRejected = false;
  try {
    await runtime.setEnabled("inconnu", true);
  } catch (error) {
    unknownRejected = error instanceof PluginRuntimeError && error.code === "unknown-plugin";
  }
  check("cycle de vie : un plugin inconnu est refusé", unknownRejected);

  let incompatibleRejected = false;
  try {
    await createPluginRuntime({
      registry: [registered(baseManifest())],
      repository: lifecycleRepo,
      apiVersion: "2.0.0",
      logger: silentLogger,
    }).setEnabled("test-plugin", true);
  } catch (error) {
    incompatibleRejected =
      error instanceof PluginRuntimeError && error.code === "incompatible-api";
  }
  check("cycle de vie : une API incompatible est refusée à l'activation", incompatibleRejected);

  const throwingRepo = new MemoryPluginStateRepository();
  const throwing = definePlugin((api) => {
    api.onActivate(() => {
      throw new Error("boum");
    });
  });
  const resilient = createPluginRuntime({
    registry: [registered(baseManifest(), throwing)],
    repository: throwingRepo,
    logger: silentLogger,
  });
  await resilient.setEnabled("test-plugin", true);
  const degraded = await throwingRepo.get("test-plugin");
  eq("résilience : un hook en échec ne remonte pas", degraded?.enabled, true);
  eq("résilience : l'échec est compté", degraded?.errorCount, 1);
  eq("résilience : la santé est dégradée", degraded?.health, "degraded");
}

async function main(): Promise<void> {
  verifyManifest();
  verifySemver();
  verifyRegistry();
  await verifyRuntime();

  if (failures.length > 0) {
    console.error("\n✗ Extensibilité :");
    for (const failure of failures) console.error(`  · ${failure}`);
    console.error(`\n${passed} vérifications passées, ${failures.length} en échec.\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`✓ Extensibilité — ${passed} vérifications.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
