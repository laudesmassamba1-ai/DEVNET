/**
 * Garde de capacités : refus par défaut, vérifié à chaque appel.
 *
 * Le manifeste **demande** ; l'état `grantedCapabilities` **accorde**. Une
 * capacité demandée mais non accordée n'est jamais disponible, même si le
 * plugin est activé.
 */
import type { PluginManifest } from "@devnet/plugin-sdk";
import type { PluginState } from "./state";

export class CapabilityDeniedError extends Error {
  constructor(
    readonly pluginId: string,
    readonly capability: string,
  ) {
    super(`Capacité refusée pour ${pluginId} : ${capability}`);
    this.name = "CapabilityDeniedError";
  }
}

/**
 * Intersection demande × octroi. Une capacité accordée mais non demandée
 * n'est pas utilisable : le manifeste reste la limite haute.
 */
export function grantedCapabilities(
  manifest: PluginManifest,
  state: PluginState,
): string[] {
  const granted = new Set(state.grantedCapabilities);
  return manifest.capabilities.filter((capability) => granted.has(capability));
}

export function hasCapability(
  manifest: PluginManifest,
  state: PluginState,
  capability: string,
): boolean {
  return grantedCapabilities(manifest, state).includes(capability);
}

export function assertCapability(
  manifest: PluginManifest,
  state: PluginState,
  capability: string,
): void {
  if (!hasCapability(manifest, state, capability)) {
    throw new CapabilityDeniedError(manifest.id, capability);
  }
}
