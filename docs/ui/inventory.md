# Inventaire UI — DevNet

**Phase A — lecture seule.** Établi le 4 novembre 2026 sur la branche
`refactor/independence`. Sources : `app/**/page.tsx`, `app/**/layout.tsx`,
`components/`, `hooks/`, `app/globals.css`, `docs/design-log.md`,
`docs/ui-contracts/admin-console.md`, `lib/admin-modules.ts`.

**Convention de statut.** `complète` signifie que les sous-écrans décrits par
le catalogue existent et fonctionnent pour cette surface. Les exigences
transverses de la définition de « terminé » — i18n FR/EN, `axe`, E2E,
états hors-ligne, mesure Lighthouse — ne sont **pas** satisfaites par
l'ensemble de l'application à ce jour ; elles sont comptées séparément au
§9. Aucune ligne de cet inventaire ne doit donc être lue comme « prête pour
la production ».

## 1. Chiffres

| Élément | Nombre | Remarque |
|---|---:|---|
| Routes (`page.tsx`) | 36 | 12 publiques, 24 derrière session |
| Layouts | 2 | `app/layout.tsx`, `app/admin/layout.tsx` |
| `loading.tsx` | 15 | couvrent aussi les segments enfants |
| `error.tsx` | 1 | à la racine uniquement |
| `not-found.tsx` | 1 | à la racine uniquement |
| `global-error.tsx` | 0 | absent |
| Composants (`components/*.tsx`) | 70 | 3 inutilisés (§7) |
| Hooks | 9 | session, défis, succès, frappe, actions de post… |
| Fichiers `lib/` | 115 | fonctions et services |
| Fichiers de `app/`, `components/`, `hooks/` qui importent `lib/supabase` | 25 | dette d'architecture (§6) |
| Modules en ports/adaptateurs | 1 | `modules/feed` seulement |
| Couleurs hexadécimales en dur dans les `.tsx` | 19 | 4 fichiers, logos et `themeColor` |
| Thèmes | 2 | sombre par défaut, clair ; pas de contraste élevé |

## 2. Routes

### 2.1 Publiques

| Route | Accès / rôle | État | Dette visible |
|---|---|---|---|
| `/` | Visiteur, membre | Pivot | Aucune landing publique : redirection client vers `/feed` ou `/login`. Pas de proposition de valeur, pas de contenu indexable. |
| `/login` | Visiteur | Partielle | Email + mot de passe, Google/GitHub OAuth, comptes de démonstration. Pas de MFA, lien magique, ni message pour compte suspendu. |
| `/register` | Visiteur | Partielle | 2 étapes : identité/pseudo/email/mot de passe, puis langages + CGU. Pas de ville, centres d'intérêt, import GitHub, suggestions à suivre ni première publication. |
| `/mot-de-passe-oublie` | Visiteur | Complète | Envoi du lien ; erreurs et confirmation présentes. |
| `/reinitialiser-mot-de-passe` | Visiteur (lien) | Complète | Nouveau mot de passe + confirmation ; session de récupération gérée. |
| `/auth/confirmer` | Visiteur | Complète | Vérification OTP, états succès/expiré/démo. |
| `/aide` | Visiteur, membre | Partielle | FAQ statique + adresse de contact. Pas de recherche, catégories, ticket ni suivi. **Annonce un bouton « Bloquer » inexistant.** |
| `/a-propos` | Visiteur | Complète (statique) | Présentation, fonctions, données et démonstration. Pas de crédits/version. |
| `/cgu` | Visiteur | Complète (contenu) | Contenu statique ; **relecture juridique non faite**. |
| `/confidentialite` | Visiteur | Complète (contenu) | Contenu statique ; **relecture juridique non faite**. |
| `/setup` | Visiteur | Diagnostic | Page de dépannage backend, publique. Affiche l'URL du backend ; instructions limitées aux migrations `001`/`002`, obsolètes. |
| `/preview-code` | Visiteur | Outil interne | Banc d'essai du rendu de code, sans navigation produit. |

### 2.2 Derrière session (`AppShell`)

`AppShell` redirige vers `/login` dès qu'il n'y a pas de session. **Aucune de
ces routes n'est consultable par un visiteur non connecté**, y compris les
profils et les posts partagés.

