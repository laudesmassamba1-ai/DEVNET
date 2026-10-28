"use client";

import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { AppShell, IconButton } from "@/components/AppShell";
import { Avatar, EmptyState, Loading, PrimaryButton } from "@/components/Avatar";
import { CommentsPanel } from "@/components/CommentsPanel";
import { Icon, asIconName } from "@/components/Icon";
import { PostCard } from "@/components/PostCard";
import { PostOwnerTools } from "@/components/PostOwnerTools";
import { Sheet } from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/hooks/useSession";
import { usePostActions } from "@/hooks/usePostActions";
import { fetchLikedPostIds, toggleLike } from "@/lib/social";
import { findUserByPseudo } from "@/lib/repo";
import {
  ROLE_LABEL, VISIBILITY_HELP, VISIBILITY_LABEL, deleteCommunity,
  fetchCommunityBySlug, fetchCommunityMembers, fetchCommunityPosts,
  isCommunityStaff, joinCommunity, leaveCommunity, myRole,
  removeCommunityMember, setCommunityMemberRole, updateCommunity,
  type CommunityMemberRow, type CommunityPost,
} from "@/lib/communities";
import type { Community, CommunityRole, CommunityVisibility } from "@/lib/types";

const ICONS = ["globe", "code", "terminal", "bolt", "grid",
  "layers", "lock", "package", "star", "server"] as const;
const VISIBILITIES: CommunityVisibility[] = ["public", "restricted", "private"];

