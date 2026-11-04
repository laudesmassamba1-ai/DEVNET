"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AppShell, IconButton } from "@/components/AppShell";
import { Avatar, EmptyState, Loading, PrimaryButton } from "@/components/Avatar";
import { CommentsPanel } from "@/components/CommentsPanel";
import { Icon } from "@/components/Icon";
import { Motion } from "@/components/Motion";
import { PostCard } from "@/components/PostCard";
import { PostOwnerTools } from "@/components/PostOwnerTools";
import { useSession } from "@/hooks/useSession";
import { usePostActions } from "@/hooks/usePostActions";
import { fetchLikedPostIds } from "@/lib/social";
import { postsByTag, searchPeople, searchPosts, searchTags } from "@/lib/search";
import type { PostWithAuthor, UserLite } from "@/lib/types";

/**
 * Découverte.
 *
 * Trois onglets, et le choix est délibéré : une recherche qui mélange
 * gens et publications dans une seule liste force à lire le résultat
 * pour deviner ce qu'on a trouvé. Séparés, chacun répond à une question
 * distincte — « qui existe ? », « qu'ont-ils écrit ? », « de quoi
 * parlent-ils ? » — et un résultat vide n'est plus ambigu.
 *
 * On ne propose **pas** de page « Explorer » façon Instagram. Ce n'est pas
 * un réseau d'images : ce qu'un étudiant cherche ici, c'est des gens et
 * des idées, pas du contenu à faire défiler.
 */

type Tab = "people" | "posts" | "tags";

const TABS: [Tab, string, "groups" | "feed" | "hash"][] = [
  ["people", "Personnes", "groups"],
  ["posts", "Posts", "feed"],
  ["tags", "Tags", "hash"],
];

/**
 * Retarde la frappe.
 *
 * Une recherche à chaque lettre enverrait une requête par caractère, et
 * les réponses arriveraient dans le désordre : un résultat pour « dev »
 * pourrait s'afficher après celui pour « devn ». Le délai laisse les
 * frappes se regrouper, et l'arrivée des résultats reste dans l'ordre.
 */
const DEBOUNCE_MS = 220;

function SearchScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { profile } = useSession();

  /** Le hashtag consulté quand on arrive par un lien `#tag` ou `/search?tag=`. */
  const initialTag = params.get("tag") ?? "";
  const [tab, setTab] = useState<Tab>(initialTag ? "posts" : "people");
  const [query, setQuery] = useState(params.get("q") ?? "");
  /** Ce qui est réellement cherché : la frappe, moins le délai. */
  const [term, setTerm] = useState("");
  /** Tag affiché à la place d'une recherche, quand on arrive par un lien. */
  const [tag, setTag] = useState(initialTag.replace(/^#/, ""));

  const [people, setPeople] = useState<UserLite[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [posts, setPosts] = useState<PostWithAuthor[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[] | null>(null);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<string[]>([]);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);

  /**
   * Numéro de la recherche en cours.
   *
   * Deux réponses peuvent revenir dans le désordre — « dev » avant
   * « devnet » si la première requête traîne. On ignore toute réponse qui
   * n'est pas la plus récente, sinon la liste afficherait un résultat
   * périmé sous la frappe courante.
   */
  const searchSeq = useRef(0);

  const postActions = usePostActions({
    meId: profile?.id,
    onDeleted: () => search(),
    onUpdated: () => search(),
  });

  // Retard de frappe. Le minuteur est remis à zéro à chaque frappe, donc
  // seule la dernière déclenche la recherche.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  /**
   * La requête, selon l'onglet.
   *
   * Tout est regroupé ici pour que les trois onglets ne puissent pas
   * diverger sur la condition de recherche — un onglet qui chercherait
   * dans une colonne de plus serait un bug silencieux.
   */
  const search = useCallback(async () => {
    const seq = ++searchSeq.current;

    if (tab === "people") {
      if (!term) {
        setPeople([]);
        setPeopleError(null);
        setPeopleLoading(false);
        return;
      }
      setPeopleLoading(true);
      setPeopleError(null);
      const { data, error } = await searchPeople(term);
      if (seq !== searchSeq.current) return;
      setPeople(data);
      setPeopleError(error);
      setPeopleLoading(false);
      return;
    }

    if (tab === "posts") {
      // Un hashtag affiché prime la saisie : les deux se contrediraient.
      const byTag = !term && tag.length > 0;
      if (!term && !byTag) {
        setPosts([]);
        setPostsError(null);
        setPostsLoading(false);
        return;
      }
      setPostsLoading(true);
      setPostsError(null);
      const { data, error } = byTag ? await postsByTag(tag) : await searchPosts(term);
      if (seq !== searchSeq.current) return;
      setPosts(data);
      setPostsError(error);
      setPostsLoading(false);
      if (!error && profile && data.length > 0) {
        setLikedIds(await fetchLikedPostIds(profile.id, data.map((r) => r.id)));
      }
    }
    // Les tags ne dépendent pas de la saisie : on les compte une fois.
  }, [tab, term, tag, profile]);

  useEffect(() => {
    void search();
  }, [search]);

  // Les hashtags les plus utilisés, au chargement et à l'ouverture de
  // l'onglet : c'est la seule chose que la recherche propose sans qu'on
  // ait encore rien tapé.
  const loadTags = useCallback(async () => {
    setTags(null);
    setTagsError(null);
    const { data, error } = await searchTags();
    setTags(data);
    setTagsError(error);
  }, []);

  useEffect(() => {
    void (async () => {
      await loadTags();
    })();
  }, [loadTags, tab]);

  /** Rejouer la recherche en échec — le bouton des états d'erreur. */
  const retry = useCallback(() => {
    if (tab === "tags") void loadTags();
    else void search();
  }, [tab, loadTags, search]);

  /** Ouvrir un hashtag : on bascule sur les posts et on fige le tag. */
  function openTag(next: string) {
    setTag(next);
    setQuery("");
    setTerm("");
    setTab("posts");
    router.replace(`/search?tag=${encodeURIComponent(next)}`, { scroll: false });
  }

  /** Revenir à une recherche libre : le tag lâché, la saisie rouverte. */
  function clearTag() {
    setTag("");
    router.replace("/search", { scroll: false });
  }

  const resultCount = useMemo(() => {
    if (tab === "people") return people.length;
    if (tab === "posts") return posts.length;
    return tags?.length ?? 0;
  }, [tab, people, posts, tags]);

  /** La frappe attend encore son minuteur : la recherche n'est pas lancée. */
  const typing = query.trim() !== term;

  // « Chargement » a trois causes : la requête est en vol, ou la frappe
  // n'a pas encore été validée alors qu'un terme existe. On ne montre
  // jamais l'état vide d'un onglet qu'on n'a pas encore cherché.
  const peopleBusy = peopleLoading || (typing && term === "" && query.trim() !== "");
  const postsBusy = postsLoading || (typing && term === "" && query.trim() !== "" && !tag);

  return (
    <AppShell
      title="Recherche"
      path="~/recherche"
      action={<IconButton label="Profil" name="profile" onClick={() => router.push("/profile")} />}
    >
      <div className="px-(--gutter) pt-3">
        {/* ── Champ de saisie ──
            Le prompt `$` n'est pas décoratif : c'est le même langage que
            le reste de l'application, et il rappelle qu'on tape une
            requête. Le champ se vide d'un clic — un champ de recherche
            qu'on ne peut pas vider oblige à tout effacer à la main,
            lettre par lettre, entre deux essais. */}
        <Motion role="rise" delay={0}>
          <div className="relative mb-3">              <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-signal"
              style={{ textShadow: "0 0 12px rgba(255,138,61,0.5)" }}
            >
              $
            </span>
            <input
              type="search"
              value={tag && !query ? tag : query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (tag) clearTag();
              }}
              placeholder="pseudo, idée, #hashtag…"
              aria-label="Rechercher"
              data-tour="search-input"
              autoFocus
              className="h-[var(--h-tap)] w-full rounded-[var(--radius-input)] border
                border-line-3 bg-surface pr-10 pl-8 text-[14px] shadow-sh-1 outline-none
                transition-[transform,box-shadow] duration-[var(--d-base)]
                ease-[var(--ease-spring)] placeholder:text-chalk-4
                focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_var(--color-signal)]"
            />
            {(query || tag) && (
              <button
                type="button"
                aria-label="Effacer"
                onClick={() => {
                  setQuery("");
                  clearTag();
                }}
                className="absolute top-1/2 right-2 flex size-9 -translate-y-1/2 items-center
                  justify-center text-chalk-4 transition-colors hover:text-signal"
              >
                <Icon name="close" size={14} strokeWidth={2} />
              </button>
            )}
          </div>
        </Motion>

        {/* Le hashtag consulté, quand on est arrivé par un lien. */}
        {tag && (
          <Motion role="rise">
            <p className="mb-3 flex items-center gap-2 font-mono text-[12px] text-chalk-3">
              <Icon name="hash" size={12} className="text-signal" />
              publications étiquetées
              <span className="text-signal">#{tag}</span>
              <button
                type="button"
                onClick={clearTag}
                className="ml-auto text-chalk-4 underline-sweep hover:text-chalk"
              >
                revenir à la recherche
              </button>
            </p>
          </Motion>
        )}

        {/* ── Onglets ──
            Trois segments égaux. Le nombre de résultats suit l'onglet
            actif, et il est annoncé : sans lui, un onglet qui ne rend
            rien ne se distingue pas d'un onglet qui n'a pas été cherché. */}
        <div
          role="tablist"
          aria-label="Type de résultat"
          data-tour="search-tabs"
          className="mb-3 flex gap-0 border-b border-line-2"
        >
          {TABS.map(([value, label, icon]) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`-mb-0.5 flex items-center gap-1.5 tab-underline px-3 py-2
                font-mono text-[11.5px] font-bold uppercase tracking-[0.12em]
                transition-colors duration-[var(--d-fast)]
                ${tab === value
                  ? "text-signal"
                  : "text-chalk-4 hover:text-chalk-2"}`}
            >
              <Icon name={icon} size={12} />
              {label}
              {value === tab && resultCount > 0 && (
                <span className="tnum text-chalk-3">{resultCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Personnes ── */}
        {tab === "people" && peopleBusy && people.length === 0 && (
          <Loading label="Recherche" />
        )}

        {tab === "people" && !peopleBusy && peopleError && (
          <SearchError message={peopleError} onRetry={retry} />
        )}

        {tab === "people" && !peopleBusy && !peopleError && term === "" && (
          <EmptyState
            icon={<Icon name="search" size={20} strokeWidth={1.5} />}
            title="Cherche quelqu'un"
            hint="Tape un pseudo ou un prénom pour trouver un compte."
          />
        )}

        {tab === "people" && !peopleBusy && !peopleError && term !== "" && people.length === 0 && (
          <EmptyState
            icon={<Icon name="groups" size={20} strokeWidth={1.5} />}
            title="Personne ne correspond"
            hint={`Aucun compte pour « ${term} ».`}
          />
        )}

        {tab === "people" && !peopleError && people.map((u, i) => (
          <Motion key={u.id} role="rise" delay={Math.min(i * 40, 320)}>
            <button
              type="button"
              onClick={() => router.push(`/u/${u.pseudo}`)}
              className="mb-2 flex w-full items-center gap-3 border border-line-2 bg-surface
                px-3.5 py-3 text-left shadow-sh-1 transition-colors
                hover:border-signal"
            >
              <Avatar name={u.prenom} color={u.avatar_color} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-display text-[15px] font-bold text-chalk">
                    {u.prenom}
                  </span>
                  {u.verified && (
                    <span className="label-micro inline-flex items-center gap-1 text-signal">
                      <Icon name="verified" size={11} />
                      vérifié
                    </span>
                  )}
                </span>
                <span className="block truncate font-mono text-[12px] text-chalk-4">
                  @{u.pseudo}
                  {u.filiere ? ` · ${u.filiere}` : ""}
                </span>
              </span>
              <Icon name="chevron-right" size={14} className="shrink-0 text-chalk-4" />
            </button>
          </Motion>
        ))}

        {/* ── Publications ── */}
        {tab === "posts" && postsBusy && posts.length === 0 && (
          <Loading label="Recherche" />
        )}

        {tab === "posts" && !postsBusy && postsError && (
          <SearchError message={postsError} onRetry={retry} />
        )}

        {tab === "posts" && !postsBusy && !postsError && term === "" && !tag && (
          <EmptyState
            icon={<Icon name="feed" size={20} strokeWidth={1.5} />}
            title="Cherche une publication"
            hint="Tape un mot, un extrait de code ou un #hashtag."
          />
        )}

        {tab === "posts" && !postsBusy && !postsError && (term !== "" || tag) && posts.length === 0 && (
          <EmptyState
            icon={<Icon name="feed" size={20} strokeWidth={1.5} />}
            title={tag ? `Rien pour #${tag}` : "Aucune publication"}
            hint={tag
              ? "Aucune publication ne porte encore ce hashtag."
              : `Aucune publication ne contient « ${term} ».`}
          />
        )}

        {tab === "posts" && !postsError && posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              meId={profile?.id ?? null}
              liked={likedIds.includes(p.id)}
              onOpenComments={setCommentsFor}
              onOpenProfile={(pseudo) => router.push(`/u/${pseudo}`)}
              isMine={postActions.isMine(p)}
              {...postActions.cardProps}
            />
          ))}

        {/* ── Hashtags ──
            C'est le seul onglet qui ait du contenu sans saisie : il
            répond à « de quoi parle ce réseau ? », ce qu'aucun autre écran
            ne montre. */}
        {tab === "tags" && (
          <>
            {tagsError && <SearchError message={tagsError} onRetry={retry} />}

            {!tagsError && tags === null && <Loading label="Comptage des tags" />}

            {!tagsError && tags?.length === 0 && (
              <EmptyState
                icon={<Icon name="hash" size={20} strokeWidth={1.5} />}
                title="Aucun hashtag pour l'instant"
              />
            )}

            <div className="flex flex-wrap gap-2">
              {tags?.map((t, i) => (
                <Motion key={t.tag} role="rise" delay={Math.min(i * 30, 300)}>
                  <button
                    type="button"
                    onClick={() => openTag(t.tag)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line-2 px-3 py-2 font-mono text-[12px]
                      text-chalk-2 transition-colors duration-[var(--d-fast)]
                      hover:border-signal hover:text-signal hover:shadow-[var(--shadow-sh-1)]"
                      style={{ background: "linear-gradient(135deg, var(--color-surface) 0%, var(--color-surface-2) 100%)" }}
                  >
                    <Icon name="hash" size={11} className="text-signal" />
                    {t.tag}
                    <span className="tnum text-chalk-4">{t.count}</span>
                  </button>
                </Motion>
              ))}
            </div>
          </>
        )}

        <PostOwnerTools actions={postActions} />

        <CommentsPanel
          postId={commentsFor}
          open={commentsFor !== null}
          onClose={() => setCommentsFor(null)}
          me={profile?.id ?? null}
          canModerate={posts?.find((p) => p.id === commentsFor)?.author_id === profile?.id}
        />
      </div>
    </AppShell>
  );
}

/**
 * Recherche en échec.
 *
 * Un échec n'est pas un résultat vide : on le dit, on montre la cause
 * quand le backend la donne, et on propose de rejouer la requête. Sans
 * ce message, une panne se lisait comme « personne ne correspond ».
 */
function SearchError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon={<Icon name="flag" size={20} strokeWidth={1.5} className="text-danger" />}
      title="Recherche impossible"
      hint={message}
      action={<PrimaryButton onClick={onRetry}>Réessayer</PrimaryButton>}
    />
  );
}

export default function SearchPage() {
  // `useSearchParams` force un rendu dynamique : la page est enveloppée
  // dans un `Suspense` pour que le gabarit statique puisse se construire
  // sans attendre la requête d'URL.
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <SearchScreen />
    </Suspense>
  );
}