| Route | Accès / rôle | État | Dette visible |
|---|---|---|---|
| `/feed` | Membre | Partielle | Fil + composeur (texte, code, langage, projet), brouillon local, densité, stories texte, réactions, repost, signet, partage, signalement, commentaires, GIF, photo/vidéo et atelier de calques. Pas de sondage, visibilité, publication programmée, avertissement de contenu, aperçu complet, ni sélecteur de mentions/hashtags. |
| `/decouvrir` | Membre | Partielle | Quatre sections : posts de la semaine, preuves récentes, ateliers ouverts, cercles. Pas de personnes à suivre, défis, catégories, pages langage/ville. |
| `/search` | Membre | Partielle | Trois onglets : personnes, posts, hashtags (`?q=`, `?tag=`). Pas de projets, groupes, code, filtres, historique ni recherches enregistrées. |
| `/notifications` | Membre | Partielle | Six filtres (tout, défi, like, abonnement, mention, message), regroupement, tout lire, pagination curseur. Pas de types projet/modération/système, ni actions rapides, ni préférences. |
| `/messages` | Membre | Partielle | Conversation 1:1 dans la page : texte, code, réponse citée, réactions, édition, suppression, accusés de lecture, frappe, épingles privées, recherche locale. Pas de pièces jointes, groupes, demandes de message, archivage, sourdine. |
| `/profile` | Membre | Partielle | Onglets Posts/Travail/Progrès/Infos/Paramètres ; édition prénom, bio, ville, pays, langages, liens, couleur d'avatar ; export JSON ; type de compte et vérification. Pas de bannière, statut, épinglage, centres d'intérêt, suppression de compte. |
| `/u/[pseudo]` | Membre | Partielle | Profil d'autrui : preuves, publications, projets ; suivre, message, signaler. Pas de réponses, activité, médias, likes, statistiques ; pas de vue visiteur ni de profil privé. |
| `/u/[pseudo]/followers` | Membre | Partielle | Abonnés et abonnements via `?which=following`. Pas d'abonnés en commun, recherche dans la liste, ni suggestions. |
| `/post/[id]` | Membre | Partielle | Post + panneau de commentaires à réponses imbriquées (affichage sur un niveau, données à la racine). Pas de tri, permalien de commentaire, historique des modifications. |
| `/signets` | Membre | Partielle | Liste plate privée, retrait optimiste. Pas de collections, notes, tri, partage. |
| `/groups` | Membre | Partielle | Recherche, création, adhésion, séparation « mes groupes / autres ». Pas de catégories, confidentialité, invitations. |
| `/groups/[id]` | Membre, rôles de groupe | Partielle | Canaux, messages, membres, rôles, reçus. Pas de paramètres de groupe, règles, mode lent, mots interdits, file de modération, journal, statistiques. |
| `/communities` | Membre | Partielle | Recherche et création (nom, description, règlement, visibilité, icône). Pas de catégories. |
| `/communities/[slug]` | Membre, staff de communauté | Partielle | En-tête, adhésion/départ, publications, membres, rôles, règlement, réglages staff, ajout par pseudo. Pas de file de modération ni de validation des publications. |
| `/projects` | Membre | Partielle | Galerie, filtres langage/étape/rôle, compatibilité, création, candidature. Pas de tri/tendances ni d'import GitHub depuis cette page. |
| `/projects/[id]` | Membre ; réglages admin projet | Partielle | Onglets Code, Issues, Demandes, Tâches, Candidatures, Doc, Score, GitHub, Réglages. Pas de licence, webhooks, transfert, archivage, branche par défaut, recherche dans le code. |
| `/github` | Membre | Partielle | Connexion OAuth, liste des dépôts, import. Pas de déconnexion ni de gestion des portées. |
| `/github/[owner]/[repo]` | Membre | Partielle | Lecture des fichiers, commits, branches d'un dépôt importé. Pas d'issues/PR GitHub, pas d'écriture. |
| `/ide/[project]` | Membre | Partielle | Monaco chargé à la demande, exécution, collaboration, commandes d'extension F1. Éditeur lourd ; expérience mobile et budget réseau à mesurer. |
| `/extensions` | Membre | Partielle | Catalogue, installation, publication, extraits et commandes exécutables. Les thèmes restent décoratifs. |
| `/moderation` | Membre | Partielle | **Mes** signalements : états, traitement/écartement. Ce n'est pas une file staff ; pas de sanctions ni d'appels. |
| `/settings` | Membre | Partielle | Sections Compte, Sécurité (mot de passe), Apparence (thème, densité, mouvement), Notifications informatives, Aide, zone dangereuse désactivée. Pas de recherche, confidentialité, langue, accessibilité complète, éditeur, intégrations, données, avancé, MFA, sessions, suppression. |

