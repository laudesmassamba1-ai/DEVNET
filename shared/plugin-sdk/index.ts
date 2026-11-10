/**
 * SDK public et stable de DevNet.
 *
 * Un plugin n'importe **que** ce point d'entrée. Toute surface ajoutée ici
 * devient un contrat : un changement cassant exige une nouvelle version
 * majeure et une période de dépréciation.
 */
export {
  CORE_MODULES,
  DEVNET_API_VERSION,
  EVENT_VERSIONS,
  SLOT_NAMES,
  eventCapability,
  eventKey,
  isKnownEventKey,
  isValidCapability,
  slotCapability,
} from "./catalog";
export type {
  CoreModule,
  EventKey,
  EventType,
  SlotName,
} from "./catalog";

export { definePlugin } from "./plugin";
export type {
  PluginApi,
  PluginDefinition,
  PluginEventRegistration,
  PluginLifecycleHook,
} from "./plugin";

export type {
  EventEnvelope,
  PluginEventHandler,
  PluginEventKey,
} from "./events";

export type {
  PluginActor,
  PluginContext,
  PluginHttp,
  PluginKeyValueStore,
  PluginLogger,
  PluginSettings,
} from "./context";

export { validateManifest } from "./manifest";
export type {
  ManifestIssue,
  ManifestValidation,
  PluginLevel,
  PluginManifest,
} from "./manifest";

export {
  compareVersions,
  isCompatible,
  isVersionInRange,
  parseRange,
  parseVersion,
} from "./semver";
export type { SemVer, VersionRange } from "./semver";