export default function CommunityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { profile } = useSession();
  const toast = useToast();
  const router = useRouter();

  const [community, setCommunity] = useState<Community | null | undefined>(undefined);
  const [members, setMembers] = useState<CommunityMemberRow[]>([]);
  const [posts, setPosts] = useState<CommunityPost[] | null>(null);
  const [likedIds, setLikedIds] = useState<string[]>([]);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [invite, setInvite] = useState("");

  const role = myRole(members, profile?.id ?? null);
  const staff = isCommunityStaff(role);
  const amMember = role !== null || community?.created_by === profile?.id;
  const canPost =
    community != null &&
    (community.visibility === "public" || amMember);

  const loadPosts = async (communityId: string) => {
    const rows = await fetchCommunityPosts(communityId);
    setPosts(rows);
    if (profile) {
      setLikedIds(await fetchLikedPostIds(profile.id, rows.map((r) => r.id)));
    }
  };

  useEffect(() => {
    if (!slug) return;
    let alive = true;

    fetchCommunityBySlug(slug).then(async (c) => {
      if (!alive) return;
      setCommunity(c);
      if (!c) return;
      const [ms, rows] = await Promise.all([
        fetchCommunityMembers(c.id),
        fetchCommunityPosts(c.id),
      ]);
      if (!alive) return;
      setMembers(ms);
      setPosts(rows);
      if (profile) {
        const liked = await fetchLikedPostIds(profile.id, rows.map((r) => r.id));
        if (alive) setLikedIds(liked);
      }
    });

    return () => {
      alive = false;
    };
  }, [slug, profile]);

  async function onToggleLike(id: string) {
    if (!profile) return;
    const { liked, error } = await toggleLike(id, profile.id);
    if (error) return toast(`Erreur : ${error}`, "err");
    setLikedIds((prev) => (liked ? [...prev, id] : prev.filter((x) => x !== id)));
    setPosts((prev) =>
      (prev ?? []).map((p) =>
        p.id === id ? { ...p, likes: Math.max(0, (p.likes || 0) + (liked ? 1 : -1)) } : p,
      ),
    );
  }

  const postActions = usePostActions({
    meId: profile?.id,
    onDeleted: (postId) => {
      setPosts((prev) => (prev === null ? prev : prev.filter((p) => p.id !== postId)));
      if (community) void loadPosts(community.id);
    },
    onUpdated: (postId, text) => {
      setPosts((prev) =>
        (prev ?? []).map((p) => (p.id === postId ? { ...p, text } : p)),
      );
    },
  });

  async function publish() {
    if (!community || !profile) return;
    if (!draft.trim()) return toast("Écris quelque chose", "err");

    setBusy(true);
    const { error } = await supabase.from("posts").insert({
      author_id: profile.id,
      text: draft.trim(),
      has_code: false,
      code: "",
      lang: "",
      community_id: community.id,
    });
    setBusy(false);
    if (error) return toast(`Erreur : ${error.message}`, "err");

    setDraft("");
    toast("Publié");
    await loadPosts(community.id);
  }

  async function join() {
    if (!community || !profile) return;
    const { error } = await joinCommunity(community.id, profile.id);
    if (error && !/duplicate|unique/i.test(error)) {
      return toast(`Erreur : ${error}`, "err");
    }
    setMembers(await fetchCommunityMembers(community.id));
    setCommunity((prev) =>
      prev ? { ...prev, member_count: (prev.member_count || 0) + 1 } : prev,
    );
    toast("Communauté rejointe");
  }

  async function leave() {
    if (!community || !profile) return;
    const { error } = await leaveCommunity(community.id, profile.id);
    if (error) return toast(`Erreur : ${error}`, "err");
    setMembers(await fetchCommunityMembers(community.id));
    toast("Tu as quitté la communauté");
  }

  async function changeRole(member: CommunityMemberRow, next: CommunityRole) {
    if (!community) return;
    const { error } = await setCommunityMemberRole(community.id, member.user_id, next);
    if (error) return toast(`Erreur : ${error}`, "err");
    setMembers(await fetchCommunityMembers(community.id));
  }

  async function remove(member: CommunityMemberRow) {
    if (!community) return;
    const { error } = await removeCommunityMember(community.id, member.user_id);
    if (error) return toast(`Erreur : ${error}`, "err");
    setMembers(await fetchCommunityMembers(community.id));
  }

  if (community === undefined) {
    return (
      <AppShell title="Communauté" path="~/communautés">
        <Loading label="Chargement de la communauté" />
      </AppShell>
    );
  }

  if (community === null) {
    return (
      <AppShell title="Communauté" path="~/communautés">
        <EmptyState
          icon={<Icon name="lock" size={20} strokeWidth={1.5} />}
          title="Communauté introuvable"
          action={<PrimaryButton icon="grid" onClick={() => router.push("/communities")}>Voir les communautés</PrimaryButton>}
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      title={community.name}
      path={`~/communautés/${community.slug}`}
      action={
        <IconButton
          label="Membres"
          name="groups"
          onClick={() => setMembersOpen(true)}
        />
      }
    >
      <div className="px-(--gutter) pt-3">
        {/* En-tête : icône, nom, visibilité, compteur, et l'action join/leave. */}
        <header className="depth-card mb-4 rounded-[var(--radius-card)] border border-edge glass-flat p-4">
          <div className="flex items-start gap-3.5">
            <span className="flex size-[44px] shrink-0 items-center justify-center rounded-[var(--radius-input)]
              border border-line-3 bg-surface-2 text-signal-d">
              <Icon name={asIconName(community.icon, "globe")} size={20} strokeWidth={1.6} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[18px] font-extrabold text-chalk">{community.name}</h1>
                <span className="rounded-[var(--radius-chip)] border border-line-3 px-2 py-0.5
                  text-[9px] font-bold uppercase tracking-[0.1em] text-chalk-3">
                  {VISIBILITY_LABEL[community.visibility]}
                </span>
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-chalk-3">
                {community.description || "Pas encore de description."}
              </p>
              <p className="mt-1 font-mono text-[11px] text-chalk-4">
                {community.member_count} membre{community.member_count !== 1 ? "s" : ""}
                {role && ` · vous êtes ${ROLE_LABEL[role]}`}
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              {staff && (
                <IconButton
                  label="Réglages"
                  name="settings"
                  onClick={() => setSettingsOpen(true)}
                />
              )}
              {amMember ? (
                community.created_by !== profile?.id && (
                  <button type="button" onClick={leave}
                    className="mo-press rounded-[var(--radius-chip)] border border-line-3 px-3.5 py-1.5
                      text-[11.5px] font-bold text-chalk-2 hover:text-chalk">
                    Quitter
                  </button>
                )
              ) : (
                <button type="button" onClick={join}
                  className="mo-press rounded-[var(--radius-chip)] border border-line-3 bg-signal px-3.5
                    py-1.5 text-[11.5px] font-bold text-void shadow-sh-1">
                  Rejoindre
                </button>
              )}
            </div>
          </div>

          {/* Règlement intérieur : il vit dans la communauté, pas dans un
              écran à part — c'est ce qu'on lit avant de publier. */}
          {community.rules.trim() && (
            <div className="mt-4 rounded-[var(--radius-input)] border border-line-2 bg-surface-2 px-3.5 py-3">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-chalk-3">
                Règlement
              </p>
              <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-chalk-2">
                {community.rules}
              </p>
            </div>
          )}
        </header>

        {/* Composeur : seulement là où la RLS autorise l'écriture. */}
        {canPost && (
          <div className="mb-4">
            <textarea
              value={draft} onChange={(e) => setDraft(e.target.value)}
              rows={2} placeholder={`Publier dans ${community.name}…`}
              className="mb-2 w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3.5 py-3
                text-[14px] leading-[1.6] shadow-sh-1 outline-none placeholder:text-chalk-4
                focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_#FF8A3D]"
            />
            <div className="flex justify-end">
              <button type="button" onClick={publish} disabled={busy}
                className="mo-press inline-flex h-[var(--h-tap)] items-center gap-2 rounded-[var(--radius-input)]
                  border border-line-3 bg-signal px-4 text-[12.5px] font-bold text-void shadow-sh-2
                  disabled:opacity-40">
                <Icon name="send" size={14} />
                Publier
              </button>
            </div>
          </div>
        )}

        {posts === null && <Loading />}

        {posts?.length === 0 && (
          <EmptyState
            icon={<Icon name="terminal" size={20} strokeWidth={1.5} />}
            title="Aucune publication"
          />
        )}

        {posts?.map((p, i) => (
          <PostCard
            key={p.id}
            post={p}
            meId={profile?.id ?? null}
            index={i}
            liked={likedIds.includes(p.id)}
            onToggleLike={onToggleLike}
            onOpenComments={setCommentsFor}
            onOpenProfile={(pseudo) => router.push(`/u/${pseudo}`)}
            isMine={postActions.isMine(p)}
            {...postActions.cardProps}
          />
        ))}
      </div>

      <PostOwnerTools actions={postActions} />

      <CommentsPanel
        postId={commentsFor}
        open={commentsFor !== null}
        onClose={() => setCommentsFor(null)}
        me={profile?.id ?? null}
        canModerate={
          commentsFor !== null &&
          posts?.find((p) => p.id === commentsFor)?.author_id === profile?.id
        }
      />

      {/* Membres et rôles */}
      <Sheet open={membersOpen} onClose={() => setMembersOpen(false)}
        title={`Membres · ${community.member_count}`}>
        {staff && (
          <div className="mb-4 flex gap-2">
            <input value={invite} onChange={(e) => setInvite(e.target.value)}
              placeholder="Inviter par pseudo (@…)"
              className="h-[var(--h-input)] flex-1 rounded-[var(--radius-input)] border border-line-3 bg-surface
                px-3.5 text-[14px] shadow-sh-1 outline-none placeholder:text-chalk-4" />
            <button type="button" onClick={addInvite}
              className="mo-press rounded-[var(--radius-input)] border border-line-3 bg-signal px-4
                text-[12.5px] font-bold text-void shadow-sh-1">
              Ajouter
            </button>
          </div>
        )}

        {members.map((m) => (
          <MemberRow
            key={m.user_id}
            m={m}
            staff={staff}
            meId={profile?.id ?? null}
            onChangeRole={(next) => changeRole(m, next)}
            onRemove={() => remove(m)}
          />
        ))}
      </Sheet>

      {/* Réglages (équipe) */}
      {staff && (
        <SettingsSheet
          community={community}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => {
            setCommunity(next);
            setSettingsOpen(false);
          }}
          onDeleted={() => router.push("/communities")}
        />
      )}
    </AppShell>
  );

  // Enveloppe locale : l'ajout par pseudo est un insert direct, pour que la
  // même politique (staff) décide. On relit la liste après coup.
  async function addInvite() {
    if (!community) return;
    const target = invite.trim().replace(/^@/, "");
    if (!target) return;
    const { user } = await findUserByPseudo(target);
    if (!user) return toast("Aucun compte trouvé", "err");
    const { error } = await supabase
      .from("community_members")
      .insert({ community_id: community.id, user_id: user.id, role: "member" });
    if (error) return toast(`Erreur : ${error.message}`, "err");
    setInvite("");
    setMembers(await fetchCommunityMembers(community.id));
    toast("Membre ajouté");
  }
}

