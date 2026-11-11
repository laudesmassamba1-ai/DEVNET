/**
 * Runtime des plugins : chargement, compatibilité, dépendances et capacités.
 *
 * Il ne fait **aucune** E/S lui-même : l'état vient d'un port, le registre est
 * généré à la compilation. Une panne d'un plugin (hook qui lève) est isolée et
 * comptée ; elle ne remonte jamais comme une panne du cœur.
 */
import {
  CORE_MODULES,
  DEVNET_API_VERSION,
  isCompatible,
  validateManifest,
  type EventKey,
  type PluginContext,
  type PluginDefinition,
  type PluginEventHandler,
  type PluginLogger,
  type PluginManifest,
} from "@devnet/plugin-sdk";
import { grantedCapabilities } from "./permissions";
import type { PluginState, PluginStateRepository } from "./state";

export interface RegisteredPlugin {
  readonly manifest: PluginManifest;
  readonly definition: PluginDefinition;
}

export interface ActivePlugin {
  readonly id: string;
  readonly manifest: PluginManifest;
  readonly definition: PluginDefinition;
  readonly state: PluginState;
  readonly grantedCapabilities: readonly string[];
}

export type InactiveReason =
  | "disabled"
  | "invalid-manifest"
  | "incompatible-api"
  | "requires-missing"
  | "requires-disabled"
  | "conflict"
  | "global-disabled";

export interface InactivePlugin {
  readonly id: string;
  readonly reason: InactiveReason;
  readonly detail?: string;
}

export interface RuntimeSnapshot {
  readonly active: readonly ActivePlugin[];
  readonly inactive: readonly InactivePlugin[];
}

export interface PluginEventHandlerEntry {
  readonly pluginId: string;
  readonly event: EventKey;
  readonly handler: PluginEventHandler;
}

export interface PluginRuntimeOptions {
  readonly registry: readonly RegisteredPlugin[];
  readonly repository: PluginStateRepository;
  readonly apiVersion?: string;
  readonly globalDisabled?: boolean;
  readonly logger?: PluginLogger;
}

export class PluginRuntimeError extends Error {
  constructor(
    readonly code:
      | "unknown-plugin"
      | "invalid-manifest"
      | "incompatible-api",
    message: string,
  ) {
    super(message);
    this.name = "PluginRuntimeError";
  }
}

export interface PluginRuntime {
  load(): Promise<RuntimeSnapshot>;
  setEnabled(pluginId: string, enabled: boolean): Promise<void>;
  handlersFor(
    event: EventKey,
    snapshot: RuntimeSnapshot,
  ): readonly PluginEventHandlerEntry[];
  contextFor(
    pluginId: string,
    snapshot: RuntimeSnapshot,
  ): PluginContext | null;
  quarantine(pluginId: string, reason: string): Promise<void>;
}

const consoleLogger: PluginLogger = {
  info: (message, meta) => console.info(message, meta ?? ""),
  warn: (message, meta) => console.warn(message, meta ?? ""),
  error: (message, meta) => console.error(message, meta ?? ""),
};

function defaultState(manifest: PluginManifest): PluginState {
  return {
    pluginId: manifest.id,
    enabled: false,
    version: manifest.version,
    grantedCapabilities: [],
    settings: {},
    health: "ok",
    errorCount: 0,
  };
}

function buildContext(
  manifest: PluginManifest,
  state: PluginState,
  logger: PluginLogger,
): PluginContext {
  const prefix = `[plugin:${manifest.id}]`;
  return {
    pluginId: manifest.id,
    actor: `plugin:${manifest.id}`,
    log: {
      info: (message, meta) => logger.info(`${prefix} ${message}`, meta),
      warn: (message, meta) => logger.warn(`${prefix} ${message}`, meta),
      error: (message, meta) => logger.error(`${prefix} ${message}`, meta),
    },
    store: null,
    http: null,
    settings: {
      get: <T = unknown>(key: string) => state.settings[key] as T | undefined,
      all: () => ({ ...state.settings }),
    },
  };
}

/** Résout `requires`/`conflicts` jusqu'à un point fixe. */
function resolveDependencies(
  candidates: Map<string, ActivePlugin>,
  registry: Map<string, RegisteredPlugin>,
): InactivePlugin[] {
  const inactive: InactivePlugin[] = [];
  const core = new Set<string>(CORE_MODULES);
  let changed = true;

  while (changed) {
    changed = false;
    for (const [id, plugin] of [...candidates]) {
      let removal: InactivePlugin | null = null;

      for (const dependency of plugin.manifest.requires) {
        if (core.has(dependency)) continue;
        if (!registry.has(dependency)) {
          removal = { id, reason: "requires-missing", detail: dependency };
          break;
        }
        if (!candidates.has(dependency)) {
          removal = { id, reason: "requires-disabled", detail: dependency };
          break;
        }
      }

      if (!removal) {
        for (const conflict of plugin.manifest.conflicts) {
          if (candidates.has(conflict)) {
            removal = { id, reason: "conflict", detail: conflict };
            break;
          }
        }
      }

      if (removal) {
        candidates.delete(id);
        inactive.push(removal);
        changed = true;
      }
    }
  }

  return inactive;
}

