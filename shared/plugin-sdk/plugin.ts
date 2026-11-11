/**
 * `definePlugin` : le seul point d'entrée pour un plugin côté serveur.
 *
 * Le plugin **déclare** ses abonnements ; il ne les exécute pas lui-même. Le
 * runtime du cœur décide plus tard, à chaque appel, si la capacité a été
 * accordée. Un abonnement non déclaré dans le manifeste ne sera jamais
 * distribué.
 */
import {
  eventCapability,
  isKnownEventKey,
  type EventKey,
} from "./catalog";
import type { PluginContext } from "./context";
import type { PluginEventHandler } from "./events";

export type PluginLifecycleHook = (
  context: PluginContext,
) => Promise<void> | void;

export interface PluginEventRegistration {
  event: EventKey;
  capability: string;
  handler: PluginEventHandler;
}

export interface PluginDefinition {
  readonly events: readonly PluginEventRegistration[];
  readonly onActivate: readonly PluginLifecycleHook[];
  readonly onDeactivate: readonly PluginLifecycleHook[];
}

export interface PluginApi {
  /** S'abonner à un événement versionné du cœur. */
  onEvent(event: EventKey, handler: PluginEventHandler): void;
  /** Exécuté après une activation réussie. */
  onActivate(hook: PluginLifecycleHook): void;
  /** Exécuté après une désactivation ; ne doit pas supprimer les données. */
  onDeactivate(hook: PluginLifecycleHook): void;
}

export function definePlugin(setup: (api: PluginApi) => void): PluginDefinition {
  const events: PluginEventRegistration[] = [];
  const onActivate: PluginLifecycleHook[] = [];
  const onDeactivate: PluginLifecycleHook[] = [];

  setup({
    onEvent(event, handler) {
      if (!isKnownEventKey(event)) {
        throw new Error(
          `Événement inconnu du SDK : ${event}. Utilisez un événement du catalogue.`,
        );
      }
      events.push({ event, capability: eventCapability(event), handler });
    },
    onActivate(hook) {
      onActivate.push(hook);
    },
    onDeactivate(hook) {
      onDeactivate.push(hook);
    },
  });

  return { events, onActivate, onDeactivate };
}
