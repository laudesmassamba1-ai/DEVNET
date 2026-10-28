"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, EmptyState, Loading } from "@/components/Avatar";
import { FollowButton } from "@/components/FollowButton";
import { Icon } from "@/components/Icon";
import { Motion } from "@/components/Motion";
import { useSession } from "@/hooks/useSession";
import {
  fetchFollowList,
  fetchProfileByPseudo,
  type FollowListKind,
  type PublicProfile,
} from "@/lib/social";

/**
 * Liste des abonnés / suivis d'un profil public — `/u/[pseudo]/followers`.
 *
 * La route est partagée : `?which=following` bascule vers la liste des
 * comptes que la personne suit, sans `which` on affiche ses abonnés. C'est
 * un choix d'URL — deux routes auraient dupliqué le composant et l'onglet
 * actif ne se serait pas partagé.
 */
export default function FollowersPage({
  params,
  searchParams,
}: {
  params: Promise<{ pseudo: string }>;
  searchParams: Promise<{ which?: string }>;
}) {
  const { pseudo } = use(params);
  const { which } = use(searchParams);
  const kind: FollowListKind = which === "following" ? "following" : "followers";
  const { profile } = useSession();

  // On ne peut pas importer `isFollowing` ici (côté serveur/client), on
  // duplique la logique pour le montage — c'est une seule requête par
  // élément affiché, et la liste reste courte.
  async function isFollowingFn(me: string, target: string): Promise<boolean> {
    const { supabase } = await import("@/lib/supabase/client");
    const { data } = await supabase
      .from("follows")
      .select("follower_id")
      .eq("follower_id", me)
      .eq("followee_id", target)
      .maybeSingle();
    return Boolean(data);
  }

  const [user, setUser] = useState<PublicProfile | null>(null);
  const [list, setList] = useState<PublicProfile[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [followingMap, setFollowingMap] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const found = await fetchProfileByPseudo(pseudo);
    setUser(found.user);
    setMissing(found.user === null);

    if (found.user) {
      const data = await fetchFollowList(found.user.id, kind);
      setList(data);

      if (profile) {
        const map: Record<string, boolean> = {};
        for (const u of data) {
          if (profile.id !== u.id) {
            map[u.id] = await isFollowingFn(profile.id, u.id);
          }
        }
        setFollowingMap(map);
      }
    }
  }, [pseudo, kind, profile]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function handleFollowChanged(
    targetId: string,
    next: boolean,
    previous: boolean | undefined,
  ) {
    if (previous === undefined) return;
    if (user) {
      setUser((prev: PublicProfile | null) =>
        prev
          ? {
              ...prev,
              followers:
                kind === "followers"
                  ? Math.max(0, prev.followers + (next ? 1 : -1))
                  : prev.followers,
              following:
                kind === "following"
                  ? Math.max(0, prev.following + (next ? 1 : -1))
                  : prev.following,
            }
          : prev,
      );
    }
    setFollowingMap((prev) => ({ ...prev, [targetId]: next }));
  }

  if (missing) {
    return (
      <AppShell path={`~/u/${pseudo}/followers`}>
        <EmptyState
          title="Profil introuvable"
          hint={`Aucun compte : « ${pseudo} ».`}
        />
      </AppShell>
    );
  }

  const label = kind === "followers" ? "Abonnés" : "Suivis";
  const emptyHint =
    kind === "followers"
      ? "Personne ne suit encore ce compte."
      : "Ce compte ne suit personne.";

  return (
    <AppShell title={user ? `~/${user.pseudo} / ${label}` : label}>
      {user && (
        <Link
          href={`/u/${user.pseudo}`}
          className="mx-auto flex max-w-[1200px] items-center gap-3 px-5 py-4 text-chalk-3 hover:text-chalk"
        >
          <Icon name="arrow-left" size={16} />
          <span className="font-mono text-[11.5px] font-bold uppercase tracking-[0.08em]">
            retour au profil
          </span>
        </Link>
      )}

      <div className="mx-auto max-w-[1200px] px-5 pb-8">
        <div className="mb-4 border-b border-line-2">
          {(["followers", "following"] as FollowListKind[]).map((k) => (
            <Link
              key={k}
              href={`/u/${user?.pseudo ?? pseudo}/followers${k === "following" ? "?which=following" : ""}`}
              className={`tab-underline px-3.5 py-2 font-mono text-[11.5px]
                font-bold uppercase tracking-[0.12em] transition-colors
                duration-[var(--d-fast)]
                ${kind === k ? "text-signal" : "text-chalk-4 hover:text-chalk-2"}`}
            >
              {k === "followers" ? "Abonnés" : "Suivis"}
              {user && (
                <span className="tnum ml-1.5 text-chalk-3">
                  {kind === "followers" ? user.followers : user.following}
                </span>
              )}
            </Link>
          ))}
        </div>

        {list === null && <Loading label={`Lecture des ${label.toLowerCase()}`} />}

        {list?.length === 0 && (
          <EmptyState title={label} hint={emptyHint} />
        )}

        {list?.map((u, i) => (
          <Link
            key={u.id}
            href={`/u/${u.pseudo}`}
            className="mo-rise block"
            style={{ animationDelay: `${Math.min(i * 35, 280)}ms` }}
          >
            <Motion role="none" className="flex items-center gap-3.5 py-3 border-b border-line last:border-b-0">
              <Avatar name={u.prenom} color={u.avatar_color} size="md" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-bold text-[13.5px] text-chalk truncate">
                    {u.prenom}
                  </span>
                  {u.verified && (
                    <span className="label-micro inline-flex items-center gap-1 text-signal">
                      <Icon name="verified" size={11} />
                      vérifié
                    </span>
                  )}
                </p>
                <p className="mt-0.5 font-mono text-[11.5px] text-chalk-4 truncate">
                  @{u.pseudo}
                </p>
                {(u.filiere || u.niveau) && (
                  <p className="mt-1 font-mono text-[11px] text-chalk-3">
                    {[u.filiere, u.niveau].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>

              {!profile || profile.id === u.id ? null : (
                <FollowButton
                  me={profile?.id ?? null}
                  targetId={u.id}
                  targetPseudo={u.pseudo}
                  defaultFollowing={followingMap[u.id]}
                  variant="compact"
                  onChanged={(next, prev) => handleFollowChanged(u.id, next, prev)}
                />
              )}
            </Motion>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}