/**
 * Catalogue stable du SDK : version d'API, modules du cœur, emplacements
 * d'interface, événements et grammaire des capacités.
 *
 * C'est la **surface publique** : un manifeste ne peut demander que ce qui
 * figure ici. Ajouter une entrée est rétro-compatible ; en retirer une est un
 * changement cassant (nouvelle version majeure du SDK).
 */

/** Version du SDK que cette copie du cœur implémente. */
export const DEVNET_API_VERSION = "1.0.0";

/** Modules du cœur qu'un plugin peut déclarer dans `requires`. */
export const CORE_MODULES = [
  "profiles",
  "feed",
  "messaging",
  "notifications",
  "proofs",
  "projects",
  "ratings",
  "admin",
] as const;

export type CoreModule = (typeof CORE_MODULES)[number];

/** Emplacements d'interface ouverts par le cœur. */
export const SLOT_NAMES = [
  "nav.sidebar.item",
  "nav.settings.link",
  "home.feed.header",
  "composer.toolbar.action",
  "composer.block",
  "post.card.action",
  "post.card.footer",
  "post.detail.sidebar",
  "profile.tab",
  "profile.header.badge",
  "profile.sidebar.widget",
  "project.tab",
  "project.sidebar.widget",
  "settings.section",
  "explore.widget",
  "onboarding.step",
  "command.palette.command",
  "notification.renderer",
  "search.provider",
  "admin.panel",
  "moderation.tool",
  "theme.pack",
  "i18n.pack",
] as const;

export type SlotName = (typeof SLOT_NAMES)[number];

/**
 * Événements du cœur ouverts aux plugins, avec leur version courante.
 *
 * Une évolution incompatible crée `@2` et maintient `@1` pendant la période
 * de dépréciation : on n'insère jamais une clé existante avec une autre
 * version.
 */
export const EVENT_VERSIONS = {
  "post.created": 1,
  "proof.verified": 1,
  "user.registered": 1,
} as const;

export type EventType = keyof typeof EVENT_VERSIONS;
export type EventKey = `${EventType}@${number}`;

export function eventKey(
  type: EventType,
  version: number = EVENT_VERSIONS[type],
): EventKey {
  return `${type}@${version}`;
}

/** Un couple `type@version` connu du SDK ? */
export function isKnownEventKey(value: string): value is EventKey {
  const match = /^([a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+)@(\d+)$/.exec(value);
  if (!match) return false;
  const type = match[1] as EventType;
  return type in EVENT_VERSIONS && Number(match[2]) === EVENT_VERSIONS[type];
}

export function eventCapability(event: EventKey): string {
  return `events:subscribe:${event}`;
}

export function slotCapability(slot: SlotName): string {
  return `ui:slot:${slot}`;
}

const EXACT_CAPABILITIES = new Set([
  "store:kv",
  "notifier:channel",
  "content:filter",
  "ranking:signal",
  "write:notifications",
  "read:profile.public",
  "read:posts.public",
]);

const ROUTE_RE = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/;
const TASK_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Vérifie une capacité sans se contenter d'un préfixe : le nom de l'événement
 * doit exister, l'emplacement doit être ouvert, la route doit être un chemin
 * simple. Une capacité inventée est refusée au manifeste, donc avant le
 * premier appel.
 */
export function isValidCapability(value: string): boolean {
  if (EXACT_CAPABILITIES.has(value)) return true;

  if (value.startsWith("events:subscribe:")) {
    return isKnownEventKey(value.slice("events:subscribe:".length));
  }

  if (value.startsWith("ui:slot:")) {
    const slot = value.slice("ui:slot:".length);
    return (SLOT_NAMES as readonly string[]).includes(slot);
  }

  if (value.startsWith("api:route:")) {
    return ROUTE_RE.test(value.slice("api:route:".length));
  }

  if (value.startsWith("jobs:task:")) {
    return TASK_RE.test(value.slice("jobs:task:".length));
  }

  return false;
}
