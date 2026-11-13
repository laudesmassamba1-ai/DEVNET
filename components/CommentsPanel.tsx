"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Avatar, Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Motion, waitForExit } from "@/components/Motion";
import { ReportButton } from "@/components/ReportButton";
import { Sheet } from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { addComment, deleteComment, fetchComments } from "@/lib/social";
import { MessageAttachmentButtons, MessageAttachmentView } from "@/components/MessageAttachments";
import { canSendMessage, type MessageAttachment } from "@/lib/message-media";
import { fetchStickers, type StickerRowView } from "@/lib/stickers";
import { badgeFor, xpOf } from "@/lib/verification";
import { splitContent } from "@/lib/text";
import type { CommentWithAuthor } from "@/lib/types";

/**
 * Fil de commentaires d'un post.
 *
 * Un commentaire est une **ligne** de la table `comments`, et jamais un
 * `int` sur le post. Le compteur du post est un cache, tenu par le
 * déclencheur `sync_post_comments` ; le nombre affiché ici est donc lu
 * depuis la table à chaque ouverture, et non repris du post — sinon la
 * liste et son compteur finiraient par diverger.
 *
 * L'ordre est chronologique croissant : une conversation se lit du
 * premier au dernier. L'inverse impose un aller-retour visuel permanent
 * pour suivre les échanges.
 *
 * ## Les réponses, et pourquoi un seul niveau
 *
 * `comments.parent_id` (migration 018) permet de répondre à un
 * commentaire. L'affichage imbrique la réponse sous son parent, mais la
 * **donnée** ne descend jamais plus bas : répondre à une réponse attache
 * la nouvelle au commentaire **racine** du fil. C'est le même parti que
 * les fils de discussion classiques — au-delà d'un niveau, un fil devient
 * illisible sur un téléphone, la gouttière mange la largeur du texte, et
 * la notification n'a plus de forme lisible (« X a répondu à Y qui
 * répondait à Z »).
 *
 * Ce que l'interface fait, en revanche, c'est **remonter** : un
 * commentaire dont le parent n'est pas dans la liste (parent supprimé, ou
 * réponse stockée à un autre niveau) est rendu comme un commentaire
 * racine. Rien ne disparaît — un fil qui cache une réponse serait pire
 * qu'un fil qui l'affiche au mauvais niveau.
 */

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "";

  const min = Math.round(diff / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;

  const hours = Math.round(min / 60);
  if (hours < 24) return `il y a ${hours} h`;

  const days = Math.round(hours / 24);
  if (days < 30) return `il y a ${days} j`;

  return new Date(iso).toLocaleDateString("fr", { day: "numeric", month: "short" });
}

