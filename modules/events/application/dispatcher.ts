/**
 * Dispatching des événements de la boîte d'envoi.
 *
 * Le dispatcheur ne connaît que des ports : il réclame des événements dus,
 * interroge le runtime pour savoir qui écoute, exécute chaque gestionnaire
 * sous un délai borné, puis consigne. Une panne d'un plugin ne remonte jamais
 * comme une panne du drainage : elle devient une livraison en échec, une
 * reprise, puis une quarantaine.
 */
import {
  isKnownEventKey,
  type EventKey,
  type PluginContext,
  type PluginEventHandler,
  type PluginLogger,
} from "@devnet/plugin-sdk";
import type {
  EventOutboxRepository,
  OutboxEvent,
} from "../ports/event-outbox-repository";
import { eventKeyOf, toEventEnvelope } from "./envelope";

export interface DispatchHandler {
  readonly pluginId: string;
  readonly handler: PluginEventHandler;
}

export interface DispatchRuntime<TSnapshot> {
  load(): Promise<TSnapshot>;
  handlersFor(
    event: EventKey,
    snapshot: TSnapshot,
  ): readonly DispatchHandler[];
  contextFor(pluginId: string, snapshot: TSnapshot): PluginContext | null;
  quarantine(pluginId: string, reason: string): Promise<void>;
}

export interface EventDispatcherOptions<TSnapshot> {
  repository: EventOutboxRepository;
  runtime: DispatchRuntime<TSnapshot>;
  logger?: PluginLogger;
  clock?: () => Date;
  batchSize?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  handlerTimeoutMs?: number;
  staleAfterMs?: number;
}

export interface DispatchReport {
  claimed: number;
  delivered: number;
  dispatched: number;
  failed: number;
  retried: number;
  quarantined: string[];
  durationMs: number;
}

export interface EventDispatcher {
  dispatch(): Promise<DispatchReport>;
}

