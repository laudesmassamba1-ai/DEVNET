"use client";

import { useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { cascade } from "./Motion";
import { readSeenStoryIds, SEEN_EVENT } from "@/lib/stories";
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

  /**
   * Ce que cet appareil a déjà vu.
   *
   * Le serveur ne peut pas répondre à cette question : la table des vues
   * n'est lisible que par l'auteur. Le rail lit donc la mémoire locale, et
   * se met à jour quand le lecteur referme une story — sans recharger le
   * fil pour une information qui tient dans un `Set`.
   */
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const sync = () => setSeenIds(readSeenStoryIds());
    sync();
    window.addEventListener(SEEN_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SEEN_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

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
            l'action, et une action se place là où l'œil arrive.

            S'il y a déjà une story à soi, le cercle **ouvre cette story**
            — c'est là qu'on la regarde et qu'on la supprime. Publier reste
            possible par la pastille « + » posée dessus : un cercle qui ne
            ferait qu'ajouter une story rendrait les siennes inaccessibles
            depuis le rail. */}
        {onPublish && (
          <div className="relative flex w-20 shrink-0 flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={() => (mine && me ? onOpen(me) : onPublish())}
              className="group flex w-20 flex-col items-center gap-1.5"
            >
              <span
                className={`relative flex size-13.5 items-center justify-center
                  rounded-full p-[2px] transition-transform group-hover:-translate-y-0.5
                  ${mine ? "" : "border-[1.5px] border-dashed border-line-3 bg-surface"}`}
              >
                {mine && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: "var(--story-ring-gradient)",
                      WebkitMask: "radial-gradient(circle, transparent 62%, black 63%)",
                      mask: "radial-gradient(circle, transparent 62%, black 63%)",
                    }}
                  />
                )}
                {/* L'initiale est décorative : le nom est juste en dessous.
                    Lue deux fois, elle s'entendrait « K vous ». */}
                <span
                  aria-hidden="true"
                  className="flex size-full items-center justify-center rounded-full bg-page"
                >
                  <Avatar
                    name={mine?.author?.prenom ?? "moi"}
                    color={mine?.author?.avatar_color ?? "av-lime"}
                    src={mine?.author?.avatar_url}
                    className="size-9.5 border-0 text-14"
                  />
                </span>
              </span>
              {/* Pas de troncature ici : le libellé tient dans la largeur du
                  cercle, et « Votre st… » ne dit plus ce qu'on peut faire. */}
              <span className="label-micro w-full whitespace-nowrap text-center leading-tight text-chalk-2">
                {mine ? "vous" : "Votre story"}
              </span>
              {mine && mine.items.length > 1 && (
                <span className="label-micro flex w-full items-center justify-center text-chalk-4">
                  {mine.items.length}
                </span>
              )}
            </button>

            {/* La pastille garde sa taille visuelle, mais la cible tactile
                fait 44 px : sur un 320 px, 22 px se rate une fois sur
                trois au pouce. Elle est centrée sur le coin bas-droit du
                cercle, comme avant. */}
            {mine && (
              <button
                type="button"
                onClick={onPublish}
                aria-label="Publier une nouvelle story"
                title="Publier une nouvelle story"
                className="absolute top-[25px] -right-[13px] flex size-11 items-center
                  justify-center rounded-full"
              >
                <span
                  className="flex size-5.5 items-center justify-center rounded-full
                    border-[1.5px] border-void bg-signal text-void
                    transition-transform active:scale-95"
                  style={{ boxShadow: "var(--shadow-sh-1)" }}
                >
                  <Icon name="plus" size={12} strokeWidth={2.6} />
                </span>
              </button>
            )}
          </div>
        )}

        {groups
          .filter((g) => !(onPublish && g.authorId === me))
          .map((g, i) => {
            const unseen = g.items.some((story) => !seenIds.has(story.id));
            return (
              <button
                key={g.authorId}
                type="button"
                onClick={() => onOpen(g.authorId)}
                className="mo-rise group flex w-20 shrink-0 flex-col items-center gap-1.5"
                style={{ animationDelay: `${cascade(i, 40, 400)}ms` }}
              >
                {/* Deux états, deux matières : l'anneau de marque pour ce
                    qui n'a pas été vu, un filet discret pour le reste. Le
                    dégradé ne clignote pas : c'est une information, pas un
                    appel à l'action. */}
                <span
                  className={`relative flex size-13.5 items-center justify-center
                    rounded-full p-[2px] transition-transform
                    duration-(--d-fast) ease-(--ease-spring)
                    group-hover:-translate-y-0.5 group-hover:scale-105 ${
                      unseen ? "" : "border-[1.5px] border-line-3"
                    }`}
                >
                  {/* L'anneau est un calque **frère** de l'avatar, jamais
                      son parent : un masque s'applique aussi aux enfants, et
                      posé sur le conteneur il effaçait le visage au centre
                      du cercle. */}
                  {unseen && (
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-full"
                      style={{
                        background: "var(--story-ring-gradient)",
                        WebkitMask: "radial-gradient(circle, transparent 62%, black 63%)",
                        mask: "radial-gradient(circle, transparent 62%, black 63%)",
                      }}
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className="flex size-full items-center justify-center rounded-full bg-page"
                  >
                    <Avatar
                      name={g.author?.prenom}
                      color={g.author?.avatar_color}
                      src={g.author?.avatar_url}
                      className="size-9.5 border-0 text-14"
                    />
                  </span>
                </span>

                <span
                  className={`label-micro w-full truncate text-center ${
                    unseen ? "text-chalk-2" : "text-chalk-3"
                  }`}
                >
                  {g.authorId === me ? "vous" : (g.author?.pseudo ?? "?")}
                </span>

                {/* Un compteur n'apparaît que s'il y a plusieurs statuts :
                    « 1 » à côté de chaque nom serait du bruit. */}
                {g.items.length > 1 && (
                  <span className="label-micro flex w-full items-center justify-center text-chalk-4">
                    {g.items.length}
                  </span>
                )}

                {/* L'état se dit à voix haute sans remplacer le nom visible :
                    un `aria-label` qui réécrit le contenu casse le lien entre
                    ce qu'on lit et ce qu'on entend. */}
                <span className="sr-only">
                  {` — ${g.items.length} statut${g.items.length > 1 ? "s" : ""}, `}
                  {unseen ? "non vu" : "déjà vu"}
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}

/** Le lecteur vit dans son propre fichier : il porte les interactions. */
export { StoryViewer } from "./StoryViewerLive";
