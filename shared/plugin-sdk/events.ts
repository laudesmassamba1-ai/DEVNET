/**
 * Enveloppe d'événement versionnée.
 *
 * `data` ne contient que des identifiants et le minimum utile : jamais de
 * contenu privé ni de donnée personnelle brute. La livraison est « au moins
 * une fois » ; un gestionnaire doit donc être idempotent.
 */
import type { EventKey } from "./catalog";
import type { PluginContext } from "./context";

export interface EventEnvelope<TData = Record<string, unknown>> {
  id: string;
  type: string;
  version: number;
  occurredAt: string;
  actor: string | null;
  subject: Record<string, string>;
  data: TData;
  correlationId: string | null;
}

export type PluginEventHandler<TData = Record<string, unknown>> = (
  event: EventEnvelope<TData>,
  context: PluginContext,
) => Promise<void> | void;

export type PluginEventKey = EventKey;
