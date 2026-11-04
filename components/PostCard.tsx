"use client";

import { useRouter } from "next/navigation";
import { Avatar } from "./Avatar";
import { CodeBlock } from "./CodeBlock";
import { Icon, asIconName } from "./Icon";
import { Motion, useCount } from "./Motion";
import { ReactionPicker } from "./ReactionPicker";
import { ReportButton } from "./ReportButton";
import { PostShareButton } from "./PostShareButton";
import { VerifiedBadge } from "./VerifiedBadge";
import { badgeFor } from "@/lib/verification";
import { clockTime, profileMeta, timeAgo } from "@/lib/utils";
import { splitContent } from "@/lib/text";
import type { PostWithAuthor } from "@/lib/types";

/**
 * Carte de post.
 *
 * La métaphore : **une publication est un fichier**. Elle a une
 * gouttière de lignes à gauche, un en-tête qui donne l'auteur et
 * l'horodatage, et un corps. Le liseré d'accent remplace la barre
 * d'outils verticale de l'éditeur.
 *
 * La gouttière n'est pas décorative : elle donne à la carte une colonne
 * de repères stable. Le contenu est un flux, mais la structure doit être
 * stable — c'est ce qui permet à l'œil de parcourir le fil sans lire.
 *
 * La gouttière rappelle la marge d'un éditeur. Les séparateurs du fil
 * gardent les publications dans une seule colonne, sans empilement de cartes.
 */
