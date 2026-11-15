/**
 * Port de la boîte d'envoi.
 *
 * Le domaine ne connaît ni `pg`, ni Supabase, ni le temps réel : il réclame
 * des événements dus, exécute les gestionnaires, puis consigne le résultat.
 * L'adaptateur décide comment cette consignation est atomique.
 */

export type OutboxStatus = "pending" | "processing" | "dispatched" | "failed";
export type DeliveryStatus = "pending" | "delivered" | "failed";

export interface OutboxEvent {
  id: string;
  type: string;
  version: number;
  actor: string | null;
  subject: Record<string, string>;
  data: Record<string, unknown>;
  correlationId: string | null;
  occurredAt: Date;
}

export interface EventDelivery {
  eventId: string;
  pluginId: string;
  status: DeliveryStatus;
  attempts: number;
  availableAt: Date;
  lastError: string | null;
}

export interface EnqueueEventInput {
  type: string;
  version: number;
  actor?: string | null;
  subject?: Record<string, string>;
  data?: Record<string, unknown>;
  correlationId?: string | null;
  occurredAt?: Date;
}

export interface RecordDeliveryFailure {
  attempts: number;
  availableAt: Date;
  error: string;
  dead: boolean;
}

export interface EventOutboxRepository {
  enqueue(input: EnqueueEventInput): Promise<OutboxEvent>;
  claimDue(limit: number, now: Date, staleBefore: Date): Promise<OutboxEvent[]>;
  ensureDelivery(
    eventId: string,
    pluginId: string,
    now: Date,
  ): Promise<EventDelivery>;
  markDelivered(eventId: string, pluginId: string, now: Date): Promise<void>;
  recordFailure(
    eventId: string,
    pluginId: string,
    failure: RecordDeliveryFailure,
  ): Promise<void>;
  failOpenDeliveries(pluginId: string, error: string, now: Date): Promise<number>;
  completeEvent(
    eventId: string,
    status: Extract<OutboxStatus, "dispatched" | "failed">,
    error: string | null,
    now: Date,
  ): Promise<void>;
  rescheduleEvent(
    eventId: string,
    availableAt: Date,
    error: string | null,
    now: Date,
  ): Promise<void>;
}