### 2.3 Administration

| Route | Accès / rôle | État | Dette visible |
|---|---|---|---|
| `/admin` | `is_admin`, vérifié côté serveur | Partielle | Vue d'ensemble, file de vérification, annuaire des comptes. Pas de sessions, journal d'audit, contenu global. |
| `/admin/[section]` | `is_admin`, vérifié côté serveur, `noindex` | Coquille honnête | 14 modules déclarés ; la plupart affichent un état « indisponible » avec la raison réelle. **Aucun chiffre ni bouton simulé.** `accounts` redirige vers `/admin`. |

## 3. Coquille et navigation

- **Bureau (≥ 880 px)** : panneau gauche repliable (mémoire `devnet.nav`),
  colonne centrale, en-tête avec retour, recherche, notifications, messages,
  menu profil. **Pas de panneau contextuel droit.**
- **Mobile** : `BottomNav` (Fil, Explorer, Créer, Messages, Profil) et feuille
  « Plus » pour les autres routes. L'entrée Admin n'apparaît que si
  `is_admin` ; la route reste protégée côté serveur.
- **Raccourcis** : `g m n s p b v` dans `AppShell`. Pas de palette
  `Cmd/Ctrl+K`, pas d'aide `?`, pas de liste des raccourcis.
- **Retour** : bouton contextuel avec destination de repli
  (`lib/navigation.ts`). Pas de restauration de la position de défilement.
- **Fil d'Ariane** : le `path` `~/…` de l'en-tête est un repère, pas un vrai
  fil d'Ariane cliquable.
- **Visite guidée** : `TourProvider` / `TourOverlay`, état dans
  `localStorage` (`devnet.tour.v1`), arrêts et écran d'intro.
- **Chargement initial** : `SplashScreen` dans le layout, logo animé.

## 4. Composants (70)

| Famille | Composants | Constat |
|---|---|---|
| Coque / navigation | `AppShell`, `BottomNav`, `StatusBar`, `PublicFooter`, `AdminConsoleNav`, `NotificationBell`, `PresenceRail` | Solides ; navigation mobile livrée ; pas de palette de commandes. |
| Identité / thème | `ThemeApplier`, `SplashScreen`, `LoadingLogo`, `AnimatedLogo`, `Logo`, `Motion` | Logos en couleurs directes (exception de marque). |
| Social | `PostCard`, `PostOwnerTools`, `PostShareButton`, `CommentsPanel`, `ReactionPicker`, `StoryRail`, `FollowButton`, `ReportButton`, `VerifiedBadge`, `BadgeGallery` | Le cœur du produit ; `ReportButton` est complet, le blocage n'existe pas. |
| Atelier visuel | `StudioEditor`, `StudioInspector`, `StudioLayerView` | Calques texte/image/vidéo/forme/courbe/sticker, export PNG/JPEG, préchargement du média du composeur. Pas encore de suppression, réordonnancement ni modération des médias. |
| Messagerie | `ChatComposer`, `DMContext`, `MessageExtras`, `TypingDots`, `StdinBubble`, `Receipt` | 1:1 avancé ; pas de pièces jointes. |
| Projets / code | `ProjectCard`, `ProjectCodeView`, `ProjectSettingsPanel`, `ProjectWikiPanel`, `ProjectRatingPanel`, `PullRequestPanel`, `IssuePanel`, `ForkTreePanel`, `TaskBoard`, `ApplicationPanel`, `CodeEditor`, `MonacoCodeEditor`, `CodeBlock`, `RunOutput`, `ScorePanel`, `ScoreCurve`, `ScoreTrajectory`, `ProfileWorkPanel`, `ProofPanel`, `GithubPanel`, `TrendNote` | La zone la plus complète ; Monaco hors bundle initial. |
| Progression | `ProgressPanel`, `AchievementsPanel`, `ChallengePanel`, `ContributionMap` | Score, série, quêtes, badges, heatmap, classement local au profil. |
| Admin | `AdminAccounts`, `AdminOverview`, `AdminRadar`, `AdminSettingsPanel` | Comptes et vérifications réels ; le reste est une coquille documentée. |
| Partagés | `Avatar` (+ `Loading`, `EmptyState`, `PrimaryButton`, `Spinner`), `Icon`, `Sheet`, `ShareSheet`, `Toast`, `Pending`, `BackendGate` | Une seule implémentation par contrôle. |
| **Supprimés** | `AfricaMap`, `AnonymousRunner`, `OpenInVSCode` | Aucun import constaté : supprimés plutôt que laissés en vitrine. Une carte géographique reviendra le jour où une page ville/pays existera. |

