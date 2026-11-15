/**
 * Tests du drainage des événements (Phase 3).
 *
 * Exécuter avec :  npx tsx scripts/test-events.ts
 *
 * Ce qui est verrouillé ici :
 *  - un abonné reçoit un événement une fois, avec l'enveloppe versionnée ;
 *  - une livraison déjà consignée n'est jamais rejouée ;
 *  - une panne est reprise avec un délai exponentiel ;
 *  - au-delà du plafond, la livraison meurt et le plugin est mis en quarantaine ;
 *  - un événement sans abonné est consommé sans erreur ;
 *  - un événement inconnu du SDK est refusé, pas silencieusement livré ;
 *  - un gestionnaire qui boucle est interrompu par le délai ;
 *  - un worker mort est repris après péremption.
 */
import {
  definePlugin,
  type EventEnvelope,
  type PluginDefinition,
  type PluginLogger,
  type PluginManifest,
} from "../shared/plugin-sdk";
import {
  createPluginRuntime,
  MemoryPluginStateRepository,
  type PluginState,
} from "../platform/plugin-runtime";
import { createEventDispatcher } from "../modules/events";
import { MemoryEventOutboxRepository } from "../modules/events/infrastructure/memory/memory-event-outbox-repository";

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

const EVENT_CAP = "events:subscribe:proof.verified@1";
const BASE_TIME = Date.parse("2026-11-05T10:00:00.000Z");
let now = new Date(BASE_TIME);

function clock(): Date {
  return new Date(now);
}

function advance(ms: number): void {
  now = new Date(now.getTime() + ms);
}

function resetClock(): void {
  now = new Date(BASE_TIME);
}

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "event-probe",
    name: "Sonde d'événements",
    version: "1.0.0",
    devnetApi: "^1.0.0",
    level: 2,
    requires: [],
    conflicts: [],
    capabilities: [EVENT_CAP],
    network: { outbound: [] },
    entry: { server: "server.ts" },
    i18n: ["fr"],
    dataCategories: [],
    ...overrides,
  };
}

function state(overrides: Partial<PluginState> = {}): PluginState {
  return {
    pluginId: "event-probe",
    enabled: true,
    version: "1.0.0",
    grantedCapabilities: [EVENT_CAP],
    settings: {},
    health: "ok",
    errorCount: 0,
    ...overrides,
  };
}

function buildRuntime(
  plugins: Array<{ manifest: PluginManifest; definition: PluginDefinition }>,
  states: PluginState[],
): {
  runtime: ReturnType<typeof createPluginRuntime>;
  stateRepository: MemoryPluginStateRepository;
} {
  const stateRepository = new MemoryPluginStateRepository(states);
  const runtime = createPluginRuntime({
    registry: plugins,
    repository: stateRepository,
    logger: silentLogger,
  });
  return { runtime, stateRepository };
}

function makeDispatcher(
  repository: MemoryEventOutboxRepository,
  runtime: ReturnType<typeof createPluginRuntime>,
  overrides: Partial<{
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    handlerTimeoutMs: number;
    staleAfterMs: number;
  }> = {},
) {
  return createEventDispatcher({
    repository,
    runtime,
    logger: silentLogger,
    clock,
    batchSize: 10,
    maxAttempts: overrides.maxAttempts ?? 3,
    baseDelayMs: overrides.baseDelayMs ?? 1_000,
    maxDelayMs: overrides.maxDelayMs ?? 60_000,
    handlerTimeoutMs: overrides.handlerTimeoutMs ?? 50,
    staleAfterMs: overrides.staleAfterMs ?? 5_000,
  });
}

function proofEvent(repository: MemoryEventOutboxRepository, id = "proof-1") {
  return repository.enqueue({
    type: "proof.verified",
    version: 1,
    actor: "user-1",
    subject: { proofId: id, userId: "user-1" },
    data: { proofId: id, userId: "user-1", kind: "commit", hasCode: true },
    occurredAt: clock(),
  });
}

async function verifyDelivery(): Promise<void> {
  resetClock();
  const received: EventEnvelope[] = [];
  const definition = definePlugin((api) => {
    api.onEvent("proof.verified@1", (event) => {
      received.push(event);
    });
  });
  const plugin = { manifest: manifest(), definition };
  const { runtime } = buildRuntime([plugin], [state()]);
  const repository = new MemoryEventOutboxRepository();
  const dispatcher = makeDispatcher(repository, runtime);

  const event = await proofEvent(repository);
  const report = await dispatcher.dispatch();

  eq("livraison : un événement réclamé", report.claimed, 1);
  eq("livraison : un gestionnaire exécuté", report.delivered, 1);
  eq("livraison : événement dispatché", report.dispatched, 1);
  eq("livraison : aucune reprise", report.retried, 0);
  eq("livraison : le gestionnaire a été appelé", received.length, 1);
  eq("livraison : identifiant conservé", received[0]?.id, event.id);
  eq("livraison : type conservé", received[0]?.type, "proof.verified");
  eq("livraison : version conservée", received[0]?.version, 1);
  eq("livraison : acteur explicite", received[0]?.actor, "user:user-1");
  eq("livraison : sujet minimal", received[0]?.subject.proofId, "proof-1");
  eq("livraison : aucune donnée de texte", "text" in (received[0]?.data ?? {}), false);

  const inspected = repository.inspect(event.id);
  eq("livraison : événement consigné", inspected?.status, "dispatched");
  eq("livraison : livraison consignée", inspected?.deliveries[0]?.status, "delivered");
}

