/**
 * Adaptateur transitoire de `PluginStateRepository` sur Supabase.
 *
 * La migration 042 active la RLS : la lecture est permise aux utilisateurs
 * authentifiés, l'écriture ne l'est pas. Les activations passent donc par un
 * chemin serveur privilégié (Phase 8) ; d'ici là, le SQL documenté dans le
 * README du plugin suffit à basculer un état sans redéploiement.
 */
import { getOrCreateServerClient } from "@/lib/supabase/server";
import {
  PluginStateError,
  type PluginHealth,
  type PluginState,
  type PluginStateRepository,
} from "./state";

const COLUMNS =
  "plugin_id, enabled, version, granted_capabilities, settings, health, error_count";

interface PluginStateRow {
  plugin_id: string;
  enabled: boolean;
  version: string;
  granted_capabilities: string[] | null;
  settings: unknown;
  health: PluginHealth;
  error_count: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toState(row: PluginStateRow): PluginState {
  return {
    pluginId: row.plugin_id,
    enabled: row.enabled,
    version: row.version,
    grantedCapabilities: row.granted_capabilities ?? [],
    settings: isObject(row.settings) ? row.settings : {},
    health: row.health,
    errorCount: row.error_count,
  };
}

export class SupabasePluginStateRepository implements PluginStateRepository {
  async list(): Promise<PluginState[]> {
    const client = await getOrCreateServerClient();
    if (!client) {
      throw new PluginStateError("list", "Client serveur indisponible.");
    }

    const { data, error } = await client.from("plugin_state").select(COLUMNS);
    if (error) {
      throw new PluginStateError("list", error.message, { cause: error });
    }
    return ((data as PluginStateRow[] | null) ?? []).map(toState);
  }

  async get(pluginId: string): Promise<PluginState | null> {
    const client = await getOrCreateServerClient();
    if (!client) {
      throw new PluginStateError("get", "Client serveur indisponible.");
    }

    const { data, error } = await client
      .from("plugin_state")
      .select(COLUMNS)
      .eq("plugin_id", pluginId)
      .maybeSingle();

    if (error) {
      throw new PluginStateError("get", error.message, { cause: error });
    }
    return data ? toState(data as PluginStateRow) : null;
  }

  async save(state: PluginState): Promise<void> {
    const client = await getOrCreateServerClient();
    if (!client) {
      throw new PluginStateError("save", "Client serveur indisponible.");
    }

    const { error } = await client.from("plugin_state").upsert(
      {
        plugin_id: state.pluginId,
        enabled: state.enabled,
        version: state.version,
        granted_capabilities: state.grantedCapabilities,
        settings: state.settings,
        health: state.health,
        error_count: state.errorCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "plugin_id" },
    );

    if (error) {
      throw new PluginStateError("save", error.message, { cause: error });
    }
  }
}
