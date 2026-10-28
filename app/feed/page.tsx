"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell, IconButton } from "@/components/AppShell";
import { Avatar, EmptyState, Loading, PrimaryButton, Spinner } from "@/components/Avatar";
import { CodeBlock } from "@/components/CodeBlock";
import { CommentsPanel } from "@/components/CommentsPanel";
import { Icon, asIconName } from "@/components/Icon";
import { Motion } from "@/components/Motion";
import { PostCard } from "@/components/PostCard";
import { PostOwnerTools } from "@/components/PostOwnerTools";
import { Sheet } from "@/components/Sheet";
import { groupStoriesByAuthor, StoryRail, StoryViewer } from "@/components/StoryRail";
import { useToast } from "@/components/Toast";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/hooks/useSession";
import { createPortal } from "react-dom";
import { postPoints } from "@/lib/gamification";
import {
  deleteStory,
  fetchLiveStories,
  publishStory,
  STORY_MAX,
} from "@/lib/stories";
import {
  fetchFeedPageCached as fetchFeedPage, fetchLikedPostIdsCached as fetchLikedPostIds,
  fetchMyReactionsCached as fetchMyReactions, fetchRepostIdsCached as fetchRepostIds,
  setReaction, toggleLike, toggleRepost, type FeedScope,
  invalidatePostCache,
} from "@/lib/social";
import { fetchBookmarkedPostIdsCached as fetchBookmarkedPostIds, toggleBookmark } from "@/lib/signets";
import { usePostActions } from "@/hooks/usePostActions";
import {
  fetchProjects,
  fetchProjectsForPosts,
  linkPostToProject,
} from "@/lib/repo";
import { removeSamplePosts, seedSamplePosts, SAMPLE_MARK } from "@/lib/seed";
import { fetchCommunityFeed } from "@/lib/communities";
import type { PostWithAuthor, StoryWithAuthor, UserLite } from "@/lib/types";

const LANG_OPTIONS = [
  "", "Python", "JavaScript", "TypeScript", "Java", "C / C++",
  "PHP", "Kotlin", "Dart", "Go", "Rust", "Swift", "SQL", "HTML/CSS",
];

/**
 * Brouillon de publication.
 *
 * Le composeur enregistre son état à chaque frappe et le récupère au
 * retour sur le fil : un post pensé, interrompu par une navigation, ne
 * se perd pas. La publication (ou la fermeture) vide le brouillon — un
 * post envoyé est un post parti.
 */
const DRAFT_KEY = "devnet:compose";

type ComposerDraft = { text: string; code: string; lang: string; isCode: boolean };

const EMPTY_DRAFT: ComposerDraft = { text: "", code: "", lang: "", isCode: false };

