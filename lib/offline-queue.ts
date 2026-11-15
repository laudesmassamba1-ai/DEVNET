"use client";

/**
 * File d'écritures hors-ligne.
 *
 * Une action faite sans réseau ne doit pas être perdue, et elle ne doit pas
 * être rejouée deux fois. Deux règles portent ce fichier :
 *
 *  1. l'identifiant de l'opération est déterministe. Un like, un signet ou
 *     un message garde le même identifiant entre la mise en file et le
 *     rejeu, donc une réponse perdue ne crée pas de doublon ;
 *  2. les états sont **absolus**, jamais des bascules. Rejouer « aimer »
 *     ne dépend pas de l'état du serveur au moment du rejeu, et deux
 *     clics hors-ligne se réduisent au dernier état voulu.
 *
 * La file vit dans IndexedDB, pas dans localStorage : le texte d'un
 * message privé n'a rien à faire dans un stockage synchrone lisible par
 * tous les scripts de la page. Elle est purgée avec la session.
 */
import { api } from "@/lib/api/client";
import type { DirectMessage } from "@/lib/types";

export const OFFLINE_QUEUE_EVENT = "devnet:offline-queue";
export const OFFLINE_MUTATION_SENT_EVENT = "devnet:offline-mutation-sent";

const DB_NAME = "devnet-offline-writes";
const STORE = "mutations";
const DB_VERSION = 1;

type MutationState = "pending" | "failed";

type BaseMutation = {
  id: string;
  createdAt: number;
  attempts: number;
  state: MutationState;
  lastError?: string;
};

export type QueuedMutation =
  | (BaseMutation & { kind: "message"; message: DirectMessage })
  | (BaseMutation & {
      kind: "like";
      postId: string;
      userId: string;
      liked: boolean;
    })
  | (BaseMutation & {
      kind: "bookmark";
      postId: string;
      userId: string;
      bookmarked: boolean;
    });

export type OfflineQueueSummary = { pending: number; failed: number };

let databasePromise: Promise<IDBDatabase> | null = null;
let activeFlush: Promise<OfflineQueueSummary> | null = null;

function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB indisponible"));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB refusé"));
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB en échec"));
  });
}

async function putMutation(mutation: QueuedMutation): Promise<void> {
  const db = await database();
  const transaction = db.transaction(STORE, "readwrite");
  await requestResult(transaction.objectStore(STORE).put(mutation));
}

async function removeMutation(id: string): Promise<void> {
  const db = await database();
  const transaction = db.transaction(STORE, "readwrite");
  await requestResult(transaction.objectStore(STORE).delete(id));
}

async function readMutations(): Promise<QueuedMutation[]> {
  const db = await database();
  const transaction = db.transaction(STORE, "readonly");
  const rows = await requestResult(
    transaction.objectStore(STORE).getAll() as IDBRequest<QueuedMutation[]>,
  );
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

function notifyQueue(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OFFLINE_QUEUE_EVENT));
}

function base(id: string): BaseMutation {
  return { id, createdAt: Date.now(), attempts: 0, state: "pending" };
}

/** Un message en attente garde son identifiant : le serveur le déduplique. */
export async function enqueueOfflineMessage(message: DirectMessage): Promise<boolean> {
  try {
    await putMutation({
      ...base(`message:${message.id}`),
      kind: "message",
      message,
    });
    notifyQueue();
    return true;
  } catch {
    return false;
  }
}

/** Un like hors-ligne retient l'état voulu, pas le geste. */
export async function enqueueOfflineLike(
  postId: string,
  userId: string,
  liked: boolean,
): Promise<boolean> {
  try {
    await putMutation({
      ...base(`like:${postId}:${userId}`),
      kind: "like",
      postId,
      userId,
      liked,
    });
    notifyQueue();
    return true;
  } catch {
    return false;
  }
}