## 5. Système de design

### Couleurs

| Rôle | Sombre (défaut) | Clair (`data-theme="light"`) |
|---|---|---|
| Fond / void | `#11110E` | `#F6F4EF` |
| Surface | `#191914` | `#FBFAF7` |
| Surface 2 / 3 | `#201F19` / `#292A23` | `#F1EEE6` / `#EAE6DC` |
| Encre | `#ECE9DF` | `#16150F` |
| Texte secondaire | `#9A978B` | `#58554B` |
| Filet | `#2A2A23` | `#E3DFD3` |
| Action (signal) | `#FF7A45` | `#C2410C` |
| Succès / phosphor | `#5FBF86` | `#2F7D4F` |
| Danger | `#FF6B61` | `#B3261E` |
| Avertissement | `#E6BC75` | `#815A18` |
| Info | `#A6B7B0` | `#53645C` |
| Avatars | 5 paires pastel | mêmes paires, adaptées |

Constats :

- `--color-chalk-4` vaut `--color-chalk-3` en sombre : la hiérarchie de texte
  n'a que trois niveaux réels, malgré quatre jetons.
- Les commentaires de `globals.css` parlent encore de « verre » et de « mer
  bleue » ; les jetons `--glass-*`, `--gradient-*` et `--shadow-brut*` sont
  des alias morts. Le nom `DEFAULT_THEME = "liquid-bleu"` ne correspondait à
  aucun rendu : corrigé, il vaut désormais `"dark"`.
- Pas de thème contraste élevé, pas de `forced-colors`, pas de variante
  « auto » (système).

### Typographie

- **Instrument Sans** (`--font-display`, `--font-sans`) : interface, titres,
  lecture.
- **IBM Plex Mono** (`--font-mono`) : code, pseudonymes, dates, compteurs.
- Échelle : 28, 22, 18, 15, 13, 12, 11 px ; chiffres tabulaires.
- Polices auto-hébergées (`app/fonts/`), `next/font/local`, `display: swap`.
- Un fichier Inter est présent dans `app/fonts/` sans usage identifié.

### Formes, espace, profondeur

- Espacement : 4, 8, 12, 16, 24, 32 px ; gouttière 16 px.
- Rayons : 6 px (champ/commande), 10 px (panneau/carte).
- Filets : 1 px, 1,5 px, accent 3 px. Une seule ombre neutre, réservée aux
  feuilles et menus.
- Hauteurs : en-tête 56 px, barre d'état 22 px, barre basse 60 px, cible
  tactile 44 px.
- Points de rupture : `shell` 880 px, `wide` 1440 px — des capacités de
  coque, pas des tailles d'écran.
- `z-index` nommés : base 0, sticky 80, composer 90, nav 100, sheet 200,
  modal 300, toast 400.
- Mouvement : cinq courbes d'intention, durées 90–300 ms ;
  `prefers-reduced-motion` et préférence locale respectées.

### Couleurs en dur

19 occurrences : `AnimatedLogo` (12), `SplashScreen` (3), `LoadingLogo` (3),
`app/layout.tsx` (1, `themeColor`). Les trois premiers sont des logos ; le
`themeColor` devrait dériver du jeton de fond.

## 6. i18n et textes

- **Aucun framework i18n** (`next-intl`, `i18next`, `react-intl`, `lingui` :
  absents). Aucun fichier de messages.
- Toutes les chaînes sont écrites en français directement dans les pages et
  composants. `<html lang="fr">`.
- Quelques catalogues existent déjà : `lib/admin-modules.ts` (libellés et
  raisons des modules), `lib/errors` (messages de service), les libellés de
  rôles de projet/communauté.
- Aucune bascule FR/EN, aucun formatage localisé centralisé pour les dates,
  nombres et pluriels.
- Les textes sont globalement naturels et spécifiques ; les principaux écarts
  sont les promesses de l'aide (§7) et les commentaires de tokens obsolètes.

## 7. Audit « surface fantôme »

**Ce qui est propre :**

- Aucun `href="#"`, aucun handler `onClick={() => {}}` détecté.
- Les modules admin non instrumentés affichent une raison réelle et aucune
  donnée simulée.