export function createPluginRuntime(
  options: PluginRuntimeOptions,
): PluginRuntime {
  const apiVersion = options.apiVersion ?? DEVNET_API_VERSION;
  const globalDisabled = options.globalDisabled ?? false;
  const logger = options.logger ?? consoleLogger;
  const registry = new Map(
    options.registry.map((plugin) => [plugin.manifest.id, plugin]),
  );

  return {
    async load(): Promise<RuntimeSnapshot> {
      const states = new Map(
        (await options.repository.list()).map((state) => [state.pluginId, state]),
      );
      const inactive: InactivePlugin[] = [];
      const candidates = new Map<string, ActivePlugin>();

      if (globalDisabled) {
        for (const id of registry.keys()) {
          inactive.push({ id, reason: "global-disabled" });
        }
        return { active: [], inactive: sortById(inactive) };
      }

      for (const registered of options.registry) {
        const validation = validateManifest(registered.manifest);
        if (!validation.ok) {
          inactive.push({
            id: registered.manifest.id,
            reason: "invalid-manifest",
            detail: validation.issues.map((issue) => issue.path).join(", "),
          });
          continue;
        }

        const manifest = validation.manifest;
        const state = states.get(manifest.id);
        if (!state?.enabled) {
          inactive.push({ id: manifest.id, reason: "disabled" });
          continue;
        }

        if (!isCompatible(manifest.devnetApi, apiVersion)) {
          inactive.push({
            id: manifest.id,
            reason: "incompatible-api",
            detail: `${manifest.devnetApi} ≠ ${apiVersion}`,
          });
          continue;
        }

        candidates.set(manifest.id, {
          id: manifest.id,
          manifest,
          definition: registered.definition,
          state,
          grantedCapabilities: grantedCapabilities(manifest, state),
        });
      }

      inactive.push(...resolveDependencies(candidates, registry));

      return {
        active: [...candidates.values()].sort((a, b) => a.id.localeCompare(b.id)),
        inactive: sortById(inactive),
      };
    },

    async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
      const registered = registry.get(pluginId);
      if (!registered) {
        throw new PluginRuntimeError(
          "unknown-plugin",
          `Plugin inconnu du registre : ${pluginId}`,
        );
      }

      const validation = validateManifest(registered.manifest);
      if (!validation.ok) {
        throw new PluginRuntimeError(
          "invalid-manifest",
          `Manifeste invalide pour ${pluginId}`,
        );
      }

      const manifest = validation.manifest;
      if (enabled && !isCompatible(manifest.devnetApi, apiVersion)) {
        throw new PluginRuntimeError(
          "incompatible-api",
          `${pluginId} exige ${manifest.devnetApi}, SDK ${apiVersion}`,
        );
      }

      const current =
        (await options.repository.get(pluginId)) ?? defaultState(manifest);
      const next: PluginState = {
        ...current,
        enabled,
        version: manifest.version,
      };
      await options.repository.save(next);

      const context = buildContext(manifest, next, logger);
      const hooks = enabled
        ? registered.definition.onActivate
        : registered.definition.onDeactivate;

      for (const hook of hooks) {
        try {
          await hook(context);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`[plugin:${pluginId}] hook en échec : ${message}`);
          await options.repository.save({
            ...next,
            errorCount: next.errorCount + 1,
            health: "degraded",
          });
        }
      }
    },

    handlersFor(
      event: EventKey,
      snapshot: RuntimeSnapshot,
    ): readonly PluginEventHandlerEntry[] {
      const entries: PluginEventHandlerEntry[] = [];
      for (const plugin of snapshot.active) {
        for (const registration of plugin.definition.events) {
          if (registration.event !== event) continue;
          if (!plugin.grantedCapabilities.includes(registration.capability)) {
            continue;
          }
          entries.push({
            pluginId: plugin.id,
            event: registration.event,
            handler: registration.handler,
          });
        }
      }
      return entries;
    },

    contextFor(
      pluginId: string,
      snapshot: RuntimeSnapshot,
    ): PluginContext | null {
      const plugin = snapshot.active.find((entry) => entry.id === pluginId);
      if (!plugin) return null;
      return buildContext(plugin.manifest, plugin.state, logger);
    },

    async quarantine(pluginId: string, reason: string): Promise<void> {
      const registered = registry.get(pluginId);
      if (!registered) {
        logger.warn(`[plugin:${pluginId}] quarantaine demandée hors registre`);
        return;
      }

      const current =
        (await options.repository.get(pluginId)) ??
        defaultState(registered.manifest);
      await options.repository.save({
        ...current,
        enabled: false,
        health: "quarantined",
        errorCount: current.errorCount + 1,
      });
      logger.error(`[plugin:${pluginId}] quarantaine : ${reason}`);
    },
  };
}

function sortById(entries: InactivePlugin[]): InactivePlugin[] {
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}