/** Une ligne de commentaire, racine ou réponse. */
function CommentRow({
  comment,
  delay,
  me,
  canModerate,
  leaving,
  busy,
  sticker,
  onReply,
  onRemove,
}: {
  comment: CommentWithAuthor;
  delay: number;
  me: string | null;
  canModerate: boolean;
  leaving: boolean;
  busy: boolean;
  /** Le sticker joint, résolu depuis le catalogue chargé par le panneau. */
  sticker: StickerRowView | null;
  onReply: (c: CommentWithAuthor) => void;
  onRemove: (id: string) => void;
}) {
  const author = comment.author;
  const name = author?.prenom ?? "compte supprimé";
  const mine = comment.author_id === me;

  return (
    <Motion
      role={leaving ? "none" : "rise"}
      delay={delay}
      className={`flex gap-2.5 border-b border-line py-3 last:border-b-0
        ${leaving ? "mo-exit" : ""}`}
    >
      <Avatar name={name} color={author?.avatar_color ?? "av-sage"} src={author?.avatar_url} size="sm" />

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-1.5">
          <span className="font-bold text-[13px] text-chalk">{name}</span>
          {author?.verified && <VerifiedBadge tier={badgeFor(author, xpOf(author))} size="sm" className="translate-y-[1px]" />}
          {/* L'horodatage est secondaire : il s'oppose à la présence du
              pseudo, qui est l'information première. */}
          <span className="font-mono text-[10.5px] text-chalk-4">
            {relativeTime(comment.created_at)}
          </span>
        </p>
        <MessageAttachmentView
          gifUrl={comment.gif_url}
          gifAlt={comment.gif_alt}
          sticker={sticker}
        />
        <p className="mt-1 text-[13.5px] leading-[1.55] break-words whitespace-pre-wrap text-chalk-2">
          {/* Même découpage que dans une publication : c'est ici qu'on
              cite le plus souvent quelqu'un, et un `@pseudo` qui ne mène
              nulle part obligerait à le retaper pour aller voir le
              profil. */}
          {splitContent(comment.text).map((segment, j) =>
            segment.mention ? (
              <Link
                key={j}
                href={`/u/${encodeURIComponent(segment.mention)}`}
                className="font-medium text-chalk underline-sweep hover:text-signal"
              >
                {segment.text}
              </Link>
            ) : (
              // React échappe déjà : `esc()` doublait le travail et
              // affichait les entités en clair (voir PostCard).
              <span key={j}>{segment.text}</span>
            ),
          )}
        </p>

        {/* Répondre. Le bouton porte le nom de la personne visée : un
            « répondre » sans destinataire laisse croire qu'on écrit au
            fil entier, alors qu'on répond à quelqu'un. */}
        <button
          type="button"
          onClick={() => onReply(comment)}
          disabled={!me || busy}
          className="mt-1.5 inline-flex min-h-[32px] items-center gap-1.5
            font-mono text-[10.5px] font-bold tracking-[0.08em] text-chalk-3
            uppercase transition-colors hover:text-signal disabled:opacity-40"
        >
          <Icon name="command" size={11} strokeWidth={2} />
          Répondre
        </button>
      </div>

      {(mine || canModerate) && (
        <button
          type="button"
          onClick={() => onRemove(comment.id)}
          disabled={busy}
          aria-label="Supprimer ce commentaire"
          className="h-7 shrink-0 self-start rounded-[var(--radius-chip)]
            border-[var(--bw-thin)] border-line px-1.5 text-chalk-4
            transition-[color,border-color] duration-[var(--d-fast)]
            hover:border-danger hover:text-danger
            disabled:opacity-40"
        >
          <Icon name="close" size={12} />
        </button>
      )}

      {/* Signaler un commentaire qui n'est pas le mien. Sur le mien, le
          composant ne rend rien : porter un signalement contre soi-même
          n'aurait aucun sens, et la RLS le refuse. L'auto-modération passe
          par le bouton supprimer ci-dessus, quand il apparaît. */}
      <ReportButton
        me={me}
        targetId={comment.id}
        targetType="comment"
        targetLabel="ce commentaire"
        targetAuthorId={comment.author_id}
        compact
        className="h-7 shrink-0 self-start rounded-[var(--radius-chip)]
          border-[var(--bw-thin)] border-line text-chalk-4
          transition-[color,border-color] duration-[var(--d-fast)]
          hover:border-danger hover:text-danger"
      />
    </Motion>
  );
}