async function verifyIdempotence(): Promise<void> {
  resetClock();
  let calls = 0;
  const definition = definePlugin((api) => {
    api.onEvent("proof.verified@1", () => {
      calls += 1;
    });
  });
  const plugin = { manifest: manifest(), definition };
  const { runtime } = buildRuntime([plugin], [state()]);
  const repository = new MemoryEventOutboxRepository();
  const dispatcher = makeDispatcher(repository, runtime);

  const event = await proofEvent(repository);
  await repository.ensureDelivery(event.id, "event-probe", now);
  await repository.markDelivered(event.id, "event-probe", now);

  const report = await dispatcher.dispatch();
  eq("idempotence : événement tout de même réclamé", report.claimed, 1);
  eq("idempotence : gestionnaire non rappelé", calls, 0);
  eq("idempotence : événement clos", report.dispatched, 1);
  eq(
    "idempotence : une seule livraison",
    repository.inspect(event.id)?.deliveries.length,
    1,
  );
}

async function verifyRetry(): Promise<void> {
  resetClock();
  let attempts = 0;
  const definition = definePlugin((api) => {
    api.onEvent("proof.verified@1", () => {
      attempts += 1;
      if (attempts === 1) throw new Error("panne simulée");
    });
  });
  const plugin = { manifest: manifest(), definition };
  const { runtime } = buildRuntime([plugin], [state()]);
  const repository = new MemoryEventOutboxRepository();
  const dispatcher = makeDispatcher(repository, runtime);

  const event = await proofEvent(repository);
  const first = await dispatcher.dispatch();
  eq("reprise : échec compté", first.retried, 1);
  eq("reprise : gestionnaire rappelé une fois", attempts, 1);
  eq("reprise : événement en attente", repository.inspect(event.id)?.status, "pending");
  eq(
    "reprise : première tentative consignée",
    repository.inspect(event.id)?.deliveries[0]?.attempts,
    1,
  );

  const tooEarly = await dispatcher.dispatch();
  eq("reprise : pas de rejeu avant le délai", tooEarly.claimed, 0);

  advance(1_000);
  const second = await dispatcher.dispatch();
  eq("reprise : seconde tentative livrée", second.delivered, 1);
  eq("reprise : événement clos", second.dispatched, 1);
  eq("reprise : gestionnaire rappelé deux fois", attempts, 2);
}

async function verifyQuarantine(): Promise<void> {
  resetClock();
  const definition = definePlugin((api) => {
    api.onEvent("proof.verified@1", () => {
      throw new Error("toujours en panne");
    });
  });
  const plugin = { manifest: manifest(), definition };
  const { runtime, stateRepository } = buildRuntime([plugin], [state()]);
  const repository = new MemoryEventOutboxRepository();
  const dispatcher = makeDispatcher(repository, runtime, {
    maxAttempts: 3,
    baseDelayMs: 1_000,
  });

  const event = await proofEvent(repository);

  await dispatcher.dispatch();
  advance(1_000);
  await dispatcher.dispatch();
  advance(2_000);
  const last = await dispatcher.dispatch();

  eq("quarantaine : plugin signalé", last.quarantined.includes("event-probe"), true);
  eq("quarantaine : événement en échec", repository.inspect(event.id)?.status, "failed");
  eq(
    "quarantaine : livraison morte",
    repository.inspect(event.id)?.deliveries[0]?.status,
    "failed",
  );
  eq(
    "quarantaine : tentatives plafonnées",
    repository.inspect(event.id)?.deliveries[0]?.attempts,
    3,
  );

  const saved = await stateRepository.get("event-probe");
  eq("quarantaine : plugin désactivé", saved?.enabled, false);
  eq("quarantaine : santé consignée", saved?.health, "quarantined");
  eq("quarantaine : compteur incrémenté", saved?.errorCount, 1);

  const later = await proofEvent(repository, "proof-2");
  const after = await dispatcher.dispatch();
  eq("quarantaine : nouvel événement sans abonné", after.dispatched, 1);
  eq(
    "quarantaine : aucune livraison au plugin coupé",
    repository.inspect(later.id)?.deliveries.length,
    0,
  );
}

async function verifyNoSubscriber(): Promise<void> {
  resetClock();
  let calls = 0;
  const definition = definePlugin((api) => {
    api.onEvent("proof.verified@1", () => {
      calls += 1;
    });
  });
  const plugin = { manifest: manifest(), definition };
  const { runtime } = buildRuntime(
    [plugin],
    [state({ grantedCapabilities: [] })],
  );
  const repository = new MemoryEventOutboxRepository();
  const dispatcher = makeDispatcher(repository, runtime);

  const event = await proofEvent(repository);
  const report = await dispatcher.dispatch();

  eq("sans capacité : aucun appel", calls, 0);
  eq("sans capacité : événement consommé", report.dispatched, 1);
  eq("sans capacité : aucun échec", report.failed, 0);
  eq(
    "sans capacité : aucune livraison créée",
    repository.inspect(event.id)?.deliveries.length,
    0,
  );
}

