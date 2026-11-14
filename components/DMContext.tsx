"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon, asIconName } from "@/components/Icon";
import { fetchLiveStories } from "@/lib/stories";
import { fetchProjectsWithCounts } from "@/lib/repo";
import { timeAgo } from "@/lib/utils";
import type { StoryWithAuthor, UserLite } from "@/lib/types";

/**
 * Contexte du correspondant — la fusion WhatsApp × Instagram × GitHub.
 *
 * Au-dessus d'une conversation, une bande discrète montre ce que l'autre
 * fait en ce moment : sa story vivante (Instagram) et son dépôt le plus
 * récent (GitHub). Ni l'une ni l'autre n'exige d'ouvrir un autre écran :
 * le texte qu'on écrit prend du sens parce que celui qui le lit est là,
 * en train de publier ou de commiter.
 *
 * La bande ne s'affiche qu'à moitié : sans story ni dépôt, il ne reste
 * rien à montrer et la ligne disparaît plutôt que d'occuper la place
 * pour dire « rien ».
 */
export function DMContext({ peer }: { peer: UserLite }) {
  const [story, setStory] = useState<StoryWithAuthor | null>(null);
  const [project, setProject] = useState<Awaited<
    ReturnType<typeof fetchProjectsWithCounts>
  >[number] | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      const [stories, projects] = await Promise.all([
        fetchLiveStories(),
        fetchProjectsWithCounts(peer.id),
      ]);

      if (!alive) return;

      const mine = stories
        .filter((s) => s.author_id === peer.id)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];

      if (mine) setStory(mine);

      // Le dépôt le plus actif, pas le plus ancien : « ce qu'il fait »
      // se lit sur la dernière activité, pas sur la date de création.
      const latest = [...projects].sort(
        (a, b) => (a.lastCommitAt < b.lastCommitAt ? 1 : -1),
      )[0];

      if (latest) setProject(latest);
    })();

    return () => {
      alive = false;
    };
  }, [peer.id]);

  if (!story && !project) return null;

  return (
    <div className="mx-(--gutter) mb-3 border border-line-2 bg-surface-2/50">
      <p className="label-micro flex items-center gap-1.5 border-b-(--bw-thin)
        border-line px-3 py-1.5 text-chalk-4">
        <Icon name="terminal" size={9} className="text-signal" />
        {story ? "en ce moment" : "en cours"}
      </p>

      <div className="flex items-center gap-4 px-3 py-2 text-sm text-chalk-3">
        {story && (
          <Link href={`/feed?story=${encodeURIComponent(story.author_id)}`}
            className="flex min-w-0 items-center gap-1.5 hover:text-signal">
            <span className="label-micro shrink-0 text-chalk-4">story</span>
            <span className="truncate">{story.caption || "sans légende"}</span>
            <span className="label-micro shrink-0 tnum text-chalk-4">
              · {timeAgo(story.created_at)}
            </span>
          </Link>
        )}
        {story && project && (
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-line" />
        )}
        {project && (
          <Link href={`/projects/${project.id}`} className="flex min-w-0
            items-center gap-1.5 hover:text-signal">
            <span aria-hidden="true" className="shrink-0 leading-none">
              <Icon name={asIconName(project.emoji, "layers")} size={11} strokeWidth={1.8} />
            </span>
            <span className="truncate">{project.name}</span>
            <span className="flex shrink-0 items-center gap-1 font-mono text-[10.5px]
              text-chalk-4">
              <Icon name="branch" size={9} />
              {project.branch}
              <span>· {project.commitCount}</span>
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}