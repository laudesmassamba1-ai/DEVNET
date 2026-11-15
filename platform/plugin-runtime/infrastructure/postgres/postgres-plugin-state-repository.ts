/**
 * Adaptateur PostgreSQL direct de l'état des plugins.
 *
 * Il lit et écrit la même table `plugin_state` que la migration 042. Le
 * drainage et la quarantaine fonctionnent donc sans passer par Supabase, ce
 * qui prépare la sortie du fournisseur sans changer le runtime.
 */
import type { Pool } from "pg";
import {
  PluginStateError,
  type PluginHealth,
  type PluginState,
  type PluginStateRepository,
} from "../../state";

interface StateRow {
  plugin_id: string;
  enabled: boolean;
  version: string;
  granted_capabilities: string[] | null;
  settings: unknown;
  health: PluginHealth;
  error_count: number;
}

const COLUMNS =
  "plugin_id, enabled, version, granted_capabilities, settings, health, error_count";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toState(row: StateRow): PluginState {
  return {
    pluginId: row.plugin_id,
    enabled: row.enabled,
    version: row.version,
    grantedCapabilities: row.granted_capabilities ?? [],
    settings: isRecord(row.settings) ? row.settings : {},
    health: row.health,
    errorCount: row.error_count,
  };
}

export class PostgresPluginStateRepository implements PluginStateRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<PluginState[]> {
    try {
      const { rows } = await this.pool.query<StateRow>(
        `select ${COLUMNS} from public.plugin_state order by plugin_id`,
      );
      return rows.map(toState);
    } catch (error) {
      throw new PluginStateError("list", "Lecture de plugin_state impossible.", {
        cause: error,
      });
    }
  }

  async get(pluginId: string): Promise<PluginState | null> {
    try {
      const { rows } = await this.pool.query<StateRow>(
        `select ${COLUMNS} from public.plugin_state where plugin_id = $1`,
        [pluginId],
      );
      return rows[0] ? toState(rows[0]) : null;
    } catch (error) {
      throw new PluginStateError("get", "Lecture de plugin_state impossible.", {
        cause: error,
      });
    }
  }

  async save(state: PluginState): Promise<void> {
    try {
      await this.pool.query(
        `insert into public.plugin_state
           (plugin_id, enabled, version, granted_capabilities, settings, health, error_count, updated_at)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, now())
         on conflict (plugin_id) do update
           set enabled = excluded.enabled,
               version = excluded.version,
               granted_capabilities = excluded.granted_capabilities,
               settings = excluded.settings,
               health = excluded.health,
               error_count = excluded.error_count,
               updated_at = now()`,
        [
          state.pluginId,
          state.enabled,
          state.version,
          state.grantedCapabilities,
          JSON.stringify(state.settings),
          state.health,
          state.errorCount,
        ],
      );
    } catch (error) {
      throw new PluginStateError(
        "save",
        "Écriture de plugin_state impossible.",
        { cause: error },
      );
    }
  }
}