- Les réglages notifications email/push et la suppression de compte ne sont
  pas présentés comme actifs.
- Le bouton de signalement disparaît sur son propre contenu, et les doublons
  sont traités comme un succès idempotent.

**Ce qui ment encore :**

1. `/aide` affirme qu'on peut « bloquer quelqu'un depuis un profil » et
   « débloquer dans les paramètres ». **Aucun blocage, aucune sourdine et
   aucune liste de comptes bloqués n'existent.**
2. `/aide` affirme qu'un bouton « Signaler » est disponible sur les profils
   et publications : c'est vrai (`ReportButton`), mais il n'existe pas dans
   les messages ni dans les groupes.
3. `/setup` est public et expose l'URL du backend ; ses instructions ne
   mentionnent que `001`/`002` alors que le dépôt est à `041`.
4. ~~Trois composants ne sont importés nulle part~~ : `AfricaMap`,
   `AnonymousRunner`, `OpenInVSCode` ont été **supprimés**.
5. ~~`DEFAULT_THEME = "liquid-bleu"`~~ : corrigé en `"dark"`, et l'option
   « Bleu Liquid » du profil a disparu. Les commentaires « verre / mer bleue »
   restent à nettoyer dans `globals.css`.

## 8. Architecture UI ↔ données

- **Un seul port réel** : `modules/feed/ports/feed-repository.ts`, avec un
  adaptateur Supabase et un adaptateur mémoire, exposé par
  `platform/container.ts`. Même le fil n'utilise ce port que pour l'erreur ;
  ses lectures passent encore par `lib/social`.
- **25 fichiers de `app/`, `components/` et `hooks/`** importent
  `lib/supabase` directement, dont `feed`,
  `messages`, `profile`, `settings`, `groups`, `communities`,
  `projects/[id]`, `login`, `register` et plusieurs hooks.
- Les fonctions pures de `lib/` (score, XP, preuves, compatibilité) ne sont
  pas à réécrire : l'UI doit les appeler.
- Il n'existe qu'un contrat de surface : `docs/ui-contracts/admin-console.md`.
  Toute nouvelle surface sans backend doit recevoir son contrat + adaptateur
  mémoire avant l'écran.
- Les pages `admin` sont les seules protégées côté serveur ; les autres
  reposent sur `AppShell` côté client. **L'UI ne remplace pas le contrôle
  d'accès** : toute surface sensible nouvelle doit avoir sa vérification
  serveur.

## 9. États, erreurs et surfaces système

**Présents :** squelettes `loading` sur 15 segments, état vide soigné dans la
plupart des listes, erreurs de service avec reprise, `not-found` global,
`error.tsx` racine, `prefers-reduced-motion`, focus visible, cibles 44 px,
bandeau de démonstration.

**Absents :**

- `global-error.tsx`, frontières d'erreur par section.
- Pages 403, 500, maintenance, hors-ligne, session expirée, limite de débit,
  fonction indisponible (hors coquille admin).
- Bandeau hors-ligne, détection de reconnexion, file d'attente d'envoi.
- Bandeau cookies et préférences de consentement.
- Manifeste PWA, service worker, invite d'installation.
- Palette de commandes, aide des raccourcis, carte de profil au survol,
  sélecteur de mentions, lightbox, visionneuse de code plein écran dédiée.
- Toasts avec annulation (les toasts existent, sans « annuler »).
- Virtualisation des longues listes, mode économie de données, mode
  hors-ligne.
- Contraste élevé, taille de texte réglable, police de code réglable.

## 10. Vérifications et limites de cet inventaire

- **Phase A réalisée en lecture seule** : aucun fichier de code modifié.
- Les états et permissions ont été **relus dans le code**, pas exercés dans
  un navigateur. Aucun parcours E2E, aucun `axe`, aucun Lighthouse n'a été
  lancé pour cet inventaire.
- Les vérifications précédentes (`tsc --noEmit`, ESLint ciblé, suites
  `test:*`) restent valables pour le code d'alors ; elles ne couvrent pas
  les surfaces décrites ici.
- La migration `supabase/041_message_depth.sql` n'est appliquée à aucune
  base distante connue ; le mode démonstration fonctionne sans elle.
- `docs/ui/coverage.md` est la feuille de route qui découle de cet
  inventaire ; toute surface nouvelle doit y ajouter sa ligne avant d'être
  codée.
