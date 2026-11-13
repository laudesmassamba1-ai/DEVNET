"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell, IconButton } from "@/components/AppShell";
import { EmptyState, Loading, PrimaryButton, Spinner } from "@/components/Avatar";
import { CodeBlock } from "@/components/CodeBlock";
import { CommentsPanel } from "@/components/CommentsPanel";
import { GifPicker } from "@/components/GifPicker";
import { Icon, asIconName } from "@/components/Icon";
import { Motion } from "@/components/Motion";
import { PostCard } from "@/components/PostCard";
import { PostOwnerTools } from "@/components/PostOwnerTools";
import { Sheet } from "@/components/Sheet";
import { groupStoriesByAuthor, StoryRail, StoryViewer } from "@/components/StoryRail";
import { useToast } from "@/components/Toast";
import { WovenBand } from "@/components/WovenBand";
import { api } from "@/lib/api/client";
import { useSession } from "@/hooks/useSession";
import { StatusComposer } from "@/components/StatusComposer";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { postPoints } from "@/lib/gamification";
import { uploadMedia } from "@/lib/media";
import { deleteStory, fetchLiveStories, publishStoryMedia } from "@/lib/stories";
import {
  fetchFeedHydrationCached as fetchFeedHydration,
  fetchFeedPageCached as fetchFeedPage,
  setReaction, toggleLike, toggleRepost, type FeedScope,
  invalidatePostCache,
} from "@/lib/social";
import { toggleBookmark } from "@/lib/signets";
import { usePostActions } from "@/hooks/usePostActions";
import {
  fetchProjects,
  fetchProjectsForPosts,
  linkPostToProject,
} from "@/lib/repo";
import { removeSamplePosts, seedSamplePosts, SAMPLE_MARK } from "@/lib/seed";
import { fetchCommunityFeed } from "@/lib/communities";
import type { PostWithAuthor, StoryWithAuthor } from "@/lib/types";
import type { Gif } from "@/lib/gifs";
import { OPEN_POST_COMPOSER_EVENT } from "@/lib/ui-events";
import { FEED_DENSITY_KEY, type FeedDensity } from "@/lib/ui-preferences";
import { FeedRepositoryError } from "@/modules/feed";

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
  const [feedError, setFeedError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string>(() => readDraft().text);
  const [code, setCode] = useState<string>(() => readDraft().code);
  const [lang, setLang] = useState<string>(() => readDraft().lang);
  const [isCode, setIsCode] = useState<boolean>(() => readDraft().isCode);
  /** GIF joint à la publication en cours — un lien, pas un fichier. */
  const [gif, setGif] = useState<Gif | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  /** Media (photo/video) joint à la publication — contient l'URL et le type. */
  const [media, setMedia] = useState<{ url: string; kind: "image" | "video" } | null>(null);
  /** Envoi du média en cours : publier maintenant enverrait l'ancien état. */
  const [mediaBusy, setMediaBusy] = useState(false);
  /** Atelier visuel ouvert par-dessus la feuille de publication. */
  /** Texte des calques du statut en cours d'édition. */
  const [storyText, setStoryText] = useState("");
  const [density, setDensity] = useState<FeedDensity>("comfortable");
  const [densityReady, setDensityReady] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Auteur dont on regarde la série de stories. */
  const [storyOpen, setStoryOpen] = useState<string | null>(null);
  /** Les stories vivantes, lues dans la table — pas déduites du fil. */
  const [stories, setStories] = useState<StoryWithAuthor[] | null>(null);
  /** Feuille de publication d'une story. */
  const [openStoryCompose, setOpenStoryCompose] = useState(false);
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
  /** Au-delà de 1024 px, les commentaires tiennent dans une colonne à droite. */
  const commentsDocked = useMediaQuery("(min-width: 1024px)");

  useEffect(() => {
    const openComposer = () => setOpen(true);
    window.addEventListener(OPEN_POST_COMPOSER_EVENT, openComposer);

    if (new URLSearchParams(window.location.search).get("compose") === "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- action lancée depuis la navigation mobile
      setOpen(true);
      router.replace("/feed");
    }

    return () => window.removeEventListener(OPEN_POST_COMPOSER_EVENT, openComposer);
  }, [router]);

  useEffect(() => {
    const savedDensity = window.localStorage.getItem(FEED_DENSITY_KEY);
    if (savedDensity === "compact" || savedDensity === "comfortable") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- préférence locale lue après hydratation
      setDensity(savedDensity);
    }
    setDensityReady(true);
  }, []);

  useEffect(() => {
    if (densityReady) window.localStorage.setItem(FEED_DENSITY_KEY, density);
  }, [density, densityReady]);

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
   * suppose que la table est ajoutée à la publication la publication temps réel,
   * ce qui n'est pas acquis sur un projet neuf. Un semis qui n'apparaît pas
   * fait croire à un échec — donc on lit, et le canal ne sert plus qu'à
   * actualiser les autres.
   */
  const refresh = useCallback(async () => {
    invalidatePostCache();
    setFeedError(null);
    try {
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
    } catch (error) {
      if (!(error instanceof FeedRepositoryError)) throw error;
      setFeedError(error.message);
    }
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
    setFeedError(null);
    let page;
    try {
      page = await fetchFeedPage({ scope, me: profile?.id, before: cursor });
    } catch (error) {
      if (!(error instanceof FeedRepositoryError)) throw error;
      setFeedError(error.message);
      return;
    } finally {
      setLoadingMore(false);
    }
    if (genRef.current !== gen) return;

    setPosts((prev) => (prev === null ? prev : [...prev, ...page.rows]));
    setHasMore(page.more);

    // La page ajoutée est hydratée comme la première : likes, réactions,
    // reposts et signets du lecteur sont lus en une seule requête pour
    // toutes les cartes nouvelles. Sans cette ligne, la page 2 + arriverait
    // sans aucun état d'interaction — comme si on n'avait jamais rien aimé.
    const added = page.rows.map((r) => r.id);
    // Hydratation et projets sont indépendants : les lancer ensemble
    // supprime un aller-retour complet sur « charger plus ».
    const [hydration, projects] = await Promise.all([
      profile ? fetchFeedHydration(added) : Promise.resolve(null),
      fetchProjectsForPosts(added),
    ]);
    if (genRef.current !== gen) return;
    if (hydration) {
      setLikedIds((prev) => [...new Set([...prev, ...hydration.likedPostIds])]);
      setRepostedIds((prev) => [...new Set([...prev, ...hydration.repostedPostIds])]);
      setReactions((prev) => ({ ...prev, ...hydration.reactions }));
      setBookmarkedIds((prev) => [...new Set([...prev, ...hydration.bookmarkedPostIds])]);
    }
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
      // Les likes/reposts/réactions/signets et les projets sont deux
      // lectures indépendantes : les mener en parallèle évite d'additionner
      // leurs latences au premier affichage du fil.
      const [hydration, projects] = await Promise.all([
        profile ? fetchFeedHydration(rows.map((r) => r.id)) : Promise.resolve(null),
        fetchProjectsForPosts(rows.map((r) => r.id)),
      ]);
      if (!alive || genRef.current !== gen) return;
      if (hydration) {
        setLikedIds(hydration.likedPostIds);
        setRepostedIds(hydration.repostedPostIds);
        setReactions(hydration.reactions);
        setBookmarkedIds(hydration.bookmarkedPostIds);
      }
      setPostProjects(
        new Map(
          [...projects].map(([postId, p]) => [
            postId,
            { id: p.id, name: p.name, emoji: p.emoji },
          ]),
        ),
      );
    }).catch((error: unknown) => {
      if (!alive || genRef.current !== gen) return;
      if (!(error instanceof FeedRepositoryError)) throw error;
      setFeedError(error.message);
    });
    return () => {
      alive = false;
    };
  }, [scope, profile]);

  // Temps réel : nouveaux posts + mises à jour (likes)
  useEffect(() => {
    const channel = api
      .channel("feed")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        () => {
          // Le temps réel n'annonce un post que s'il appartient à la
          // portée active : sous « Abonnements », un post d'un inconnu
          // n'a rien à faire dans le fil — l'afficher contredirait le
          // filtre que le lecteur vient de poser.
          if (scope !== "all") return;
          // La charge temps réel ne porte pas l'auteur, et le navigateur ne
          // va plus le chercher dans `users` : on relit la première page par
          // `/api/feed`, qui arrive complète. Le canal ne sert plus qu'à
          // signaler « quelque chose a changé ».
          void refresh();
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
      void api.removeChannel(channel);
    };
  }, [scope, refresh]);

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
    setGif(null);
    setMedia(null);
    setMediaBusy(false);
    // Le projet choisi ne survit pas à la publication : le rattachement
    // est une décision par publication, pas une préférence. Le garder
    // ferait rattacher par automatisme des publications sans rapport.
    setProjectId(null);
  }

  /** Publie le dessin de l'atelier comme statut de 24 h. */
  async function publishStoryFromStudio(file: File) {
    const { id, error } = await publishStoryMedia(storyText, file);
    if (error || !id) return toast(error ?? "Publication du statut impossible", "err");
    setStoryText("");
    await refreshStories();
    toast("Statut publié · 24 h");
  }

  async function attachMedia(file: File) {
    setMediaBusy(true);
    try {
      const result = await uploadMedia(file);
      if (!result.ok) {
        toast(result.error, "err");
        return;
      }
      setMedia({ url: result.media.url, kind: result.media.kind });
    } finally {
      setMediaBusy(false);
    }
  }

  async function publish() {
    if (!profile) return;
    const body = text.trim();
    // Un GIF peut tenir lieu de texte : envoyer un GIF seul est un geste
    // complet, comme une image dans une messagerie.
    if (!body && !gif && !media) return toast("Écris quelque chose ou choisis un GIF ou un média", "err");
    if (mediaBusy) return toast("Le média est encore en cours d'envoi", "err");

    setBusy(true);
    // On relit la ligne insérée : il faut son identifiant pour la
    // rattacher à un projet. Une publication sans projet reste possible —
    // le rattachement est une information, pas une obligation.
    const { data: created, error } = await api
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
        // Le GIF est un lien filtré côté serveur à la recherche, et
        // re-vérifié par la contrainte `posts_gif_url_https` en base.
        gif_url: gif?.url ?? "",
        gif_alt: gif?.alt ?? "",
        // Media (photo/video) — stocké tel quel, le serveur appliquera
        // sa propre transformation (redimension, format MP4 pour vidéo).
        media_url: media?.url ?? "",
        media_type: media?.kind ?? "",
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
    // place (table absente de la publication temps réel sur un projet neuf) ou
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
      <div className="px-(--gutter) pt-3" data-feed-density={density}>
        <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
        <div className="mb-3 flex min-h-11 items-center justify-between gap-3">
          <h1 className="font-display text-[22px] font-semibold tracking-[-0.03em]">
            Fil
          </h1>
          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label="Densité des publications"
              className="flex items-center rounded-[var(--radius-input)] border border-line-2 p-0.5"
            >
              {([
                ["comfortable", "Confortable"],
                ["compact", "Compacte"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={density === value}
                  onClick={() => setDensity(value)}
                  className={`min-h-[var(--h-tap)] rounded-[var(--radius-chip)] px-2.5 text-[12px]
                    transition-colors duration-[var(--d-fast)]
                    ${density === value
                      ? "bg-surface-3 text-chalk"
                      : "text-chalk-3 hover:text-chalk"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Publier une publication"
              data-tour="composer"
              className="inline-flex min-h-[var(--h-tap)] min-w-[var(--h-tap)]
                items-center justify-center gap-2 rounded-[var(--radius-input)]
                border border-signal bg-signal px-3 text-void hover:opacity-90"
            >
              <Icon name="edit" size={16} />
              <span className="hidden text-[12px] font-semibold sm:inline">
                Publier
              </span>
            </button>
          </div>
        </div>

        <Motion role="slide" delay={60} attrs={{ "data-tour": "feed-stories" }}>
          <StoryRail
            stories={stories ?? []}
            me={profile?.id ?? null}
            onOpen={(authorId) => setStoryOpen(authorId)}
            onPublish={profile ? () => setOpenStoryCompose(true) : undefined}
          />
        </Motion>

        {/* La trame sépare le fil de son en-tête : deux zones, pas deux
            cartes. Le tissu prend la couleur de l'action. */}
        <WovenBand tone="signal" className="mb-3" />

        {/* La publication s'ouvre dans la feuille depuis l'action en tête du fil. */}

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

        {posts === null && !feedError && <Loading label="Chargement du fil" />}
        {feedError && (
          <div
            role="alert"
            className="my-3 flex flex-wrap items-center justify-between gap-3
              border border-line-2 px-4 py-3 text-[13px] text-chalk-2"
          >
            <span>{feedError}</span>
            <button
              type="button"
              onClick={() => void refresh()}
              className="min-h-[var(--h-tap)] px-3 font-bold text-signal
                hover:underline focus-visible:outline-2
                focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              Réessayer
            </button>
          </div>
        )}

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
                      text-sm font-bold text-chalk-3 transition-colors
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

        {/* Chaque publication est séparée par un filet, sans défilement infini. */}
        {posts?.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            meId={profile?.id ?? null}
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

        {/* Charger la suite, **après** les publications déjà lues.

            Il était rendu au-dessus du fil : l'écran proposait donc d'ajouter
            des posts avant d'avoir montré les premiers, et le bouton séparait
            les onglets de la première publication. Un bouton explicite plutôt
            qu'un défilement infini : ici, le fil est un dossier qu'on
            parcourt, pas un mur qu'on défile. */}
        {posts && posts.length > 0 && hasMore && (
          <Motion role="fade">
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex h-[var(--h-tap)] items-center gap-2
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

      <PostOwnerTools actions={postActions} />
        </div>

        <CommentsPanel
          variant={commentsDocked ? "docked" : "sheet"}
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
      </div>

      <Sheet
        open={open}
        onClose={resetSheet}
        title="Nouveau post"
      >
        <textarea
          value={text} onChange={(e) => setText(e.target.value)}
          rows={Math.min(12, Math.max(4, text.split("\n").length))}
          aria-label="Texte de la publication"
          placeholder="Partage une question, un extrait ou une avancée."
          className="mb-3 w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3.5 py-3
            text-[14px] leading-[1.6] placeholder:text-chalk-4"
        />

        {/* Le GIF se choisit dans une feuille à part : la grille a besoin
            de place, et le composeur doit rester lisible. L'atelier, lui,
            ouvre l'éditeur de calques sur le média déjà joint. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setGifOpen(true)}
            aria-haspopup="dialog"
            className="inline-flex min-h-[var(--h-tap)] items-center gap-1.5
              rounded-[var(--radius-chip)] border border-line-3 px-3 font-mono
              text-[12px] font-bold uppercase tracking-[0.08em] text-chalk-3
              transition-colors duration-[var(--d-fast)]
              hover:border-signal hover:text-signal"
          >
            <Icon name="gif" size={16} />
            {gif ? "Changer le GIF" : "Ajouter un GIF"}
          </button>
        </div>

        {gif && (
          <Motion role="scale" className="mb-3">
            <div className="relative overflow-hidden rounded-[var(--radius-input)] border border-line-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={gif.preview}
                alt={gif.alt}
                className="max-h-[220px] w-full object-contain bg-surface-2"
              />
              <button
                type="button"
                onClick={() => setGif(null)}
                aria-label="Retirer le GIF"
                className="absolute right-2 top-2 inline-flex size-11 items-center
                  justify-center rounded-full border border-line-3 bg-void/80
                  text-chalk shadow-sh-1 backdrop-blur transition-colors
                  hover:border-danger hover:text-danger"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          </Motion>
        )}

        {/* Sélecteur de photo / vidéo */}
        <label className="mb-3 flex cursor-pointer items-center gap-2" title="Ajouter une photo ou une vidéo">
          <input
            type="file"
            accept="image/*,video/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset : choisir deux fois le même fichier doit fonctionner.
              event.target.value = "";
              if (file) void attachMedia(file);
            }}
            className="sr-only"
          />
          <Icon
            name={media ? (media.kind === "video" ? "video" : "image") : "image"}
            size={18}
            strokeWidth={1.8}
          />
          {media && <span className="text-chalk-4">{media.kind === "video" ? "vidéo" : "photo"}</span>}
        </label>

        <GifPicker open={gifOpen} onClose={() => setGifOpen(false)} onPick={setGif} />

        {/* Bouton photo / vidéo */}
        {media && (
          <Motion role="scale" className="mb-3">
            <div className="relative overflow-hidden rounded-[var(--radius-input)] border border-line-2">
              {media.kind === "video" ? (
                <video
                  src={media.url}
                  playsInline
                  controls
                  preload="metadata"
                  className="max-h-[220px] w-full object-contain bg-surface-2"
                />
              ) : (
                <img
                  className="max-h-[220px] w-full object-contain bg-surface-2"
                  src={media.url}
                  alt="Photo jointe"
                />
              )}
              <button
                type="button"
                onClick={() => setMedia(null)}
                aria-label="Retirer le media"
                className="absolute right-2 top-2 inline-flex size-11 items-center justify-center rounded-full border border-line-3 bg-void/80 text-chalk shadow-sh-1 backdrop-blur transition-colors hover:border-danger hover:text-danger"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          </Motion>
        )}

        <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-chalk-3">
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
                aria-label="Langage du code"
                value={lang} onChange={(e) => setLang(e.target.value)}
                className="h-[var(--h-input)] w-full cursor-pointer
                  rounded-[var(--radius-input)] border border-line-3 bg-surface
                  px-3.5 text-[14px] shadow-sh-1"
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
                aria-label="Code à publier"
                value={code} onChange={(e) => setCode(e.target.value)} rows={7}
                placeholder="// Ton code ici…"
                className="w-full rounded-[var(--radius-input)] border border-line-3
                  bg-surface-2 px-3.5 py-3 font-mono text-[var(--text-code)]
                  leading-[var(--lh-code)] shadow-sh-1
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
        <div className="mb-4">
          <p className="prompt-label mb-2 text-chalk-2">
            projet <span className="text-chalk-4">— facultatif</span>
          </p>
          {myProjects.length === 0 ? (
            /*
              Ne rien afficher laissait croire que la fonction avait
              disparu : un compte sans projet ne voyait aucun moyen d'en
              rattacher un, ni même de découvrir que c'était possible.
            */
            <p className="text-[12.5px] leading-relaxed text-chalk-4">
              Aucun dépôt pour l’instant.{" "}
              <Link href="/projects" className="text-signal underline-offset-2 hover:underline">
                Créez un projet
              </Link>{" "}
              pour pouvoir rattacher vos publications à du code.
            </p>
          ) : (
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
          )}
        </div>

        <div className="mt-1 flex gap-2.5">
          <button type="button" onClick={resetSheet}
            className="rounded-[var(--radius-input)] border border-transparent px-5 text-[13px]
              font-bold text-chalk-2 transition-colors hover:bg-surface-2 hover:text-chalk">
            Annuler
          </button>
          <button
            type="button" onClick={publish} disabled={busy || mediaBusy}
            className="mo-press flex h-[var(--h-tap)] flex-1 items-center justify-center gap-2
              rounded-[var(--radius-input)] border border-line-3 bg-signal text-[13px] font-bold
              text-void shadow-sh-2 disabled:opacity-40"
          >
            Publier
          </button>
        </div>
      </Sheet>


      {/* ── Statut : l'atelier est le brouillon, et publie ce qu'on voit. ── */}
      <StatusComposer
        open={openStoryCompose}
        onClose={() => {
          setOpenStoryCompose(false);
          setStoryText("");
        }}
        onLayersChange={setStoryText}
        onUse={(file) => {
          void publishStoryFromStudio(file);
        }}
      />

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

    </AppShell>
  );
}