async function verifyUnknownEvent(): Promise<void> {
  resetClock();
  const { runtime } = buildRuntime([], []);
  const repository = new MemoryEventOutboxRepository();
  const dispatcher = makeDispatcher(repository, runtime);

  const event = await repository.enqueue({
    type: "post.hacked",
    version: 9,
    actor: "user-1",
    subject: { postId: "post-1" },
    data: { postId: "post-1" },
    occurredAt: clock(),
  });
  const report = await dispatcher.dispatch();

  eq("inconnu : événement refusé", report.failed, 1);
  eq("inconnu : statut en échec", repository.inspect(event.id)?.status, "failed");
  check(
    "inconnu : raison consignée",
    repository.inspect(event.id)?.lastError?.includes("inconnu") ?? false,
  );
}

async function verifyTimeout(): Promise<void> {
  resetClock();
  let calls = 0;
  const definition = definePlugin((api) => {
    api.onEvent("proof.verified@1", () => {
      calls += 1;
      return new Promise<void>(() => undefined);
    });
  });
  const plugin = { manifest: manifest(), definition };
  const { runtime } = buildRuntime([plugin], [state()]);
  const repository = new MemoryEventOutboxRepository();
  const dispatcher = makeDispatcher(repository, runtime, {
    maxAttempts: 2,
    baseDelayMs: 10,
    handlerTimeoutMs: 20,
  });

  const event = await proofEvent(repository);
  const first = await dispatcher.dispatch();
  eq("délai : première panne comptée", first.retried, 1);
  advance(10);
  const second = await dispatcher.dispatch();

  eq("délai : gestionnaire appelé deux fois", calls, 2);
  eq("délai : quarantaine après plafond", second.quarantined.includes("event-probe"), true);
  eq("délai : événement en échec", repository.inspect(event.id)?.status, "failed");
  check(
    "délai : raison explicite",
    repository.inspect(event.id)?.lastError?.includes("délai dépassé") ?? false,
  );
}

async function verifyStaleClaim(): Promise<void> {
  resetClock();
  let calls = 0;
  const definition = definePlugin((api) => {
    api.onEvent("proof.verified@1", () => {
      calls += 1;
    });
  });
  const plugin = { manifest: manifest(), definition };
  const { runtime } = buildRuntime([plugin], [state()]);
  const repository = new MemoryEventOutboxRepository();
  const dispatcher = makeDispatcher(repository, runtime, { staleAfterMs: 5_000 });

  const event = await proofEvent(repository);
  const crashed = await repository.claimDue(
    10,
    now,
    new Date(now.getTime() - 1),
  );
  eq("péremption : événement réclamé par le worker mort", crashed.length, 1);

  advance(6_000);
  const report = await dispatcher.dispatch();
  eq("péremption : événement repris", report.claimed, 1);
  eq("péremption : livraison effectuée", calls, 1);
  eq("péremption : événement clos", repository.inspect(event.id)?.status, "dispatched");
}

async function verifyMultipleSubscribers(): Promise<void> {
  resetClock();
  const callsA: string[] = [];
  const callsB: string[] = [];
  const pluginA = {
    manifest: manifest({ id: "event-probe" }),
    definition: definePlugin((api) => {
      api.onEvent("proof.verified@1", (event) => {
        callsA.push(event.id);
      });
    }),
  };
  const pluginB = {
    manifest: manifest({ id: "event-audit" }),
    definition: definePlugin((api) => {
      api.onEvent("proof.verified@1", (event) => {
        callsB.push(event.id);
      });
    }),
  };
  const { runtime } = buildRuntime(
    [pluginA, pluginB],
    [
      state(),
      state({ pluginId: "event-audit" }),
    ],
  );
  const repository = new MemoryEventOutboxRepository();
  const dispatcher = makeDispatcher(repository, runtime);

  const event = await proofEvent(repository);
  const report = await dispatcher.dispatch();

  eq("multi : deux livraisons", report.delivered, 2);
  eq("multi : premier abonné", callsA[0], event.id);
  eq("multi : second abonné", callsB[0], event.id);
  eq(
    "multi : deux lignes de livraison",
    repository.inspect(event.id)?.deliveries.length,
    2,
  );
}

async function main(): Promise<void> {
  await verifyDelivery();
  await verifyIdempotence();
  await verifyRetry();
  await verifyQuarantine();
  await verifyNoSubscriber();
  await verifyUnknownEvent();
  await verifyTimeout();
  await verifyStaleClaim();
  await verifyMultipleSubscribers();

  if (failures.length > 0) {
    console.error("\n✗ Drainage :");
    for (const failure of failures) console.error(`  · ${failure}`);
    console.error(`\n${passed} vérifications passées, ${failures.length} en échec.\n`);
    process.exit(1);
  }
  console.log(`✓ Drainage des événements — ${passed} vérifications.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
