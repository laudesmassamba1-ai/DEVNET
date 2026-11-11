import type { DirectMessage } from "./types";

export type MessageDeliveryStatus = "sending" | "failed";
export type MessageRow = DirectMessage & { deliveryStatus?: MessageDeliveryStatus };

export function sortMessages(messages: MessageRow[]): MessageRow[] {
  return [...messages].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
  );
}

export function mergeMessage(messages: MessageRow[], message: DirectMessage): MessageRow[] {
  const found = messages.some((item) => item.id === message.id);
  const merged = found
    ? messages.map((item) => item.id === message.id ? message : item)
    : [...messages, message];
  return sortMessages(merged);
}

export function setMessageDeliveryStatus(
  messages: MessageRow[] | null,
  id: string,
  status: MessageDeliveryStatus,
): MessageRow[] | null {
  return messages?.map((message) =>
    message.id === id ? { ...message, deliveryStatus: status } : message,
  ) ?? null;
}
