"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell, IconButton } from "@/components/AppShell";
import { Icon, asIconName } from "@/components/Icon";
import { EmptyState, Loading } from "@/components/Avatar";
import { Sheet } from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/hooks/useSession";
import type { Group } from "@/lib/types";

const ICONS = ["code", "server", "terminal", "bolt", "grid",
  "layers", "lock", "globe", "package", "star"] as const;
const CATEGORIES = ["Groupe", "Algorithmique", "Web", "Data & IA", "Cybersécurité", "Mobile", "Carrière"];

export default function GroupsPage() {
  const { profile } = useSession();
  const toast = useToast();

  const [groups, setGroups] = useState<Group[] | null>(null);
  /**
   * Les groupes dont je suis membre.
   *
   * L'adhésion est une **ligne** dans `group_members` — c'est la source
   * de vérité, et la seule que la RLS laisse écrire. `groups.members`
   * n'était qu'un tableau dénormalisé que le client ne peut plus mettre
   * à jour : classer les groupes sur lui, c'est se fier à un cache que
   * personne ne maintient.
   */
  const [myGroupIds, setMyGroupIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [emoji, setEmoji] = useState<(typeof ICONS)[number]>(ICONS[0]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("groups").select("*").order("created_at", { ascending: false });
    setGroups((data as Group[]) ?? []);
  }, []);

  useEffect(() => {
    let alive = true;

    supabase
      .from("groups").select("*").order("created_at", { ascending: false })
      .then(({ data }: { data: Group[] | null }) => {
        if (alive) setGroups(data ?? []);
      });

    return () => {
      alive = false;
    };
  }, []);

  // Mes adhésions — une requête, une fois : c'est ce qui distingue « mes
  // groupes » de « découvrir », et c'est la même vérité que le bouton
  // Rejoindre écrit.
  useEffect(() => {
    if (!profile?.id) return;
    let alive = true;

    supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", profile.id)
      .then(({ data }: { data: { group_id: string }[] | null }) => {
        if (!alive) return;
        setMyGroupIds(new Set((data ?? []).map((r) => r.group_id)));
      });

    return () => {
      alive = false;
    };
  }, [profile?.id]);

  /**
   * Rejoindre un groupe — on écrit une **adhésion**, pas un compteur.
   *
   * L'ancien chemin recopiait `groups.members` et `member_count`. Deux
   * raisons de ne plus le faire : la RLS réserve la mise à jour du
   * groupe à son créateur (un rejoignant n'écrit donc rien), et le
   * compteur est un cache recalculé par un déclencheur. Écrire la ligne
   * d'adhésion est la seule action juste — et la seule que la base
   * accepte de quelqu'un qui n'a pas créé le groupe.
   */
  async function join(g: Group) {
    if (!profile) return;
    const { error } = await supabase
      .from("group_members")
      .insert({ group_id: g.id, user_id: profile.id, role: "member" });

    // Rejoindre deux fois n'est pas une faute : la clé primaire
    // `(group_id, user_id)` la refuse. On ne crie que sur un vrai refus.
    if (error && !/duplicate|unique/i.test(error.message)) {
      return toast("Impossible de rejoindre", "err");
    }

    setMyGroupIds((prev) => new Set(prev).add(g.id));
    setGroups((prev) =>
      (prev ?? []).map((x) =>
        x.id === g.id ? { ...x, member_count: (x.member_count || 0) + 1 } : x,
      ),
    );
    toast("Groupe rejoint");
  }

  async function create() {
    if (!profile) return;
    if (!name.trim()) return toast("Donne un nom au groupe", "err");

    setBusy(true);
    const { data, error } = await supabase
      .from("groups")
      .insert({
        name: name.trim(),
        description: desc.trim(),
        category,
        emoji,
        created_by: profile.id,
        members: [profile.id],
        member_count: 1,
      })
      .select("id")
      .single();

    setBusy(false);
    if (error) return toast(`Erreur : ${error.message}`, "err");

    // Tout groupe naît avec son #général : sans canal, l'écran du groupe
    // n'a ni discussion active ni composeur — un chargement sans fin.
    // Le backfill de 004_foundation.sql fait la même chose pour les
    // groupes créés avant les canaux.
    const gid = (data as { id: string } | null)?.id;
    if (gid) {
      // Le créateur est membre **owner** de son groupe : sans cette
      // ligne, il ne serait membre d'aucun rôle, les fonctions de rôle
      // le liraient comme un inconnu, et il ne pourrait pas être
      // reconnu comme propriétaire dans la salle des membres.
      await supabase.from("group_members").insert({
        group_id: gid,
        user_id: profile.id,
        role: "owner",
      });
      setMyGroupIds((prev) => new Set(prev).add(gid));
      await supabase.from("channels").insert({
        group_id: gid,
        slug: "general",
        name: "général",
        topic: "Conversation principale du groupe.",
        position: 0,
        created_by: profile.id,
      });
    }

    setOpen(false);
    setName(""); setDesc("");
    toast("Groupe créé");
    load();
  }

  const q = query.trim().toLowerCase();
  const visible = (groups ?? []).filter(
    (g) => !q
      || g.name.toLowerCase().includes(q)
      || g.description.toLowerCase().includes(q),
  );

  const amMember = (g: Group) =>
    myGroupIds.has(g.id) || g.created_by === profile?.id;

  const mine = visible.filter(amMember);
  const others = visible.filter((g) => !amMember(g));

  return (
    <AppShell
      title="Groupes"
      path="~/groupes"
      action={
        <IconButton label="Créer un groupe" name="plus" dataTour="groups-new" onClick={() => setOpen(true)} />
      }
    >
      <div className="px-(--gutter) pt-3" data-tour="groups-list">
        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un groupe…"
          className="mb-4 h-[var(--h-input)] w-full rounded-[var(--radius-input)] border border-line-3 bg-surface
            px-3.5 text-[14px] shadow-sh-1 outline-none placeholder:text-chalk-4
            focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_var(--color-signal)]"
        />

        {groups === null && <Loading />}

        {groups !== null && visible.length === 0 && (
          <EmptyState title="Aucun groupe trouvé" />
        )}

        {mine.length > 0 && (
          <>
            <div className="mb-2.5 flex items-center gap-2.5 pt-2 text-[10px] font-bold
              uppercase tracking-[0.16em]">
              Mes groupes
              <span className="h-0.5 flex-1 bg-surface/85" />
            </div>
            {mine.map((g) => (
              <GroupRow key={g.id} g={g} joined />
            ))}
          </>
        )}

        {others.length > 0 && (
          <>
            <div className="mb-2.5 flex items-center gap-2.5 pt-4 text-[10px] font-bold
              uppercase tracking-[0.16em]">
              Découvrir
              <span className="h-0.5 flex-1 bg-surface/85" />
            </div>
            {others.map((g) => (
              <GroupRow key={g.id} g={g} onJoin={() => join(g)} />
            ))}
          </>
        )}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Nouveau groupe">
        <div className="mb-4">
          <label className="label mb-1.5 block text-chalk">
            Nom
          </label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="ex: Algo & Structures L2"
            className="h-[var(--h-input)] w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3.5
              text-[14px] shadow-sh-1 outline-none placeholder:text-chalk-4" />
        </div>

        <div className="mb-4">
          <label className="label mb-1.5 block text-chalk">
            Description
          </label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2}
            placeholder="À quoi sert ce groupe ?"
            className="w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3.5 py-3
              text-[14px] shadow-sh-1 outline-none placeholder:text-chalk-4" />
        </div>

        <div className="mb-4">
          <label className="label mb-1.5 block text-chalk">
            Catégorie
          </label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="h-[var(--h-input)] w-full cursor-pointer rounded-[var(--radius-input)] border border-line-3
              bg-surface px-3.5 text-[14px] shadow-sh-1 outline-none">
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>

        <div className="mb-4">
          <label className="label mb-1.5 block text-chalk">
            Icône
          </label>
          <div className="mt-1.5 grid grid-cols-5 gap-1.5">
            {ICONS.map((name) => (
              <button key={name} type="button" onClick={() => setEmoji(name)}
                aria-label={`Icône ${name}`} aria-pressed={emoji === name}
                className={`flex aspect-square items-center justify-center rounded-[var(--radius-input)]
                  border-[var(--bw-thin)] text-signal-d transition-[transform,border-color]
                  ${emoji === name
                    ? "border-line-3 bg-surface"
                    : "border-line-2 bg-surface-2 hover:border-line-3 hover:-translate-y-0.5"}`}
              >
                <Icon name={name} size={18} strokeWidth={1.7} />
              </button>
            ))}
          </div>
        </div>

        <div className="mt-1 flex gap-2.5">
          <button type="button" onClick={() => setOpen(false)}
            className="rounded-[var(--radius-input)] border border-transparent px-5 text-[13px]
              font-bold text-chalk-2 transition-colors hover:bg-surface-2 hover:text-chalk">
            Annuler
          </button>
          <button type="button" onClick={create} disabled={busy}
            className="mo-press flex h-[var(--h-tap)] flex-1 items-center justify-center rounded-[var(--radius-input)]
              border border-line-3 bg-signal text-[13px] font-bold text-void shadow-sh-2
              disabled:opacity-40">
            Créer
          </button>
        </div>
      </Sheet>
    </AppShell>
  );
}

