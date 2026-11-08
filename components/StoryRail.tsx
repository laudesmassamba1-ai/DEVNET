"use client";

import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import type { StoryWithAuthor } from "@/lib/types";

/**
 * Stories DevNet — ce que le réseau a écrit dans les dernières 24 h.
 *
 * L'analogie Instagram est assumée : un rail horizontal de cercles, un
 * lecteur plein écran avec des barres de progression. Mais le contenu
 * n'est pas un statut décoratif : c'est une **vraie ligne** de `stories`,
 * avec une échéance. Une story vide n'existe pas — l'écran refuse de la
 * publier, et il n'y a dès lors rien à afficher.
 *
 * ## Un cercle par personne, une série par personne
 *
 * La table autorise plusieurs stories du même auteur ; le rail les
 * regroupe donc sous un seul cercle, et le lecteur déroule la série de
 * cette personne. C'est ce qui évite un rail où quelqu'un qui publie
 * trois fois occupe trois places, poussant les autres hors de l'écran.
 */

/**
 * Regroupe les stories par auteur, en gardant l'ordre d'arrivée.
 *
 * L'entrée est triée du plus récent au plus ancien : la personne qui
 * vient de publier passe donc en tête. À l'intérieur d'une série,
 * l'ordre est **chronologique** — c'est l'ordre dans lequel on la
 * regarde.
 */
export function groupStoriesByAuthor(
  stories: StoryWithAuthor[],
): { authorId: string; author: StoryWithAuthor["author"]; items: StoryWithAuthor[] }[] {
  const order: string[] = [];
  const groups = new Map<string, StoryWithAuthor[]>();

  for (const s of stories) {
    if (!groups.has(s.author_id)) order.push(s.author_id);
    const list = groups.get(s.author_id) ?? [];
    list.push(s);
    groups.set(s.author_id, list);
  }

  return order.map((authorId) => {
    const items = [...(groups.get(authorId) ?? [])].sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
    );
    return { authorId, author: items[0]?.author ?? null, items };
  });
}

export function StoryRail({
  stories,
  me,
  onOpen,
  onPublish,
}: {
  stories: StoryWithAuthor[];
  /** Le lecteur — pour marquer sa propre story d'un signe distinct. */
  me: string | null;
  onOpen: (authorId: string) => void;
  /** Ouvre la feuille de publication ; absent = on ne propose pas d'écrire. */
  onPublish?: () => void;
}) {
  const groups = groupStoriesByAuthor(stories);

  // Sans story et sans possibilité d'en publier, le rail n'a rien à dire :
  // un titre « Dernières contributions » au-dessus du vide serait du bruit.
  if (groups.length === 0 && !onPublish) return null;

  const mine = groups.find((g) => g.authorId === me);

  return (
    <div className="mb-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="prompt-label text-chalk-2">Dernières contributions</h2>
        <span className="label-micro text-chalk-3">24 h</span>
      </div>

      <div className="-mx-(--gutter) flex gap-3 overflow-x-auto px-(--gutter) pb-2">
        {/* Le cercle d'écriture passe en tête quand on peut publier : c'est
            l'action, et une action se place là où l'œil arrive. */}
        {onPublish && (
          <button
            type="button"
            onClick={onPublish}
            className="group flex w-[64px] shrink-0 flex-col items-center gap-1.5"
          >
            <span
              className="relative flex size-[54px] items-center justify-center
                rounded-full border-[1.5px] border-dashed border-line-3 bg-surface p-[2px]
                transition-transform group-hover:-translate-y-0.5"
            >
              <span className="flex size-full items-center justify-center rounded-full bg-page">
                <Avatar
                  name={mine?.author?.prenom ?? "moi"}
                  color={mine?.author?.avatar_color ?? "av-lime"}
                  className="size-[38px] border-0 text-[14px]"
                />
              </span>
              <span
                className="absolute -right-0.5 -bottom-0.5 flex size-[18px] items-center
                  justify-center rounded-full border-[1.5px] border-void bg-signal text-void"
                style={{ boxShadow: "var(--shadow-sh-1)" }}
              >
                <Icon name="plus" size={11} strokeWidth={2.4} />
              </span>
            </span>
            <span className="label-micro w-full truncate text-center text-chalk-2">
              Votre story
            </span>
          </button>
        )}

        {groups.map((g) => (
          <button
            key={g.authorId}
            type="button"
            onClick={() => onOpen(g.authorId)}
            className="group flex w-[64px] shrink-0 flex-col items-center gap-1.5"
          >
            {/* Anneau « sonde » — la signature de marque.
                Le dégradé phosphor ambre→vert, d'un écran qui s'allume.
                Il remplace l'arc-en-ciel d'Instagram par une seule
                affirmation de la marque. */}
            <span
              className="relative flex size-[54px] items-center justify-center
                rounded-full p-[2px] transition-transform group-hover:-translate-y-0.5
                group-hover:animate-[pulse_1.8s_ease-continuous_infinite]"
            >
              <span
                className="relative flex size-full items-center justify-center
                  rounded-full border bg-void p-[2px]"
                style={{
                  background: "var(--story-ring-gradient)",
                  WebkitMask: "radial-gradient(circle, transparent 62%, black 63%)",
                  mask: "radial-gradient(circle, transparent 62%, black 63%)",
                }}
              >
                <span
                  className="flex size-full items-center justify-center
                    rounded-full bg-page"
                >
                  <Avatar
                    name={g.author?.prenom}
                    color={g.author?.avatar_color}
                    className="size-[38px] border-0 text-[14px]"
                  />
                </span>
              </span>
            </span>

            <span className="label-micro w-full truncate text-center text-chalk-2">
              {g.authorId === me ? "vous" : (g.author?.pseudo ?? "?")}
            </span>

            {/* Indicateur de nombre de stories (Instagram-style). */}
            {g.items.length > 1 && (
              <span className="label-micro flex items-center justify-center w-full text-chalk-4">
                {g.items.length}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Le lecteur vit dans son propre fichier : il porte les interactions. */
export { StoryViewer } from "./StoryViewerLive";
