"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell, IconButton } from "@/components/AppShell";
import { Icon, asIconName } from "@/components/Icon";
import { Avatar, EmptyState, Loading, PrimaryButton } from "@/components/Avatar";
import { Sheet } from "@/components/Sheet";
import { GroupReceipt } from "@/components/Receipt";
import { MessageExtras, ReplyQuote } from "@/components/MessageExtras";
import { MessageAttachmentButtons, MessageAttachmentView } from "@/components/MessageAttachments";
import { TypingLine } from "@/components/TypingDots";
import { ChatComposer, ComposerBar } from "@/components/ChatComposer";
import { useToast } from "@/components/Toast";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { badgeFor, xpOf } from "@/lib/verification";
import { api } from "@/lib/api/client";
import { uploadMedia } from "@/lib/media";
import { useSession } from "@/hooks/useSession";
import { useTyping } from "@/hooks/useTyping";
import { messagePoints } from "@/lib/gamification";
import { clockTime } from "@/lib/utils";
import {
  fetchChannelReadMarks,
  markChannelRead,
  readBy,
} from "@/lib/reads";
import {
  channelLabel, findBySlug, isValidChannelName, orderChannels, slugify,
  uniqueSlug, type ChannelLite,
} from "@/lib/groups/channels";
import {
  deleteGroupMessage, fetchMembers, isStaff, myRole, removeMember,
  setMemberRole, ROLE_LABEL, type MemberRow,
} from "@/lib/groups/members";
import {
  fetchMessageReactions,
  fetchPinnedMessageIds,
  toggleMessagePin,
  toggleMessageReaction,
  type ReactionsByMessage,
  type ReactionSummary,
} from "@/lib/messages";
import type { Group, GroupMessage, GroupRole, Project } from "@/lib/types";
import { canSendMessage, attachmentColumns, type MessageAttachment } from "@/lib/message-media";
import { fetchStickers, type StickerRowView } from "@/lib/stickers";
import { fetchProjectsForGroup } from "@/lib/repo";

const CHANNEL_KEY = "c";

