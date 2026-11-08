/**
 * Composition réservée au serveur.
 *
 * `platform/container.ts` est importé par des modules qui vivent aussi dans le
 * navigateur : y ajouter `pg` enverrait le driver dans le bundle client. Ce
 * fichier-ci n'est importé que par des routes serveur et ne doit jamais
 * l'être depuis un composant.
 */
import { createEventDispatcher, type EventDispatcher } from "@/modules/events";
import { PostgresEventOutboxRepository } from "@/modules/events/infrastructure/postgres/postgres-event-outbox-repository";
import { PostgresFeedRepository } from "@/modules/feed/infrastructure/postgres/postgres-feed-repository";
import type { FeedRepository } from "@/modules/feed/ports/feed-repository";
import { withUser } from "./infrastructure/postgres/with-user";
import {
  getPostgresPool,
  hasDatabaseUrl,
} from "./infrastructure/postgres/pool";
import {
  createPluginRuntime,
  type PluginRuntime,
  type PluginStateRepository,
} from "./plugin-runtime";
import { PostgresPluginStateRepository } from "./plugin-runtime/infrastructure/postgres/postgres-plugin-state-repository";
import { SupabasePluginStateRepository } from "./plugin-runtime/supabase-plugin-state-repository";
import { REGISTERED_PLUGINS } from "./registry.generated";

let runtime: PluginRuntime | null = null;
let dispatcher: EventDispatcher | null = null;

function pluginStateRepository(): PluginStateRepository {
  if (hasDatabaseUrl()) {
    return new PostgresPluginStateRepository(getPostgresPool());
  }
  return new SupabasePluginStateRepository();
}

export function getPluginRuntime(): PluginRuntime {
  runtime ??= createPluginRuntime({
    registry: REGISTERED_PLUGINS,
    repository: pluginStateRepository(),
    globalDisabled: process.env.PLUGINS_DISABLED === "true",
    logger: {
      info: (message, meta) => console.info(message, meta ?? ""),
      warn: (message, meta) => console.warn(message, meta ?? ""),
      error: (message, meta) => console.error(message, meta ?? ""),
    },
  });
  return runtime;
}

/**
 * Fil servi par PostgreSQL direct.
 *
 * Composé **ici** et pas dans `platform/container.ts` : ce dernier est aussi
 * chargé par le navigateur, et y importer `pg` enverrait le pilote dans le
 * bundle client. L'identité vient de `withUser`, donc la RLS reste la seule
 * juge de ce qui est lisible.
 */
export function getServerFeedRepository(): FeedRepository {
  return new PostgresFeedRepository({
    asUser: (userId, run) => withUser(userId, run),
  });
}

export function getEventDispatcher(): EventDispatcher | null {
  if (!hasDatabaseUrl()) return null;
  dispatcher ??= createEventDispatcher({
    repository: new PostgresEventOutboxRepository(getPostgresPool()),
    runtime: getPluginRuntime(),
  });
  return dispatcher;
}
