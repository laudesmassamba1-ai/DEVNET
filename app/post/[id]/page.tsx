"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppShell, IconButton } from "@/components/AppShell";
import { EmptyState, Loading } from "@/components/Avatar";
import { CommentsPanel } from "@/components/CommentsPanel";
import { Icon } from "@/components/Icon";
import { Motion } from "@/components/Motion";
import { PostCard } from "@/components/PostCard";
import { PostOwnerTools } from "@/components/PostOwnerTools";
import { useToast } from "@/components/Toast";
import { useSession } from "@/hooks/useSession";
import { usePostActions } from "@/hooks/usePostActions";
import {
  fetchLikedPostIds, fetchMyReaction, fetchPostById, fetchRepostIds,
  setReaction, toggleLike, toggleRepost,
} from "@/lib/social";
import { fetchProjectForPost } from "@/lib/repo";
import type { PostWithAuthor, Project } from "@/lib/types";

/**
 * Le lien permanent d'une publication.
 *
 * `/post/p-1`. Cette page existe pour une raison précise : une
 * notification de like ou de mention doit mener **à la publication**,
 * pas au fil où elle défile peut-être trois pages plus bas. C'est la
 * seule façon, pour la notification, d'être autre chose qu'un
 * pense-bête qui donne soif d'information.
 *
 * C'est aussi l'adresse qu'on copie quand on partage — le fil n'est pas
 * une adresse de partage, il change de contenu toutes les cinq
 * minutes.
 *
 * Le reste est le fil, à l'identique : même carte, mêmes commentaires,
 * mêmes actions d'auteur. Une page qui refait sa propre version de la
 * carte de publication divergerait d'elle en trois mois — donc elle
 * n'en fait pas, elle la réutilise.
 */
export default function PostPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { profile } = useSession();

  const [post, setPost] = useState<PostWithAuthor | null>(null);
  const [missing, setMissing] = useState(false);
  const [liked, setLiked] = useState(false);
  const [reaction, setReactionState] = useState<string | null>(null);
  const [reposted, setReposted] = useState(false);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);

  const id = params.id;
  const postActions = usePostActions({
    meId: profile?.id,
    onDeleted: () => router.push("/feed"),
  });

  const load = useCallback(async () => {
    if (!id) return;

    const found = await fetchPostById(id);
    if (!found) {
      setMissing(true);
      return;
    }

    setPost(found);
    setMissing(false);
    setProject(await fetchProjectForPost(id));
  }, [id]);

  useEffect(() => {
    let alive = true;

    // `setPost(null)` et `setMissing(false)` au corps de l'effet	sont des
    // cascades : la lecture asynchrone ci-dessous remplace naturellement
    // l'ancien état, et l'écran en attente le masque déjà par son
    // état null — pas d'état intermédiaire à poser en plus.
    (async () => {
      await load();
      if (!alive || !profile) return;

      // Le like du lecteur se lit à part : c'est la seule information
      // de la carte qui dépend de **qui** regarde. La réaction et le
      // repost suivent la même règle — c'est « qu'est-ce que j'ai fait
      // sur cette carte », pas une propriété de la carte.
      const [likedIds, repostIds, myReaction] = await Promise.all([
        fetchLikedPostIds(profile.id, [id]),
        fetchRepostIds(profile.id, [id]),
        fetchMyReaction(id, profile.id),
      ]);
      if (!alive) return;
      setLiked(likedIds.includes(id));
      setReposted(repostIds.includes(id));
      setReactionState(myReaction);
    })();

    return () => {
      alive = false;
    };
  }, [load, id, profile]);

  /**
   * Like, avec la même écriture optimiste que le fil : le compteur bouge
   * tout de suite, et revient en arrière si l'écriture échoue. Copier
   * la logique ici plutôt que la factoriser laisserait deux endroits
   * à corriger — et le second serait celui qu'on oublierait.
   */
  async function onToggleLike(postId: string) {
    if (!profile || !post) return;

    const wasLiked = liked;
    setLiked(!wasLiked);
    setPost((prev) =>
      prev ? { ...prev, likes: Math.max(0, (prev.likes ?? 0) + (wasLiked ? -1 : 1)) } : prev,
    );

    const { liked: now, error } = await toggleLike(postId, profile.id);
    if (error) {
      setLiked(wasLiked);
      setPost((prev) =>
        prev ? { ...prev, likes: Math.max(0, (prev.likes ?? 0) + (wasLiked ? 1 : -1)) } : prev,
      );
      toast("Action impossible", "err");
      return;
    }

    setLiked(now);
    const reread = await fetchPostById(postId);
    if (reread) setPost(reread);
  }

  async function onReact(postId: string, emoji: string | null) {
    if (!profile) return;

    const before = reaction;
    setReactionState(emoji);
    const { error } = await setReaction(postId, profile.id, emoji);
    if (error) {
      setReactionState(before);
      toast("Réaction impossible", "err");
      return;
    }
    const reread = await fetchPostById(postId);
    if (reread) setPost(reread);
  }

  async function onRepost(postId: string) {
    if (!profile) return;

    const was = reposted;
    setReposted(!was);
    const { reposted: now, error } = await toggleRepost(postId, profile.id);
    if (error) {
      setReposted(was);
      toast("Repub impossible", "err");
      return;
    }
    setReposted(now);
    const reread = await fetchPostById(postId);
    if (reread) setPost(reread);
  }



  return (
    <AppShell
      title="Publication"
      path={`~/post/${id}`}
      action={<IconButton label="Retour" name="arrow-left" onClick={() => router.back()} />}
    >
      <div className="px-(--gutter) pt-3">
        {post === null && !missing && <Loading label="Ouverture de la publication" />}

        {missing && (
          <EmptyState
            icon={<Icon name="file" size={20} strokeWidth={1.5} />}
            title="Publication introuvable"
            hint="Supprimée, ou lien invalide."
            action={
              <button
                type="button"
                onClick={() => router.push("/feed")}
                className="inline-flex h-(--h-tap) items-center gap-2
                  rounded-(--radius-input) border border-line-2 px-4
                  font-mono text-[11.5px] font-bold tracking-[0.12em]
                  text-chalk-3 uppercase transition-colors
                  duration-(--d-fast) hover:border-signal hover:text-signal"
              >
                Retour au fil
              </button>
            }
          />
        )}

        {post && (
          <>
            <Motion role="slide" delay={40}>
              <PostCard
                post={post}
                meId={profile?.id ?? null}
                liked={liked}
                reaction={reaction}
                onReact={onReact}
                reposted={reposted}
                onRepost={onRepost}
                onToggleLike={onToggleLike}
                onOpenComments={setCommentsFor}
                onOpenProfile={(pseudo) => router.push(`/u/${pseudo}`)}
                project={project ? { id: project.id, name: project.name, emoji: project.emoji, default_branch: project.default_branch } : null}
                onOpenProject={(projectId) => router.push(`/projects/${projectId}`)}
                isMine={postActions.isMine(post)}
                {...postActions.cardProps}
              />
            </Motion>

            <PostOwnerTools actions={postActions} />

            <CommentsPanel
              postId={commentsFor}
              open={commentsFor !== null}
              onClose={() => setCommentsFor(null)}
              me={profile?.id ?? null}
              canModerate={post.author_id === profile?.id}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}