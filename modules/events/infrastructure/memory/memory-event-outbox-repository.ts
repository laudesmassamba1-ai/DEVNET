/**
 * Adaptateur mémoire de la boîte d'envoi.
 *
 * Il n'a aucune atomicité à démontrer : il sert aux tests du dispatcheur et à
 * un éventuel mode démonstration. En production, les événements naissent dans
 * la transaction PostgreSQL du fait qui les produit.
 */
import type {
  EnqueueEventInput,
  EventDelivery,
  EventOutboxRepository,
  OutboxEvent,
  OutboxStatus,
  RecordDeliveryFailure,
} from "../../ports/event-outbox-repository";

interface StoredEvent extends OutboxEvent {
  status: OutboxStatus;
  availableAt: Date;
  attempts: number;
  lockedAt: Date | null;
  lastError: string | null;
}

interface StoredDelivery extends EventDelivery {
  deliveredAt: Date | null;
}

function cloneEvent(event: StoredEvent): OutboxEvent {
  return {
    id: event.id,
    type: event.type,
    version: event.version,
    actor: event.actor,
    subject: { ...event.subject },
    data: { ...event.data },
    correlationId: event.correlationId,
    occurredAt: new Date(event.occurredAt),
  };
}

function cloneDelivery(delivery: StoredDelivery): EventDelivery {
  return {
    eventId: delivery.eventId,
    pluginId: delivery.pluginId,
    status: delivery.status,
    attempts: delivery.attempts,
    availableAt: new Date(delivery.availableAt),
    lastError: delivery.lastError,
  };
}

function keyOf(eventId: string, pluginId: string): string {
  return `${eventId}::${pluginId}`;
}

function newId(): string {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class MemoryEventOutboxRepository implements EventOutboxRepository {
  private readonly events = new Map<string, StoredEvent>();
  private readonly deliveries = new Map<string, StoredDelivery>();

  async enqueue(input: EnqueueEventInput): Promise<OutboxEvent> {
    const occurredAt = input.occurredAt ?? new Date();
    const event: StoredEvent = {
      id: newId(),
      type: input.type,
      version: input.version,
      actor: input.actor ?? null,
      subject: { ...(input.subject ?? {}) },
      data: { ...(input.data ?? {}) },
      correlationId: input.correlationId ?? null,
      occurredAt,
      status: "pending",
      availableAt: occurredAt,
      attempts: 0,
      lockedAt: null,
      lastError: null,
    };
    this.events.set(event.id, event);
    return cloneEvent(event);
  }

  async claimDue(
    limit: number,
    now: Date,
    staleBefore: Date,
  ): Promise<OutboxEvent[]> {
    const due = [...this.events.values()]
      .filter((event) => {
        if (event.status === "pending") {
          return event.availableAt.getTime() <= now.getTime();
        }
        if (event.status === "processing") {
          return (
            event.lockedAt !== null &&
            event.lockedAt.getTime() <= staleBefore.getTime()
          );
        }
        return false;
      })
      .sort((a, b) => {
        const byAvailable = a.availableAt.getTime() - b.availableAt.getTime();
        if (byAvailable !== 0) return byAvailable;
        const byOccurred = a.occurredAt.getTime() - b.occurredAt.getTime();
        if (byOccurred !== 0) return byOccurred;
        return a.id.localeCompare(b.id);
      })
      .slice(0, limit);

    for (const event of due) {
      event.status = "processing";
      event.lockedAt = new Date(now);
      event.attempts += 1;
    }
    return due.map(cloneEvent);
  }

  async ensureDelivery(
    eventId: string,
    pluginId: string,
    now: Date,
  ): Promise<EventDelivery> {
    const key = keyOf(eventId, pluginId);
    let delivery = this.deliveries.get(key);
    if (!delivery) {
      delivery = {
        eventId,
        pluginId,
        status: "pending",
        attempts: 0,
        availableAt: new Date(now),
        lastError: null,
        deliveredAt: null,
      };
      this.deliveries.set(key, delivery);
    }
    return cloneDelivery(delivery);
  }

  async markDelivered(
    eventId: string,
    pluginId: string,
    now: Date,
  ): Promise<void> {
    const delivery = this.deliveries.get(keyOf(eventId, pluginId));
    if (!delivery) return;
    delivery.status = "delivered";
    delivery.deliveredAt = new Date(now);
    delivery.lastError = null;
  }

  async recordFailure(
    eventId: string,
    pluginId: string,
    failure: RecordDeliveryFailure,
  ): Promise<void> {
    const delivery = this.deliveries.get(keyOf(eventId, pluginId));
    if (!delivery) return;
    delivery.status = failure.dead ? "failed" : "pending";
    delivery.attempts = failure.attempts;
    delivery.availableAt = new Date(failure.availableAt);
    delivery.lastError = failure.error;
  }

  async failOpenDeliveries(
    pluginId: string,
    error: string,
    now: Date,
  ): Promise<number> {
    let changed = 0;
    for (const delivery of this.deliveries.values()) {
      if (delivery.pluginId !== pluginId || delivery.status !== "pending") {
        continue;
      }
      delivery.status = "failed";
      delivery.availableAt = new Date(now);
      delivery.lastError = error;
      changed += 1;
    }
    return changed;
  }

  async completeEvent(
    eventId: string,
    status: "dispatched" | "failed",
    error: string | null,
    now: Date,
  ): Promise<void> {
    const event = this.events.get(eventId);
    if (!event) return;

    let effective: "dispatched" | "failed" = status;
    for (const delivery of this.deliveries.values()) {
      if (delivery.eventId !== eventId) continue;
      if (delivery.status === "failed") effective = "failed";
      if (delivery.status === "pending") {
        delivery.status = "failed";
        delivery.availableAt = new Date(now);
        delivery.lastError = error ?? "événement terminé sans livraison";
        effective = "failed";
      }
    }

    event.status = effective;
    event.lockedAt = null;
    event.lastError = effective === "failed" ? error : null;
  }

  async rescheduleEvent(
    eventId: string,
    availableAt: Date,
    error: string | null,
    _now: Date,
  ): Promise<void> {
    const event = this.events.get(eventId);
    if (!event) return;
    event.status = "pending";
    event.availableAt = new Date(availableAt);
    event.lockedAt = null;
    event.lastError = error;
  }

  inspect(eventId: string): {
    status: OutboxStatus;
    attempts: number;
    lastError: string | null;
    deliveries: EventDelivery[];
  } | null {
    const event = this.events.get(eventId);
    if (!event) return null;
    return {
      status: event.status,
      attempts: event.attempts,
      lastError: event.lastError,
      deliveries: [...this.deliveries.values()]
        .filter((delivery) => delivery.eventId === eventId)
        .map(cloneDelivery),
    };
  }
}