export default function GroupChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { profile } = useSession();
  const toast = useToast();

  const [group, setGroup] = useState<Group | null>(null);
  /** Les dépôts du groupe — la fusion groupe ↔ dépôt. */
  const [repos, setRepos] = useState<Project[]>([]);
  const [channels, setChannels] = useState<ChannelLite[] | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ channelId: string; rows: GroupMessage[] } | null>(null);
  const [text, setText] = useState("");
  const [asCode, setAsCode] = useState(false);
  const [sending, setSending] = useState(false);
  /** Fichier en cours de téléversement avant l'envoi du message. */
  const [uploadingMedia, setUploadingMedia] = useState(false);
  /** Catalogue des stickers : la bulle ne stocke qu'un identifiant. */
  const [stickerCatalog, setStickerCatalog] = useState<Map<string, StickerRowView>>(new Map());
  const [openNew, setOpenNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTopic, setNewTopic] = useState("");
  const [creating, setCreating] = useState(false);
  /**
   * Accusés de lecture du canal ouvert.
   *
   * Un canal n'affiche pas de double tick — il affiche une fraction.
   * `last_read_at` par membre est l'état qui la produit, et il vit
   * dans la table d'appartenance : lire un canal est un état, pas un
   * événement par message.
   */
  const [readMarks, setReadMarks] = useState<{ userId: string; readAt: string | null }[]>([]);
  /** Réactions agrégées par message, pour le canal ouvert. */
  const [reactions, setReactions] = useState<ReactionsByMessage>({});
  /** Messages épinglés par **moi** — les épingles restent privées. */
  const [pins, setPins] = useState<Set<string>>(new Set());
  /** Le message auquel le prochain envoi répondra. */
  const [replyTo, setReplyTo] = useState<GroupMessage | null>(null);
  /**
   * Les membres et leurs rôles (migration 020).
   *
   * Le rôle est lu, jamais deviné : c'est lui qui décide quels boutons
   * l'écran montre. La RLS, elle, décide ce qui passe — l'écran ne fait
   * que prévoir.
   */
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [openMembers, setOpenMembers] = useState(false);
  const [busyMember, setBusyMember] = useState<string | null>(null);
  /** La suppression de message attend sa confirmation, en ligne. */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Défile le **conteneur** de messages, jamais la fenêtre : voir le
  // commentaire du même effet dans `/messages`.
  const scrollDown = useCallback(() => {
    const wall = endRef.current?.parentElement;
    if (wall) wall.scrollTo({ top: wall.scrollHeight, behavior: "smooth" });
  }, []);

  // Catalogue des stickers, chargé une fois pour toutes les bulles.
  useEffect(() => {
    let alive = true;
    void fetchStickers().then((rows) => {
      if (alive) setStickerCatalog(new Map(rows.map((row) => [row.id, row])));
    });
    return () => {
      alive = false;
    };
  }, []);

  // ── Chargement ──
  useEffect(() => {
    let alive = true;

    (async () => {
      const { data } = await api.from("groups").select("*").eq("id", id).single();
      if (!alive) return;
      if (!data) return router.replace("/groups");

      const g = data as Group;
      setGroup(g);
      document.title = `DevNet — ${g.name}`;

      // Les dépôts du groupe, chargés dans la même passe — un groupe qui
      // travaille sur du code le montre sous son en-tête.
      const repos = await fetchProjectsForGroup(id);
      if (!alive) return;
      setRepos(repos);

      const { data: chans } = await api
        .from("channels")
        .select("id, slug, name, topic, position, is_private")
        .eq("group_id", id)
        .order("position", { ascending: true });

      if (!alive) return;
      const list = (chans ?? []) as ChannelLite[];
      setChannels(list);

      // Le slug est lu depuis l'URL après le rendu : lire `location`
      // pendant le rendu Créait une divergence entre le serveur et le
      // client sur une page dynamique.
      const wanted = new URLSearchParams(window.location.search).get(CHANNEL_KEY);
      setActiveSlug(findBySlug(list, wanted)?.slug ?? null);
    })();

    return () => {
      alive = false;
    };
  }, [id, router]);

  const ordered = useMemo(() => orderChannels(channels ?? []), [channels]);
  const active = useMemo(
    () => findBySlug(ordered, activeSlug),
    [ordered, activeSlug],
  );

  // L'URL suit le canal : le lien se partage, le rechargement revient au
  // bon endroit.
  useEffect(() => {
    if (!active) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get(CHANNEL_KEY) === active.slug) return;
    url.searchParams.set(CHANNEL_KEY, active.slug);
    window.history.replaceState(null, "", url);
  }, [active]);

  // ── Membres et rôles ──
  // Une lecture dédiée, partagée par l'ouverture et par les mutations :
  // après un changement de rôle, on **relit** plutôt que de réécrire
  // l'état localement — le rôle affiché doit être celui que la base a
  // accepté, pas celui qu'on a espéré.
  const loadMembers = useCallback(async () => {
    const rows = await fetchMembers(id);
    setMembers(rows);
    // Le compteur de l'en-tête suit la liste réelle : c'est la même
    // source, et un compteur qui dérive de la liste se verrait aussitôt.
    setGroup((g) => (g ? { ...g, member_count: rows.length } : g));
  }, [id]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const rows = await fetchMembers(id);
      if (alive) {
        setMembers(rows);
        setGroup((g) => (g ? { ...g, member_count: rows.length } : g));
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const role = myRole(members ?? [], profile?.id);
  const canModerate = isStaff(role);
  const isCreator = group?.created_by === profile?.id;

  // Messages du canal ouvert, **filtrés par identifiant de canal**.
  //
  // On ne remet pas l'état à `null` au changement de canal : entre le clic
  // et la réponse de la base, l'écran afficherait les messages du canal
  // précédent sous l'en-tête du nouveau — trompeur. En gardant le canal
  // auquel ils appartiennent, `messages` vaut `null` tant que la réponse
  // n'est pas arrivée, sans avoir à écrire dans un effet.
  const channelId = active?.id;
  const messages =
    loaded && channelId && loaded.channelId === channelId ? loaded.rows : null;

  useEffect(() => {
    if (!channelId) return;

    let alive = true;
    (async () => {
      const { data } = await api
        .from("group_messages")
        .select("*")
        .eq("channel_id", channelId)
        .order("created_at", { ascending: true })
        .limit(100);
      if (!alive) return;
      const rows = (data as GroupMessage[]) ?? [];
      setLoaded({ channelId, rows });
      setReplyTo(null);

      // Réactions et épingles en deux requêtes pour tout le canal.
      if (profile?.id && rows.length > 0) {
        const [rx, pinned] = await Promise.all([
          fetchMessageReactions("group_message", rows.map((r) => r.id), profile.id),
          fetchPinnedMessageIds("group_message", profile.id),
        ]);
        if (!alive) return;
        setReactions(rx);
        setPins(pinned);
      } else {
        setReactions({});
        setPins(new Set());
      }

      // L'état de lecture du canal, relu à l'ouverture puis mis à jour —
      // c'est lui qui produit le « lu par n sur m ». Sans cette lecture,
      // aucun message n'aurait d'accusé, et la fonctionnalité serait
      // invisible juste parce qu'on n'a pas pensé à la charger.
      if (profile?.id) {
        const marks = await fetchChannelReadMarks(channelId);
        if (alive) setReadMarks(marks);
        await markChannelRead(channelId, profile.id);
        if (alive) {
          setReadMarks((prev) => [
            ...prev.filter((m) => m.userId !== profile.id),
            { userId: profile.id, readAt: new Date().toISOString() },
          ]);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [channelId, profile?.id]);

  useEffect(() => {
    if (messages) scrollDown();
  }, [messages, scrollDown]);

  /**
   * L'indicateur de frappe du canal ouvert.
   *
   * Un canal peut avoir plusieurs personnes en train d'écrire — c'est
   * précisément la différence avec un message privé. Le libellé suit
   * donc le nombre : « X écrit », « X et Y écrivent », « 4 personnes
   * écrivent ». Écrire « X écrit » pour quatre personnes serait
   * faux, et une ligne d'indicateur fausse est pire qu'une absente.
   *
   * Le topic de frappe est distinct de celui des messages (`gc-<id>`) :
   * `api.channel()` réutilise l'instance d'un topic existant, et
   * ajouter une liaison à un canal déjà abonné lève.
   */
  const { peers: typingPeers, notifyTyping } = useTyping(
    active ? `gc-typing-${active.id}` : null,
    profile?.id ?? null,
  );

  /** Prénoms des pairs qui tapent, résolus pour l'affichage. */
  const [typingNames, setTypingNames] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (typingPeers.length === 0) {
        setTypingNames([]);
        return;
      }

      const { data } = await api
        .from("users")
        .select("id, prenom")
        .in("id", typingPeers.map((p) => p.userId));

      if (!alive) return;
      setTypingNames(
        ((data as { id: string; prenom: string }[] | null) ?? []).map((n) => n.prenom),
      );
    })();

    return () => {
      alive = false;
    };
  }, [typingPeers]);

  // ── Temps réel, filtré sur le canal ouvert ──
  useEffect(() => {
    if (!channelId) return;

    const channel = api
      .channel(`gc-${channelId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "group_messages",
          filter: `channel_id=eq.${channelId}` },
        ({ new: m }: { new: GroupMessage }) => {
          // On ignore un message arrivé pour un canal qui n'est plus
          // ouvert : sinon il s'affiche dans la discussion courante.
          if (m.channel_id !== channelId) return;
          setLoaded((prev) =>
            !prev || prev.channelId !== channelId
              ? prev
              : { channelId, rows: [...prev.rows.filter((x) => x.id !== m.id), m] },
          );
        })
      .subscribe();

    return () => {
      void api.removeChannel(channel);
    };
  }, [channelId]);

  /** Pose ou retire une réaction, en optimiste (même choix qu'en MP). */
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
      "group_message",
      messageId,
      profile.id,
      emoji,
    );

    if (error) {
      setReactions(before);
      toast("Réaction impossible", "err");
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

    const { error } = await toggleMessagePin("group_message", messageId, profile.id);
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

  async function send(attachment?: MessageAttachment) {
    if (!profile || !active) return;
    const body = text.trim();
    // Mêmes règles que le privé : média seul accepté, URL filtrée.
    if (!canSendMessage(body, attachment)) return;
    const media = attachmentColumns(attachment);

    setSending(true);
    const { error } = await api.from("group_messages").insert({
      group_id: id,
      channel_id: active.id,
      author_id: profile.id,
      author_name: profile.prenom,
      author_color: profile.avatar_color,
      text: body,
      is_code: asCode,
      gif_url: media.gif_url,
      gif_alt: media.gif_alt,
      sticker_id: media.sticker_id,
      media_url: media.media_url,
      media_type: media.media_type,
      reply_to_id: replyTo?.id ?? null,
    });

    setSending(false);
    if (error) return toast(`Erreur : ${error.message}`, "err");
    setText("");
    setReplyTo(null);
    // On annonce le gain, sans toast d'erreur : répondre dans un groupe
    // fait progresser, et l'utilisateur doit le voir.
    toast(`Envoyé · +${messagePoints(asCode)} pts`);
  }

  /**
   * Un média dans un canal part **tel quel** : le canal n'est pas un
   * atelier de statut. On choisit le type, on téléverse, on envoie.
   */
  function attachMedia(file: File) {
    if (!active) return;
    const kind = file.type.startsWith("video/")
      ? "video"
      : file.type.startsWith("image/")
        ? "image"
        : null;
    if (!kind) return toast("Choisis une photo ou une vidéo.", "err");
    void sendMedia(file);
  }

  /** Envoyer une photo ou une vidéo dans le canal courant. */
  async function sendMedia(file: File) {
    setUploadingMedia(true);
    const result = await uploadMedia(file);
    setUploadingMedia(false);
    if (!result.ok) return toast(result.error, "err");
    await send({ kind: "media", url: result.media.url, mediaType: result.media.kind });
  }

  /**
   * Supprimer un message — l'auteur, ou l'équipe du groupe (migration
   * 020). La RLS tranche ; l'écran ne montre le bouton que là où elle
   * accepte, et l'erreur, si elle vient quand même, se dit.
   */
  async function removeMessage(messageId: string) {
    setPendingDelete(null);
    const { error } = await deleteGroupMessage(messageId);
    if (error) return toast("Suppression refusée", "err");
    setLoaded((prev) =>
      prev
        ? { channelId: prev.channelId, rows: prev.rows.filter((x) => x.id !== messageId) }
        : prev,
    );
    toast("Message supprimé");
  }

  /** Régler le rôle d'un membre — réservé au créateur par la RLS. */
  async function changeRole(member: MemberRow, next: GroupRole) {
    if (busyMember) return;
    setBusyMember(member.user_id);
    const { error } = await setMemberRole(id, member.user_id, next);
    setBusyMember(null);
    if (error) return toast("Rôle refusé", "err");
    await loadMembers();
    toast(`${member.user?.prenom ?? "Membre"} → ${ROLE_LABEL[next]}`);
  }

  /** Retirer un membre — l'équipe visant un membre simple, ou le créateur. */
  async function kickMember(member: MemberRow) {
    if (busyMember) return;
    setBusyMember(member.user_id);
    const { error } = await removeMember(id, member.user_id);
    setBusyMember(null);
    if (error) return toast("Retrait refusé", "err");
    await loadMembers();
    toast(`${member.user?.prenom ?? "Membre"} retiré du groupe`);
  }

  /** Quitter le groupe soi-même — la RLS autorise `user_id = auth.uid()`. */
  async function leaveGroup() {
    if (!profile || busyMember) return;
    setBusyMember(profile.id);
    const { error } = await removeMember(id, profile.id);
    setBusyMember(null);
    if (error) return toast("Départ refusé", "err");
    toast("Groupe quitté");
    router.push("/groups");
  }

  async function createChannel() {
    if (!profile || !group) return;
    const name = newName.trim();
    if (!isValidChannelName(name)) {
      return toast("Nom de canal inutilisable", "err");
    }

    setCreating(true);
    const slug = uniqueSlug(name, ordered.map((c) => c.slug));

    const { data, error } = await api
      .from("channels")
      .insert({
        group_id: id,
        slug,
        name,
        topic: newTopic.trim(),
        position: ordered.length,
        created_by: profile.id,
      })
      .select("id, slug, name, topic, position, is_private")
      .single();

    setCreating(false);
    if (error) return toast(`Erreur : ${error.message}`, "err");

    // On rouvre immédiatement le canal créé : l'utilisateur vient de dire
    // « ici, maintenant » — le renvoyer ailleurs serait une faute.
    setChannels((prev) => [...(prev ?? []), data as ChannelLite]);
    setActiveSlug((data as ChannelLite).slug);
    setNewName("");
    setNewTopic("");
    setOpenNew(false);
    toast(`#${slug} ouvert`);
  }

  return (
    <AppShell
      title={group ? group.name : "Groupe"}
      path={active ? `~/groupes/${id}/${active.slug}` : `~/groupes/${id}`}
      wide
      immersive
    >
      {/* ── Coque du tchat ──
          Plein écran sur téléphone (l'en-tête et la barre basse de
          l'application s'effacent derrière), deux volets à partir de
          `shell` : le rail de canaux tient alors à côté de la discussion.
          Un seul arbre, deux dispositions — le composeur vit **dans** la
          colonne, il ne peut donc pas être recouvert. */}
      <div className="fixed inset-0 z-(--z-sheet) flex flex-col overlay-frost
        shell:static shell:bg-page shell:z-auto shell:h-[calc(100dvh-var(--h-topbar)-var(--h-banner,0px))] shell:flex-row">

        {/* Rail de canaux — colonne à gauche sur grand écran seulement :
            un rail de 164 px volerait un tiers d'un écran de 390 px. */}
        <nav aria-label="Canaux" className="hidden shrink-0 flex-col overflow-y-auto
          border-r border-edge glass-flat shell:flex shell:w-44">
          <p className="label-micro px-3 pt-3 pb-1.5 text-chalk-4">Canaux</p>

          <div className="flex flex-col gap-0.5 px-1.5">
            {ordered.map((c) => {
              const on = c.slug === active?.slug;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveSlug(c.slug)}
                  aria-current={on ? "true" : undefined}
                  className={`relative flex w-full items-center gap-1.5
                    rounded-(--radius-chip) px-2.5 py-2 text-left text-13
                    transition-colors
                    ${on
                      ? "bg-surface-2 font-semibold text-signal"
                      : "text-chalk-3 hover:bg-surface-2/60 hover:text-chalk"}`}
                >
                  {on && <span className="absolute inset-y-0 left-0 w-[3px] bg-signal" />}
                  <Icon name={c.is_private ? "lock" : "hash"} size={12} strokeWidth={2}
                    className={on ? "text-signal" : "text-chalk-4"} />
                  <span className="truncate">{c.name || c.slug}</span>
                </button>
              );
            })}

            <button type="button" onClick={() => setOpenNew(true)}
              className="flex w-full items-center gap-1.5 rounded-(--radius-chip)
                px-2.5 py-2 text-left text-13 text-chalk-4 transition-colors
                hover:bg-surface-2/60 hover:text-chalk">
              <Icon name="plus" size={12} strokeWidth={2} />
              <span className="truncate">Nouveau canal</span>
            </button>
          </div>

          {/* Dépôts du groupe : le code se lit dans la même pièce que la
              discussion. Discret — n'apparaît que si le groupe en a. */}
          {repos.length > 0 && (
            <>
              <p className="label-micro px-3 pt-4 pb-1.5 text-chalk-4">Dépôts</p>
              <div className="flex flex-col gap-0.5 px-1.5 pb-3">
                {repos.map((r) => (
                  <Link key={r.id} href={`/projects/${r.id}`} title={`Ouvrir ${r.name}`}
                    className="flex w-full items-center gap-1.5 rounded-(--radius-chip)
                      px-2.5 py-2 text-left text-sm text-chalk-3 transition-colors
                      hover:bg-surface-2/60 hover:text-signal">
                    <span aria-hidden="true" className="shrink-0 leading-none text-signal-d">
                      <Icon name={asIconName(r.emoji, "layers")} size={12} strokeWidth={1.8} />
                    </span>
                    <span className="truncate">{r.name}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </nav>

        {/* ── Discussion ── */}
        <div className="relative flex min-w-0 min-h-0 flex-1 flex-col">
          <header className="shrink-0 border-b border-edge glass-strong">
            <div className="flex h-(--h-topbar) items-center gap-2.5 px-3 safe-top">
              <button type="button" aria-label="Retour aux groupes"
                onClick={() => router.push("/groups")}
                className="mo-press flex size-(--h-tap) shrink-0 items-center
                  justify-center border-(--bw-thin) border-line-2/40 text-chalk
                  transition-colors hover:border-signal hover:bg-signal hover:text-void
                  shell:hidden">
                <Icon name="chevron-left" size={16} />
              </button>

              {/* Identité : le groupe sur téléphone (l'en-tête de
                  l'application est masqué derrière cette coque), le canal
                  ouvert sur grand écran. */}
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="flex size-8.5 shrink-0 items-center justify-center
                  rounded-(--radius-input) border border-line-3 bg-surface-2
                  text-signal-d shell:hidden">
                  <Icon name={asIconName(group?.emoji, "groups")} size={16} strokeWidth={1.7} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-13 font-bold text-chalk shell:hidden">
                    {group?.name ?? "Groupe"}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-13 font-bold text-chalk">
                      {active ? channelLabel(active) : "#"}
                    </span>
                    {active?.topic && (
                      <span className="hidden truncate text-12 text-chalk-4 shell:inline">
                        {active.topic}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <IconButton label="Membres du groupe" name="groups"
                  onClick={() => setOpenMembers(true)} />
                <IconButton label="Nouveau canal" name="plus"
                  onClick={() => setOpenNew(true)} />
              </div>
            </div>

            {/* Bande de canaux — téléphone seulement. */}
            <nav aria-label="Canaux — accès rapide"
              className="flex gap-1 overflow-x-auto px-2 pb-2 shell:hidden">
              {ordered.map((c) => {
                const on = c.slug === active?.slug;
                return (
                  <button key={c.id} type="button" onClick={() => setActiveSlug(c.slug)}
                    aria-current={on ? "true" : undefined}
                    className={`relative flex shrink-0 items-center gap-1.5
                      rounded-(--radius-chip) px-2.5 py-1.5 text-sm transition-colors
                      ${on ? "bg-surface-2 font-semibold text-signal"
                           : "text-chalk-3 hover:bg-surface-2/60 hover:text-chalk"}`}>
                    <Icon name={c.is_private ? "lock" : "hash"} size={11} strokeWidth={2}
                      className={on ? "text-signal" : "text-chalk-4"} />
                    <span className="truncate">{c.name || c.slug}</span>
                  </button>
                );
              })}
              <button type="button" onClick={() => setOpenNew(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-(--radius-chip)
                  px-2.5 py-1.5 text-sm text-chalk-4 transition-colors
                  hover:bg-surface-2/60 hover:text-chalk">
                <Icon name="plus" size={11} strokeWidth={2} />
                Nouveau
              </button>
            </nav>
          </header>

          <div className="chat-wall flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto
            px-(--gutter) pt-4 pb-4">
            {/* Groupe sans aucun canal : un loader tournerait pour
                toujours, puisqu'il n'y a rien à charger. On propose de
                créer le premier canal à la place. */}
            {channels !== null && ordered.length === 0 && (
              <EmptyState
                title="Aucun canal dans ce groupe"
                action={
                  <PrimaryButton icon="plus" onClick={() => setOpenNew(true)}>
                    Créer un canal
                  </PrimaryButton>
                }
              />
            )}

            {messages === null && (channels === null || ordered.length > 0) && <Loading />}

            {messages?.length === 0 && (
              <EmptyState
                title={`Aucun message dans ${active ? channelLabel(active) : "ce canal"}`}
                hint={active?.topic ? active.topic : "Ajoutez un sujet."}
                action={<PrimaryButton icon="send" onClick={() => {
                  document.getElementById("composer-channel")?.focus();
                }}>Écrire le premier message</PrimaryButton>}
              />
            )}

            {messages?.map((m) => {
              const mine = m.author_id === profile?.id;
              // La fraction ne porte que sur les messages écrits : on ne
              // peut pas prétendre savoir qui a lu le message de quelqu'un
              // d'autre, et le résultat serait une information fausse.
              const receipt = mine
                ? readBy(m.created_at, readMarks, profile?.id ?? "")
                : null;
              // Le message cité est cherché dans la fenêtre chargée ; plus
              // ancien, il n'affiche pas de citation plutôt qu'un contenu
              // inventé.
              const parent = m.reply_to_id
                ? messages.find((x) => x.id === m.reply_to_id)
                : null;
              return (
                <div
                  key={m.id}
                  id={`gm-msg-${m.id}`}
                  className={`${mine ? "mo-msg-in" : "mo-msg-in-alt"} group/message flex items-end gap-2.5 ${mine ? "flex-row-reverse" : ""}`}
                >
                  {!mine && <Avatar name={m.author_name} color={m.author_color} />}
                  <div className={`flex max-w-[78%] flex-col gap-0.5 ${mine ? "items-end" : ""}`}>
                    {!mine && (
                      <span className="pl-0.5 text-12 font-bold text-chalk-3">
                        {m.author_name}
                      </span>
                    )}
                    {parent && (
                      <ReplyQuote
                        author={parent.author_name}
                        text={parent.text}
                        align={mine ? "right" : "left"}
                        onClick={() =>
                          document
                            .getElementById(`gm-msg-${parent.id}`)
                            ?.scrollIntoView({ behavior: "smooth", block: "center" })
                        }
                      />
                    )}
                    <div
                      className={`rounded-(--radius-input) border px-3.5 py-2.5 text-13
                        leading-[1.55] break-words whitespace-pre-wrap
                        ${m.is_code && !mine
                          ? "border-l-[5px] border-signal glass-flat font-mono text-12"
                          : mine
                            ? "border-signal/60 glass-flat text-chalk"
                            : "border-line-2 glass-flat text-chalk-2"}`}
                    >
                      <MessageAttachmentView
                        gifUrl={m.gif_url}
                        gifAlt={m.gif_alt}
                        mediaUrl={m.media_url}
                        mediaType={m.media_type}
                        sticker={
                          m.sticker_id ? stickerCatalog.get(m.sticker_id) ?? null : null
                        }
                      />
                      {m.text}
                    </div>
                    <span className="px-0.5 text-12 tracking-wider text-chalk-4">
                      {clockTime(m.created_at)}
                      {receipt && (
                        <GroupReceipt count={receipt.count} total={receipt.total} />
                      )}
                    </span>
                    <MessageExtras
                      summary={reactions[m.id] ?? []}
                      pinned={pins.has(m.id)}
                      align={mine ? "right" : "left"}
                      onToggleReaction={(emoji) => void toggleReaction(m.id, emoji)}
                      onReply={() => setReplyTo(m)}
                      onTogglePin={() => void togglePin(m.id)}
                      onDelete={
                        mine || canModerate
                          ? () => setPendingDelete(m.id)
                          : undefined
                      }
                    />
                    {pendingDelete === m.id && (
                      <div
                        role="alertdialog"
                        aria-label="Confirmer la suppression du message"
                        className={`flex flex-wrap items-center gap-2 border border-danger
                          bg-surface px-2.5 py-2 text-12 text-chalk shadow-sh-1
                          ${mine ? "self-end" : "self-start"}`}
                      >
                        <Icon name="trash" size={14} className="text-danger" />
                        <span className="mr-auto">
                          {mine
                            ? "Supprimer ce message ?"
                            : `Message de ${m.author_name} — supprimer ?`}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(null)}
                          className="rounded-(--radius-chip) border border-line-3 px-2 py-1
                            font-mono text-12 font-bold uppercase tracking-[0.12em]
                            text-chalk-3 transition-colors hover:text-chalk"
                        >
                          annuler
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeMessage(m.id)}
                          className="rounded-(--radius-chip) border border-danger bg-danger px-2 py-1
                            font-mono text-12 font-bold uppercase tracking-[0.12em] text-void
                            transition-transform active:translate-y-px"
                        >
                          supprimer
                        </button>
                      </div>
                    )}
                  </div>
                  {mine && <Avatar name={m.author_name} color={m.author_color} />}
                </div>
              );
            })}
            {/* La frappe se lit sous les messages : c'est le bas de la
                conversation que l'œil surveille. */}
            <TypingLine names={typingNames} />
            <div ref={endRef} />

          </div>
          <ComposerBar>
            {replyTo && (
              <div className="mb-1.5 flex items-center gap-2 rounded-(--radius-input)
                border border-line-2 bg-surface px-2.5 py-1.5 text-12 text-chalk-3">
                <Icon name="comment" size={12} className="shrink-0 text-signal" />
                <span className="min-w-0 flex-1 truncate">
                  Réponse à{" "}
                  <span className="font-bold text-chalk">{replyTo.author_name}</span>
                </span>
                <button type="button" onClick={() => setReplyTo(null)}
                  aria-label="Annuler la réponse"
                  className="shrink-0 text-chalk-4 transition-colors hover:text-danger">
                  <Icon name="close" size={12} />
                </button>
              </div>
            )}
            <ChatComposer
              id="composer-channel"
              value={text}
              onValueChange={setText}
              onSend={() => void send()}
              attachments={
                <>
                  <MessageAttachmentButtons
                    disabled={!active || sending || uploadingMedia}
                    onGif={(gif) => void send({ kind: "gif", gif })}
                    onMedia={attachMedia}
                  />
                </>
              }
              onTyping={notifyTyping}
              sending={sending}
              disabled={!active}
              placeholder={active ? `Message dans ${channelLabel(active)}` : "Aucun canal"}
              code={asCode}
              onToggleCode={() => setAsCode((v) => !v)}
            />
          </ComposerBar>
        </div>
      </div>

      {/* ── Création de canal ── */}
      <Sheet open={openNew} onClose={() => setOpenNew(false)} title="Nouveau canal">
        <div className="mb-3">
          <label className="label mb-1.5 block text-chalk">Nom</label>
          <input
            aria-label="Nom du canal"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="développement"
            className="h-(--h-input) w-full rounded-(--radius-input) border
              border-line-3 bg-surface px-3.5 text-14 shadow-sh-1
              placeholder:text-chalk-4 focus:shadow-[3px_3px_0_var(--color-signal)]"
          />
          {/* Aperçu du slug : le nom affiché et le nom tapé diffèrent, et
              c'est le second qui finit dans l'URL. Better vaut le montrer
              avant qu'un lien soit partagé. */}
          {newName.trim() && (
            <p className="label-micro mt-1.5 flex items-center gap-1.5 text-chalk-4">
              <Icon name="hash" size={11} strokeWidth={2} />
              {uniqueSlug(newName, ordered.map((c) => c.slug))}
              {slugify(newName) !== newName.trim().toLowerCase() && (
                <span className="text-warn">· accent retiré</span>
              )}
            </p>
          )}
        </div>

        <div className="mb-4">
          <label className="label mb-1.5 block text-chalk">Sujet (facultatif)</label>
          <input
            aria-label="Sujet du canal"
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            placeholder="À quoi sert ce canal ?"
            className="h-(--h-input) w-full rounded-(--radius-input) border
              border-line-3 bg-surface px-3.5 text-14 shadow-sh-1
              placeholder:text-chalk-4 focus:shadow-[3px_3px_0_var(--color-signal)]"
          />
        </div>

        <div className="mt-1 flex gap-2.5">
          <button type="button" onClick={() => setOpenNew(false)}
            className="rounded-(--radius-input) border border-transparent px-5
              text-13 font-bold text-chalk-2 transition-colors hover:bg-surface-2 hover:text-chalk">
            Annuler
          </button>
          <button
            type="button" onClick={createChannel} disabled={creating}
            className="mo-press flex h-(--h-tap) flex-1 items-center justify-center gap-2
              rounded-(--radius-input) border border-line-3 bg-signal text-13
              font-bold text-void shadow-sh-2 disabled:opacity-40"
          >
            {creating ? "Création…" : "Ouvrir le canal"}
          </button>
        </div>
      </Sheet>

      {/* ── Membres et rôles (migration 020) ──
          Les pouvoirs se lisent ici avant de s'exercer : le créateur
          nomme et retire des modérateurs, l'équipe retire un membre
          simple. Les actions absentes sont celles que la RLS refuserait
          — un bouton qui échoue en silence serait le défaut que la
          migration a été écrite pour éviter. */}
      <Sheet open={openMembers} onClose={() => setOpenMembers(false)} title="Membres">
        {members === null && <Loading />}

        {members !== null && (
          <ul className="flex flex-col gap-1">
            {members.map((m) => {
              const staff = m.role === "owner" || m.role === "moderator";
              return (
                <li
                  key={m.user_id}
                  className="flex items-center gap-2.5 border border-line bg-surface-2 px-2.5 py-2"
                >
                  <Avatar
                    name={m.user?.prenom ?? "?"}
                    color={m.user?.avatar_color}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-13 font-bold text-chalk">
                      {m.user?.prenom ?? "Compte supprimé"}
                      {m.user?.verified && <VerifiedBadge tier={badgeFor(m.user, xpOf(m.user))} size="sm" className="ml-1.5" />}
                      {m.user?.account_type === "professional" && (
                        <Icon
                          name="verified"
                          size={11}
                          className="ml-1.5 inline text-signal"
                        />
                      )}
                    </p>
                    <p className="truncate font-mono text-12 text-chalk-4">
                      @{m.user?.pseudo ?? "—"}
                    </p>
                  </div>

                  <span
                    className={`shrink-0 font-mono text-12 font-bold uppercase
                      tracking-[0.12em] ${
                        m.role === "owner"
                          ? "text-warn"
                          : staff
                            ? "text-signal"
                            : "text-chalk-4"
                      }`}
                  >
                    {ROLE_LABEL[m.role]}
                  </span>

                  {/* Rôle — le créateur seul règle les rôles, et jamais
                      le sien ni celui du propriétaire. */}
                  {isCreator && m.user_id !== profile?.id && m.role !== "owner" && (
                    <button
                      type="button"
                      disabled={busyMember === m.user_id}
                      onClick={() =>
                        void changeRole(
                          m,
                          m.role === "moderator" ? "member" : "moderator",
                        )
                      }
                      className="mo-press shrink-0 rounded-(--radius-chip) border border-line-3
                        px-2 py-1 font-mono text-12 font-bold uppercase tracking-[0.1em]
                        text-chalk-2 transition-colors hover:border-signal hover:text-signal
                        disabled:opacity-40"
                    >
                      {m.role === "moderator" ? "révoquer" : "nommer"}
                    </button>
                  )}

                  {/* Retrait — l'équipe vise un membre simple ; un autre
                      modérateur ou le propriétaire n'est pas une cible. */}
                  {canModerate &&
                    m.user_id !== profile?.id &&
                    m.role === "member" && (
                      <button
                        type="button"
                        disabled={busyMember === m.user_id}
                        onClick={() => void kickMember(m)}
                        aria-label={`Retirer ${m.user?.prenom ?? "ce membre"} du groupe`}
                        className="mo-press flex size-7.5 shrink-0 items-center justify-center
                          rounded-(--radius-chip) text-chalk-4 transition-colors
                          hover:text-danger disabled:opacity-40"
                      >
                        <Icon name="close" size={14} />
                      </button>
                    )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 text-12 leading-[1.5] text-chalk-4">
          Le créateur gère les rôles.
        </p>

        {profile && role !== "owner" && (
          <button
            type="button"
            disabled={busyMember !== null}
            onClick={() => void leaveGroup()}
            className="mo-press mt-4 flex h-11 w-full items-center justify-center gap-2
              rounded-(--radius-input) border border-danger bg-surface
              text-13 font-bold text-danger transition-colors hover:bg-danger
              hover:text-void disabled:opacity-40"
          >
            <Icon name="logout" size={14} />
            Quitter le groupe
          </button>
        )}
      </Sheet>
    </AppShell>
  );
}