function GroupRow({ g, joined, onJoin }: {
  g: Group;
  joined?: boolean;
  onJoin?: () => void;
}) {
  const count = Math.max(1, g.member_count || 1);

  const inner = (
    <>
      {/* L'identité d'un groupe : son icône dans la tuile, et un compteur
          en médaillon — la même signature qu'une pièce qui abrite
          plusieurs personnes, sans avoir à charger leurs avatars. */}
      <span className="relative size-[42px] shrink-0">
        <span className="flex size-[34px] items-center justify-center rounded-[var(--radius-input)]
          border border-line-3 bg-surface-2 text-signal-d">
          <Icon name={asIconName(g.emoji, "groups")} size={18} strokeWidth={1.7} />
        </span>
        <span className="absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center
          rounded-full border border-line-2 bg-signal text-[9px] font-extrabold text-void">
          {count > 9 ? "9+" : count}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-bold">{g.name}</div>
        {g.description ? (
          <div className="mt-0.5 truncate text-[11.5px] text-chalk-3">{g.description}</div>
        ) : null}
        <div className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-chalk-4">
          {count} membre{count > 1 ? "s" : ""}
          {g.category ? ` · ${g.category}` : ""}
        </div>
      </div>
      {joined
        ? <span aria-hidden="true" className="shrink-0 pl-1 font-mono text-[16px] text-chalk-4">›</span>
        : (
          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onJoin?.(); }}
            className="mo-press h-[34px] rounded-[var(--radius-chip)] border-[var(--bw-thin)] border-line-3 bg-signal
              px-3.5 text-[11.5px] font-bold text-void shadow-sh-1">
            Rejoindre
          </button>
        )}
    </>
  );

  // Une seule grammaire de carte pour toute la page : la profondeur est
  // portée par l'ombre (deux couches), le déplacement reste minuscule. Deux
  // grammaires de survol sur la même page — une ici, une autre dans la
  // liste des conversations — feraient que le même geste aurait deux
  // réponses différentes selon l'écran.
  const cls =
    "depth-card mb-[9px] flex items-center gap-3.5 rounded-[var(--radius-card)] " +
    "border border-edge glass-flat p-3.5";

  return joined ? (
    <Link href={`/groups/${g.id}`} className={cls}>{inner}</Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}