function MemberRow({ m, staff, meId, onChangeRole, onRemove }: {
  m: CommunityMemberRow;
  staff: boolean;
  meId: string | null;
  onChangeRole: (role: CommunityRole) => void;
  onRemove: () => void;
}) {
  const isMe = m.user_id === meId;
  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-[var(--radius-input)] border border-line bg-surface-2
      px-2.5 py-2">
      <Avatar name={m.user?.prenom ?? "?"} color={m.user?.avatar_color} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-chalk">
          {m.user?.prenom ?? "Compte supprimé"}
        </p>
        <p className="truncate font-mono text-[11px] text-chalk-4">@{m.user?.pseudo ?? "—"}</p>
      </div>

      {staff && !isMe ? (
        <select value={m.role} onChange={(e) => onChangeRole(e.target.value as CommunityRole)}
          className="h-8 cursor-pointer rounded-[var(--radius-chip)] border border-line-3 bg-surface px-2
            text-[11px] font-bold outline-none">
          <option value="member">membre</option>
          <option value="moderator">modérateur</option>
          <option value="owner">créateur</option>
        </select>
      ) : (
        <span className={`shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.12em]
          ${m.role === "owner" ? "text-warn" : isCommunityStaff(m.role) ? "text-signal" : "text-chalk-4"}`}>
          {ROLE_LABEL[m.role]}
        </span>
      )}

      {staff && !isMe && m.role !== "owner" && (
        <button type="button" onClick={onRemove}
          className="shrink-0 text-[11px] font-bold text-danger hover:underline">
          Retirer
        </button>
      )}
    </div>
  );
}

