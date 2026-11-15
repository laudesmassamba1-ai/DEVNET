"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell, IconButton } from "@/components/AppShell";
import { Field } from "@/components/Field";
import { Icon, asIconName } from "@/components/Icon";
import { EmptyState, Loading } from "@/components/Avatar";
import { Sheet } from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { useSession } from "@/hooks/useSession";
import {
  VISIBILITY_HELP, VISIBILITY_LABEL, createCommunity, fetchCommunities,
  fetchMyCommunityIds, joinCommunity,
} from "@/lib/communities";
import type { Community, CommunityVisibility } from "@/lib/types";

const ICONS = ["globe", "code", "terminal", "bolt", "grid",
  "layers", "lock", "package", "star", "server"] as const;

const VISIBILITIES: CommunityVisibility[] = ["public", "restricted", "private"];

export default function CommunitiesPage() {
  const { profile } = useSession();
  const toast = useToast();

  const [communities, setCommunities] = useState<Community[] | null>(null);
  const [myIds, setMyIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [rules, setRules] = useState("");
  const [icon, setIcon] = useState<(typeof ICONS)[number]>(ICONS[0]);
  const [visibility, setVisibility] = useState<CommunityVisibility>("public");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setCommunities(await fetchCommunities());
  }, []);

  const loadMine = useCallback(async () => {
    if (!profile?.id) return;
    setMyIds(await fetchMyCommunityIds(profile.id));
  }, [profile]);

  useEffect(() => {
    let alive = true;
    fetchCommunities().then((rows) => {
      if (alive) setCommunities(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      await loadMine();
    })();
  }, [loadMine]);

  async function join(c: Community) {
    if (!profile) return;
    const { error } = await joinCommunity(c.id, profile.id);
    // Rejoindre deux fois n'est pas une erreur d'écran : la clé primaire
    // `(community_id, user_id)` refuse le doublon, et c'est tant mieux.
    if (error && !/duplicate|unique/i.test(error)) {
      return toast(`Erreur : ${error}`, "err");
    }
    setMyIds((prev) => new Set(prev).add(c.id));
    setCommunities((prev) =>
      (prev ?? []).map((x) =>
        x.id === c.id ? { ...x, member_count: (x.member_count || 0) + 1 } : x,
      ),
    );
    toast("Communauté rejointe");
  }

  async function create() {
    if (!profile) return;
    if (!name.trim()) return toast("Donne un nom à la communauté", "err");

    setBusy(true);
    const { community, error } = await createCommunity(
      { name, description: desc, rules, icon, visibility },
      profile.id,
    );
    setBusy(false);
    if (error) return toast(`Erreur : ${error}`, "err");

    if (community) setMyIds((prev) => new Set(prev).add(community.id));
    setOpen(false);
    setName(""); setDesc(""); setRules(""); setIcon(ICONS[0]);
    setVisibility("public");
    toast("Communauté créée");
    await load();
  }

  const q = query.trim().toLowerCase();
  const visible = (communities ?? []).filter(
    (c) => !q
      || c.name.toLowerCase().includes(q)
      || c.description.toLowerCase().includes(q),
  );

  const amMember = (c: Community) => myIds.has(c.id) || c.created_by === profile?.id;
  const mine = visible.filter(amMember);
  const others = visible.filter((c) => !amMember(c));

  return (
    <AppShell
      title="Communautés"
      path="~/communautés"
      action={
        <IconButton label="Créer une communauté" name="plus" dataTour="communities-new" onClick={() => setOpen(true)} />
      }
    >
      <div className="px-(--gutter) pt-3" data-tour="communities-list">
        <div className="mb-4 rounded-(--radius-input) border border-line-3 bg-surface-2 px-3.5 py-3
          text-12 leading-relaxed text-chalk-2">
          Les communautés sont des <span className="font-bold text-chalk">fils publics</span> :
          on y publie des posts, on s&apos;y abonne par thème. Pour discuter en direct,
          ce sont les <span className="font-bold text-chalk">groupes</span>.
        </div>

        <input
          aria-label="Rechercher une communauté"
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une communauté…"
          className="mb-4 h-(--h-input) w-full rounded-(--radius-input) border border-line-3 bg-surface
            px-3.5 text-14 shadow-sh-1 placeholder:text-chalk-4
            focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_var(--color-signal)]"
        />

        {communities === null && <Loading />}

        {communities !== null && visible.length === 0 && (
          <EmptyState title="Aucune communauté trouvée" />
        )}

        {mine.length > 0 && (
          <>
            <SectionLabel>Mes communautés</SectionLabel>
            {mine.map((c) => <CommunityRow key={c.id} c={c} joined />)}
          </>
        )}

        {others.length > 0 && (
          <>
            <SectionLabel top>Découvrir</SectionLabel>
            {others.map((c) => (
              <CommunityRow key={c.id} c={c} onJoin={() => join(c)} />
            ))}
          </>
        )}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Nouvelle communauté">
        <Field label="Nom">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="ex: Rust & systèmes"
            className="h-(--h-input) w-full rounded-(--radius-input) border border-line-3 bg-surface px-3.5
              text-14 shadow-sh-1 placeholder:text-chalk-4" />
        </Field>

        <Field label="Description">
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2}
            placeholder="À quoi sert cette communauté ?"
            className="w-full rounded-(--radius-input) border border-line-3 bg-surface px-3.5 py-3
              text-14 shadow-sh-1 placeholder:text-chalk-4" />
        </Field>

        <Field label="Règlement intérieur">
          <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={3}
            placeholder="Une règle par ligne. Affiché en tête du fil."
            className="w-full rounded-(--radius-input) border border-line-3 bg-surface px-3.5 py-3
              text-14 shadow-sh-1 placeholder:text-chalk-4" />
        </Field>

        <Field label="Visibilité">
          <div className="grid grid-cols-3 gap-2">
            {VISIBILITIES.map((v) => (
              <button key={v} type="button" onClick={() => setVisibility(v)}
                className="mo-press rounded-(--radius-input) border px-2 py-2.5 text-12 font-bold
                  transition-colors"
                data-active={visibility === v ? "true" : "false"}
                style={visibility === v
                  ? { borderColor: "var(--color-line-3)", background: "var(--color-signal)", color: "var(--color-void)" }
                  : { borderColor: "var(--color-line-3)", background: "var(--color-surface)", color: "var(--color-chalk-2)" }}>
                {VISIBILITY_LABEL[v]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-12 text-chalk-4">{VISIBILITY_HELP[visibility]}</p>
        </Field>

        <Field label="Icône">
          <div className="grid grid-cols-5 gap-2">
            {ICONS.map((k) => (
              <button key={k} type="button" onClick={() => setIcon(k)}
                aria-label={`Icône ${k}`} aria-pressed={icon === k}
                className="flex aspect-square items-center justify-center rounded-(--radius-input)
                  border border-line-3 transition-colors"
                data-active={icon === k ? "true" : "false"}
                style={icon === k
                  ? { background: "var(--color-signal)", color: "var(--color-void)" }
                  : { background: "var(--color-surface-2)", color: "var(--color-signal-d, var(--color-chalk))" }}>
                <Icon name={k} size={18} strokeWidth={1.7} />
              </button>
            ))}
          </div>
        </Field>

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={() => setOpen(false)}
            className="rounded-(--radius-input) border border-transparent px-5 text-13
              font-bold text-chalk-2 transition-colors hover:bg-surface-2 hover:text-chalk">
            Annuler
          </button>
          <button type="button" onClick={create} disabled={busy}
            className="mo-press flex h-(--h-tap) flex-1 items-center justify-center rounded-(--radius-input)
              border border-line-3 bg-signal text-13 font-bold text-void shadow-sh-2
              disabled:opacity-40">
            Créer
          </button>
        </div>
      </Sheet>
    </AppShell>
  );
}

function SectionLabel({ children, top }: { children: React.ReactNode; top?: boolean }) {
  return (
    <div className={`mb-2.5 flex items-center gap-2.5 text-12 font-bold uppercase tracking-[0.16em]
      ${top ? "pt-4" : "pt-2"}`}>
      {children}
      <span className="h-0.5 flex-1 bg-surface/85" />
    </div>
  );
}

function CommunityRow({ c, joined, onJoin }: {
  c: Community;
  joined?: boolean;
  onJoin?: () => void;
}) {
  const inner = (
    <>
      <span className="relative size-10.5 shrink-0">
        <span className="flex size-8.5 items-center justify-center rounded-(--radius-input)
          border border-line-3 bg-surface-2 text-signal-d">
          <Icon name={asIconName(c.icon, "globe")} size={18} strokeWidth={1.7} />
        </span>
        <span className="absolute -right-1 -bottom-1 flex size-4.5 items-center justify-center
          rounded-full border border-line-2 bg-signal text-12 font-extrabold text-void">
          {(c.member_count || 0) > 9 ? "9+" : Math.max(1, c.member_count || 1)}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-bold">{c.name}</span>
          <span className="shrink-0 rounded-(--radius-chip) border border-line-3 px-1.5 py-0.5
            text-12 font-bold uppercase tracking-[0.1em] text-chalk-3">
            {VISIBILITY_LABEL[c.visibility]}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-1 text-12 text-chalk-4">{c.description}</p>
      </div>
      {joined ? (
        <span className="text-chalk-4"><Icon name="chevron-right" size={16} /></span>
      ) : (
        <button type="button" onClick={onJoin}
          className="mo-press inline-flex h-(--h-tap) shrink-0 items-center rounded-(--radius-chip) border border-line-3 bg-signal px-3.5
            text-12 font-bold text-void shadow-sh-1">
          Rejoindre
        </button>
      )}
    </>
  );

  const cls = "depth-card mb-[9px] flex items-center gap-3.5 rounded-(--radius-card) " +
    "border border-edge glass-flat p-3.5";

  return joined ? (
    <Link href={`/communities/${c.slug}`} className={cls}>{inner}</Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
