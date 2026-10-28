"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Loading, PrimaryButton } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Motion } from "@/components/Motion";
import { PostCard } from "@/components/PostCard";
import { useSession } from "@/hooks/useSession";
import { useToast } from "@/components/Toast";
import { fetchBookmarks, toggleBookmark } from "@/lib/signets";
import type { PostWithAuthor } from "@/lib/types";

/**
 * La liste de lecture — « mes signets ».
 *
 * ## Pourquoi cet écran vit, et pas dans le profil
 *
 * Un profil montre ce qu'un compte **fait** ; une liste de lecture montre
 * ce qu'un compte a choisi de **garder**. Ce n'est pas la même
 * information, et la confusion est courante : on met tout dans l'onglet
 * « publications » et la liste se retrouve enterrée sous deux pages de
 * fil.
 *
 * ## Pourquoi elle est privée
 *
 * Le signet est la seule action du produit qui ne parle à personne.
 * Un like se voit, une réaction se voit, un repost se voit ; un signet
 * est exactement le contraire. C'est pour cela que la lecture de
 * `bookmarks` est restreinte à son auteur, en base comme en
 * démonstration : ce n'est pas une précaution technique, c'est le
 * sens même de la fonctionnalité.
 */
export default function BookmarksPage() {
  const { profile } = useSession();
  const router = useRouter();
  const toast = useToast();

  const [rows, setRows] = useState<PostWithAuthor[] | null>(null);
  // `vide` n'est plus un état : une liste de signets vide **est** une
  // liste vide. Un second état qui recopie le premier finit par diverger —
  // et un état mort jeté au linter n'est qu'un symptôme.

  useEffect(() => {
    let alive = true;

    if (!profile) {
    // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows([]);
      return;
    }

    fetchBookmarks(profile.id).then((res) => {
      if (!alive) return;
      setRows(res.rows);
    });

    return () => {
      alive = false;
    };
  }, [profile]);

  /**
   * Retirer un signet depuis cette page.
   *
   * On **retire la ligne** au lieu de recharger : l'écran n'affiche que
   * des signets, donc retirer l'élément revient à retirer le signet. Un
   * rechargement ferait clignotter toute la liste pour une ligne en
   * moins — et ferait perdre la position de lecture.
   */
  async function onBookmark(id: string) {
    if (!profile) return;

    setRows((prev) => (prev ?? []).filter((p) => p.id !== id));

    const { error } = await toggleBookmark(id, profile.id);
    if (error) {
      toast("Retrait impossible", "err");
      // On relit la source plutôt que de deviner quoi remettre : le
      // signet est peut-être resté, et une ligne inventee ici
      // mentirait sur l'état.
      const res = await fetchBookmarks(profile.id);
      setRows(res.rows);
    }
  }

  return (
    <AppShell path="~/signets">
      <div className="px-(--gutter) pt-3" data-tour="signets-list">
        <Motion role="slide" delay={0}>
          <header className="mb-3 border-b-[var(--bw-heavy)] border-line-2 pb-4">
            <h1 className="font-display text-[1.375rem] font-bold tracking-[-0.02em]">
              Signets
            </h1>
            <p className="mt-1.5 max-w-[46ch] text-[12.5px] leading-relaxed text-chalk-3">
              Vos publications gardées, privées.
            </p>
          </header>
        </Motion>

        {rows === null && <Loading label="Lecture de vos signets" />}

        {rows !== null && rows.length === 0 && (
          <Motion role="scale" delay={120}>
            <EmptyState
              icon={<Icon name="bookmark" size={20} strokeWidth={1.5} />}
              title="Aucun signet"
              action={
                <PrimaryButton icon="feed" onClick={() => router.push("/feed")}>
                  Parcourir le fil
                </PrimaryButton>
              }
            />
          </Motion>
        )}

        {rows?.map((p, i) => (
          <PostCard
            key={p.id}
            post={p}
            meId={profile?.id ?? null}
            index={i}
            liked={false}
            bookmarked
            onBookmark={onBookmark}
            onOpenProfile={(pseudo) => router.push(`/u/${pseudo}`)}
            onOpenComments={(id) => router.push(`/post/${id}`)}
          />
        ))}
      </div>
    </AppShell>
  );
}