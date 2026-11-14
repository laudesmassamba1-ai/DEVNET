"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell, IconButton } from "@/components/AppShell";
import { Avatar, EmptyState, Loading } from "@/components/Avatar";
import { CodeBlock } from "@/components/CodeBlock";
import { Icon, asIconName, isIconName } from "@/components/Icon";
import { Motion } from "@/components/Motion";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { useSession } from "@/hooks/useSession";
import { fetchDiscover, type Discover } from "@/lib/discover";
import { levelFor } from "@/lib/gamification";
import { stageSpec } from "@/lib/match";
import type { LeaderEntry } from "@/lib/progress";
import type { Community, PostWithAuthor, Project } from "@/lib/types";
import { badgeFor } from "@/lib/verification";
import { timeAgo } from "@/lib/utils";

export default function DiscoverPage() {
  const { profile, loading: sessionLoading } = useSession();
  const router = useRouter();
  const [data, setData] = useState<Discover | null>(null);

  useEffect(() => {
    let alive = true;
    fetchDiscover(profile ?? null).then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, [profile]);

  return (
    <AppShell
      path="~/vivier"
      action={
        <IconButton
          label="Rechercher un développeur"
          name="search"
          onClick={() => router.push("/search")}
        />
      }
    >
      <div className="px-(--gutter) pb-10 pt-3">
        <Motion role="soft">
          <Hero data={data} />
        </Motion>

        {!data ? (
          <div className="py-16">
            <Loading label="Balayage du vivier" />
          </div>
        ) : (
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_286px]">
            <div className="min-w-0 space-y-8">
              <Motion role="rise" delay={40}>
                <Section index="01" title="Le courant" note="Ce qui monte cette semaine">
                  <Rising rows={data.rising} />
                </Section>
              </Motion>

              <Motion role="rise" delay={80}>
                <Section index="02" title="Preuves récentes" note="Du code qui a tourné">
                  <Proofs proofs={data.proofs} />
                </Section>
              </Motion>

              <Motion role="rise" delay={120}>
                <Section index="03" title="Ateliers ouverts" note="On y cherche des mains">
                  <Ateliers ateliers={data.ateliers} />
                </Section>
              </Motion>

              <Motion role="rise" delay={160}>
                <Section index="04" title="Cercles" note="Des salles où entrer">
                  <Cercles cercles={data.cercles} joined={data.joined} />
                </Section>
              </Motion>
            </div>

            <aside className="space-y-4 lg:sticky lg:top-[calc(var(--h-topbar)+12px)]">
              <NextStep xp={data.myXp} ready={!sessionLoading} signedIn={Boolean(profile)} />
              <Shortcuts />
              <section className="rounded-(--radius-card) border border-dashed border-line-2 p-4">
                <p className="label-micro text-chalk-4">Règle du vivier</p>
                <p className="mt-2 text-sm leading-relaxed text-chalk-3">
                  Rien ici ne se découvre au hasard : une preuve publiée, un atelier qui
                  cherche des mains, un cercle qui s&apos;ouvre. Des traces de travail,
                  pas des images à faire défiler.
                </p>
              </section>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Hero({ data }: { data: Discover | null }) {
  const xp = data?.myXp;
  const level = xp === undefined ? null : levelFor(xp);

  return (
    <section className="relative overflow-hidden rounded-(--radius-card) border border-line-2 bg-surface p-6 depth-panel sm:p-8">
      <div className="pointer-events-none absolute -right-10 -top-10 hidden opacity-90 sm:block">
        <Sonar signals={data?.signalsWeek ?? 0} />
      </div>

      <p className="label-micro text-chalk-4">Le Vivier · captation continue</p>
      <h1 className="mt-3 max-w-[20ch] font-display text-[clamp(1.75rem,4.2vw,2.7rem)] font-bold leading-[1.03] tracking-[-0.035em] text-chalk">
        Ce qui monte <span className="text-signal">se prouve</span>.
      </h1>
      <p className="mt-3 max-w-[48ch] text-[13.5px] leading-relaxed text-chalk-3">
        Le Vivier ne classe pas des images. Il écoute les publications de code, les
        ateliers qui recrutent et les cercles qui s&apos;ouvrent — puis il montre ce
        qui mérite une visite.
      </p>

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
        <div>
          <dt className="label-micro text-chalk-4">Preuves · 7 j</dt>
          <dd className="tnum mt-1 font-display text-[26px] font-bold leading-none text-chalk">
            {data ? data.signalsWeek : "—"}
          </dd>
        </div>
        <div>
          <dt className="label-micro text-chalk-4">Ta marche</dt>
          <dd className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-[26px] font-bold leading-none text-chalk">
              {level ? level.title : "—"}
            </span>
            {level?.next && (
              <span className="label-micro text-chalk-4">
                {level.toNext} pts → {level.next.title}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="label-micro text-chalk-4">À lire</dt>
          <dd className="tnum mt-1 font-display text-[26px] font-bold leading-none text-chalk">
            {data ? data.proofs.length : "—"}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Sonar({ signals }: { signals: number }) {
  return (
    <div aria-hidden className="relative size-[210px]">
      <div className="absolute inset-0 rounded-full border border-line-2/80" />
      <div className="absolute inset-[15%] rounded-full border border-dashed border-line-2/70" />
      <div className="absolute inset-[32%] rounded-full border border-line-3/50" />
      <div className="absolute inset-0 overflow-hidden rounded-full">
        <div
          className="mo-spin size-full rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgba(143,175,78,0.34) 38deg, transparent 64deg)",
          }}
        />
      </div>
      <span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal" />
      <span className="absolute left-[24%] top-[62%] size-1 rounded-full bg-signal/70" />
      <span className="absolute left-[68%] top-[30%] size-1 rounded-full bg-signal/50" />
      <span className="absolute left-[72%] top-[70%] size-1 rounded-full bg-signal/40" />
      <span className="label-micro absolute inset-x-0 bottom-[6%] text-center text-chalk-4">
        {signals} échos
      </span>
    </div>
  );
}

function Section({
  index,
  title,
  note,
  children,
}: {
  index: string;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-3 flex items-baseline gap-3 border-b border-line-2 pb-2">
        <span className="label-micro text-signal">{index}</span>
        <h2 className="font-display text-[15px] font-bold tracking-[-0.01em] text-chalk">
          {title}
        </h2>
        <span className="ml-auto hidden text-[11px] text-chalk-4 sm:block">{note}</span>
      </header>
      {children}
    </section>
  );
}

function Rising({ rows }: { rows: LeaderEntry[] }) {
  if (rows.length === 0) {
    return <EmptyState title="Personne n'a publié cette semaine" hint="Le courant repartira au premier post." icon={<Icon name="chart" size={18} />} />;
  }

  const top = Math.max(...rows.map((r) => r.xp), 1);

  return (
    <ol>
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
          <span className={`tnum label w-5 shrink-0 text-[13px] ${r.rank === 1 ? "text-signal" : "text-chalk-4"}`}>
            {String(r.rank).padStart(2, "0")}
          </span>
          <Avatar
            name={r.prenom}
            color={r.avatarColor}
            className="size-[28px] border-(--bw-thin) text-[11px]"
          />
          <div className="min-w-0 flex-1">
            <Link href={`/u/${r.pseudo}`} className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold text-chalk hover:text-signal">
              {r.me ? "Toi" : r.prenom}
              {r.verified && (
                <VerifiedBadge
                  tier={badgeFor({ verified: r.verified, is_admin: r.isAdmin }, r.totalXp)}
                  size="sm"
                />
              )}
            </Link>
            <span className="label-micro block truncate text-chalk-4">@{r.pseudo}</span>
          </div>
          <span className="hidden h-[3px] w-[110px] overflow-hidden rounded-full bg-line-2 sm:block">
            <span
              className="block h-full rounded-full bg-signal"
              style={{ width: `${Math.max(8, (r.xp / top) * 100)}%` }}
            />
          </span>
          <span className="tnum label-micro shrink-0 text-signal">+{r.xp}</span>
        </li>
      ))}
    </ol>
  );
}

function Proofs({ proofs }: { proofs: PostWithAuthor[] }) {
  if (proofs.length === 0) {
    return <EmptyState title="Aucune preuve récente" hint="Publie du code pour ouvrir le vivier." icon={<Icon name="code" size={18} />} />;
  }

  const [featured, ...rest] = proofs;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ProofCard proof={featured} featured />
      {rest.slice(0, 5).map((p) => (
        <ProofCard key={p.id} proof={p} />
      ))}
    </div>
  );
}

function ProofCard({ proof, featured = false }: { proof: PostWithAuthor; featured?: boolean }) {
  const author = proof.author;
  const badge = author ? badgeFor(author, author.xp) : null;

  return (
    <Link
      href={`/post/${proof.id}`}
      className={`group flex min-w-0 flex-col overflow-hidden rounded-(--radius-card) border border-line-2 bg-surface p-4 depth-card transition-colors hover:border-line-3 hover:bg-surface-2/50
        ${featured ? "sm:col-span-2" : ""}`}
    >
      <div className="flex items-center gap-2">
        <Avatar
          name={author?.prenom ?? "?"}
          color={author?.avatar_color}
          className="size-[24px] border-(--bw-thin) text-[10px]"
        />
        <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-chalk">
          {author?.prenom ?? "Anonyme"}
          {badge && <VerifiedBadge tier={badge} size="sm" />}
        </span>
        <span className="label-micro ml-auto shrink-0 text-chalk-4">{timeAgo(proof.created_at)}</span>
      </div>

      {proof.text && (
        <p className={`mt-2.5 whitespace-pre-wrap text-[13px] leading-[1.55] text-chalk-2 ${featured ? "line-clamp-4" : "line-clamp-3"}`}>
          {proof.text}
        </p>
      )}

      {featured && proof.code ? (
        <div className="mt-3">
          <CodeBlock
            code={proof.code}
            lang={proof.lang}
            copyable={false}
            maxHeight={128}
          />
        </div>
      ) : (
        proof.code && (
          <pre className="mt-2.5 max-h-[64px] overflow-hidden rounded-(--radius-input) border border-line bg-void/90 px-3 py-2 font-mono text-[10.5px] leading-[1.5] text-page/85">
            {proof.code.split("\n").slice(0, 3).join("\n")}
          </pre>
        )
      )}

      <div className="mt-auto flex items-center gap-4 pt-3 text-chalk-4">
        <span className="label-micro flex items-center gap-1.5">
          <Icon name="like" size={11} /> {proof.likes}
        </span>
        <span className="label-micro flex items-center gap-1.5">
          <Icon name="comment" size={11} /> {proof.comments}
        </span>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-chalk-4 transition-colors group-hover:text-signal">
          Lire <Icon name="chevron-right" size={11} />
        </span>
      </div>
    </Link>
  );
}

function Ateliers({ ateliers }: { ateliers: Project[] }) {
  if (ateliers.length === 0) {
    return <EmptyState title="Aucun atelier ouvert" hint="Les projets qui recrutent apparaîtront ici." icon={<Icon name="package" size={18} />} />;
  }

  return (
    <ul className="space-y-2">
      {ateliers.map((p) => (
        <li key={p.id}>
          <Link
            href={`/projects/${p.id}`}
            className="group flex items-start gap-3 rounded-(--radius-input) border border-line px-3 py-2.5 transition-colors hover:border-line-3 hover:bg-surface-2/50"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-(--radius-input) border border-line bg-surface-2 text-[16px]">
              {isIconName(p.emoji) ? (
                <Icon name={p.emoji} size={16} />
              ) : /\p{Extended_Pictographic}/u.test(p.emoji) ? (
                p.emoji
              ) : (
                <Icon name="package" size={16} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[13.5px] font-semibold text-chalk">{p.name}</span>
                <span className="label-micro shrink-0 text-chalk-4">{stageSpec(p.stage).label}</span>
              </div>
              <p className="mt-0.5 line-clamp-1 text-12 text-chalk-3">{p.description}</p>
              {p.demand_languages.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {p.demand_languages.slice(0, 4).map((l) => (
                    <span key={l} className="label-micro rounded-full border border-line-2 px-1.5 py-0.5 text-chalk-4">
                      {l}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <Icon name="chevron-right" size={14} className="mt-1 shrink-0 text-chalk-4 transition-colors group-hover:text-signal" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Cercles({ cercles, joined }: { cercles: Community[]; joined: Set<string> }) {
  if (cercles.length === 0) {
    return <EmptyState title="Aucun cercle" hint="Crée la première communauté." icon={<Icon name="globe" size={18} />} />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cercles.map((c) => (
        <Link
          key={c.id}
          href={`/communities/${c.slug}`}
          className="group flex items-start justify-between gap-3 rounded-(--radius-card) border border-line-2 bg-surface p-4 transition-colors hover:border-line-3 hover:bg-surface-2/50"
        >
          <span className="grid size-9 place-items-center rounded-full border border-line bg-surface-2 text-chalk-2">
            <Icon name={asIconName(c.icon, "globe")} size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold text-chalk">{c.name}</span>
            <span className="label-micro mt-0.5 block text-chalk-4">{c.member_count} membres</span>
          </div>
          {joined.has(c.id) ? (
            <span className="label-micro shrink-0 text-signal">membre</span>
          ) : (
            <Icon name="chevron-right" size={14} className="mt-1 shrink-0 text-chalk-4 transition-colors group-hover:text-signal" />
          )}
        </Link>
      ))}
    </div>
  );
}

function NextStep({ xp, ready, signedIn }: { xp?: number; ready: boolean; signedIn: boolean }) {
  if (!ready) return null;

  if (!signedIn) {
    return (
      <section className="rounded-(--radius-card) border border-line-2 bg-surface p-4">
        <p className="prompt-label text-chalk-2">Ta prochaine marche</p>
        <p className="mt-2 text-sm text-chalk-3">Connecte-toi pour suivre ton palier.</p>
        <Link href="/login" className="label-micro mt-3 inline-flex items-center gap-1 text-signal">
          Se connecter <Icon name="chevron-right" size={11} />
        </Link>
      </section>
    );
  }

  const level = levelFor(xp ?? 0);

  return (
    <section className="rounded-(--radius-card) border border-line-2 bg-surface p-4 depth-card">
      <p className="prompt-label text-chalk-2">Ta prochaine marche</p>
      <div className="mt-3 flex items-center gap-2">
        <span className="font-display text-[15px] font-bold text-chalk">{level.title}</span>
        <span className="label-micro ml-auto text-chalk-4">palier {level.level}</span>
      </div>
      <div className="mt-2.5 h-[4px] overflow-hidden rounded-full bg-line-2">
        <div className="h-full rounded-full bg-signal" style={{ width: `${level.progress * 100}%` }} />
      </div>
      <p className="mt-2 text-12 text-chalk-3">
        {level.next
          ? `${level.toNext} pts avant ${level.next.title}`
          : "Palier maximal — tu transmets."}
      </p>
      <Link href="/profile" className="label-micro mt-3 inline-flex items-center gap-1 text-signal">
        Ma progression <Icon name="chevron-right" size={11} />
      </Link>
    </section>
  );
}

function Shortcuts() {
  const links = useMemo(
    () => [
      { href: "/search", label: "Trouver un développeur", icon: "search" as const },
      { href: "/projects", label: "Ouvrir un atelier", icon: "package" as const },
      { href: "/groups", label: "Rejoindre un groupe", icon: "groups" as const },
    ],
    [],
  );

  return (
    <section className="rounded-(--radius-card) border border-line-2 bg-surface p-2">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="flex items-center gap-2.5 rounded-(--radius-input) px-2.5 py-2 text-sm text-chalk-3 transition-colors hover:bg-surface-2/60 hover:text-chalk"
        >
          <Icon name={l.icon} size={14} />
          {l.label}
          <Icon name="chevron-right" size={11} className="ml-auto text-chalk-4" />
        </Link>
      ))}
    </section>
  );
}
