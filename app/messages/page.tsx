"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell, IconButton } from "@/components/AppShell";
import { Avatar, EmptyState, Loading } from "@/components/Avatar";
import { Sheet } from "@/components/Sheet";
import { Icon } from "@/components/Icon";
import { Receipt } from "@/components/Receipt";
import { TypingLine } from "@/components/TypingDots";
import { MessageExtras, ReplyQuote } from "@/components/MessageExtras";
import { MessageAttachmentButtons, MessageAttachmentView } from "@/components/MessageAttachments";
import { DMContext } from "@/components/DMContext";
import { ChatComposer, ComposerBar } from "@/components/ChatComposer";
import { useToast } from "@/components/Toast";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { badgeFor, xpOf } from "@/lib/verification";
import { loadAuthorXp } from "@/lib/author-xp";
import { api } from "@/lib/api/client";
import { uploadMedia } from "@/lib/media";
import { StudioEditor } from "@/components/studio/StudioEditor";
import { useSession } from "@/hooks/useSession";
import { useTyping } from "@/hooks/useTyping";
import { clockTime } from "@/lib/utils";
import { splitContent } from "@/lib/text";
import {
  mergeMessage,
  setMessageDeliveryStatus,
  sortMessages,
  type MessageRow,
} from "@/lib/message-delivery";
import {
  fetchUnreadConversations,
  markConversationRead,
} from "@/lib/notifications";
import {
  fetchConversationReadMarks,
  markConversationRead as markRead,
  receiptFor,
} from "@/lib/reads";
import {
  deleteMessage,
  fetchMessageReactions,
  fetchPinnedMessageIds,
  toggleMessagePin,
  toggleMessageReaction,
  type ReactionsByMessage,
  type ReactionSummary,
} from "@/lib/messages";
import { cascade } from "@/components/Motion";
import type { Conversation, DirectMessage, UserLite } from "@/lib/types";
import { canSendMessage, attachmentColumns, type MessageAttachment } from "@/lib/message-media";
import { fetchStickers, type StickerRowView } from "@/lib/stickers";

type Peer = { conv: Conversation; other: (UserLite & { xp?: number }) | null };

