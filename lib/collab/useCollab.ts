"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  appendChat,
  decodeChat,
  decodeCursor,
  encodeChat,
  encodeCursor,
  unwrapBroadcast,
  type CollabChatMessage,
  type CollabCursor,
  type CollabPosition,
  type CollabSelf,
} from "./cursors";

/**
 * Le canal d'un fichier — curseurs et discussion d'équipe.
 *
 * ## Un seul canal, deux besoins
 *
 * Curseur et discussion partagent la salle (`ide:<projet>:<chemin>`) et
 * donc **un seul abonnement**. C'est important pour la démonstration : son
 * bus local ne tient qu'un écouteur par couple `canal|événement`, si bien
 * que deux abonnements concurrents se recouvriraient. Un abonnement unique
 * — c'est le cas ici — évite la question.
 *
 * ## Ce qui est volatile et ce qui ne l'est pas
 *
 * Un curseur et un message de discussion sont des signaux `broadcast` :
 * ils ne sont **jamais** écrits en base. Un curseur qui traîne trois
 * heures ne veut rien dire ; un message d'équipe, dans cette tranche, vit
 * le temps de la session. Conséquence assumée : le fil d'équipe ne
 * survit pas à un rechargement, et la démonstration multi-onglets ne le
 * fait pas voyager — un bus en mémoire ne traverse pas deux onglets.
 *
 * ## L'écart réel / démo
 *
 * Le vrai Supabase remet l'enveloppe `{ type, event, payload }`, le démo
 * remet le corps nu. `unwrapBroadcast` absorbe l'écart ; l'écouteur ne
 * sait pas dans quel mode il tourne.
 */

/** Cadence minimale entre deux envois de curseur : un signal, pas un flux. */
export const CURSOR_THROTTLE_MS = 90;

/** Délai après lequel un curseur sans nouvelle est considéré périmé. */
export const CURSOR_TTL_MS = 6_000;

/** Les deux événements du canal. Exposés pour que l'intégration les cite. */
export const CURSOR_EVENT = "cursor";
export const CHAT_EVENT = "chat";

export interface UseCollabOptions {
  /**
   * La salle. `null` n'ouvre rien — utile quand aucun fichier n'est ouvert,
   * ou qu'on attend la session.
   */
  room: string | null;
  /** Mon identité. `null` avant que la session soit résolue. */
  self: CollabSelf | null;
}

export interface UseCollab {
  /** Les curseurs distants vivants, dédupliqués par personne. */
  cursors: CollabCursor[];
  /** Le fil d'équipe, dans l'ordre d'arrivée. */
  messages: CollabChatMessage[];
  /** Diffuse ma position (étranglée). */
  sendCursor: (anchor: CollabPosition, head: CollabPosition) => void;
  /** Écrit dans le fil. Le message est ajouté localement **puis** diffusé. */
  sendChat: (text: string) => void;
}

export function useCollab({ room, self }: UseCollabOptions): UseCollab {
  const [cursors, setCursors] = useState<CollabCursor[]>([]);
  const [messages, setMessages] = useState<CollabChatMessage[]>([]);

  /** Le canal courant, pour émettre sans le repasser à l'appel. */
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  /** Dernier curseur reçu, par personne — sert à l'expiration. */
  const seen = useRef(new Map<string, number>());
  /** Les curseurs vivants, en `Map` pour un remplacement sans balayage. */
  const byUser = useRef(new Map<string, CollabCursor>());
  /** Le dernier envoi de curseur : on ne diffuse pas à chaque frappe. */
  const lastSent = useRef(0);
  /** Compteur local, pour que deux messages d'une même milliseconde diffèrent. */
  const seq = useRef(0);

  /**
   * Mon identité, lue au moment de l'envoi.
   *
   * L'identité change moins souvent que les rappels ne se recréent ; une
   * référence évite de dépendre de `pseudo` et `color` dans chaque
   * `sendCallback`, dépendance qui réabonnerait le canal pour un
   * changement d'avatar.
   */
  const selfRef = useRef<CollabSelf | null>(self);
  useEffect(() => {
    selfRef.current = self;
  }, [self]);

  const selfId = self?.id ?? null;

  useEffect(() => {
    if (!room || !selfId) return;

    // Les tables sont recréées à chaque abonnement : le nettoyage doit
    // vider **celles-ci**, pas celles qui les remplaceront au prochain
    // changement de fichier.
    const table = new Map<string, number>();
    const users = new Map<string, CollabCursor>();
    seen.current = table;
    byUser.current = users;

    const channel = supabase
      .channel(room)
      .on("broadcast", { event: CURSOR_EVENT }, (message: unknown) => {
        const cursor = decodeCursor(unwrapBroadcast(message));
        // On ignore son propre curseur : l'auteur ne se voit pas lui-même.
        if (!cursor || cursor.userId === selfId) return;

        users.set(cursor.userId, cursor);
        table.set(cursor.userId, Date.now());
        setCursors(Array.from(users.values()));
      })
      .on("broadcast", { event: CHAT_EVENT }, (message: unknown) => {
        const chat = decodeChat(unwrapBroadcast(message));
        if (!chat || chat.userId === selfId) return;
        setMessages((previous) => appendChat(previous, chat));
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      void supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
      users.clear();
      table.clear();
      setCursors([]);
      // Le fil est celui de **ce** fichier : changer de salle le vide.
      setMessages([]);
    };
  }, [room, selfId]);

  // Expiration : un curseur qui cesse d'être réémis finit par disparaître.
  // Sans cela, un onglet fermé laisserait un caret figé indéfiniment.
  useEffect(() => {
    if (cursors.length === 0) return;

    const timer = setInterval(() => {
      const limit = Date.now() - CURSOR_TTL_MS;
      let change = false;

      for (const [userId, at] of seen.current) {
        if (at < limit) {
          seen.current.delete(userId);
          byUser.current.delete(userId);
          change = true;
        }
      }

      if (change) setCursors(Array.from(byUser.current.values()));
    }, 1_500);

    return () => clearInterval(timer);
  }, [cursors.length]);

  const sendCursor = useCallback(
    (anchor: CollabPosition, head: CollabPosition) => {
      const channel = channelRef.current;
      const me = selfRef.current;
      if (!channel || !me || !room) return;

      const now = Date.now();
      if (now - lastSent.current < CURSOR_THROTTLE_MS) return;
      lastSent.current = now;

      void channel.send({
        type: "broadcast",
        event: CURSOR_EVENT,
        payload: encodeCursor({
          userId: me.id,
          pseudo: me.pseudo,
          color: me.color,
          path: me.path,
          anchor,
          head,
        }),
      });
    },
    [room],
  );

  const sendChat = useCallback(
    (text: string) => {
      const channel = channelRef.current;
      const me = selfRef.current;
      if (!channel || !me || !room) return;

      const clean = text.trim();
      if (!clean) return;

      seq.current += 1;
      const message: CollabChatMessage = {
        id: `${me.id}:${Date.now()}:${seq.current}`,
        userId: me.id,
        pseudo: me.pseudo,
        color: me.color,
        text: clean,
        at: new Date().toISOString(),
      };

      // On ajoute **avant** d'émettre : le réel n'écho pas l'auteur, le
      // démo renvoie le signal à l'expéditeur. Dans les deux cas, la seule
      // copie du message que l'auteur voit est celle-ci.
      setMessages((previous) => appendChat(previous, message));

      void channel.send({
        type: "broadcast",
        event: CHAT_EVENT,
        payload: encodeChat(message),
      });
    },
    [room],
  );

  return { cursors, messages, sendCursor, sendChat };
}
