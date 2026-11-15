/**
 * État d'un plugin, indépendant du fournisseur de stockage.
 *
 * Le port permet de tester le cycle de vie sans base et de brancher plus tard
 * un adaptateur PostgreSQL. La table `plugin_state` (migration 042) est la
 * source de vérité en production : activer ou couper un plugin ne demande
 * aucun redéploiement.
 */

export type PluginHealth = "ok" | "degraded" | "quarantined";

export interface PluginState {
  pluginId: string;
  enabled: boolean;
  version: string;
  grantedCapabilities: string[];
  settings: Record<string, unknown>;
  health: PluginHealth;
  errorCount: number;
}

export interface PluginStateRepository {
  list(): Promise<PluginState[]>;
  get(pluginId: string): Promise<PluginState | null>;
  save(state: PluginState): Promise<void>;
}

export class PluginStateError extends Error {
  constructor(
    readonly operation: "list" | "get" | "save",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PluginStateError";
  }
}

function clone(state: PluginState): PluginState {
  return {
    ...state,
    grantedCapabilities: [...state.grantedCapabilities],
    settings: { ...state.settings },
  };
}

/**
 * Adaptateur mémoire : utilisé par la démonstration et les tests. Il ne
 * persiste pas entre deux processus — ce n'est pas un stockage de production.
 */
export class MemoryPluginStateRepository implements PluginStateRepository {
  private readonly states = new Map<string, PluginState>();

  constructor(initial: PluginState[] = []) {
    for (const state of initial) this.states.set(state.pluginId, clone(state));
  }

  async list(): Promise<PluginState[]> {
    return [...this.states.values()].map(clone);
  }

  async get(pluginId: string): Promise<PluginState | null> {
    const state = this.states.get(pluginId);
    return state ? clone(state) : null;
  }

  async save(state: PluginState): Promise<void> {
    this.states.set(state.pluginId, clone(state));
  }
}
