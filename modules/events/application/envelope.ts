import type { EventEnvelope } from "@devnet/plugin-sdk";
import type { OutboxEvent } from "../ports/event-outbox-repository";

export function toEventEnvelope(event: OutboxEvent): EventEnvelope {
  return {
    id: event.id,
    type: event.type,
    version: event.version,
    occurredAt: event.occurredAt.toISOString(),
    actor: event.actor ? `user:${event.actor}` : null,
    subject: event.subject,
    data: event.data,
    correlationId: event.correlationId,
  };
}

export function eventKeyOf(event: OutboxEvent): string {
  return `${event.type}@${event.version}`;
}