/** Clé de conversation stable entre deux participants, triée. */
function convKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/** Ajoute un message reçu à la liste affichée, sans doublon. */
export default function MessagesPage() {
  const { profile } = useSession();
  const toast = useToast();
  const router = useRouter();

  const [convs, setConvs] = useState<Peer[] | null>(null);
  const [active, setActive] = useState<Peer | null>(null);
  const [messages, setMessages] = useState<MessageRow[] | null>(null);
  const [text, setText] = useState("");
  const [studioOpen, setStudioOpen] = useState(false);
  /** Média importé, encore local : il ouvre l'atelier avant tout envoi. */
  const [studioSource, setStudioSource] = useState<{
    file: File;
    url: string;
    kind: "image" | "video";
    name: string;
  } | null>(null);
  const [openNew, setOpenNew] = useState(false);
  /** Recherche dans la **liste** des conversations : filtre d'affichage. */
  const [search, setSearch] = useState("");
  /** Recherche de contacts dans la feuille « nouvelle conversation ». */
  const [userSearch, setUserSearch] = useState("");
  /** Recherche **dans** la conversation ouverte : filtre d'affichage. */
  const [find, setFind] = useState("");
  /** La recherche est repliée par défaut : un champ permanent au-dessus
   *  de chaque conversation est du bruit pour un geste rare. */
  const [findOpen, setFindOpen] = useState(false);
  /** Messages affichés : toute la conversation, ou ceux qui correspondent. */
  const findQ = find.trim().toLowerCase();
  const visible = findQ
    ? (messages ?? []).filter((m) => m.text.toLowerCase().includes(findQ))
    : messages;
  const [users, setUsers] = useState<UserLite[]>([]);
  /** Messages non lus par conversation, avec leur quantité. */
  const [unreadConvs, setUnreadConvs] = useState<Record<string, number>>({});
  /**
   * Instants de lecture par personne, dans la conversation ouverte.
   *
   * Ce n'est pas une notification : c'est l'**état** de lecture, relu à
   * l'ouverture puis recalculé à chaque message reçu. Un `✓✓` posé au
   * clic ne survivrait pas au changement d'appareil ; celui-ci, si.
   */
  const [readMarks, setReadMarks] = useState<Record<string, string | null>>({});
  /** Prénoms des pairs dont le signal de frappe est actif. */
  const [typingNames, setTypingNames] = useState<string[]>([]);
  /** Réactions agrégées par message, pour la conversation ouverte. */
  const [reactions, setReactions] = useState<ReactionsByMessage>({});
  /** Messages épinglés par **moi** — les épingles sont privées. */
  const [pins, setPins] = useState<Set<string>>(new Set());
  /** Le message auquel la prochaine envoi répondra. */
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  /** Le message en cours de correction — `null` quand on écrit du neuf. */
  const [editing, setEditing] = useState<DirectMessage | null>(null);
  /** Le prochain message part comme bloc de code (migration 041). */
  const [asCode, setAsCode] = useState(false);
  /**
   * Catalogue des stickers, indexé par identifiant : un message ne
   * stocke que `sticker_id`, et la bulle a besoin du glyphe. Une seule
   * requête pour tout l'écran, refaite jamais — le catalogue change
   * rarement, et un sticker retiré laisse simplement une bulle sans
   * image plutôt qu'un écran en erreur.
   */
  const [stickerCatalog, setStickerCatalog] = useState<Map<string, StickerRowView>>(new Map());

  // Message dont la suppression attend confirmation. Une suppression est
  // irréversible : on ne la déclenche pas sur un clic, surtout que la
  // poubelle vit à côté de l'épingle et de la réponse.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  /** Conversation dont le chargement est terminé — le canal peut livrer en direct. */
  const loadStateRef = useRef<{ cid: string; ready: boolean } | null>(null);
  /** Messages reçus pendant le chargement, rejoués quand il se termine. */
  const pendingRef = useRef<DirectMessage[]>([]);
  /** Messages locaux gardés jusqu'à confirmation du serveur, par conversation. */
  const pendingOutgoingRef = useRef(new Map<string, Map<string, MessageRow>>());

  const sending = messages?.some((message) => message.deliveryStatus === "sending") ?? false;
  /** Un fichier est en cours de téléversement : le composeur reste bloqué. */
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const profileId = profile?.id;

  /*
   * La frappe (« X écrit… ») passe par un canal `broadcast` **distinct**
   * de celui des messages : `api.channel()` réutilise l'instance
   * d'un topic déjà existant, et ajouter une liaison à un canal déjà
   * abonné lève « cannot add `postgres_changes` callbacks after
   * `subscribe()` ». Deux topics, donc deux canaux — un pour la donnée
   * (`dm-<conv>`), un pour le signal volatil (`dm-typing-<conv>`).
   */
  const { peers: typingPeers, notifyTyping, stopTyping } = useTyping(
    active ? `dm-typing-${active.conv.id}` : null,
    profile?.id ?? null,
  );

  /**
   * Lecture des conversations — fonction pure.
   *
   * Elle était écrite deux fois dans cette page : une version mémorisée pour
   * l'envoi d'un message, une version recopiée dans l'effet de montage. Les
   * deux tournaient, donc chaque ouverture de page déclenchait deux fois la
   * cascade requêtes/conversations + N requêtes/users. Une seule version,
   * dont l'effet ne fait que lire le résultat.
   */
  const fetchConvs = useCallback(async (): Promise<Peer[]> => {
    if (!profileId) return [];

    const { data } = await api
      .from("conversations")
      .select("*")
      .contains("participants", [profileId])
      .order("last_message_at", { ascending: false });

    const rows = (data as Conversation[]) ?? [];
    const peers = await Promise.all(rows.map(async (conv) => {
      const otherId = conv.participants.find((p) => p !== profileId);
      if (!otherId) return { conv, other: null };
      const { data: u } = await api
        .from("users")
        .select("id, prenom, pseudo, avatar_color, account_type, verified, dm_media")
        .eq("id", otherId)
        .single();
      return { conv, other: (u as UserLite) ?? null };
    }));

    const xp = await loadAuthorXp(peers.map((p) => p.other?.id));
    if (xp.size === 0) return peers;
    return peers.map((p) => {
      const value = p.other ? xp.get(p.other.id) : undefined;
      if (!p.other || value === undefined) return p;
      return { ...p, other: { ...p.other, xp: value } };
    });
  }, [profileId]);

  /**
   * Recharge et remplace l'état — pour les actions utilisateur.
   *
   * `isAlive` n'est passé que par l'effet de montage, qui doit ignorer
   * la réponse si le composant a été démonté entre la requête et son
   * retour. Les actions utilisateur l'appellent sans argument : elles
   * sont déclenchées depuis un composant vivant, donc le test serait
   * toujours vrai et ne coûterait rien.
   *
   * Ce chemin est unique : avant, l'effet de montage et ce callback
   * listaient les conversations chacun de leur côté, et il fallait
   * maintenir les deux en phase.
   */
  const refresh = useCallback(async (isAlive?: () => boolean) => {
    const [peers, unread] = await Promise.all([
      fetchConvs(),
      profileId ? fetchUnreadConversations(profileId) : Promise.resolve<Record<string, number>>({}),
    ]);
    if (isAlive && !isAlive()) return;
    setConvs(peers);
    setUnreadConvs(unread);
  }, [fetchConvs, profileId]);

  useEffect(() => {
    // Le corps du loader est inliné ici plutôt qu'appelé : la règle
    // `set-state-in-effect` suit l'appel d'un `useCallback` du même
    // composant, mais accepte la forme IIFE locale avec garde de montage.
    let alive = true;
    void (async () => {
      const [peers, unread] = await Promise.all([
        fetchConvs(),
        profileId
          ? fetchUnreadConversations(profileId)
          : Promise.resolve<Record<string, number>>({}),
      ]);
      if (!alive) return;
      setConvs(peers);
      setUnreadConvs(unread);
    })();
    return () => {
      alive = false;
    };
  }, [refresh, fetchConvs, profileId]);

  // Temps réel sur la conversation ouverte
  useEffect(() => {
    if (!active) return;

    const cid = active.conv.id;
    let alive = true;
    // Le chargement repart de zéro : tant qu'il n'est pas fini, les
    // messages reçus vont dans le buffer au lieu de se perdre dans une
    // liste encore vide ou déjà parti consulter la précédente
    // conversation.
    loadStateRef.current = { cid, ready: false };
    pendingRef.current = [];

    (async () => {
      // Du plus récent au plus ancien, puis retourné : on charge les
      // **derniers** 100 messages, jamais les 100 premiers d'une
      // conversation qui en a mille.
      const { data } = await api
        .from("direct_messages").select("*").eq("conversation_id", cid)
        .order("created_at", { ascending: false }).limit(100);
      const rows = ((data as DirectMessage[]) ?? []).reverse();
      // Qui a changé de conversation pendant la lecture ? La réponse
      // n'a plus sa place — elle parlerait d'un autre fil.
      if (!alive || active?.conv.id !== cid) return;

      // Les messages qui sont tombés pendant la lecture sont rejoués par
      //-dessus, dédupliqués, et l'ensemble est trié.
      const pending = pendingRef.current;
      pendingRef.current = [];
      const outgoing = pendingOutgoingRef.current.get(cid);
      for (const message of [...rows, ...pending]) outgoing?.delete(message.id);
      const merged = [...(outgoing?.values() ?? []), ...rows, ...pending]
        .reduce<MessageRow[]>((result, message) => mergeMessage(result, message), []);
      if (outgoing) {
        for (const [id, message] of outgoing) {
          if (!message.deliveryStatus) outgoing.delete(id);
        }
      }
      if (outgoing?.size === 0) pendingOutgoingRef.current.delete(cid);
      setMessages(sortMessages(merged));
      loadStateRef.current = { cid, ready: true };
      setReplyTo(null);
      // Un brouillon de correction appartient au fil qu'on vient de
      // quitter : le garder l'appliquerait au message d'un autre fil.
      // Le champ est vidé pour la même raison — un texte commencé ici ne
      // doit pas partir dans la conversation suivante sans qu'on l'ait
      // demandé.
      setEditing(null);
      setAsCode(false);
      setText("");

      // Réactions et épingles en **deux requêtes** pour toute la
      // conversation : une par bulle rendrait l'ouverture de l'écran
      // proportionnelle à la longueur de l'historique.
      if (profileId && rows.length > 0) {
        const [rx, pinned] = await Promise.all([
          fetchMessageReactions("direct_message", rows.map((r) => r.id), profileId),
          fetchPinnedMessageIds("direct_message", profileId),
        ]);
        if (!alive || active?.conv.id !== cid) return;
        setReactions(rx);
        setPins(pinned);
      } else {
        setReactions({});
        setPins(new Set());
      }

      // L'état de lecture est relu **à l'ouverture**, puis on marque
      // lu : l'ordre compte. Marquer avant de lire ferait clignoter un `✓✓`
      // sur un message qui n'était pas encore affiché — c'est-à-dire
      // annoncer une lecture qui n'a pas eu lieu.
      if (profileId) {
        const marks = await fetchConversationReadMarks(cid);
        if (!alive || active?.conv.id !== cid) return;
        setReadMarks(marks);

        const dernier = rows[rows.length - 1] ?? pending[pending.length - 1];
        if (dernier) {
          await markRead(cid, profileId);
          if (!alive || active?.conv.id !== cid) return;
          setReadMarks((prev) => ({ ...prev, [profileId]: new Date().toISOString() }));
        }
      }
    })();

    const channel = api
      .channel(`dm-${cid}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages",
          filter: `conversation_id=eq.${cid}` },
        ({ new: m }: { new: DirectMessage }) => {
          const msg = m;
          const st = loadStateRef.current;
          if (st?.cid !== cid || !st.ready) {
            if (st?.cid === cid) pendingRef.current.push(msg);
            return;
          }
          const outgoing = pendingOutgoingRef.current.get(cid);
          outgoing?.delete(msg.id);
          if (outgoing?.size === 0) pendingOutgoingRef.current.delete(cid);
          setMessages((prev) => (prev === null ? prev : mergeMessage(prev, msg)));

          if (profileId && msg.author_id !== profileId) {
            void markRead(cid, profileId);
            void markConversationRead(profileId, cid);
            setReadMarks((prev) => ({ ...prev, [profileId]: new Date().toISOString() }));
            void refresh();
          }
        })
      // Une correction arrive comme un **UPDATE**, pas comme un INSERT :
      // sans cette liaison, le texte corrigé ne s'afficherait qu'au
      // rechargement — et deux personnes dans la conversation liraient
      // deux versions différentes du même message.
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "direct_messages",
          filter: `conversation_id=eq.${cid}` },
        ({ new: m }: { new: DirectMessage }) => {
          const st = loadStateRef.current;
          if (st?.cid !== cid || !st.ready) return;
          setMessages((prev) => (prev === null ? prev : mergeMessage(prev, m)));
        })
      .subscribe();

    return () => {
      alive = false;
      // `removeChannel` ferme **et** retire le canal du client : sans le
      // retrait, rouvrir la même conversation retrouverait l'ancienne
      // instance, déjà abonnée, et `.on()` lèverait à nouveau.
      void api.removeChannel(channel);
    };
  }, [active, profileId, refresh]);

  // Les prénoms des pairs qui tapent : on résout les identifiants
  // reçus par le canal en noms affichables, sinon la ligne dirait «
  // u-thabo écrit ».
  useEffect(() => {
    if (typingPeers.length === 0) {
      // La dérivation passe par le rendu, pas par un effet : on filtre
      // à l'affichage plutôt que de maintenir un second état en
      // synchronisation — l'effet n'existe plus pour le cas vide.
      return;
    }

    let alive = true;
    (async () => {
      const { data } = await api
        .from("users")
        .select("id, prenom")
        .in("id", typingPeers.map((p) => p.userId));

      if (!alive) return;
      const noms = (data as { id: string; prenom: string }[] | null) ?? [];
      setTypingNames(noms.map((n) => n.prenom));
    })();

    return () => {
      alive = false;
    };
  }, [typingPeers]);

  useEffect(() => {
    // On défile le **conteneur** de messages, jamais la fenêtre. Un
    // `scrollIntoView` remonte tous les ancêtres défilants : quand la
    // conversation tenait dans la vue, il faisait glisser toute la page
    // — la coque remontait sous le bandeau et le composeur se retrouvait
    // hors écran.
    const wall = endRef.current?.parentElement;
    if (wall && messages?.length) {
      wall.scrollTo({ top: wall.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (!openNew || !profileId) return;
    let alive = true;

    (async () => {
      const q = userSearch.trim();
      let query = api
        .from("users")
        .select("id, prenom, pseudo, avatar_color, account_type, verified")
        .neq("id", profileId!)
        .limit(20);

      if (q) query = query.ilike("pseudo", `%${q}%`);
      const { data } = await query;
      if (alive) setUsers((data as UserLite[]) ?? []);
    })();

    return () => {
      alive = false;
    };
  }, [openNew, userSearch, profileId]);

  /**
   * Ouvre (ou crée) la conversation avec `other`.
   *
   * Une seule fonction pour deux points d'entrée : le sélecteur de
   * contacts, et le lien `?to=pseudo` envoyé par un profil public. Si
   * chaque chemin calculait son propre identifiant de conversation, il
   * y aurait deux endroits où se tromper — et « ça marche quand on
   * clique dans la liste mais pas quand on arrive depuis un profil »
   * serait exactement le genre de bug qu'on ne voit qu'en production.
   */
  async function startConversation(other: UserLite) {
    if (!profile) return;
    const id = convKey(profile.id, other.id);

    const { data } = await api
      .from("conversations").select("*").eq("id", id).maybeSingle();

    let conv = data as Conversation | null;

    if (!conv) {
      const row = {
        id,
        participants: [profile.id, other.id].sort(),
        last_message: "",
        last_message_at: new Date().toISOString(),
      };
      const { data: ins } = await api
        .from("conversations").insert(row).select().single();
      conv = (ins as Conversation) ?? row;
    }

    setActive({ conv, other });
    setOpenNew(false);
    setUserSearch("");
    // Ouvrir une conversation, c'est la lire : on marque ses
    // notifications comme lues ici aussi, comme dans `openConversation`.
    // Sans cela, une conversation ouverte par « ?to=pseudo » resterait
    // « non lue » malgré la lecture, et la pastille de la liste
    // refuserait de disparaître.
    await markConversationRead(profile.id, id);
    setUnreadConvs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  /**
   * Ouvrir une conversation, c'est la lire.
   *
   * On marque donc ses notifications comme lues au moment de
   * l'ouvrir, et pas à un bouton « tout lu » du centre. Sans cela, un
   * message resterait « non lu » après avoir été lu, et la cloche
   * compterait des messages que la personne a déjà vus — un
   * compteur qui ne revient jamais à zéro, donc qu'on finit par
   * ignorer.
   *
   * La lecture vit dans `notifications.read_at` : une seule source de
   * vérité pour la cloche et pour cette liste, donc pas de table
   * `conversation_reads` qui finirait par diverger de la première.
   */
  async function openConversation(peer: Peer) {
    setActive(peer);
    if (!profile) return;

    await markConversationRead(profile.id, peer.conv.id);
    setUnreadConvs((prev) => {
      const next = { ...prev };
      delete next[peer.conv.id];
      return next;
    });
  }

  const openWith = startConversation;

  /**
   * Arrivée depuis un profil public : `/messages?to=koffi`.
   *
   * On lit le pseudo, on résout l'utilisateur, puis on ouvre la même
   * conversation que si l'on avait cliqué dans la liste. Le paramètre est
   * retiré de l'URL ensuite : sans cela, revenir en arrière rouvrirait
   * cette conversation au lieu de revenir à la liste — un effet
   * secondaire que le visiteur n'a pas demandé.
   */
  useEffect(() => {
    if (!profile) return;
    const target = new URLSearchParams(window.location.search).get("to");
    if (!target) return;

    let alive = true;
    (async () => {
      const { data } = await api
        .from("users")
        .select("id, prenom, pseudo, avatar_color, account_type, verified")
        .ilike("pseudo", target)
        .neq("id", profile.id)
        .maybeSingle();

      if (!alive || !data) return;
      await startConversation(data as UserLite);

      const clean = new URL(window.location.href);
      clean.searchParams.delete("to");
      window.history.replaceState({}, "", clean.toString());
    })();

    return () => {
      alive = false;
    };
    // `startConversation` est recréé à chaque rendu ; on ne veut pas
    // relancer la résolution du pseudo à chaque frappe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  /**
   * Pose ou retire une réaction, en **optimiste**.
   *
   * La pastille change tout de suite ; si l'écriture échoue, on remet
   * l'état d'avant. Un aller-retour réseau de plusieurs centaines de
   * millisecondes sur un pouce qui vient d'appuyer donne l'impression
   * que le clic n'a pas pris — c'est le défaut qu'on corrige ici.
   */
  async function toggleReaction(messageId: string, emoji: string) {
    if (!profile) return;
    const before = reactions;

    setReactions((prev) => {
      const list = prev[messageId] ?? [];
      const existing = list.find((r) => r.emoji === emoji);
      let next: ReactionSummary[];

      if (existing?.mine) {
        next =
          existing.count <= 1
            ? list.filter((r) => r.emoji !== emoji)
            : list.map((r) =>
                r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r,
              );
      } else if (existing) {
        next = list.map((r) =>
          r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r,
        );
      } else {
        next = [...list, { emoji, count: 1, mine: true }];
      }

      return { ...prev, [messageId]: next };
    });

    const { error } = await toggleMessageReaction(
      "direct_message",
      messageId,
      profile.id,
      emoji,
    );

    if (error) {
      setReactions(before);
      toast("Réaction impossible", "err");
    }
  }

  /** Copier un bloc de code — le geste qui suit immédiatement l'envoi. */
  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast("Code copié");
    } catch {
      toast("Le presse-papiers est indisponible ici", "err");
    }
  }

  async function togglePin(messageId: string) {
    if (!profile) return;
    const wasPinned = pins.has(messageId);

    setPins((prev) => {
      const next = new Set(prev);
      if (wasPinned) next.delete(messageId);
      else next.add(messageId);
      return next;
    });

    const { error } = await toggleMessagePin("direct_message", messageId, profile.id);
    if (error) {
      setPins((prev) => {
        const next = new Set(prev);
        if (wasPinned) next.add(messageId);
        else next.delete(messageId);
        return next;
      });
      toast("Épingle impossible", "err");
    }
  }

  async function removeMessage(messageId: string) {
    setPendingDelete(null);
    const before = messages;
    // Optimiste : le message disparaît tout de suite. La base reste
    // l'arbitre — si elle refuse (message d'un autre, politique changée),
    // on remet la liste telle qu'elle était et on le dit.
    setMessages((prev) => (prev ? prev.filter((m) => m.id !== messageId) : prev));

    const { error } = await deleteMessage(messageId);
    if (error) {
      setMessages(before);
      toast("Suppression refusée", "err");
      return;
    }
    if (replyTo?.id === messageId) setReplyTo(null);
    toast("Message supprimé");
  }

  /**
   * Cartes de story attachées aux messages privés.
   *
   * `null` = story introuvable ou expirée : le message a été écrit, la story
   * a vécu 24 h. On le dit au lieu de laisser un cadre vide.
   */
  // Le catalogue est chargé une fois, même si aucun message n'a de
  // sticker : la requête est petite, et l'alternative — la déclencher
  // au premier sticker rencontré — rendrait la première bulle vide
  // pendant un aller-retour.
  useEffect(() => {
    let alive = true;
    void fetchStickers().then((rows) => {
      if (alive) setStickerCatalog(new Map(rows.map((row) => [row.id, row])));
    });
    return () => {
      alive = false;
    };
  }, []);

  const [storyCards, setStoryCards] = useState<Record<string, { caption: string } | null>>({});

  useEffect(() => {
    const ids = [
      ...new Set(
        (messages ?? [])
          .map((message) => message.story_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ].filter((id) => !(id in storyCards));
    if (ids.length === 0) return;

    let alive = true;
    void (async () => {
      const { data } = await api.from("stories").select("id, caption").in("id", ids);
      if (!alive) return;
      const rows = (data as { id: string; caption: string }[] | null) ?? [];
      setStoryCards((previous) => {
        const next = { ...previous };
        for (const id of ids) next[id] = rows.find((row) => row.id === id) ?? null;
        return next;
      });
    })();

    return () => {
      alive = false;
    };
  }, [messages, storyCards]);

  async function persistMessage(message: MessageRow) {
    let confirmed: DirectMessage | null = null;
    try {
      const { data, error } = await api
        .from("direct_messages")
        .insert({
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
        })
        .select("*")
        .single();

      confirmed = error ? null : data as DirectMessage | null;
      if (!confirmed) {
        const { data: existing, error: lookupError } = await api
          .from("direct_messages")
          .select("*")
          .eq("id", message.id)
          .maybeSingle();
        if (lookupError) throw lookupError;
        confirmed = existing as DirectMessage | null;
      }
    } catch {
      const outgoing = pendingOutgoingRef.current.get(message.conversation_id);
      if (!outgoing?.has(message.id)) return;
      outgoing.set(message.id, { ...message, deliveryStatus: "failed" });
      if (loadStateRef.current?.cid === message.conversation_id) {
        setMessages((current) => setMessageDeliveryStatus(current, message.id, "failed"));
      }
      toast("Envoi interrompu. Réessaie quand la connexion sera rétablie.", "err");
      return;
    }

    if (!confirmed) {
      const outgoing = pendingOutgoingRef.current.get(message.conversation_id);
      if (!outgoing?.has(message.id)) return;
      outgoing.set(message.id, { ...message, deliveryStatus: "failed" });
      if (loadStateRef.current?.cid === message.conversation_id) {
        setMessages((current) => setMessageDeliveryStatus(current, message.id, "failed"));
      }
      toast("Message non envoyé. Tu peux réessayer depuis la conversation.", "err");
      return;
    }

    const loadState = loadStateRef.current;
    const outgoing = pendingOutgoingRef.current.get(message.conversation_id);
    if (loadState?.cid === message.conversation_id && !loadState.ready) {
      outgoing?.set(message.id, confirmed);
    } else {
      outgoing?.delete(message.id);
      if (outgoing?.size === 0) pendingOutgoingRef.current.delete(message.conversation_id);
      if (loadState?.cid === message.conversation_id) {
        setMessages((current) => current ? mergeMessage(current, confirmed) : current);
      }
    }
    try {
      const { error } = await api.from("conversations").update({
        last_message: confirmed.text,
        last_message_at: confirmed.created_at,
      }).eq("id", confirmed.conversation_id);
      if (error) toast("Message envoyé, mais l’aperçu de la conversation n’a pas été actualisé.", "err");
    } catch {
      toast("Message envoyé, mais l’aperçu de la conversation n’a pas été actualisé.", "err");
    }
    void refresh();
  }

  async function retryMessage(messageId: string) {
    const conversationId = active?.conv.id;
    if (!conversationId) return;
    const message = pendingOutgoingRef.current.get(conversationId)?.get(messageId);
    if (!message || message.deliveryStatus !== "failed") return;
    const sendingMessage = { ...message, deliveryStatus: "sending" as const };
    pendingOutgoingRef.current.get(conversationId)?.set(messageId, sendingMessage);
    setMessages((current) => setMessageDeliveryStatus(current, messageId, "sending"));
    await persistMessage(sendingMessage);
  }

  /**
   * Corriger un message déjà envoyé.
   *
   * `edited_at` est la seule trace de la correction : le texte précédent
   * n'est conservé nulle part, et c'est assumé — un privé n'est pas un
   * journal d'audit. En revanche l'écran le dit, pour que personne ne
   * prenne la version corrigée pour le texte d'origine.
   */
  async function saveEdit() {
    if (!profile || !editing) return;
    const body = text.trim();
    if (!body) return;

    // Rien n'a changé : corriger n'est pas réécrire. On sort sans toast,
    // parce qu'un accusé « corrigé » sur un texte identique serait faux.
    if (body === editing.text && asCode === Boolean(editing.is_code)) {
      cancelEdit();
      return;
    }

    const target = editing;
    const before = messages;
    const corrected = {
      text: body,
      is_code: asCode,
      edited_at: new Date().toISOString(),
    };

    setMessages((prev) =>
      prev
        ? prev.map((m) => (m.id === target.id ? { ...m, ...corrected } : m))
        : prev,
    );
    setEditing(null);
    setText("");
    setAsCode(false);

    const { error } = await api
      .from("direct_messages")
      .update(corrected)
      .eq("id", target.id);

    if (error) {
      setMessages(before);
      toast("Correction refusée", "err");
      return;
    }

    // L'aperçu de la liste vient de `conversations.last_message`, pas de
    // la table des messages. Corriger le dernier message sans le mettre à
    // jour laisserait dans la colonne de gauche la version d'avant — un
    // texte qu'on ne retrouve nulle part en ouvrant le fil.
    if (before && before[before.length - 1]?.id === target.id && active) {
      const { error: previewError } = await api
        .from("conversations")
        .update({ last_message: body })
        .eq("id", active.conv.id);

      if (!previewError) {
        setConvs((prev) =>
          prev?.map((p) =>
            p.conv.id === active.conv.id
              ? { ...p, conv: { ...p.conv, last_message: body } }
              : p,
          ) ?? prev,
        );
      }
    }

    toast("Message corrigé");
  }

  function cancelEdit() {
    setEditing(null);
    setText("");
    setAsCode(false);
  }

  function startEdit(message: DirectMessage) {
    setEditing(message);
    setText(message.text);
    setAsCode(Boolean(message.is_code));
    setReplyTo(null);
  }

  async function send(attachment?: MessageAttachment) {
    if (editing) {
      await saveEdit();
      return;
    }
    if (!profile || !active) return;
    const body = text.trim();
    // Un sticker ou un GIF tient lieu de texte : le message est complet
    // sans un mot. `canSendMessage` est la même règle que le canal de
    // groupe, et elle refuse un GIF dont l'URL n'est pas sûre.
    if (!canSendMessage(body, attachment) || sending) return;
    const media = attachmentColumns(attachment);

    const message: MessageRow = {
      id: crypto.randomUUID(),
      conversation_id: active.conv.id,
      author_id: profile.id,
      author_name: profile.prenom,
      text: body,
      is_code: asCode,
      gif_url: media.gif_url,
      gif_alt: media.gif_alt,
      sticker_id: media.sticker_id,
      media_url: media.media_url,
      media_type: media.media_type,
      reply_to_id: replyTo?.id ?? null,
      created_at: new Date().toISOString(),
      deliveryStatus: "sending",
    };
    const outgoing = pendingOutgoingRef.current.get(message.conversation_id) ?? new Map();
    outgoing.set(message.id, message);
    pendingOutgoingRef.current.set(message.conversation_id, outgoing);
    setMessages((current) => sortMessages([...(current ?? []), message]));
    stopTyping();
    setText("");
    setReplyTo(null);
    // Le drapeau de code ne survit pas à l'envoi : le garder ferait partir
    // la phrase suivante en bloc monospace sans que personne l'ait demandé.
    setAsCode(false);
    await persistMessage(message);
  }

  /**
   * Envoyer une photo ou une vidéo.
   *
   * Le refus du destinataire se lit **avant** le téléversement : mettre
   * le fichier en ligne pour qu'il ne parte pas serait un gaspillage et
   * une fausse promesse. La préférence est un droit de réception, pas
   * une censure (le texte continue de passer).
   */
  function closeStudio() {
    setStudioSource((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setStudioOpen(false);
  }

  /** Importer un média ouvre l'atelier ; l'envoi part à l'export. */
  function openStudioWith(file: File) {
    if (!profile || !active) return;
    if (active.other?.dm_media === false) {
      return toast("Ce contact n'accepte pas les photos et vidéos.", "err");
    }
    const kind = file.type.startsWith("video/")
      ? "video"
      : file.type.startsWith("image/")
        ? "image"
        : null;
    if (!kind) return toast("Choisis une photo ou une vidéo.", "err");
    const url = URL.createObjectURL(file);
    setStudioSource((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return { file, url, kind, name: file.name };
    });
    setStudioOpen(true);
  }

  async function sendMedia(file: File) {
    if (!profile || !active) return;
    if (active.other?.dm_media === false) {
      return toast("Ce contact n'accepte pas les photos et vidéos.", "err");
    }
    setUploadingMedia(true);
    const result = await uploadMedia(file);
    setUploadingMedia(false);
    if (!result.ok) return toast(result.error, "err");
    await send({ kind: "media", url: result.media.url, mediaType: result.media.kind });
  }

  const peer = active?.other;

  // Filtre d'affichage de la liste : on cherche dans le prénom, le pseudo
  // et le dernier message. `null` (chargement) reste `null`.
  const needle = search.trim().toLowerCase();
  const visibleConvs = convs
    ? convs.filter(
        (p) =>
          !needle ||
          (p.other?.prenom ?? "").toLowerCase().includes(needle) ||
          (p.other?.pseudo ?? "").toLowerCase().includes(needle) ||
          (p.conv.last_message ?? "").toLowerCase().includes(needle),
      )
    : null;

  return (
    <AppShell
      title="Messages"
      path="~/messages"
      wide
      immersive={Boolean(active && peer)}
      action={
        <IconButton label="Nouvelle conversation" name="edit" dataTour="messages-new" onClick={() => setOpenNew(true)} />
      }
    >
      <div className="shell:grid shell:h-[calc(100dvh-var(--h-topbar)-var(--h-banner,0px))]
        shell:grid-cols-[300px_minmax(0,1fr)]" data-tour="messages-list">
        {/* Volet conversation — plein écran sur mobile, deuxième
            colonne sur grand écran, où la liste reste visible : c'est
            la grammaire d'un tchat, pas d'un aller-retour. */}
        <section className="min-w-0 min-h-0 shell:order-2">
          {active && peer ? (
            <div className="fixed inset-0 z-[var(--z-sheet)] flex flex-col
              overlay-frost shell:static shell:bg-page shell:z-auto shell:h-full">
              <header className="flex h-[var(--h-topbar)] shrink-0 items-center gap-2.5
                border-b-[var(--bw-heavy)] border-edge glass-strong px-4 text-chalk">
                <button type="button" aria-label="Fermer"
                  onClick={() => { setActive(null); setMessages(null); }}
                  className="mo-press -ml-1.5 flex size-[var(--h-tap)] items-center justify-center
                    border-[var(--bw-thin)] border-line-2/40 transition-colors hover:bg-signal
                    shell:hidden">
                  <Icon name="chevron-left" size={16} />
                </button>
                <Avatar name={peer.prenom} color={peer.avatar_color} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-[13.5px] font-bold tracking-[-0.01em]">
                    {peer.prenom}
                    {peer.verified && <VerifiedBadge tier={badgeFor(peer, xpOf(peer))} size="sm" className="ml-1.5 translate-y-[1px]" />}
                  </div>
                  <div className="truncate font-mono text-[10.5px] text-chalk-4">
                    @{peer.pseudo}
                  </div>
                </div>
                <button type="button" aria-label="Chercher dans les échanges"
                  title="Chercher dans les échanges"
                  aria-pressed={findOpen}
                  onClick={() => setFindOpen((v) => {
                    if (v) setFind("");
                    return !v;
                  })}
                  className={`mo-press flex size-[var(--h-tap)] shrink-0 items-center justify-center
                    border-[var(--bw-thin)] transition-colors
                    ${findOpen
                      ? "border-signal bg-signal text-void"
                      : "border-line-2/40 text-chalk-4 hover:bg-signal hover:text-void"}`}>
                  <Icon name="search" size={14} />
                </button>
                <Link href={`/u/${encodeURIComponent(peer.pseudo)}`} aria-label="Voir le profil"
                  title="Voir le profil"
                  className="mo-press flex size-[var(--h-tap)] shrink-0 items-center justify-center
                    border-[var(--bw-thin)] border-line-2/40 transition-colors hover:bg-signal">
                  <Icon name="info" size={14} />
                </Link>
              </header>

              {/* Recherche dans la conversation. Repliée par défaut : un
                  filtre d'affichage, rien de plus — on lit ce qu'on
                  cherche sans quitter le fil. */}
              {findOpen && (
                <div className="mo-fade flex shrink-0 items-center gap-2 border-b border-line-2 glass-flat px-4 py-2">
                  <Icon name="search" size={14} className="shrink-0 text-chalk-4" />
                  <input
                    autoFocus
                    aria-label="Rechercher dans la conversation"
                    value={find}
                    onChange={(e) => setFind(e.target.value)}
                    placeholder={`Chercher dans les échanges avec ${peer.prenom}…`}
                    className="h-[30px] w-full border-none bg-transparent text-sm text-chalk
                      placeholder:text-chalk-4"
                  />
                  <button
                    type="button" aria-label="Fermer la recherche"
                    onClick={() => { setFind(""); setFindOpen(false); }}
                    className="mo-press flex size-[20px] items-center justify-center
                      border border-line-2 text-chalk-4 transition-colors hover:border-line-3 hover:text-chalk"
                  >
                    <Icon name="close" size={11} strokeWidth={2.4} />
                  </button>
                </div>
              )}

              <div className="chat-wall min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-4">
                {/* La bande de contexte précède les messages : c'est la
                    première chose qu'on voit en ouvrant une conversation — ce
                    que l'autre fait en ce moment, pour écrire en sachant qui
                    lit. */}
                <DMContext key={peer.id} peer={peer} />
                {messages === null && <Loading />}
                {messages?.length === 0 && (
                  <EmptyState title="Aucun message" />
                )}
                {messages !== null && messages.length > 0 && visible?.length === 0 && (
                  <EmptyState title="Aucun résultat" icon={<Icon name="search" size={20} strokeWidth={1.5} />}
                    hint={`Rien pour « ${find.trim()} ».`} />
                )}
                {visible?.map((m, i) => {
                  const mine = m.author_id === profile?.id;
                  // Seuls les messages qu'on a écrits portent un accusé :
                  // on ne peut pas savoir si quelqu'un d'autre a lu, et
                  // l'afficher quand même serait afficher une information
                  // qu'on n'a pas.
                  const receipt = mine
                    ? receiptFor(m.created_at, readMarks, profile?.id ?? "")
                    : null;
                  const isLatest = i === (visible?.length ?? 0) - 1;
                  // Le message cité est cherché dans la fenêtre chargée. S'il
                  // est plus ancien, on n'affiche pas de citation plutôt que
                  // d'inventer un contenu — la réponse reste lisible seule.
                  const parent = m.reply_to_id
                    ? (messages ?? []).find((x) => x.id === m.reply_to_id)
                    : null;

                  return (
                    <div
                      key={m.id}
                      id={`dm-msg-${m.id}`}
                      className={`${mine ? "mo-msg-in" : "mo-msg-in-alt"} group/message mb-2 flex flex-col
                        ${mine ? "items-end" : "items-start"}`}
                    >
                      {parent && (
                        <ReplyQuote
                          author={parent.author_name}
                          text={parent.text}
                          align={mine ? "right" : "left"}
                          onClick={() =>
                            document
                              .getElementById(`dm-msg-${parent.id}`)
                              ?.scrollIntoView({ behavior: "smooth", block: "center" })
                          }
                        />
                      )}
                      <div className={`max-w-[78%] rounded-[var(--radius-input)] border px-3.5 py-2.5
                        text-[13.5px] leading-[1.55] break-words whitespace-pre-wrap
                        ${m.is_code
                          ? "border-l-[5px] border-line-2 border-l-signal glass-flat font-mono text-[12px] leading-[1.6] text-chalk-2"
                          : mine
                            ? "border-signal/60 glass-flat text-chalk"
                            : "border-line-2 glass-flat text-chalk-2"}`}
                      >
                        {/* Carte de la story d'origine — le contexte du message. */}
                        {m.story_id && (
                          <div
                            className="mb-1.5 flex items-center gap-2 rounded-[var(--radius-chip)]
                              border border-line-2 bg-surface-2/60 px-2.5 py-1.5"
                          >
                            <Icon name="spark" size={11} strokeWidth={2.2} className="shrink-0 text-signal-d" />
                            <span className="label-micro shrink-0 text-chalk-3">Story</span>
                            <span className="min-w-0 truncate text-[11.5px] text-chalk-2">
                              {storyCards[m.story_id] === null
                                ? "Story expirée"
                                : storyCards[m.story_id]?.caption?.trim() || "Story"}
                            </span>
                          </div>
                        )}

                        <MessageAttachmentView
                          gifUrl={m.gif_url}
                          gifAlt={m.gif_alt}
                          mediaUrl={m.media_url}
                          mediaType={m.media_type}
                          sticker={
                            m.sticker_id ? stickerCatalog.get(m.sticker_id) ?? null : null
                          }
                        />

                        {m.is_code && (
                          <button
                            type="button"
                            onClick={() => void copyCode(m.text)}
                            className="mb-1 flex items-center gap-1 font-mono text-[10px] font-bold
                              uppercase tracking-[0.12em] text-chalk-4 transition-colors
                              hover:text-signal"
                          >
                            <Icon name="copy" size={11} />
                            copier
                          </button>
                        )}
                        {m.is_code ? (
                          <span>{m.text}</span>
                        ) : splitContent(m.text).map((segment, j) =>
                          segment.tag ? (
                            <button
                              key={j}
                              type="button"
                              onClick={() => router.push(`/search?tag=${encodeURIComponent(segment.tag!)}`)}
                              title={`Voir les publications #${segment.tag}`}
                              className="font-medium text-signal"
                            >
                              {segment.text}
                            </button>
                          ) : segment.mention ? (
                            <button
                              key={j}
                              type="button"
                              onClick={() => router.push(`/u/${encodeURIComponent(segment.mention!)}`)}
                              title={`Ouvrir le profil de @${segment.mention}`}
                              className="font-medium text-chalk hover:text-signal"
                            >
                              {segment.text}
                            </button>
                          ) : (
                            <span key={j}>{segment.text}</span>
                          ),
                        )}
                        <div className={`mt-1 text-[10px] ${mine ? "text-chalk/60" : "text-chalk-4"}`}>
                          {clockTime(m.created_at)}
                          {m.edited_at && (
                            <span
                              className="ml-1.5"
                              title={`Corrigé le ${new Date(m.edited_at).toLocaleString("fr-FR")}`}
                            >
                              · modifié
                            </span>
                          )}
                          {m.deliveryStatus === "sending" && (
                            <span className="ml-1.5" role="status">Envoi…</span>
                          )}
                          {m.deliveryStatus === "failed" && (
                            <button
                              type="button"
                              onClick={() => void retryMessage(m.id)}
                              aria-label="Réessayer l’envoi du message"
                              className="ml-1.5 font-semibold text-danger underline underline-offset-2"
                            >
                              Échec · Réessayer
                            </button>
                          )}
                          {!m.deliveryStatus && receipt && (
                            <Receipt state={receipt.state} isLatest={isLatest} />
                          )}
                        </div>
                      </div>
                      <MessageExtras
                        summary={reactions[m.id] ?? []}
                        pinned={pins.has(m.id)}
                        align={mine ? "right" : "left"}
                        onToggleReaction={(emoji) => void toggleReaction(m.id, emoji)}
                        onReply={() => {
                          // Répondre pendant une correction abandonne le
                          // brouillon : sans cela, le texte corrigé partirait
                          // comme réponse à un autre message.
                          if (editing) cancelEdit();
                          setReplyTo(m);
                        }}
                        onTogglePin={() => void togglePin(m.id)}
                        onEdit={mine && !m.deliveryStatus ? () => startEdit(m) : undefined}
                        onDelete={mine ? () => setPendingDelete(m.id) : undefined}
                      />
                      {pendingDelete === m.id && (
                        <div
                          role="alertdialog"
                          aria-label="Confirmer la suppression du message"
                          className={`mt-1 flex flex-wrap items-center gap-2 border border-danger
                            bg-surface px-2.5 py-2 text-[12px] text-chalk shadow-sh-1
                            ${mine ? "self-end" : "self-start"}`}
                        >
                          <Icon name="trash" size={14} className="text-danger" />
                          <span className="mr-auto">Supprimer ce message ?</span>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(null)}
                            className="rounded-[var(--radius-chip)] border border-line-3 px-2 py-1
                              font-mono text-[10.5px] font-bold uppercase tracking-[0.12em]
                              text-chalk-3 transition-colors hover:text-chalk"
                          >
                            annuler
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeMessage(m.id)}
                            className="mo-press rounded-[var(--radius-chip)] border border-danger bg-danger
                              px-2 py-1 font-mono text-[10.5px] font-bold uppercase tracking-[0.12em]
                              text-void"
                          >
                            supprimer
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {find.trim() && (
                  <p className="px-1 pb-1 pt-2 text-[11px] text-chalk-4">
                    {visible?.length ?? 0} résultat{(visible?.length ?? 0) > 1 ? "s" : ""}{" "}
                    sur {messages?.length ?? 0} messages
                  </p>
                )}

                {/* La ligne de frappe vit **après** les messages, jamais
                    au-dessus : elle décrit le bas de la conversation, la
                    où l'œil revient après avoir lu. Au-dessus, elle
                    pousserait la liste vers le bas à chaque apparition. */}
                <TypingLine names={typingNames} />
                <div ref={endRef} />

              </div>
              <StudioEditor
                open={studioOpen}
                onClose={closeStudio}
                owner={profile?.pseudo ?? ""}
                initialMedia={
                  studioSource
                    ? { url: studioSource.url, kind: studioSource.kind, name: studioSource.name }
                    : null
                }
                sourceFile={studioSource?.file ?? null}
                onLayersChange={setText}
                onUse={(file) => {
                  void sendMedia(file);
                }}
                onUseSource={(file) => {
                  void sendMedia(file);
                }}
              />
              <ComposerBar>
                {editing && (
                  <div className="mb-1.5 flex items-center gap-2 rounded-[var(--radius-input)]
                    border border-signal/50 bg-signal/10 px-2.5 py-1.5 text-[11.5px] text-chalk-3">
                    <Icon name="edit" size={12} className="shrink-0 text-signal" />
                    <span className="min-w-0 flex-1 truncate">
                      Correction du message…
                    </span>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      aria-label="Annuler la correction"
                      className="shrink-0 text-chalk-4 transition-colors hover:text-danger"
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                )}
                {replyTo && (
                  <div className="mb-1.5 flex items-center gap-2 rounded-[var(--radius-input)]
                    border border-line-2 bg-surface px-2.5 py-1.5 text-[11.5px] text-chalk-3">
                    <Icon name="comment" size={12} className="shrink-0 text-signal" />
                    <span className="min-w-0 flex-1 truncate">
                      Réponse à{" "}
                      <span className="font-bold text-chalk">{replyTo.author_name}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      aria-label="Annuler la réponse"
                      className="shrink-0 text-chalk-4 transition-colors hover:text-danger"
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                )}
                <ChatComposer
                  id="dm-composer"
                  value={text}
                  onValueChange={setText}
                  onSend={() => void send()}
                  attachments={
                    <>
                      <MessageAttachmentButtons
                        disabled={!active || sending || uploadingMedia}
                        onGif={(gif) => void send({ kind: "gif", gif })}
                        onMedia={(file) => openStudioWith(file)}
                      />
                      <button
                        type="button"
                        onClick={() => setStudioOpen(true)}
                        disabled={!active || sending || uploadingMedia}
                        aria-label="Ouvrir l'atelier"
                        title="Ouvrir l'atelier"
                        className="mo-press flex size-[var(--h-input)] shrink-0 items-center
                          justify-center rounded-full border border-line-3 bg-surface
                          text-chalk-4 transition-colors hover:text-signal disabled:opacity-40"
                      >
                        <Icon name="spark" size={18} strokeWidth={1.8} />
                      </button>
                    </>
                  }
                  onTyping={notifyTyping}
                  sending={sending}
                  code={asCode}
                  onToggleCode={() => setAsCode((v) => !v)}
                  placeholder={
                    editing
                      ? "Corrige ton message…"
                      : asCode
                        ? "Colle le code à envoyer…"
                        : "Écris un message…"
                  }
                />
              </ComposerBar>
            </div>
          ) : (
            <div className="hidden h-full flex-col items-center justify-center gap-3
              border-l border-line-2 text-chalk-4 shell:flex">
              <Icon name="messages" size={24} strokeWidth={1.3} />
              <p className="text-sm">Choisis une conversation</p>
            </div>
          )}
        </section>

        {/* Colonne liste — première colonne sur grand écran ; sur
            mobile, c'est toute la page tant qu'aucune conversation
            n'est ouverte. */}
        <aside className={`${active ? "hidden" : "block"} shell:block shell:order-1
          shell:overflow-y-auto`}>
          <div className="px-(--gutter) pt-3 shell:px-3 shell:pt-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          aria-label="Rechercher une conversation"
          placeholder="Rechercher…"
            className="mb-4 h-[var(--h-input)] w-full rounded-[var(--radius-input)] border border-line-3 bg-surface
              px-3.5 text-[14px] shadow-sh-1 placeholder:text-chalk-4
              focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_var(--color-signal)]" />

          {visibleConvs === null && <Loading />}

          {visibleConvs?.length === 0 && (
            <EmptyState
              title={needle ? "Aucun résultat" : "Aucune conversation"}
              hint={needle ? undefined : "Démarre une conversation par le crayon"}
            />
          )}

