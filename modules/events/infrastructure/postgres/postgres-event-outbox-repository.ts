/**
 * Adaptateur PostgreSQL de la boîte d'envoi.
 *
 * La réclamation utilise `FOR UPDATE SKIP LOCKED` : deux instances serverless
 * peuvent drainer en parallèle sans se voler les mêmes événements. Un
 * événement resté `processing` au-delà du délai de péremption est repris —
 * c'est le prix de l'« au moins une fois », et la raison pour laquelle les
 * gestionnaires doivent être idempotents.
 */
import type { Pool } from "pg";
import type {
  EnqueueEventInput,
  EventDelivery,
  EventOutboxRepository,
  OutboxEvent,
  RecordDeliveryFailure,
} from "../../ports/event-outbox-repository";

interface OutboxRow {
  id: string;
  type: string;
  version: number;
  actor: string | null;
  subject: unknown;
  data: unknown;
  correlation_id: string | null;
  occurred_at: Date;
}

interface DeliveryRow {
  event_id: string;
  plugin_id: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  available_at: Date;
  last_error: string | null;
}

const OUTBOX_COLUMNS =
  "id, type, version, actor, subject, data, correlation_id, occurred_at";
const DELIVERY_COLUMNS =
  "event_id, plugin_id, status, attempts, available_at, last_error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function toEvent(row: OutboxRow): OutboxEvent {
  return {
    id: row.id,
    type: row.type,
    version: row.version,
    actor: row.actor,
    subject: asStringRecord(row.subject),
    data: asRecord(row.data),
    correlationId: row.correlation_id,
    occurredAt: row.occurred_at,
  };
}

function toDelivery(row: DeliveryRow): EventDelivery {
  return {
    eventId: row.event_id,
    pluginId: row.plugin_id,
    status: row.status,
    attempts: row.attempts,
    availableAt: row.available_at,
    lastError: row.last_error,
  };
}

export class PostgresEventOutboxRepository implements EventOutboxRepository {
  constructor(private readonly pool: Pool) {}

  async enqueue(input: EnqueueEventInput): Promise<OutboxEvent> {
    const occurredAt = input.occurredAt ?? new Date();
    const { rows } = await this.pool.query<OutboxRow>(
      `insert into public.event_outbox
         (type, version, actor, subject, data, correlation_id, occurred_at, available_at)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $7)
       returning ${OUTBOX_COLUMNS}`,
      [
        input.type,
        input.version,
        input.actor ?? null,
        JSON.stringify(input.subject ?? {}),
        JSON.stringify(input.data ?? {}),
        input.correlationId ?? null,
        occurredAt,
      ],
    );
    return toEvent(rows[0]);
  }

  async claimDue(
    limit: number,
    now: Date,
    staleBefore: Date,
  ): Promise<OutboxEvent[]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query<OutboxRow>(
        `select ${OUTBOX_COLUMNS}
           from public.event_outbox
          where (status = 'pending' and available_at <= $2)
             or (status = 'processing' and locked_at is not null and locked_at <= $3)
          order by available_at asc, occurred_at asc, id asc
          limit $1
          for update skip locked`,
        [limit, now, staleBefore],
      );

      if (rows.length > 0) {
        await client.query(
          `update public.event_outbox
              set status = 'processing',
                  locked_at = $2,
                  attempts = attempts + 1
            where id = any($1::uuid[])`,
          [rows.map((row) => row.id), now],
        );
      }

      await client.query("commit");
      return rows.map(toEvent);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureDelivery(
    eventId: string,
    pluginId: string,
    now: Date,
  ): Promise<EventDelivery> {
    const { rows } = await this.pool.query<DeliveryRow>(
      `with inserted as (
         insert into public.event_deliveries
           (event_id, plugin_id, status, attempts, available_at, updated_at)
         values ($1, $2, 'pending', 0, $3, $3)
         on conflict (event_id, plugin_id) do nothing
         returning ${DELIVERY_COLUMNS}
       )
       select ${DELIVERY_COLUMNS} from inserted
       union all
       select ${DELIVERY_COLUMNS}
         from public.event_deliveries
        where event_id = $1 and plugin_id = $2
        limit 1`,
      [eventId, pluginId, now],
    );
    return toDelivery(rows[0]);
  }

  async markDelivered(
    eventId: string,
    pluginId: string,
    now: Date,
  ): Promise<void> {
    await this.pool.query(
      `update public.event_deliveries
          set status = 'delivered',
              delivered_at = $3,
              last_error = null,
              updated_at = $3
        where event_id = $1 and plugin_id = $2`,
      [eventId, pluginId, now],
    );
  }

  async recordFailure(
    eventId: string,
    pluginId: string,
    failure: RecordDeliveryFailure,
  ): Promise<void> {
    const status = failure.dead ? "failed" : "pending";
    await this.pool.query(
      `update public.event_deliveries
          set status = $3,
              attempts = $4,
              available_at = $5,
              last_error = $6,
              updated_at = now()
        where event_id = $1 and plugin_id = $2`,
      [
        eventId,
        pluginId,
        status,
        failure.attempts,
        failure.availableAt,
        failure.error,
      ],
    );
  }

  async failOpenDeliveries(
    pluginId: string,
    error: string,
    now: Date,
  ): Promise<number> {
    const result = await this.pool.query(
      `update public.event_deliveries
          set status = 'failed',
              available_at = $3,
              last_error = $2,
              updated_at = now()
        where plugin_id = $1 and status = 'pending'`,
      [pluginId, error, now],
    );
    return result.rowCount ?? 0;
  }

  async completeEvent(
    eventId: string,
    status: "dispatched" | "failed",
    error: string | null,
    now: Date,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update public.event_deliveries
            set status = 'failed',
                available_at = $3,
                last_error = coalesce(last_error, $2),
                updated_at = now()
          where event_id = $1 and status = 'pending'`,
        [eventId, error ?? "événement terminé sans livraison", now],
      );

      await client.query(
        `update public.event_outbox
            set status = case
                           when $2 = 'dispatched'
                                and exists (
                                  select 1 from public.event_deliveries
                                   where event_id = $1 and status = 'failed'
                                )
                           then 'failed'
                           else $2
                         end,
                locked_at = null,
                last_error = case
                               when $2 = 'failed' then $3
                               when exists (
                                 select 1 from public.event_deliveries
                                  where event_id = $1 and status = 'failed'
                               )
                               then coalesce(last_error, $3)
                               else null
                             end
          where id = $1`,
        [eventId, status, error],
      );
      await client.query("commit");
    } catch (failure) {
      await client.query("rollback").catch(() => undefined);
      throw failure;
    } finally {
      client.release();
    }
  }

  async rescheduleEvent(
    eventId: string,
    availableAt: Date,
    error: string | null,
    _now: Date,
  ): Promise<void> {
    await this.pool.query(
      `update public.event_outbox
          set status = 'pending',
              available_at = $2,
              locked_at = null,
              last_error = $3
        where id = $1`,
      [eventId, availableAt, error],
    );
  }
}