function SettingsSheet({ community, open, onClose, onSaved, onDeleted }: {
  community: Community;
  open: boolean;
  onClose: () => void;
  onSaved: (next: Community) => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(community.name);
  const [desc, setDesc] = useState(community.description);
  const [rules, setRules] = useState(community.rules);
  const [icon, setIcon] = useState(community.icon);
  const [visibility, setVisibility] = useState<CommunityVisibility>(community.visibility);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Re-synchronise à l'ouverture : la feuille réutilisée doit refléter
  // l'état courant, pas le premier rendu.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(community.name);
    setDesc(community.description);
    setRules(community.rules);
    setIcon(community.icon);
    setVisibility(community.visibility);
    setConfirmDelete(false);
  }, [open, community]);

  async function save() {
    if (!name.trim()) return toast("Le nom est requis", "err");
    setBusy(true);
    const { error } = await updateCommunity(community.id, {
      name: name.trim(),
      description: desc.trim(),
      rules: rules.trim(),
      icon,
      visibility,
    });
    setBusy(false);
    if (error) return toast(`Erreur : ${error}`, "err");
    toast("Réglages enregistrés");
    onSaved({
      ...community,
      name: name.trim(),
      description: desc.trim(),
      rules: rules.trim(),
      icon,
      visibility,
    });
  }

  async function destroy() {
    setBusy(true);
    const { error } = await deleteCommunity(community.id);
    setBusy(false);
    if (error) return toast(`Erreur : ${error}`, "err");
    toast("Communauté supprimée");
    onDeleted();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Réglages">
      <Field label="Nom">
        <input value={name} onChange={(e) => setName(e.target.value)}
          className="h-[var(--h-input)] w-full rounded-[var(--radius-input)] border border-line-3 bg-surface
            px-3.5 text-[14px] shadow-sh-1 outline-none" />
      </Field>

      <Field label="Description">
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2}
          className="w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3.5 py-3
            text-[14px] shadow-sh-1 outline-none" />
      </Field>

      <Field label="Règlement intérieur">
        <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={4}
          className="w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3.5 py-3
            text-[14px] shadow-sh-1 outline-none" />
      </Field>

      <Field label="Visibilité">
        <div className="grid grid-cols-3 gap-2">
          {VISIBILITIES.map((v) => (
            <button key={v} type="button" onClick={() => setVisibility(v)}
              className={`mo-press rounded-[var(--radius-input)] border px-2 py-2.5 text-[12px] font-bold
                ${visibility === v
                  ? "border-line-3 bg-signal text-void"
                  : "border-line-3 bg-surface text-chalk-2"}`}>
              {VISIBILITY_LABEL[v]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-chalk-4">{VISIBILITY_HELP[visibility]}</p>
      </Field>

      <Field label="Icône">
        <div className="grid grid-cols-5 gap-2">
          {ICONS.map((k) => (
            <button key={k} type="button" onClick={() => setIcon(k)}
              className={`flex aspect-square items-center justify-center rounded-[var(--radius-input)]
                border border-line-3 ${icon === k ? "bg-signal text-void" : "bg-surface text-signal-d"}`}>
              <Icon name={k} size={18} strokeWidth={1.6} />
            </button>
          ))}
        </div>
      </Field>

      <button type="button" onClick={save} disabled={busy}
        className="mo-press mb-5 flex h-[var(--h-tap)] w-full items-center justify-center
          rounded-[var(--radius-input)] border border-line-3 bg-signal text-[13px] font-bold text-void
          shadow-sh-2 disabled:opacity-40">
        Enregistrer
      </button>

      <div className="rounded-[var(--radius-input)] border border-danger/40 p-3.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-danger">Zone sensible</p>
        <p className="mt-1 text-[12px] text-chalk-3">
          Supprimer la communauté ferme le fil. Les publications survivent,
          détachées de tout rayon.
        </p>
        {confirmDelete ? (
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setConfirmDelete(false)}
              className="flex-1 rounded-[var(--radius-input)] border border-line-3 py-2 text-[12px]
                font-bold text-chalk-2">
              Annuler
            </button>
            <button type="button" onClick={destroy} disabled={busy}
              className="flex-1 rounded-[var(--radius-input)] border border-danger bg-danger py-2
                text-[12px] font-bold text-void disabled:opacity-40">
              Supprimer
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)}
            className="mt-3 rounded-[var(--radius-input)] border border-danger px-3.5 py-2 text-[12px]
              font-bold text-danger hover:bg-danger/10">
            Supprimer la communauté
          </button>
        )}
      </div>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="label mb-1.5 block text-chalk">{label}</label>
      {children}
    </div>
  );
}