const consoleLogger: PluginLogger = {
  info: (message, meta) => console.info(message, meta ?? ""),
  warn: (message, meta) => console.warn(message, meta ?? ""),
  error: (message, meta) => console.error(message, meta ?? ""),
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`délai dépassé (${timeoutMs} ms)`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function earlier(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

export function createEventDispatcher<TSnapshot>(
  options: EventDispatcherOptions<TSnapshot>,
): EventDispatcher {
  const logger = options.logger ?? consoleLogger;
  const clock = options.clock ?? (() => new Date());
  const batchSize = options.batchSize ?? 10;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
  const baseDelayMs = Math.max(1, options.baseDelayMs ?? 2_000);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 300_000);
  const handlerTimeoutMs = Math.max(1, options.handlerTimeoutMs ?? 5_000);
  const staleAfterMs = Math.max(1, options.staleAfterMs ?? 300_000);

  async function dispatch(): Promise<DispatchReport> {
    const startedAt = Date.now();
    const now = clock();
    const report: DispatchReport = {
      claimed: 0,
      delivered: 0,
      dispatched: 0,
      failed: 0,
      retried: 0,
      quarantined: [],
      durationMs: 0,
    };

    const events = await options.repository.claimDue(
      batchSize,
      now,
      new Date(now.getTime() - staleAfterMs),
    );
    report.claimed = events.length;
    if (events.length === 0) {
      report.durationMs = Date.now() - startedAt;
      return report;
    }

    const snapshot = await options.runtime.load();
    const quarantined = new Set<string>();

    for (const event of events) {
      await dispatchOne(event, snapshot, quarantined, report, now);
    }

    report.durationMs = Date.now() - startedAt;
    return report;
  }

  async function dispatchOne(
    event: OutboxEvent,
    snapshot: TSnapshot,
    quarantined: Set<string>,
    report: DispatchReport,
    now: Date,
  ): Promise<void> {
    const key = eventKeyOf(event);
    if (!isKnownEventKey(key)) {
      await options.repository.completeEvent(
        event.id,
        "failed",
        `événement inconnu du SDK : ${key}`,
        now,
      );
      report.failed += 1;
      logger.warn(`[events] événement inconnu ignoré : ${key}`);
      return;
    }

    const handlers = options.runtime.handlersFor(key, snapshot);
    if (handlers.length === 0) {
      await options.repository.completeEvent(event.id, "dispatched", null, now);
      report.dispatched += 1;
      return;
    }

    const envelope = toEventEnvelope(event);
    let pending = false;
    let failed = false;
    let nextAvailable: Date | null = null;
    let lastError: string | null = null;

    for (const entry of handlers) {
      if (quarantined.has(entry.pluginId)) {
        const dead = await options.repository.ensureDelivery(
          event.id,
          entry.pluginId,
          now,
        );
        if (dead.status !== "delivered" && dead.status !== "failed") {
          const reason = `plugin ${entry.pluginId} en quarantaine`;
          await options.repository.recordFailure(event.id, entry.pluginId, {
            attempts: dead.attempts,
            availableAt: now,
            error: reason,
            dead: true,
          });
        }
        failed = true;
        lastError = lastError ?? `plugin ${entry.pluginId} en quarantaine`;
        continue;
      }

      const delivery = await options.repository.ensureDelivery(
        event.id,
        entry.pluginId,
        now,
      );
      if (delivery.status === "delivered") continue;
      if (delivery.status === "failed") {
        failed = true;
        lastError = lastError ?? delivery.lastError;
        continue;
      }
      if (delivery.availableAt.getTime() > now.getTime()) {
        pending = true;
        nextAvailable =
          nextAvailable === null
            ? delivery.availableAt
            : earlier(nextAvailable, delivery.availableAt);
        continue;
      }

      try {
        const context = options.runtime.contextFor(entry.pluginId, snapshot);
        if (!context) {
          throw new Error(`contexte introuvable pour ${entry.pluginId}`);
        }
        await withTimeout(
          Promise.resolve().then(() => entry.handler(envelope, context)),
          handlerTimeoutMs,
        );
        await options.repository.markDelivered(event.id, entry.pluginId, clock());
        report.delivered += 1;
      } catch (error) {
        const reason = errorMessage(error);
        const attempts = delivery.attempts + 1;
        lastError = reason;

        if (attempts >= maxAttempts) {
          await options.repository.recordFailure(event.id, entry.pluginId, {
            attempts,
            availableAt: now,
            error: reason,
            dead: true,
          });
          quarantined.add(entry.pluginId);
          report.quarantined.push(entry.pluginId);
          await options.repository.failOpenDeliveries(
            entry.pluginId,
            `plugin mis en quarantaine : ${reason}`,
            now,
          );
          await options.runtime.quarantine(
            entry.pluginId,
            `livraison ${key} en échec : ${reason}`,
          );
          failed = true;
          logger.error(
            `[events] ${entry.pluginId} mis en quarantaine après ${attempts} tentatives : ${reason}`,
          );
        } else {
          const delay = Math.min(
            maxDelayMs,
            baseDelayMs * 2 ** (attempts - 1),
          );
          const availableAt = new Date(now.getTime() + delay);
          await options.repository.recordFailure(event.id, entry.pluginId, {
            attempts,
            availableAt,
            error: reason,
            dead: false,
          });
          pending = true;
          nextAvailable =
            nextAvailable === null
              ? availableAt
              : earlier(nextAvailable, availableAt);
          report.retried += 1;
          logger.warn(
            `[events] livraison ${key} → ${entry.pluginId} échouée (${attempts}/${maxAttempts}), reprise dans ${delay} ms : ${reason}`,
          );
        }
      }
    }

    if (pending) {
      await options.repository.rescheduleEvent(
        event.id,
        nextAvailable ?? now,
        lastError,
        now,
      );
      return;
    }

    if (failed) {
      await options.repository.completeEvent(
        event.id,
        "failed",
        lastError,
        now,
      );
      report.failed += 1;
      return;
    }

    await options.repository.completeEvent(event.id, "dispatched", null, now);
    report.dispatched += 1;
  }

  return { dispatch };
}