export function PostCard({
  post,
  liked,
  onToggleLike,
  onOpenComments,
  onOpenProfile,
  isMine = false,
  onEdit,
  onDelete,
  project = null,
  onOpenProject,
  meId = null,
  reaction = null,
  onReact,
  reposted = false,
  onRepost,
  bookmarked = false,
  onBookmark,
}: {
  post: PostWithAuthor;
  liked: boolean;
  onToggleLike?: (id: string) => void;
  /** Ouvre le fil de commentaires du post. */
  onOpenComments?: (id: string) => void;
  onOpenProfile?: (pseudo: string) => void;
  /**
   * Le post appartient-il au lecteur ? C'est la seule condition pour
   * proposer de le modifier ou de le supprimer — et elle est vérifiée
   * une seconde fois par la RLS, qui refuse l'écriture à quiconque
   * n'est pas l'auteur. L'interface ne fait qu'éviter d'afficher une
   * action qui échouerait.
   */
  isMine?: boolean;
  onEdit?: (post: PostWithAuthor) => void;
  onDelete?: (post: PostWithAuthor) => void;
  /**
   * Projet auquel cette publication est rattachée.
   *
   * Optionnel par conception : la plupart des publications n'ont pas de
   * dépôt derrière, et afficher un emplacement vide sur chacune
   * à leur place serait du bruit. Le rattachement se voit **s'il
   * existe** — et il est alors un lien, pas une étiquette.
   */
  project?: { id: string; name: string; emoji: string; default_branch?: string } | null;
  onOpenProject?: (id: string) => void;
  /**
   * Identifiant du lecteur.
   *
   * Passé en prop et non lu par un `useSession` dans la carte : le fil
   * affiche trente cartes, et trente abonnements à la même session
   * pour savoir la même chose. La carte ne répond qu'à « à qui
   * appartient ce post ».
   */
  meId?: string | null;
  /**
   * La réaction du lecteur sur ce post, si elle en a posé une.
   *
   * Passée en prop comme `liked` : les deux décrivent la même chose —
   * « qu'est-ce que j'ai fait sur cette carte » — et les lire depuis
   * la base à chaque rendu coûterait une requête par carte.
   */
  reaction?: string | null;
  /** Pose, remplace ou retire la réaction. `null` retire. */
  onReact?: (id: string, emoji: string | null) => void;
  /** Le lecteur a-t-il republié ce post ? */
  reposted?: boolean;
  /** Republie ou retire le repost. */
  onRepost?: (id: string) => void;
  /** Le lecteur a-t-il enregistré ce post dans ses signets ? */
  bookmarked?: boolean;
  /** Enregistre ou retiré le signet. */
  onBookmark?: (id: string) => void;
}) {
  const router = useRouter();

  // L'auteur vient de la jointure, jamais des colonnes recopiées sur le
  // post : une recopie est figée à l'insertion, donc un changement de nom,
  // de pseudo ou de filière resterait invisible sur les posts anciens.
  // La jointure peut échouer (mode démo, réseau) — on affiche alors un
  // repli neutre, ce qui se voit, plutôt qu'un nom périmé, qui ne se voit pas.
  const author = post.author;
  const name = author?.prenom ?? "?";
  const pseudo = author?.pseudo ?? "";
  const color = author?.avatar_color ?? "av-sage";
  const meta = profileMeta(author?.filiere, author?.niveau);

  const likes = useCount(post.likes ?? 0);
  const comments = useCount(post.comments ?? 0);

  // L'heure absolue vit dans la marge, l'heure relative reste dans
  // l'en-tête. Les deux ne disent pas la même chose : « il y a 8 min »
  // situe la lecture, « 08:42 » date le contenu. La marge porte le
  // repère fixe, l'en-tête le repère mouvant.
  const posted = clockTime(post.created_at);

  return (
    <article
      className="feed-post flex overflow-hidden border-b border-line-2"
    >
      {/* Gouttière de lecture, distincte du texte et du code intégré. */}
      <div
        className="feed-post__gutter flex w-8 shrink-0 flex-col items-center
          border-r border-line-2 py-4"
      >
        <Motion as="span" role="rotate">
          <Icon name="file" size={12} className="text-chalk-4" />
        </Motion>

        {/* Cadran : deux lignes de deux chiffres tiennent dans les 32 px
            de la gouttière et alignent la colonne de repères d'un post à
            l'autre, sans élargir la marge de lecture. */}
        <Motion as="span" role="slide" className="mt-2 block">
          <time
            dateTime={post.created_at}
            title={`Publié à ${posted}`}
            className="line-gutter tnum block text-center leading-[1.5]"
          >
            <span aria-hidden="true">
              {posted.slice(0, 2)}
              <br />
              {posted.slice(3, 5)}
            </span>
            <span className="sr-only">Publié à {posted}</span>
          </time>
        </Motion>

        {/* Le filet vertical ne s'étire qu'entre deux éléments : c'est
            une liaison, pas un séparateur. */}
        <Motion
          role="slide"
          className="mt-6 w-px flex-1"
          style={{ transformOrigin: "top" }}
        >
          <span className="block h-full w-px bg-line" />
        </Motion>

        <Motion as="span" role="fade">
          <Icon name="comment" size={11} className="text-chalk-4" />
        </Motion>
      </div>

      <div className="feed-post__content min-w-0 flex-1 px-4 py-4">
        {/* ── En-tête ── */}
        <Motion
          role="rise"
          className="mb-2.5 flex items-center gap-2.5"
        >
          <Avatar
            name={name}
            color={color}
            className={author?.verified ? "shadow-[0_0_12px_1px_rgba(255,138,61,0.35)]" : ""}
          />
          <div className="min-w-0 flex-1">
            {pseudo ? (
              <button
                type="button"
                onClick={() => onOpenProfile?.(pseudo)}
                className="group/author -ml-0.5 -my-[3px] block py-[3px] text-left"
              >
                <span className="inline-flex items-center gap-1.5 text-[13.5px]
                  font-semibold transition-colors group-hover/author:text-signal">
                  {name}
                  {author?.verified && (
                    <VerifiedBadge
                      tier={badgeFor(author, author?.xp ?? 0)}
                      size="inline"
                    />
                  )}
                </span>
                <span
                  className="ml-1.5 font-mono text-[11.5px] font-normal
                    text-chalk-3 transition-colors group-hover/author:text-signal/70"
                >
                  @{pseudo}
                </span>
              </button>
            ) : (
              <div className="text-[13.5px] font-semibold">{name}</div>
            )}
            <div className="label-micro mt-1 text-chalk-4">
              {meta ? `${meta} · ` : ""}
              {timeAgo(post.created_at)}
            </div>
          </div>
        </Motion>

        {/* ── Corps ──
            Le texte est rendu segment par segment, pas en HTML : un
            hashtag devient un lien, une mention aussi, et le reste du
            texte passe par `esc` comme avant. On ne peut donc pas
            injecter de balise dans un post, et un `#python` écrit dans
            le texte mène quelque part.

            Écrire un hashtag sans pouvoir le suivre serait une promesse
            non tenue : c'est pour ça que le mot existe dans le texte et
            pas seulement dans une colonne invisible. La mention suit la
            même règle, et pour une raison plus forte encore : on écrit
            `@koffi` pour le citer, et un texte qui cite sans lien oblige
            à recopier le pseudo. */}
        <Motion
          role="slide"
          className="feed-post__text mb-3.5 text-[14.5px] leading-[1.66] break-words
            whitespace-pre-wrap text-chalk-2"
        >
          {splitContent(post.text).map((segment, i) =>
            segment.tag ? (
              <button
                key={i}
                type="button"
                onClick={() => router.push(`/search?tag=${encodeURIComponent(segment.tag!)}`)}
                title={`Voir les publications #${segment.tag}`}
                className="font-medium text-signal underline-sweep"
              >
                {segment.text}
              </button>
            ) : segment.mention ? (
              <button
                key={i}
                type="button"
                onClick={() => router.push(`/u/${encodeURIComponent(segment.mention!)}`)}
                title={`Ouvrir le profil de @${segment.mention}`}
                className="font-medium text-chalk underline-sweep hover:text-signal"
              >
                {segment.text}
              </button>
            ) : (
              // React échappe déjà le texte : passer par `esc()` ici
              // doublait l'échappement, et les entités s'affichaient en
              // clair — « &#39; » au lieu d'un apostrophe, « <br/> » au lieu
              // d'un retour à la ligne (que `whitespace-pre-wrap` rend
              // déjà). Le HTML se protège en ne l'injectant pas, pas en
              // rééchappant ce que React protège déjà.
              <span key={i}>{segment.text}</span>
            ),
          )}
        </Motion>

        {/* ── Code : s'insère après le texte, à sa place dans la lecture. ── */}
        {post.has_code && (
          <Motion role="scale">
            <CodeBlock code={post.code} lang={post.lang} variant="paper" lineNumbers />
          </Motion>
        )}

        {/* ── Le projet d'origine ──
            Une publication qui vient d'un dépôt le dit, et le dit
            cliquable : c'est le chemin le plus court entre « j'ai lu
            quelque chose d'intéressant » et « voici le code ». Sans ce
            lien, le lien post↔projet n'existerait que dans la base. */}
        {project && (
          <Motion role="fade">
            <button
              type="button"
              onClick={() => onOpenProject?.(project.id)}
              className="mb-3 inline-flex items-center gap-1.5 rounded-[var(--radius-chip)]
                border border-line-3 px-2.5 py-1.5 font-mono text-[11px]
                text-chalk-3 transition-colors duration-[var(--d-fast)]
                hover:border-signal hover:text-signal"
            >
              <span aria-hidden="true" className="shrink-0 leading-none">
                <Icon name={asIconName(project.emoji, "layers")} size={14} strokeWidth={1.8} />
              </span>
              <span className="truncate">{project.name}</span>
              {project.default_branch && (
                <span className="label-micro flex items-center gap-0.5 text-chalk-4">
                  <Icon name="branch" size={9} />
                  {project.default_branch}
                </span>
              )}
              <Icon name="chevron-right" size={11} />
            </button>
          </Motion>
        )}

        {/* ── Actions ── */}
        <Motion
          role="slide"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            onClick={() => onToggleLike?.(post.id)}
            aria-pressed={liked}
            aria-label={liked ? "Ne plus aimer cette publication" : "Aimer cette publication"}
            className={`inline-flex items-center gap-1.5 rounded-[var(--radius-chip)]
              border-[var(--bw-thin)] px-2.5 py-2 min-h-[var(--h-action)] max-sm:min-h-[var(--h-tap)] inline-flex items-center font-mono text-[12px] font-medium
              transition-[color,border-color,background-color,transform] duration-[var(--d-fast)]
              ${liked
                ? "border-signal text-signal"
                : "border-line text-chalk-3 hover:border-line-3 hover:bg-surface-2 hover:text-chalk"}
              active:translate-y-px`}
          >
            {/* Le cœur ne « remplit » pas : il se contracte puis revient.
                Un remplissage instantané est un changement d'état ; la
                contraction est une réaction. */}
            <Motion key={String(liked)} role="pop" as="span" delay={0}>
              <Icon
                name="like"
                size={14}
                fill={liked ? "currentColor" : "none"}
                strokeWidth={liked ? 1.7 : 1.9}
              />
            </Motion>
            <span className="tnum">{likes}</span>
          </button>

          {/* Le nombre de commentaires est un **bouton**. Il l'était
              pendant longtemps un `<span>` : l'icône d'une bulle de
              conversation invite à cliquer, et un élément sur lequel on
              ne peut pas cliquer est un mensonge de l'interface. Il est
              donc actionnable, avec le même relief que les autres
              actions de la barre, et il annonce son effet aux lecteurs
              d'écran. */}
          <button
            type="button"
            onClick={() => onOpenComments?.(post.id)}
            aria-label={`Ouvrir les ${post.comments || 0} commentaires`}
            className={`inline-flex items-center gap-1.5 rounded-[var(--radius-chip)]
              border-[var(--bw-thin)] px-2.5 py-2 min-h-[var(--h-action)] max-sm:min-h-[var(--h-tap)] inline-flex items-center font-mono text-[12px]
              text-chalk-3 transition-[color,border-color,background-color]
              duration-[var(--d-fast)]
              hover:border-line-3 hover:bg-surface-2 hover:text-chalk
              active:translate-y-px`}
          >
            <Icon name="comment" size={14} />
            <span className="tnum">{comments}</span>
          </button>

          {/* Réaction : le sélecteur s'ouvre au survol du bouton, et
              la ligne de réactions déjà posées se lit juste au-dessus.
              L'emoji affiché dans le bouton est celui du lecteur : un
              bouton qui ne montre pas son propre état oblige à ouvrir
              le sélecteur pour savoir si on a déjà réagi. */}
          <ReactionPicker
            mine={reaction ?? null}
            onPick={(emoji) => onReact?.(post.id, emoji)}
          />

          {/* Le total des réactions, quand il y en a. On n'affiche pas
              un `0` : un chiffre à zéro sur une carte vide est du bruit,
              et il n'apprend rien. */}
          {post.reactions ? (
            <span className="tnum font-mono text-[12px] text-chalk-4">
              {post.reactions}
            </span>
          ) : null}

          {/* Repost : ni like, ni partage. Le like dit « j'ai vu », le
              partage dit « envoie-le à quelqu'un », le repost dit « il
              fait partie de mon fil ». Le confondre avec le partage
              était le défaut d'origine : les deux sont deux gestes et
              deux destinations différentes. */}
          <button
            type="button"
            onClick={() => onRepost?.(post.id)}
            aria-pressed={reposted}
            aria-label={
              reposted
                ? "Retirer cette publication de ton fil"
                : "Republier dans mon fil"
            }
            className={`inline-flex items-center gap-1.5 rounded-[var(--radius-chip)]
              border-[var(--bw-thin)] px-2.5 py-2 min-h-[var(--h-action)] max-sm:min-h-[var(--h-tap)] inline-flex items-center font-mono text-[12px]
              transition-[color,border-color,background-color,transform]
              duration-[var(--d-fast)]
              ${reposted
                ? "border-ok text-ok"
                : "border-line text-chalk-3 hover:border-line-3 hover:bg-surface-2 hover:text-chalk"}
              active:translate-y-px`}
          >
            <Motion key={String(reposted)} role="rotate" as="span" delay={0}>
              <Icon name="repost" size={14} />
            </Motion>
            {post.reposts ? <span className="tnum">{post.reposts}</span> : null}
          </button>

          {/* Le signet est le seul des quatre gestes qui ne parle **pas**
              aux autres : on garde une publication pour soi. D'où son
              ton — l'ambre, qui est la couleur d'accent — et non le
              rouge du like, qui signifierait « j'ai vu » et serait donc
              faux. */}
          <button
            type="button"
            onClick={() => onBookmark?.(post.id)}
            aria-pressed={bookmarked}
            aria-label={
              bookmarked
                ? "Retirer des signets"
                : "Enregistrer dans les signets"
            }
            title={bookmarked ? "Retirer des signets" : "Enregistrer"}
            className={`inline-flex items-center rounded-[var(--radius-chip)]
              border-[var(--bw-thin)] px-2 py-2 min-h-[var(--h-action)]
              max-sm:min-h-[var(--h-tap)] transition-[color,border-color,transform]
              duration-[var(--d-fast)] active:translate-y-px
              ${bookmarked
                ? "border-signal text-signal"
                : "border-line text-chalk-4 hover:border-line-3 hover:text-chalk"}`}
          >
            <Motion key={String(bookmarked)} role="pop" as="span" delay={0}>
              <Icon
                name="bookmark"
                size={14}
                fill={bookmarked ? "currentColor" : "none"}
              />
            </Motion>
          </button>

          <PostShareButton title={post.text} url={`${window.location.origin}/post/${post.id}`} />

          {/* Signaler, en icône seule et dans le ton le plus discret :
              c'est un geste qu'on fait une fois, dans le doute, et il ne
              doit pas peser dans la barre d'actions comme un partage. Le
              composant ne rend rien si le post est le mien — la base
              refuserait l'envoi. */}
          <ReportButton
            me={meId ?? null}
            targetId={post.id}
            targetType="post"
            targetLabel="cette publication"
            targetAuthorId={post.author_id}
            compact
            className="ml-1 inline-flex size-[34px] items-center justify-center
              rounded-[var(--radius-chip)] border-[var(--bw-thin)] border-line
              text-chalk-4 transition-[color,border-color,background-color]
              duration-[var(--d-fast)] hover:border-danger hover:text-danger"
          />

          {/* Les deux actions de l'auteur. Elles ne displacement pas
              « Partager » : c'est le geste le plus courant, il reste à
              droite où l'œil l'attend. Elles apparaissent à leur place
              dans la barre, pas dans un menu — un post qu'on lit est un
              post qu'on a sous les yeux, et un menu à trois entrées
              pour deux gestes est une étape de trop. */}
          {isMine && (
            <>
              <button
                type="button"
                onClick={() => onEdit?.(post)}
                aria-label="Modifier ce post"
                title="Modifier"
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-chip)]
                  border-[var(--bw-thin)] border-line px-2.5 py-2 text-chalk-3
                  transition-[color,background-color,border-color] duration-[var(--d-fast)]
                  hover:border-line-3 hover:bg-surface-2 hover:text-chalk
                  active:translate-y-px"
              >
                <Icon name="edit" size={14} />
              </button>

              <button
                type="button"
                onClick={() => onDelete?.(post)}
                aria-label="Supprimer ce post"
                title="Supprimer"
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-chip)]
                  border-[var(--bw-thin)] border-line px-2.5 py-2 text-chalk-3
                  transition-[color,background-color,border-color] duration-[var(--d-fast)]
                  hover:border-danger hover:text-danger
                  active:translate-y-px"
              >
                <Icon name="trash" size={14} />
              </button>
            </>
          )}
        </Motion>
      </div>
    </article>
  );
}