/** Même règle pour un signet. */
export async function enqueueOfflineBookmark(
  postId: string,
  userId: string,
  bookmarked: boolean,
): Promise<boolean> {
  try {
    await putMutation({
      ...base(`bookmark:${postId}:${userId}`),
      kind: "bookmark",
      postId,
      userId,
      bookmarked,
    });
    notifyQueue();
    return true;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Erreur inconnue";
}

/**
 * Une erreur est rejouable quand elle vient du réseau ou d'une panne
 * serveur. Un refus RLS, une validation ou un doublon ne le sont pas :
 * les rejouer en boucle ne changerait rien et masquerait le vrai problème.
 */
export function isRetryableOfflineError(error: unknown): boolean {
  const code = errorCode(error);
  if (code === "NETWORK" || code === "ECONNREFUSED" || code === "ETIMEDOUT") return true;
  if (code && /^5\d\d$/.test(code)) return true;
  const message = errorMessage(error).toLowerCase();
  return message.includes("network") || message.includes("fetch") ||
    message.includes("réseau") || message.includes("timeout");
}

async function executeMutation(mutation: QueuedMutation): Promise<void> {
  if (mutation.kind === "message") {
    const message = mutation.message;
    const { error } = await api.from("direct_messages").insert({
      id: message.id,
      conversation_id: message.conversation_id,
      author_id: message.author_id,
      author_name: message.author_name,
      text: message.text,
      is_code: message.is_code ?? false,
      gif_url: message.gif_url ?? "",
      gif_alt: message.gif_alt ?? "",
      sticker_id: message.sticker_id ?? null,
      media_url: message.media_url ?? "",
      media_type: message.media_type ?? "",
      reply_to_id: message.reply_to_id ?? null,
    });

    // 23505 signifie que le message est déjà arrivé : la réponse a été
    // perdue, pas l'écriture. C'est le cas idempotent attendu.
    if (error && error.code !== "23505") throw error;

    if (!error) {
      await api.from("conversations").update({
        last_message: message.text,
        last_message_at: message.created_at,
      }).eq("id", message.conversation_id);
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(OFFLINE_MUTATION_SENT_EVENT, {
        detail: { kind: "message", id: message.id, conversationId: message.conversation_id },
      }));
    }
    return;
  }

  if (mutation.kind === "like") {
    const { error } = mutation.liked
      ? await api.from("post_likes").insert({
          post_id: mutation.postId,
          user_id: mutation.userId,
        })
      : await api.from("post_likes").delete()
          .eq("post_id", mutation.postId)
          .eq("user_id", mutation.userId);
    if (error && error.code !== "23505") throw error;
    return;
  }

  const { error } = mutation.bookmarked
    ? await api.from("bookmarks").insert({
        post_id: mutation.postId,
        user_id: mutation.userId,
      })
    : await api.from("bookmarks").delete()
        .eq("post_id", mutation.postId)
        .eq("user_id", mutation.userId);
  if (error && error.code !== "23505") throw error;
}

/**
 * Rejoue la file dans l'ordre. Un seul rejeu peut tourner à la fois : deux
 * onglets qui se reconnectent ensemble ne doivent pas doubler les envois.
 */
export function flushOfflineQueue(options?: {
  retryFailed?: boolean;
}): Promise<OfflineQueueSummary> {
  if (typeof window === "undefined") return Promise.resolve({ pending: 0, failed: 0 });
  if (!navigator.onLine) return offlineQueueSummary();
  if (activeFlush) return activeFlush;

  activeFlush = (async () => {
    const rows = await readMutations();

    for (const row of rows) {
      if (row.state === "failed" && !options?.retryFailed) continue;

      try {
        await executeMutation(row);
        await removeMutation(row.id);
        notifyQueue();
      } catch (error) {
        if (!isRetryableOfflineError(error)) {
          await putMutation({
            ...row,
            attempts: row.attempts + 1,
            state: "failed",
            lastError: errorMessage(error),
          });
          continue;
        }

        await putMutation({
          ...row,
          attempts: row.attempts + 1,
          state: "pending",
          lastError: errorMessage(error),
        });
        break;
      }
    }

    const summary = await offlineQueueSummary();
    notifyQueue();
    return summary;
  })().finally(() => {
    activeFlush = null;
  });

  return activeFlush;
}

export async function offlineQueueSummary(): Promise<OfflineQueueSummary> {
  if (typeof indexedDB === "undefined") return { pending: 0, failed: 0 };
  try {
    const rows = await readMutations();
    return {
      pending: rows.filter((row) => row.state !== "failed").length,
      failed: rows.filter((row) => row.state === "failed").length,
    };
  } catch {
    return { pending: 0, failed: 0 };
  }
}

/** Purge la file avec la session : elle contient des textes privés. */
export async function purgeOfflineQueue(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await database();
    const transaction = db.transaction(STORE, "readwrite");
    await requestResult(transaction.objectStore(STORE).clear());
  } catch {
    // Une file illisible ne doit pas bloquer la déconnexion.
  }
  notifyQueue();
}