function readDraft(): ComposerDraft {
  if (typeof window === "undefined") return EMPTY_DRAFT;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return EMPTY_DRAFT;
    const d = JSON.parse(raw) as Partial<ComposerDraft>;
    return {
      text: typeof d.text === "string" ? d.text : "",
      code: typeof d.code === "string" ? d.code : "",
      lang: typeof d.lang === "string" ? d.lang : "",
      isCode: Boolean(d.isCode),
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

// `filiere` et `niveau` font partie de la jointure, et non des colonnes
// copiées du post : ces dernières sont figées à l'insertion, donc changer
// sa filière laisserait l'ancienne affichée sur tous ses anciens posts.
// Le fil lit l'auteur, il ne lit jamais une copie de l'auteur.
const AUTHOR_COLUMNS =
  "id, prenom, pseudo, avatar_color, account_type, verified, filiere, niveau";

/**
 * Fusionne une page relue avec la liste affichée, sans casser le défilement.
 *
 * `refresh()` est appelé après chaque like, réaction ou repost : remplacer
 * toute la liste par la première page repliait le fil sous les yeux du
 * lecteur. Ici, on conserve les lignes déjà affichées, on ajoute celles
 * qu'on ne connaissait pas encore, et on retrie comme le serveur — qu'un
 * post surgisse en tête ou disparaisse de la lecture ne déplace jamais ce
 * qu'on est en train de lire.
 */
function mergePosts(prev: PostWithAuthor[] | null, incoming: PostWithAuthor[]): PostWithAuthor[] {
  const byId = new Map((prev ?? []).map((p) => [p.id, p]));
  for (const p of incoming) if (!byId.has(p.id)) byId.set(p.id, p);
  return [...byId.values()].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  );
}

export default function FeedPage() {
  const { profile } = useSession();

  const toast = useToast();
  const router = useRouter();

  const [posts, setPosts] = useState<PostWithAuthor[] | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string>(() => readDraft().text);
  const [code, setCode] = useState<string>(() => readDraft().code);
  const [lang, setLang] = useState<string>(() => readDraft().lang);
  const [isCode, setIsCode] = useState<boolean>(() => readDraft().isCode);
  const [busy, setBusy] = useState(false);
  /** La bulle de rédaction est portée dans `document.body` : elle doit
      échapper aux `transform`/`backdrop-filter` des ancêtres, qui créent
      un bloc conteneur et casseraient son `position: fixed`. On ne la
      monte qu'après hydratation, sinon le portail n'a pas de cible. */
  const [fabReady, setFabReady] = useState(false);
  /** Auteur dont on regarde la série de stories. */
  const [storyOpen, setStoryOpen] = useState<string | null>(null);
  /** Les stories vivantes, lues dans la table — pas déduites du fil. */
  const [stories, setStories] = useState<StoryWithAuthor[] | null>(null);
  /** Feuille de publication d'une story. */
  const [openStoryCompose, setOpenStoryCompose] = useState(false);
  const [storyText, setStoryText] = useState("");
  const [seeding, setSeeding] = useState(false);
  /** Ids des posts aimés par l'utilisateur courant — lus à part, en une requête. */
  const [likedIds, setLikedIds] = useState<string[]>([]);
  /**
   * La réaction du lecteur sur chaque post, indexée par post.
   *
   * Une seule requête pour tout le fil, comme les likes : une requête
   * par carte aurait fait dépendre le rendu du nombre de publications.
   */
  const [reactions, setReactions] = useState<Record<string, string>>({});
  /** Ids des posts republiés par le lecteur. */
  const [repostedIds, setRepostedIds] = useState<string[]>([]);
  /** Ids des posts enregistrés dans les signets. */
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>([]);
  /** Post dont on ouvre le fil de commentaires. */
  const [commentsFor, setCommentsFor] = useState<string | null>(null);

  useEffect(() => setFabReady(true), []); // eslint-disable-line react-hooks/set-state-in-effect -- posé après le premier paint, c'est le signal d'animation

  /** Portée du fil : tout le monde, les abonnements, ou les communautés. */
  const [scope, setScope] = useState<FeedScope | "communities">("all");
  /** `created_at` du dernier post affiché — le curseur de la page suivante. */
  const [cursor, setCursor] = useState<string | null>(null);
  /** Reste-t-il des publications en dessous ? */
  const [hasMore, setHasMore] = useState(false);
  /** Le filtre Abonnements est actif mais ne suit personne. */
  const [emptyScope, setEmptyScope] = useState(false);
  /**
   * Génération du fil. Chaque changement de portée l'incrémente : les
   * réponses asynchrones d'une portée (lecture initiale, `loadMore`) qui
   * arrivent après coup sont écartées, pour ne jamais mélanger deux fils
   * différents.
   */
  const genRef = useRef(0);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Projets du lecteur, pour rattacher une publication à l'un d'eux. */
  const [myProjects, setMyProjects] = useState<{ id: string; name: string; emoji: string }[]>([]);
  /** Projet choisi dans la feuille de publication, `null` = aucun. */
  const [projectId, setProjectId] = useState<string | null>(null);
  /** Projet de chaque publication affichée, lu en une requête. */
  const [postProjects, setPostProjects] = useState<Map<string, { id: string; name: string; emoji: string }>>(
    new Map(),
  );

  /**
   * Recharge et remplace l'état — réservé aux actions déclenchées par
   * l'utilisateur.
   *
   * On relit plutôt que d'attendre le canal temps réel : `postgres_changes`
   * suppose que la table est ajoutée à la publication `supabase_realtime`,
   * ce qui n'est pas acquis sur un projet neuf. Un semis qui n'apparaît pas
   * fait croire à un échec — donc on lit, et le canal ne sert plus qu'à
   * actualiser les autres.
   */
  const refresh = useCallback(async () => {
    invalidatePostCache();
    // L'onglet Communautés a sa propre lecture : il ne lit que les posts
    // rattachés à une communauté publique ou restreinte, sans pagination.
    if (scope === "communities") {
      const rows = await fetchCommunityFeed();
      setEmptyScope(false);
      setPosts(rows);
      setHasMore(false);
      return;
    }
    const page = await fetchFeedPage({ scope, me: profile?.id });
    setEmptyScope(page.emptyScope);
    setPosts((prev) => mergePosts(prev, page.rows));
    setHasMore(page.more);
  }, [scope, profile]);

  /**
   * Page suivante, par curseur sur `created_at`.
   *
   * On **ajoute** sans remplacer : « charger plus » doit prolonger la
   * lecture, pas la recommencer sous les yeux de quelqu'un qui avait déjà
   *Raises le doigt sur la carte 12.
   */
  async function loadMore() {
    if (scope === "communities") return;
    if (!cursor || loadingMore) return;
    const gen = genRef.current;

    setLoadingMore(true);
    const page = await fetchFeedPage({ scope, me: profile?.id, before: cursor });
    setLoadingMore(false);
    if (genRef.current !== gen) return;

    setPosts((prev) => (prev === null ? prev : [...prev, ...page.rows]));
    setHasMore(page.more);

    // La page ajoutée est hydratée comme la première : likes, réactions,
    // reposts et signets du lecteur sont lus en une seule requête pour
    // toutes les cartes nouvelles. Sans cette ligne, la page 2 + arriverait
    // sans aucun état d'interaction — comme si on n'avait jamais rien aimé.
    const added = page.rows.map((r) => r.id);
    if (profile) {
      const [ids, reposts, mine, marks] = await Promise.all([
        fetchLikedPostIds(profile.id, added),
        fetchRepostIds(profile.id, added),
        fetchMyReactions(profile.id, added),
        fetchBookmarkedPostIds(profile.id, added),
      ]);
      if (genRef.current !== gen) return;
      setLikedIds((prev) => [...new Set([...prev, ...ids])]);
      setRepostedIds((prev) => [...new Set([...prev, ...reposts])]);
      setReactions((prev) => ({ ...prev, ...mine }));
      setBookmarkedIds((prev) => [...new Set([...prev, ...marks])]);
    }

    const projects = await fetchProjectsForPosts(added);
    if (genRef.current !== gen) return;
    setPostProjects((prev) => {
      const next = new Map(prev);
      for (const [postId, p] of projects) {
        next.set(postId, { id: p.id, name: p.name, emoji: p.emoji });
      }
      return next;
    });
    setCursor(page.rows.length ? page.rows[page.rows.length - 1].created_at : cursor);
  }

  /** Bascule entre « Tout », « Abonnements » et « Communautés ». */
  function setScopeAndReset(next: FeedScope | "communities") {
    setScope(next);
    setPosts(null);
    // Le curseur, le drapeau de fin et l'état « aucune personne suivie » de
    // l'ancienne portée ne décrivent plus rien : sans reset, « charger
    // plus » relirait la suite de l'autre fil à la volée, au mauvais
    // tri, et un scope vide continuerait d'afficher son bandeau.
    setCursor(null);
    setHasMore(false);
    setEmptyScope(false);
    // La génération invalide les réponses en vol de l'ancienne portée :
    // un `loadMore` parti avant le changement ne doit pas garnir le fil
    // du nouveau scope avec les lignes de l'ancien.
    genRef.current += 1;
  }

  /**
   * Modification et suppression.
   *
   * Après une suppression, le fil est **relu** plutôt que filtré
   * localement : le serveur a aussi fait tomber les commentaires et les
   * likes, et les compteurs du reste du fil doivent refléter cet état.
   * Après une modification, en revanche, on ne touche qu'à la ligne
   * concernée : le post garde sa place, son ordre, et les compteurs de ses
   * voisins ne scintillent pas sous les yeux du lecteur.
   */
  const postActions = usePostActions({
    meId: profile?.id,
    onDeleted: (postId) => {
      // Le post retiré s'efface tout de suite ; le reste du fil se relit
      // pour que les compteurs des autres cartes reflètent ce qui est
      // parti (le serveur supprime aussi commentaires et likes).
      setPosts((prev) => (prev === null ? prev : prev.filter((p) => p.id !== postId)));
      void refresh();
    },
    onUpdated: (postId, text) =>
      setPosts((prev) =>
        prev === null ? prev : prev.map((p) => (p.id === postId ? { ...p, text } : p)),
      ),
  });

  // Le composeur se sauvegarde à chaque frappe. `resetSheet` (publication
  // ou fermeture) remet tout à vide : l'effet écrit alors un brouillon
  // vide, c'est-à-dire qu'il efface le précédent.
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, code, lang, isCode }));
    } catch {
      // Stockage indisponible (navigation privée, quota) : on compose
      // sans filet, jamais on ne bloque la saisie pour un brouillon.
    }
  }, [text, code, lang, isCode]);

  const draftRestored = useRef<boolean | null>(null);
  if (draftRestored.current === null) {
    const d = readDraft();
    draftRestored.current = Boolean(d.text.trim() || d.code.trim());
  }
  const announcedDraft = useRef(false);
  useEffect(() => {
    if (announcedDraft.current) return;
    announcedDraft.current = true;
    if (draftRestored.current) toast("Brouillon restauré");
  }, [toast]);

  // Les projets du lecteur sont lus une fois, au montage : le sélecteur
  // de la feuille de publication en a besoin, et le profil public les
  // affiche séparément.
  useEffect(() => {
    if (!profile) return;

    let alive = true;
    void fetchProjects(profile.id).then((rows) => {
      if (alive) setMyProjects(rows.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji })));
    });

    return () => {
      alive = false;
    };
  }, [profile]);

  useEffect(() => {
    let alive = true;
    const gen = genRef.current;

    // Vider le fil **après** le rendu, via la mise à jour asynchrone :
    // `setPosts(null)` au corps de l'effet faisait double rendu à chaque
    // changement de portée (« cascading render » signalé par le linter).
    // La lecture asynchrone remplace naturellement les anciens posts —
    // aucun état intermédiaire vide à figer par un second rendu.
    // `rowsFor` isole la seule différence entre les portées : la source.
    // L'onglet Communautés ne lit que les posts rattachés à une communauté
    // publique ou restreinte, sans pagination ; les autres portées lisent
    // `fetchFeedPage` avec son curseur. L'hydratation qui suit est commune.
    const rowsFor = async (): Promise<PostWithAuthor[] | null> => {
      if (scope === "communities") {
        const rows = await fetchCommunityFeed();
        if (!alive || genRef.current !== gen) return null;
        setEmptyScope(false);
        setHasMore(false);
        setCursor(null);
        return rows;
      }
      const page = await fetchFeedPage({ scope, me: profile?.id });
      if (!alive || genRef.current !== gen) return null;
      setEmptyScope(page.emptyScope);
      setHasMore(page.more);
      setCursor(page.rows.length ? page.rows[page.rows.length - 1].created_at : null);
      return page.rows;
    };

    rowsFor().then(async (rows) => {
      if (!alive || genRef.current !== gen || !rows) return;
      setPosts(rows);
      // Les likes de l'utilisateur courant sont lus dans la foulée, en une
      // seule requête pour tout le fil. Le champ `liked_by` du post ne peut
      // plus servir : le like est une ligne dans `post_likes`, et il
      // appartient à celui qui regarde, pas au post.
      if (profile) {
        const pageIds = rows.map((r) => r.id);
        const [ids, reposts, mine, marks] = await Promise.all([
          fetchLikedPostIds(profile.id, pageIds),
          fetchRepostIds(profile.id, pageIds),
          fetchMyReactions(profile.id, pageIds),
          fetchBookmarkedPostIds(profile.id, pageIds),
        ]);
        if (!alive || genRef.current !== gen) return;
        setLikedIds(ids);
        setRepostedIds(reposts);
        setReactions(mine);
        setBookmarkedIds(marks);
      }
      // Les projets des publications sont lus dans la foulée : une
      // requête pour tout le fil, jamais une par carte.
      const projects = await fetchProjectsForPosts(rows.map((r) => r.id));
      if (!alive || genRef.current !== gen) return;
      setPostProjects(
        new Map(
          [...projects].map(([postId, p]) => [
            postId,
            { id: p.id, name: p.name, emoji: p.emoji },
          ]),
        ),
      );
    });
    return () => {
      alive = false;
    };
  }, [scope, profile]);

  // Temps réel : nouveaux posts + mises à jour (likes)
  useEffect(() => {
    const channel = supabase
      .channel("feed")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        async ({ new: p }: { new: PostWithAuthor }) => {
          // Le temps réel n'annonce un post que s'il appartient à la
          // portée active : sous « Abonnements », un post d'un inconnu
          // n'a rien à faire dans le fil — l'afficher contredirait le
          // filtre que le lecteur vient de poser.
          if (scope !== "all") return;
          const { data: author } = await supabase
            .from("users")
            .select(AUTHOR_COLUMNS)
            .eq("id", p.author_id)
            .single();

          setPosts((prev) =>
            prev === null ? prev : [{ ...(p as PostWithAuthor), author: author as UserLite },
              ...prev.filter((x: PostWithAuthor) => x.id !== p.id)],
          );
        })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "posts" },
        ({ new: p }: { new: Partial<PostWithAuthor> }) => {
          setPosts((prev) =>
            prev?.map((x: PostWithAuthor) =>
              x.id === p.id ? { ...x, ...p } : x) ?? null,
          );
        })
      .subscribe();

    return () => {
      // `removeChannel` ferme et retire le canal : `unsubscribe` seul le
      // laisse dans le client, et le prochain `channel("feed")` renverrait
      // l'instance déjà abonnée — `.on()` lèverait alors.
      void supabase.removeChannel(channel);
    };
  }, [scope]);

  /**
   * Les stories.
   *
   * Elles ne sont **pas** déduites du fil : une story est une ligne de
   * `stories` (migration 018), avec sa propre échéance. On la lit ici en
   * une requête, ce qui garantit qu'une story publiée apparaît sans
   * qu'une publication en crée une par accident — les deux objets sont
   * distincts, et c'est le sens de la migration.
   */
  const refreshStories = useCallback(async () => {
    setStories(await fetchLiveStories());
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await fetchLiveStories();
      if (alive) setStories(rows);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Ouverture directe depuis un lien partagé : /feed?story=<auteur>.
  // Lien court, lisible, et le lecteur sait lequel ouvrir sans état
  // supplémentaire à synchroniser entre deux pages.
  useEffect(() => {
    const author = new URLSearchParams(window.location.search).get("story");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lu avant le premier paint (lien partagé), sinon un flash place l'écran sur la story
    if (author) setStoryOpen(author);
  }, []);

  /** Les stories de l'auteur ouvert, en ordre chronologique de lecture. */
  const openStories = useMemo(
    () =>
      storyOpen
        ? (groupStoriesByAuthor(stories ?? []).find((g) => g.authorId === storyOpen)?.items ?? [])
        : [],
    [stories, storyOpen],
  );

  /**
   * Le compte possède-t-il des exemples ?
   *
   * On le déduit du fil déjà chargé plutôt que d'une requête dédiée : le
   * marqueur est dans le texte, la réponse ne peut donc pas diverger de ce
   * qu'on affiche, et on économise un aller-retour sur chaque page.
   */
  const hasSamples = useMemo(
    () => (posts ?? []).some((p) => p.text.startsWith(SAMPLE_MARK)),
    [posts],
  );


  /**
   * Publie le jeu d'exemple.
   *
   * Sur un backend neuf, le fil est vide et rien ne se passe — on ne peut
   * ni juger l'application, ni voir sa propre progression. Cette action
   * écrit de vraies lignes, autorisées par la RLS (elles appartiennent au
   * compte courant), et se supprime d'un clic.
   */
  async function seed() {
    if (!profile) return;
    setSeeding(true);
    try {
      const n = await seedSamplePosts(profile);
      await refresh();
      toast(`${n} publications d'exemple ajoutées`);
    } catch (e) {
      toast(`Échec : ${e instanceof Error ? e.message : "inconnu"}`, "err");
    } finally {
      setSeeding(false);
    }
  }

  async function unseed() {
    if (!profile) return;
    setSeeding(true);
    try {
      const n = await removeSamplePosts(profile);
      await refresh();
      toast(`${n} publication(s) retirée(s)`);
    } catch (e) {
      toast(`Échec : ${e instanceof Error ? e.message : "inconnu"}`, "err");
    } finally {
      setSeeding(false);
    }
  }

  function resetSheet() {
    setOpen(false);
    setText("");
    setCode("");
    setLang("");
    setIsCode(false);
    // Le projet choisi ne survit pas à la publication : le rattachement
    // est une décision par publication, pas une préférence. Le garder
    // ferait rattacher par automatisme des publications sans rapport.
    setProjectId(null);
  }

  async function publish() {
    if (!profile) return;
    const body = text.trim();
    if (!body) return toast("Écris quelque chose", "err");

    setBusy(true);
    // On relit la ligne insérée : il faut son identifiant pour la
    // rattacher à un projet. Une publication sans projet reste possible —
    // le rattachement est une information, pas une obligation.
    const { data: created, error } = await supabase
      .from("posts")
      .insert({
        author_id: profile.id,
        // Aucune donnée d'auteur n'est recopiée ici : `author:users(...)`
        // est la seule source de vérité. Les colonnes correspondantes
        // restent en base avec leur valeur par défaut, mais plus rien ne
        // les lit — un nom affiché ne peut plus être périmé.
        text: body,
        has_code: isCode && code.trim().length > 0,
        code: isCode ? code.trim() : "",
        lang: isCode ? lang : "",
      })
      .select("id")
      .single();

    setBusy(false);
    if (error) return toast(`Erreur : ${error.message}`, "err");

    const postId = (created as { id: string } | null)?.id;
    if (postId && projectId) {
      const { error: linkError } = await linkPostToProject(postId, projectId);
      // Le post existe déjà : un rattachement raté ne doit pas faire
      // croire que la publication a échoué. On le dit, on ne bloque rien.
      if (linkError) toast("Publié, mais le projet n'a pas pu être lié.", "err");
    }

    resetSheet();
    // On relit après la publication : le post publié doit apparaître **en
    // tête** tout de suite, même quand le canal temps réel n'est pas en
    // place (table absente de `supabase_realtime` sur un projet neuf) ou
    // quand la portée Abonnements ne le laisserait pas passer.
    void refresh();
    // Le score est annoncé au moment où il est gagné : c'est le seul
    // moment où un chiffre de progression a une valeur d'information.
    const gained = postPoints(isCode && code.trim().length > 0);
    toast(`Publié · +${gained} pts`);
  }

  /**
   * Like / unlike.
   *
   * Le compteur affiché est optimiste : il bouge tout de suite, puis on
   * recharge si l'écriture échoue. Sur réseau local ou en 4G, attendre
   * l'aller-retour avant de voir le cœur se remplir fait croire à un
   * clic raté. En cas d'erreur on **revient en arrière** — un compteur
   * qui reste menti ne vaut pas mieux qu'un délai de 300 ms.
   */
  async function onToggleLike(id: string) {
    if (!profile) return;

    const wasLiked = likedIds.includes(id);
    setLikedIds((prev) =>
      wasLiked ? prev.filter((x) => x !== id) : [...prev, id],
    );
    setPosts((prev) =>
      prev?.map((p) =>
        p.id === id ? { ...p, likes: Math.max(0, (p.likes ?? 0) + (wasLiked ? -1 : 1)) } : p,
      ) ?? null,
    );

    const { liked, error } = await toggleLike(id, profile.id);
    if (error) {
      // Retour arrière : l'interface ne doit jamais afficher un état
      // que la base n'a pas enregistré.
      setLikedIds((prev) =>
        wasLiked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id),
      );
      setPosts((prev) =>
        prev?.map((p) =>
          p.id === id
            ? { ...p, likes: Math.max(0, (p.likes ?? 0) + (wasLiked ? 1 : -1)) }
            : p,
        ) ?? null,
      );
      toast("Action impossible", "err");
      return;
    }

    // On se fie au retour de la base plutôt qu'à notre prévision, et on
    // relit le compteur réel : le déclencheur fait foi.
    setLikedIds((prev) =>
      liked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id),
    );
    void refresh();
  }

  /**
   * Réaction : on pose, on remplace ou on retire.
   *
   * Comme le like, l'écriture est optimiste et revient en arrière si la
   * base refuse. Le compteur, lui, n'est pas deviné : il se relit sur la
   * publication après coup, parce que c'est le déclencheur qui fait foi.
   */
  async function onReact(id: string, emoji: string | null) {
    if (!profile) return;

    const before = reactions[id] ?? null;
    setReactions((prev) => {
      const next = { ...prev };
      if (emoji) next[id] = emoji;
      else delete next[id];
      return next;
    });

    const { error } = await setReaction(id, profile.id, emoji);
    if (error) {
      setReactions((prev) => {
        const next = { ...prev };
        if (before) next[id] = before;
        else delete next[id];
        return next;
      });
      toast("Réaction impossible", "err");
      // « Retirer puis poser » n'est pas atomique : si la pose a échoué
      // après le retrait, la base n'a plus de réaction alors que l'écran
      // en affiche encore une. On se resynchronise sur la vérité.
      void refresh();
      return;
    }

    void refresh();
  }

  /** Repost : le post rejoint le fil du lecteur, source conservée. */
  async function onRepost(id: string) {
    if (!profile) return;

    const wasReposted = repostedIds.includes(id);
    setRepostedIds((prev) =>
      wasReposted ? prev.filter((x) => x !== id) : [...prev, id],
    );

    const { reposted, error } = await toggleRepost(id, profile.id);
    if (error) {
      setRepostedIds((prev) =>
        wasReposted ? [...new Set([...prev, id])] : prev.filter((x) => x !== id),
      );
      toast("Repub impossible", "err");
      return;
    }

    setRepostedIds((prev) =>
      reposted ? [...new Set([...prev, id])] : prev.filter((x) => x !== id),
    );
    toast(reposted ? "Republié dans votre fil" : "Republié retiré");
    void refresh();
  }

  /**
   * Signet : garder une publication pour soi.
   *
   * Aucun toast de confirmation ici, contrairement au repost : le
   * bouton se remplit et s'éclate, et c'est déjà une confirmation
   * visible sur la carte elle-même. Un second signal — un bandeau —
   * dirait deux fois la même chose, et le lecteur commence à ignorer
   * le premier des deux.
   */
  async function onBookmark(id: string) {
    if (!profile) return;

    const was = bookmarkedIds.includes(id);
    setBookmarkedIds((prev) =>
      was ? prev.filter((x) => x !== id) : [...prev, id],
    );

    const { bookmarked, error } = await toggleBookmark(id, profile.id);
    if (error) {
      setBookmarkedIds((prev) =>
        was ? [...new Set([...prev, id])] : prev.filter((x) => x !== id),
      );
      toast("Enregistrement impossible", "err");
      return;
    }

    setBookmarkedIds((prev) =>
      bookmarked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id),
    );
  }

  /**
   * Partager une publication, c'est partager **son adresse**, pas
   * « le fil, à la page trois ».
   *
   * `/feed#${id}` ouvrait un fil qui a changé de contenu depuis : le
   * lien ne promettait rien de vérifiable. Depuis que `/post/[id]`
   * existe, c'est un lien permanent — le seul qu'on peut coller dans
   * une discussion sans s'exposer à avoir raison par hasard.
   */
  // Partage géré par PostShareButton (fenêtre de sélection d'app)

  return (
    <AppShell
      path="~/fil"
      action={
        <IconButton label="Mon profil" name="profile" onClick={() => router.push("/profile")} />
      }
    >
      {/* ── Scène du fil : quatre plans, quatre retards. ──
          Le rail de contributions, la zone de rédaction, le bandeau
          d'exemple puis les cartes. L'ordre suit l'ordre de lecture :
          on voit QUI est actif, puis ce qu'on peut écrire, puis ce qui
          a été écrit. Le fil lui-même est produit par la cascade du PostCard. */}
      <div className="px-(--gutter) pt-3">
        <Motion role="slide" delay={60} attrs={{ "data-tour": "feed-stories" }}>
          <StoryRail
            stories={stories ?? []}
            me={profile?.id ?? null}
            onOpen={(authorId) => setStoryOpen(authorId)}
            onPublish={profile ? () => setOpenStoryCompose(true) : undefined}
          />
        </Motion>

        {/* ── Zone de rédaction ──
            Le composeur ne vit plus dans le flux du fil : il est devenu
            une **bulle de verre flottante** (`BulleRédaction`, plus bas),
            toujours visible pendant le défilement. La feuille « Nouveau
            post » reste le lieu où l'on écrit — texte, code et projet. */}

        {posts !== null && hasSamples && (
          <Motion
            role="slide"
            delay={420}
            className="mb-3 flex items-center gap-2 border border-dashed
              border-line-2 bg-surface/60 px-3 py-2"
          >
            <Icon name="package" size={14} strokeWidth={1.8} className="shrink-0 text-chalk-4" />
            <p className="label-micro min-w-0 flex-1 leading-[1.5] text-chalk-4">
              Jeu d&apos;exemple — ne compte pas dans le score.
            </p>
            <button
              type="button" onClick={unseed} disabled={seeding}
              className="label-micro shrink-0 border border-line-2 px-2 py-1
                text-chalk-3 transition-colors hover:border-danger hover:text-danger
                disabled:opacity-40"
            >
              retirer
            </button>
          </Motion>
        )}

        {/* ── Portée du fil ──
            Deux vues, un même emplacement. Le sélecteur ne porte que ça :
            une recherche ou un tri resteraient ici, et ce bandeau n'a pas
            la place de les héberger. Ils ont leur propre écran. */}
        <Motion role="fade" delay={40}>
          <div
            role="tablist"
            aria-label="Portée du fil"
            data-tour="feed-scope"
            className="mb-3 flex gap-0 border-b border-line-2"
          >
            {([
              ["all", "Tout"],
              ["followed", "Abonnements"],
              ["communities", "Communautés"],
            ] as [FeedScope | "communities", string][]).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                type="button"
                aria-selected={scope === value}
                onClick={() => setScopeAndReset(value)}
                className={`-mb-0.5 flex min-h-[var(--h-tap)] items-center tab-underline px-3.5 py-2 font-mono text-[11.5px]
                  font-bold uppercase tracking-[0.12em] transition-colors
                  duration-[var(--d-fast)]
                  ${scope === value
                    ? "text-signal"
                    : "text-chalk-4 hover:text-chalk-2"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </Motion>

        {posts === null && <Loading label="Chargement du fil" />}

        {/* Filtre actif mais personne suivi : ce n'est pas un fil vide,
            c'est un fil qu'on ne peut pas encore remplir. L'écran doit
            proposer l'action qui le rendrait non vide — suivre quelqu'un
            depuis un profil — au lieu d'afficher un vide qui n'explique
            rien. */}
        {posts?.length === 0 && emptyScope && (
          <Motion role="scale" delay={200}>
            <EmptyState
              icon={<Icon name="follow" size={20} strokeWidth={1.5} />}
              title="Vous ne suivez personne"
              action={
                <PrimaryButton icon="search" onClick={() => router.push("/search")}>
                  Trouver des gens
                </PrimaryButton>
              }
            />
          </Motion>
        )}

        {posts?.length === 0 && !emptyScope && (
          <Motion role="scale" delay={200}>
            <EmptyState
              icon={<Icon name="terminal" size={20} strokeWidth={1.5} />}
              title="Le fil est vide"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <PrimaryButton icon="send" onClick={() => setOpen(true)}>
                    Publier
                  </PrimaryButton>
                  <button
                    type="button"
                    onClick={seed}
                    disabled={seeding}
                    className="inline-flex h-[var(--h-tap)] items-center gap-2
                      rounded-[var(--radius-input)] border border-line-2 px-4
                      text-[12.5px] font-bold text-chalk-3 transition-colors
                      hover:border-signal hover:text-signal disabled:opacity-40"
                  >
                    <Icon name="package" size={14} strokeWidth={2} />
                    <span aria-hidden={seeding || undefined}>
                      {seeding ? <Spinner /> : null}
                    </span>
                    {seeding ? null : "Jeu d'exemple"}
                  </button>
                </div>
              }
            />
          </Motion>
        )}

        {/* Charger la suite. Un bouton explicite plutôt qu'un défilement
            infini : ici, le fil est un **dossier** qu'on parcourt, pas un
            mur qu'on défile. Un défilement automatique continuerait de
            consummer du réseau sans que le lecteur l'ait demandé, et
            sur ce plan de travail le contexte compte plus que la fluidité. */}
        {posts && posts.length > 0 && hasMore && (
          <Motion role="fade">
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}                  className="inline-flex h-[var(--h-tap)] items-center gap-2
                    rounded-[var(--radius-input)] border border-line-2
                    px-4 font-mono text-[11.5px] font-bold uppercase
                    tracking-[0.12em] text-chalk-3 transition-colors
                    duration-[var(--d-fast)]
                    hover:border-signal hover:text-signal disabled:opacity-40"
              >
                <span aria-hidden={loadingMore || undefined}>
                  {loadingMore ? <Spinner /> : null}
                </span>
                {loadingMore ? null : "Charger plus"}
              </button>
            </div>
          </Motion>
        )}

        {/* Le fil : cascade plafonnée. Chaque carte porte son rang, et le
            retard est calculé dans PostCard pour que la logique reste avec
            l'élément qu'elle anime. */}
        {posts?.map((p, i) => (
          <PostCard
            key={p.id}
            post={p}
            meId={profile?.id ?? null}
            index={i}
            liked={likedIds.includes(p.id)}
            reaction={reactions[p.id] ?? null}
            onReact={onReact}
            reposted={repostedIds.includes(p.id)}
            onRepost={onRepost}
            bookmarked={bookmarkedIds.includes(p.id)}
            onBookmark={onBookmark}
            onToggleLike={onToggleLike}
            onOpenComments={setCommentsFor}
            onOpenProfile={(pseudo) => router.push(`/u/${pseudo}`)}
            project={postProjects.get(p.id) ?? null}
            onOpenProject={(projectId) => router.push(`/projects/${projectId}`)}
            isMine={postActions.isMine(p)}
            {...postActions.cardProps}
          />
        ))}

      <PostOwnerTools actions={postActions} />

      <CommentsPanel
        postId={commentsFor}
        open={commentsFor !== null}
        onClose={() => setCommentsFor(null)}
        me={profile?.id ?? null}
        canModerate={
          commentsFor !== null &&
          posts?.find((p) => p.id === commentsFor)?.author_id === profile?.id
        }
      />
      </div>

      <Sheet open={open} onClose={resetSheet} title="Nouveau post">
        <textarea
          value={text} onChange={(e) => setText(e.target.value)}
          rows={4} placeholder="Rédigez votre publication"
          className="mb-3 w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3.5 py-3
            text-[14px] leading-[1.6] shadow-sh-1 outline-none
            transition-[transform,box-shadow] placeholder:text-chalk-4
            focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_#FF8A3D]"
        />

        <label className="mb-3 flex cursor-pointer items-center gap-2 text-[12.5px] text-chalk-3">
          <input
            type="checkbox" checked={isCode}
            onChange={(e) => setIsCode(e.target.checked)}
            className="size-3.5 accent-signal"
          />
          Ajouter un snippet de code
        </label>

        {isCode && (
          <>
            <div className="mb-4">
              <label className="label mb-1.5 block text-chalk">Langage</label>
              <select
                value={lang} onChange={(e) => setLang(e.target.value)}
                className="h-[var(--h-input)] w-full cursor-pointer
                  rounded-[var(--radius-input)] border border-line-3 bg-surface
                  px-3.5 text-[14px] shadow-sh-1 outline-none"
              >
                {LANG_OPTIONS.map((l) => (
                  <option key={l} value={l}>{l || "Sélectionner…"}</option>
                ))}
              </select>
            </div>
            <div className="mb-4">
              <label className="label mb-1.5 block text-chalk">Code</label>
              {/* Aperçu en direct : on voit la coloration avant de publier. */}
              {code.trim() && (
                <div className="mb-3">
                  <CodeBlock code={code.trim()} lang={lang} variant="paper" maxHeight={260} />
                </div>
              )}
              <textarea
                value={code} onChange={(e) => setCode(e.target.value)} rows={7}
                placeholder="// Ton code ici…"
                className="w-full rounded-[var(--radius-input)] border border-line-3
                  bg-surface-2 px-3.5 py-3 font-mono text-[var(--text-code)]
                  leading-[var(--lh-code)] shadow-sh-1 outline-none
                  placeholder:text-chalk-4"
              />
            </div>
          </>
        )}

        {/* ── Rattachement à un projet ──
            Facultatif, et explicite : une publication n'appartient pas
            forcément à un dépôt. Mais quand elle en vient, le dire change
            la lecture — la carte affiche alors le projet, et quelqu'un
            qui tombe dessus peut ouvrir le code.

            Rien ne s'affiche si le compte n'a aucun projet : on ne propose
            pas de lien vers une liste vide. */}
        {myProjects.length > 0 && (
          <div className="mb-4">
            <p className="prompt-label mb-2 text-chalk-2">
              projet <span className="text-chalk-4">— facultatif</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setProjectId(null)}
                aria-pressed={projectId === null}
                className={`inline-flex items-center gap-1.5 rounded-[var(--radius-chip)]
                  border px-2.5 py-1.5 font-mono text-[11.5px] transition-colors
                  duration-[var(--d-fast)]
                  ${projectId === null
                    ? "text-signal"
                    : "border-line-3 text-chalk-3 hover:text-chalk"}`}
              >
                aucun
              </button>

              {myProjects.map((pr) => (
                <button
                  key={pr.id}
                  type="button"
                  onClick={() => setProjectId(pr.id)}
                  aria-pressed={projectId === pr.id}
                  className={`inline-flex items-center gap-1.5 rounded-[var(--radius-chip)]
                    border px-2.5 py-1.5 font-mono text-[11.5px] transition-colors
                    duration-[var(--d-fast)]
                    ${projectId === pr.id
                      ? "text-signal"
                      : "border-line-3 text-chalk-3 hover:border-line-3 hover:text-chalk"}`}
                >
                  <span aria-hidden="true" className="shrink-0 leading-none">
                    <Icon name={asIconName(pr.emoji, "layers")} size={12} strokeWidth={1.9} />
                  </span>
                  {pr.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-1 flex gap-2.5">
          <button type="button" onClick={resetSheet}
            className="rounded-[var(--radius-input)] border border-transparent px-5 text-[13px]
              font-bold text-chalk-2 transition-colors hover:bg-surface-2 hover:text-chalk">
            Annuler
          </button>
          <button
            type="button" onClick={publish} disabled={busy}
            className="mo-press flex h-[var(--h-tap)] flex-1 items-center justify-center gap-2
              rounded-[var(--radius-input)] border border-line-3 bg-signal text-[13px] font-bold
              text-void shadow-sh-2 disabled:opacity-40"
          >
            Publier
          </button>
        </div>
      </Sheet>


      {/* ── Publier une story ── */}
      <Sheet
        open={openStoryCompose}
        onClose={() => setOpenStoryCompose(false)}
        title="Nouvelle story"
      >
        {/* Qui publie. Une story est un visage avant d'être un texte : on
            montre l'auteur et l'échéance sur la même ligne, avant le champ. */}
        <div className="mb-3.5 flex items-center gap-2.5">
          <span
            className="flex size-[42px] shrink-0 items-center justify-center rounded-full p-[2px]"
            style={{ background: "var(--story-ring-gradient)" }}
          >
            <span className="flex size-full items-center justify-center rounded-full bg-page">
              <Avatar
                name={profile?.prenom ?? "moi"}
                color={profile?.avatar_color}
                className="size-[34px] border-0 text-[13px]"
              />
            </span>
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold text-chalk">
              @{profile?.pseudo ?? "moi"}
            </p>
            <p className="label-micro text-chalk-4">Disparaît dans 24 h</p>
          </div>
        </div>

        {/* On écrit **dans** le cadre de la story. L'anneau de marque
            encadre le texte exactement comme il l'encadrera dans le
            lecteur : on compose ce qu'on voit, et non un champ dont on
            découvrirait le rendu après publication. */}
        <div
          className="rounded-[calc(var(--radius-card)+4px)] p-[2px]"
          style={{ background: "var(--story-ring-gradient)" }}
        >
          <div className="min-h-[180px] rounded-[var(--radius-card)] bg-page px-4 py-3.5">
            <textarea
              value={storyText}
              onChange={(e) => setStoryText(e.target.value)}
              rows={5}
              maxLength={STORY_MAX}
              autoFocus
              placeholder="Ta story en un texte court…"
              className="w-full resize-none border-0 bg-transparent p-0 text-[16px]
                leading-[1.55] text-chalk outline-none placeholder:text-chalk-4"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="tnum font-mono text-[10.5px] text-chalk-4">
            {storyText.length}/{STORY_MAX}
          </span>
          <button
            type="button"
            disabled={!profile || !storyText.trim()}
            onClick={async () => {
              if (!profile) return;
              const { error } = await publishStory(profile.id, storyText);
              if (error) return toast(`Story non publiée : ${error}`, "err");
              setStoryText("");
              setOpenStoryCompose(false);
              await refreshStories();
              toast("Story publiée · 24 h");
            }}
            className="mo-press h-[var(--h-input)] rounded-[var(--radius-chip)] border
              border-signal bg-signal px-5 font-mono text-[12px] font-bold
              tracking-[0.1em] text-void uppercase shadow-sh-1
              disabled:opacity-40"
          >
            Publier
          </button>
        </div>
      </Sheet>

      {openStories.length > 0 && (
        <StoryViewer
          stories={openStories}
          me={profile?.id ?? null}
          onClose={() => setStoryOpen(null)}
          onDelete={async (id) => {
            const { error } = await deleteStory(id);
            if (error) return toast("Suppression impossible", "err");
            // La série peut se vider : le lecteur ne s’affiche plus quand
            // elle n’a plus de story, donc rien à fermer à la main.
            await refreshStories();
          }}
        />
      )}

      {/* ── Bulle de rédaction ──
          Un bouton flottant en verre, **toujours visible** pendant le
          défilement. Il ouvre la feuille de composition : on écrit dans
          un espace dédié, pas dans une barre écrasée entre deux posts.
          Porté dans `document.body` pour échapper aux `transform` et
          `backdrop-filter` des ancêtres (qui créeraient un bloc conteneur
          et figeraient le `position: fixed`). */}
      {fabReady &&
        createPortal(
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Écrire une publication"
            data-tour="composer"
            className="glass-lens fixed right-4 bottom-[calc(var(--h-bottomnav)+var(--h-status)+1.1rem)]
              z-[var(--z-composer)] flex size-14 items-center justify-center rounded-full
              text-signal
              transition-transform duration-[var(--d-base)] ease-[var(--ease-spring)]
              hover:scale-105 active:scale-95
              shell:right-6 shell:bottom-6"
          >
            <Icon name="edit" size={20} strokeWidth={2} />
          </button>,
          document.body,
        )}
    </AppShell>
  );
}