{visibleConvs?.map((peer, i) => {
            const { conv, other } = peer;
            const unread = unreadConvs[conv.id] ?? 0;

            return (
            <button key={conv.id} type="button" onClick={() => void openConversation(peer)}
              className={`depth-card mo-rise mb-[9px] flex w-full items-center gap-3.5
                rounded-[var(--radius-card)] border glass-flat p-3.5 text-left
                ${unread > 0 ? "border-signal" : "border-line-2/60"}`}
              style={{ animationDelay: `${cascade(i)}ms` }}>
              <Avatar name={other?.prenom} color={other?.avatar_color} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[14px] font-bold">
                    {other?.prenom ?? "Utilisateur"}
                  </span>
                  {other?.verified && <VerifiedBadge tier={badgeFor(other, xpOf(other))} size="sm" />}
                </div>
                <div className="mt-0.5 overflow-hidden text-[11.5px] text-chalk-3
                  text-ellipsis whitespace-nowrap">
                  {conv.last_message || "…"}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {conv.last_message_at && (
                  <span className="text-[10.5px] tracking-wide text-chalk-4">
                    {clockTime(conv.last_message_at)}
                  </span>
                )}
                {unread > 0 && (
                  <span className="flex size-[18px] items-center justify-center
                    rounded-full bg-signal font-mono text-[10px] font-bold leading-none text-void">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </div>
            </button>
            );
          })}
          </div>
        </aside>
      </div>

      <Sheet open={openNew} onClose={() => setOpenNew(false)} title="Nouvelle conversation">
        <input value={userSearch} aria-label="Rechercher un pseudo" onChange={(e) => setUserSearch(e.target.value)}
          placeholder="Rechercher un pseudo…"
          className="mb-4 h-[var(--h-input)] w-full rounded-[var(--radius-input)] border border-line-3 bg-surface
            px-3.5 text-[14px] shadow-sh-1 placeholder:text-chalk-4" />

        {users.length === 0 && (
          <p className="py-6 text-center text-sm text-chalk-3">Aucun membre trouvé</p>
        )}

        {users.map((u) => (
          <button key={u.id} type="button" onClick={() => openWith(u)}
            className="mb-[9px] flex w-full items-center gap-3.5 rounded-[var(--radius-card)] border
              border-line-3 bg-surface p-3 shadow-sh-1 transition-[transform,box-shadow]
              hover:-translate-x-[2px] hover:-translate-y-[2px] hover:bg-surface-2 hover:shadow-sh-2">
            <Avatar name={u.prenom} color={u.avatar_color} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[13.5px] font-bold">{u.prenom}</span>
                {u.verified && <VerifiedBadge tier={badgeFor(u, xpOf(u))} size="sm" />}
              </div>
              <span className="font-mono text-[11px] text-chalk-3">@{u.pseudo}</span>
            </div>
            <span className="label-micro text-chalk-4">
              {u.account_type === "professional" ? "Pro" : "Étu"}
            </span>
          </button>
        ))}
      </Sheet>
    </AppShell>
  );
}