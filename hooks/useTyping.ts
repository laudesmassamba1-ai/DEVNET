"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";

/**
 * Qui est en train d'écrire, dans cette conversation ou ce canal.
 *
 * ## Pourquoi un signal et pas une colonne
 *
 * « Je tape » est un état **volatile** : il n'a pas d'intérêt à être
 * conservé (personne ne veut savoir que Koffi a tapé il y a trois
 * heures), et il n'a aucun risque à être perdu. Le stocker serait une
 * ligne en base à maintenir pour une information qui vaut trois
 * secondes. Le `broadcast` de Supabase Realtime est exactement l'outil
 * pour ça : il porte un message d'un client aux autres, sans écrire.
 *
 * C'est aussi ce qui rend le mode démonstration honnête : le démo
 * implémente le même `send` / `on("broadcast")`, donc l'indicateur
 * s'affiche dans les deux modes au lieu d'être une fonction morte
 * ailleurs.
 *
 * ## Pourquoi l'expiration est nécessaire
 *
 * Un signal de frappe émis puis oublié reste « en train d'écrire » pour
 * toujours : la personne a fermé l'onglet, changé d'appareil, ou son
 * réseau a lâché après l'envoi. On expire donc chaque signal au bout de
 * quelques secondes, ce qui correspond à la durée réelle d'une frappe —
 * quelqu'un qui écrit vraiment réémet toutes les deux secondes.
 */

/** Délai après lequel un signal de frappe est considéré périmé. */
const TYPING_TTL_MS = 6_000;

/** Cadence minimale entre deux envois : un signal, pas un flux de touches. */
const TYPING_THROTTLE_MS = 2_500;

export interface TypingPeer {
  userId: string;
}

export function useTyping(channelName: string | null, me: string | null) {
  /** Les pairs dont le signal n'est pas périmé. */
  const [peers, setPeers] = useState<TypingPeer[]>([]);

  /** Dernier signal reçu, par pair — sert à l'expiration. */
  const seen = useRef(new Map<string, number>());
  /** Le canal courant, pour pouvoir émettre sans le repasser à l'appel. */
  const channelRef = useRef<ReturnType<typeof api.channel> | null>(null);
  /** Le dernier envoi : on ne diffuse pas à chaque frappe. */
  const lastSent = useRef(0);

  useEffect(() => {
    if (!channelName || !me) return;

    // La map est recréée à chaque abonnement : le nettoyage doit vider
    // **celle-là**, pas celle qui aura été remplacée au prochain
    // changement de canal. Une référence lue au moment du cleanup peut
    // déjà avoir changé — c'est exactement l'avertissement que le
    // linter donne ici, et il a raison.
    const table = new Map<string, number>();
    seen.current = table;

    const channel = api
      .channel(channelName)
      .on("broadcast", { event: "typing" }, (message) => {
        const signal = message.payload as { userId?: string; typing?: boolean } | null;
        // On ignore son propre signal : l'auteur ne se voit pas taper.
        if (!signal?.userId || signal.userId === me) return;

        if (signal.typing) table.set(signal.userId, Date.now());
        else table.delete(signal.userId);

        setPeers(Array.from(table.keys()).map((userId) => ({ userId })));
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      // Signaler l'arrêt de frappe **avant** de fermer le canal : sans
      // cela, l'autre côté garderait « écrit… » jusqu'à l'expiration — un
      // fantôme que personne n'a demandé à voir.
      if (me) {
        void channel.send({
          type: "broadcast",
          event: "typing",
          payload: { userId: me, typing: false },
        });
      }
      void api.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
      table.clear();
      // L'état est vidé **dans le cleanup**, pas dans le corps de
      // l'effet : un `setState` synchrone au montage provoque un second
      // rendu à chaque changement de conversation, pour annoncer un
      // état qui était déjà vrai (aucun pair).
      setPeers([]);
    };
  }, [channelName, me]);

  // Expiration : un pair qui cesse d'envoyer finit par disparaître.
  // Sans ça, un message de frappe resterait affiché jusqu'au rechargement
  // de la page — c'est-à-dire beaucoup trop longtemps.
  useEffect(() => {
    if (peers.length === 0) return;

    const timer = setInterval(() => {
      const limite = Date.now() - TYPING_TTL_MS;
      let change = false;

      for (const [userId, at] of seen.current) {
        if (at < limite) {
          seen.current.delete(userId);
          change = true;
        }
      }

      if (change) setPeers(Array.from(seen.current.keys()).map((userId) => ({ userId })));
    }, 1_500);

    return () => clearInterval(timer);
  }, [peers.length]);

  /**
   * À appeler quand la personne tape.
   *
   * Le garde-fou temporel évite un message par touche : une frappe à
   * huit caractères par seconde produirait huit envois par seconde, et le
   * canal est censé porter un signal, pas un flux de frappes.
   */
  const notifyTyping = useCallback(() => {
    const channel = channelRef.current;
    if (!channel || !me) return;

    const maintenant = Date.now();
    if (maintenant - lastSent.current < TYPING_THROTTLE_MS) return;
    lastSent.current = maintenant;

    void channel.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: me, typing: true },
    });
  }, [me]);

  /**
   * À appeler quand on cesse d'écrire (message envoyé, feuille fermée) :
   * fait tomber l'indicateur chez l'autre côté **immédiatement**, sans
   * attendre l'expiration — envoyer un message n'est pas finir de taper.
   */
  const stopTyping = useCallback(() => {
    const channel = channelRef.current;
    if (!channel || !me) return;

    void channel.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: me, typing: false },
    });
  }, [me]);

  return { peers, notifyTyping, stopTyping };
}