export function CommentsPanel({
  postId,
  open,
  onClose,
  me,
  canModerate,
  variant = "sheet",
}: {
  postId: string | null;
  open: boolean;
  onClose: () => void;
  /** L'utilisateur courant ; sans lui, on ne peut rien écrire. */
  me: string | null;
  /** Droit de supprimer les commentaires d'autrui (auteur du post). */
  canModerate: boolean;
  /**
   * `docked` pose le fil dans une colonne à droite du contenu, sans voile
   * ni superposition : on lit les commentaires **et** les publications en
   * même temps, comme sur Instagram ou YouTube. La colonne des posts garde
   * sa largeur — c'est le couple qui se centre — donc ouvrir la
   * conversation décale le fil au lieu de l'écraser. `sheet` garde la
   * feuille du bas, seule tenable sur un écran de téléphone.
   */
  variant?: "sheet" | "docked";
}) {
  const [comments, setComments] = useState<CommentWithAuthor[] | null>(null);
  /** Commentaire en cours de retrait — garde son animation de sortie. */
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  /** Média joint au prochain commentaire — sticker ou GIF, jamais un emoji. */
  const [attachment, setAttachment] = useState<MessageAttachment | null>(null);
  /** Catalogue des stickers, pour rendre un commentaire déjà envoyé. */
  const [stickerCatalog, setStickerCatalog] = useState<Map<string, StickerRowView>>(new Map());
  /** Le fil qu'on est en train de regarder — trie les réponses en vol. */
  const postIdRef = useRef(postId);
  useEffect(() => {
    postIdRef.current = postId;
  }, [postId]);
  /**
   * Le commentaire auquel la prochaine publication répondra.
   *
   * `rootId` est la **racine** du fil — jamais l'identifiant d'une
   * réponse, même quand on clique « Répondre » sur une réponse. `name`
   * est le nom de la personne réellement visée, pour le bandeau : on
   * répond à Thabo, et la ligne s'attache au commentaire racine.
   */
  const [replyTo, setReplyTo] = useState<{ rootId: string; name: string } | null>(
    null,
  );
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();

  const load = useCallback(async (id: string) => {
    setComments(null);
    const data = await fetchComments(id);
    // Un fil qui s'ouvre pendant qu'un autre chargeait : seule la
    // réponse du fil **courant** peut s'afficher, sinon on verrait les
    // commentaires d'un post dans la feuille d'un autre.
    setComments((prev) => (id === postIdRef.current ? data : prev));
  }, []);

  useEffect(() => {
    if (!open || !postId) return;
    void (async () => {
      await load(postId);
    })();
  }, [open, postId, load]);

  // Le catalogue ne change pas pendant la lecture d'un fil : une requête
  // par ouverture suffit, et elle sert toutes les bulles d'un coup.
  useEffect(() => {
    if (!open) return;
    void fetchStickers().then((rows) => {
      setStickerCatalog(new Map(rows.map((row) => [row.id, row])));
    });
  }, [open]);

  /**
   * Le fil reconstitué depuis la liste plate.
   *
   * On garde l'ordre d'arrivée (`created_at` croissant) pour les racines
   * comme pour les réponses.
   *
   * Le point délicat est le **parent d'un parent**. Le client ne produit
   * jamais ce cas — il remonte à la racine avant d'écrire — mais la base
   * l'autorise (elle ne refuse qu'un parent qui serait la ligne
   * elle-même), et un commentaire stocké ainsi doit rester visible. On
   * remonte donc chaque réponse à la **racine de sa chaîne** : une
   * réponse à une réponse s'affiche sous la racine, au même niveau que
   * les autres réponses. Aucune ligne ne disparaît, et l'affichage tient
   * sur un seul niveau — ce que la donnée a décidé.
   */
  const { roots, childrenOf, rootOf } = useMemo(() => {
    const rows = comments ?? [];
    const byId = new Map(rows.map((c) => [c.id, c]));

    // Remonte la chaîne des parents jusqu'à un commentaire absent (le
    // véritable ancêtre) ou jusqu'à une racine. La borne de longueur
    // évite une boucle infinie si les données contenaient un cycle —
    // impossible en base (`parent_id <> id`), mais la démo relit un
    // store `localStorage` qu'on ne contrôle pas.
    const rootOf = (c: CommentWithAuthor): string => {
      let cur = c;
      for (let guard = 0; guard < rows.length; guard++) {
        const parent = cur.parent_id ? byId.get(cur.parent_id) : undefined;
        if (!parent) return cur.id;
        cur = parent;
      }
      return c.id;
    };

    const roots: CommentWithAuthor[] = [];
    const childrenOf = new Map<string, CommentWithAuthor[]>();

    for (const c of rows) {
      const rootId = rootOf(c);
      if (rootId === c.id) {
        roots.push(c);
      } else {
        const list = childrenOf.get(rootId) ?? [];
        list.push(c);
        childrenOf.set(rootId, list);
      }
    }

    const rootsById = new Map(roots.map((c) => [c.id, c]));

    return {
      roots,
      childrenOf,
      /** La racine du fil auquel appartient `id`, commentaire ou réponse. */
      rootOf: (id: string): CommentWithAuthor | null => {
        const c = byId.get(id);
        return c ? (rootsById.get(rootOf(c)) ?? null) : null;
      },
    };
  }, [comments]);

  async function send() {
    if (!postId || !me || busy) return;
    if (!canSendMessage(text, attachment ?? undefined)) return;
    setBusy(true);
    const { error } = await addComment(
      postId,
      me,
      text,
      replyTo?.rootId ?? null,
      attachment ?? undefined,
    );
    setBusy(false);

    if (error) {
      toast("Commentaire non posté", "err");
      return;
    }
    setText("");
    setAttachment(null);
    setReplyTo(null);
    await load(postId);
  }

  async function remove(id: string) {
    if (!postId || busy) return;
    setBusy(true);
    const { error } = await deleteComment(id);
    setBusy(false);

    if (error) {
      toast("Suppression impossible", "err");
      return;
    }

    // Le commentaire joue son retrait avant d'être relu : la liste est
    // rechargée ensuite, donc sans ce délai la ligne s'évanouirait sans
    // que rien ne bouge.
    setLeavingId(id);
    await waitForExit();
    setLeavingId(null);
    await load(postId);
  }

  /**
   * Préparer une réponse.
   *
   * On remonte à la racine : le parent stocké est le commentaire **racine**
   * du fil, même quand on clique « Répondre » sur une réponse. Le nom
   * affiché reste celui de la personne cliquée, pas celui du propriétaire
   * de la racine — on répond à qui l'on a touché.
   */
  function beginReply(c: CommentWithAuthor) {
    setReplyTo({
      rootId: rootOf(c.id)?.id ?? c.id,
      name: c.author?.prenom ?? "ce compte",
    });
    // Le focus suit le geste : on a appuyé sur « Répondre », on s'attend
    // à écrire tout de suite. Sans ça, il faut faire défiler jusqu'au
    // bas et cliquer une seconde fois.
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  // Compteur de délai d'apparition : il traverse racines et réponses dans
  // l'ordre du rendu, pour que l'entrée en cascade reste continue.
  let delayIndex = 0;
  const nextDelay = () => Math.min(delayIndex++ * 45, 360);

  const body = (
    <>
      <div className={variant === "docked" ? "min-h-0 flex-1 overflow-y-auto" : "max-h-[56vh] overflow-y-auto"}>
        {comments === null && <Loading label="Lecture des commentaires" />}

        {comments?.length === 0 && (
          <p className="py-8 text-center font-mono text-[12px] text-chalk-4">
            aucun commentaire
          </p>
        )}

        {roots.map((c) => {
          const replies = childrenOf.get(c.id) ?? [];
          return (
            <div key={c.id}>
              <CommentRow
                comment={c}
                delay={nextDelay()}
                me={me}
                canModerate={canModerate}
                leaving={leavingId === c.id}
                busy={busy}
                sticker={c.sticker_id ? stickerCatalog.get(c.sticker_id) ?? null : null}
                onReply={beginReply}
                onRemove={remove}
              />

              {replies.length > 0 && (
                // La gouttière de réponse : un filet vertical qui dit
                // « ces lignes appartiennent à celle du dessus » sans
                // consommer d'indentation horizontale. Un retrait de
                // 32 px volerait un dixième de la largeur sur un
                // téléphone, là où une ligne de 2 px ne vole rien.
                <div className="ml-[19px] border-l border-line-2 pl-3">
                  {replies.map((r) => (
                    <CommentRow
                      key={r.id}
                      comment={r}
                      delay={nextDelay()}
                      me={me}
                      canModerate={canModerate}
                      leaving={leavingId === r.id}
                      busy={busy}
                      sticker={r.sticker_id ? stickerCatalog.get(r.sticker_id) ?? null : null}
                      onReply={beginReply}
                      onRemove={remove}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Le composeur colle au bas du panneau : on écrit toujours à la
          même hauteur, quel que soit le nombre de commentaires au-dessus. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="mt-3 border-t border-line pt-3"
      >
        {/* Bandeau de réponse. Il n'existe que lorsqu'on répond : un
            bandeau permanent afficherait « répondre à personne ». */}
        {replyTo && (
          <div className="mb-2 flex items-center gap-2 border border-line-2
            bg-surface px-2.5 py-1.5 text-[11.5px] text-chalk-3">
            <Icon name="command" size={11} className="shrink-0 text-signal" />
            <span className="min-w-0 flex-1 truncate">
              Réponse à <span className="font-bold text-chalk">{replyTo.name}</span>
            </span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              aria-label="Annuler la réponse"
              className="shrink-0 text-chalk-4 transition-colors hover:text-danger"
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        )}

        {attachment && (
          <div className="mb-2 flex items-center gap-2 rounded-input border border-line-2
            bg-surface-2/60 px-2.5 py-1.5">
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-chalk-2">
              {attachment.kind === "sticker" ? "Sticker prêt à envoyer" : "GIF prêt à envoyer"}
            </span>
            <button
              type="button"
              onClick={() => setAttachment(null)}
              aria-label="Retirer la pièce jointe"
              className="flex size-8 shrink-0 items-center justify-center rounded-full
                text-chalk-4 transition-colors hover:text-danger"
            >
              <Icon name="close" size={12} strokeWidth={2.2} />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <MessageAttachmentButtons
            disabled={!me || busy}
            onGif={(gif) => setAttachment({ kind: "gif", gif })}
          />
          <textarea
            ref={composerRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Entrée envoie, Maj+Entrée passe à la ligne : c'est le
              // comportement d'une zone de commentaire, pas celui d'un
              // formulaire, où Entrée valide le formulaire entier.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            maxLength={1000}
            aria-label="Écrire un commentaire"
            placeholder={me ? "Répondre…" : "Connecte-toi pour répondre"}
            disabled={!me}
            className="min-h-[42px] flex-1 resize-none rounded-[var(--radius-input)]
              border border-line-3 bg-surface px-3 py-2 text-[13.5px]
              leading-[1.55] text-chalk shadow-sh-1
              transition-[transform,box-shadow] placeholder:text-chalk-4
              focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_var(--color-signal)]
              disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!me || busy || !canSendMessage(text, attachment ?? undefined)}
            aria-label="Publier le commentaire"
            className="h-[42px] shrink-0 rounded-[var(--radius-chip)] border
              border-signal bg-signal px-3.5 font-mono text-[12px] font-bold
              tracking-[0.1em] text-void uppercase
              transition-[transform,opacity] duration-[var(--d-fast)]
              active:translate-y-px disabled:opacity-35"
          >
            <Icon name="send" size={14} />
          </button>
        </div>
      </form>

      {/* La limite est une information, pas une punition : elle n'apparaît
          qu'à partir de 80 %, sinon elle prendrait la place du texte. */}
      {text.length > 800 && (
        <p className="tnum mt-1 text-right font-mono text-[10.5px] text-warn">
          {text.length}/1000
        </p>
      )}
    </>
  );

  if (variant === "docked") {
    if (!open || postId === null) return null;
    return (
      <aside
        aria-label="Commentaires"
        className="sticky top-[calc(var(--h-topbar)+var(--h-banner,0px)+12px)] hidden
          max-h-[calc(100dvh-var(--h-topbar)-var(--h-banner,0px)-1.5rem)] w-80 shrink-0 flex-col
          overflow-hidden rounded-panel border border-line-2 bg-surface shadow-sh-2 xl:flex"
      >
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-chalk-3">
            Commentaires
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer les commentaires"
            className="flex size-8 items-center justify-center rounded-full text-chalk-4
              transition-colors hover:text-chalk"
          >
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-3">{body}</div>
      </aside>
    );
  }

  return (
    <Sheet open={open && postId !== null} onClose={onClose} title="Commentaires">
      {body}
    </Sheet>
  );
}
