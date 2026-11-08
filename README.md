# DevNet

**Le réseau des développeurs africains** — une plateforme d'échange entre étudiants et professionnels du numérique, par les développeurs, pour les développeurs.

## Stack

| Couche | Choix |
|---|---|
| Framework | **Next.js 16** (App Router, Turbopack) |
| Langage | **TypeScript** strict |
| Styles | **Tailwind CSS v4** (tokens CSS-first via `@theme`) |
| Base de données | **Supabase** (PostgreSQL) |
| Auth | Supabase Auth (email + mot de passe) |
| Temps réel | Supabase Realtime (`postgres_changes`) |
| Polices | `next/font` — Fraunces, Space Grotesk, JetBrains Mono |

## Démarrage

```bash
npm install

# Clés Supabase → Project Settings → API Keys
cp .env.local.example .env.local
# renseignez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY

npm run dev
```

## Mode démonstration

Une démo qui affiche un écran vide devant un jury est une démo ratée. `lib/backend.ts` sonde l'API REST au démarrage ; si elle ne répond pas, l'application bascule sur un **backend local** (`lib/demo/`) au lieu de laisser `Failed to fetch` s'afficher partout.

Ce backend n'est pas une maquette : c'est une implémentation du sous-ensemble de PostgREST qu'utilise DevNet — mêmes méthodes, mêmes sémantiques de retour (`{ data, error }`), mêmes cas d'erreur (`single()` sur zéro ligne échoue, `maybeSingle()` non). Le code applicatif ne peut pas distinguer le vrai backend du faux.

- `lib/demo/query.ts` — requêtes chaînables, jointures `alias:table(...)`, temps réel
- `lib/demo/store.ts` — tables en mémoire, persistées dans `localStorage`
- `lib/demo/data.ts` — jeu de données (les écritures du présentateur survivent au rechargement)
- `/setup` — diagnostic : état du backend, « Réessayer », réinitialisation de la démo

Un bandeau l'affiche explicitement : afficher de fausses données sans le dire serait malhonnête.

Limite assumée : le temps réel local est un bus en mémoire, donc **un seul onglet**. Le multi-onglets exige un vrai backend.

## Base de données

Dans Supabase → SQL Editor, exécuter dans l'ordre :

1. `supabase/001_schema.sql` — tables, RLS, realtime, trigger de création de profil
2. `supabase/002_accounts.sql` — comptes étudiant/professionnel + durcissement RLS
3. `supabase/003_indexes.sql` — index de progression (**facultatif**, tout fonctionne sans)

Puis, dans l'ordre, les vagues suivantes : `004_foundation` (canaux, projets,
dépôt, GitHub), `005_social` (likes, commentaires, follows), `006_messaging`,
`007_search`, `008_commit_files`, `009_post_projects`, `010_notifications`,
`011_reports`, `012_branches`, `013_issues`, `014_pull_requests`,
`015_project_pages` (le wiki de dépôt), `016_reactions` (réactions et
reposts), `017_read_receipts` (accusés de lecture), `018_social_depth`
(signets, réponses de commentaires, réactions/épingles de messages, stories),
`019_presence` (présence et divergence du dépôt), puis `020` à `029`
(`025` forks et notation, `026` liens de profil, `027` réglages de projet,
`028` communautés, `029` la table des notes).

### Migration 025 — forks et notation par les pairs

`supabase/025_forks.sql` crée la lignée des dépôts et le jury, et
`supabase/029_project_ratings.sql` la table qui porte les votes :

- **`project_forks`** — le parent (`source_id`), la racine de la lignée
  (`root_project_id`, déduite à l'insertion), l'instantané cloné
  (`source_branch`, `source_sha`), et l'auteur du geste. Lecture publique,
  écriture réservée au forker (`forks_insert`).
- **`projects.forked_from`** — une colonne dénormalisée pour afficher
  « forké de X » sans jointure ; la source de vérité reste la table.
- **`proofs.kind`** — la liste des kinds *s'étend* : `fork` rejoint les
  sept existants (poids 3, entre `github` 4 et `task` la voilà du côté du
  métier), et la preuve se dérive depuis `project_forks` au rejeu, comme
  les autres. Côté client, `lib/proofs.ts` porte le même élargissement, et
  le rejeu démo (`lib/demo/proofs.ts`) accorde la preuve `fork` comme les
  autres.
- **`project_ratings`** *(migration `029_project_ratings.sql`)* — une étoile
  1–5 par (projet, votant), clé composée. Le côté moteur est prêt
  (`lib/rating.ts`) : moyenne bayésienne (prior = moyenne de la plateforme,
  cinq votes de confiance), incertitude de Wilson sur le petit échantillon,
  entropie de Shannon sur la provenance des votants, moyenne géométrique
  pondérée des trois facteurs — un projet mal noté par un jury homogène de
  2 votes ne dépasse pas un projet bien noté d'un jury large et divers.

La 029 existe parce que le client, lui, interrogeait déjà la table : sans
elle, PostgREST répondait 404 à chaque ouverture de profil et un projet
restait « pas encore noté » même après un vote. La clé primaire est la
paire (projet, votant) — le double vote est impossible *par le schéma*, pas
par une vérification applicative qu'un client plus ancien contournerait.

Le backend de démonstration reproduit la 025 : `project_forks` et
`project_ratings` sont dans le store local (`KEY v10`), la racine se
déduit comme en base, la contrainte (projet, votant) refuse le double
vote avec l'erreur Postgres, et la preuve `fork` se redérive à chaque
rejeu. Voir `scripts/test-demo-social-plus.ts` pour ce contrat testé.

## Comptes étudiant / professionnel

Un seul champ `account_type` sur `users`, **pas deux tables** : un étudiant devient professionnel en cours d'année, et il doit conserver ses posts, ses groupes et sa réputation.

Le type n'est pas une étiquette mais une **échelle de capacités**. Un compte étudiant se crée en 30 secondes, donc n'importe qui peut en créer 200 : on borne ce qu'il peut faire pour que le spam n'ait pas d'intérêt.

| Capacité | Étudiant | Professionnel |
|---|---|---|
| Publier, commenter, groupes | oui | oui |
| **Initier un MP vers un pro** | non | oui |
| **Visible par un recruteur** | non | oui |
| Badge vérifié | non | oui |

## Direction artistique

**Système « Liquid Ivoire »** — un fond ivoire mat en dégradé vertical,
sans halo, porte des panneaux de **verre translucide** : reflet
directionnel, bord fin, ombre de contact et flou réservé aux surfaces
flottantes révèlent leur profondeur. Issu des systèmes
« Terminal », « Phosphore », « Papier » puis « Verre clair », qu'il
prolonge sans les renier.

- **Fond ivoire mat** (dégradé vertical sans nimbes) — la lumière
  vient des surfaces, pas d'un halo d'arrière-plan. **Une seule identité** :
  pas de variante sombre, pas de bloc `prefers-color-scheme`.
- **Olive** `#C5D58C` comme accent d'action, avec une encre graphite.
  **Vert** pour la donnée vivante
  (présence, en ligne). Vert / rouge / or / cyan sont sémantiques et
  rares. Aucun dégradé « Instagram ».
- **Barre de statut** en bas (chemin · mode · heure) et **barre d'onglets** en haut —
  l'héritage de l'outillage terminal.
- **Gouttière de lignes** sur chaque carte de post : une structure stable sous un
  flux de contenu.
- **Libellés au prompt shell** — `❯ CARTE D'ACTIVITÉ`, `❯ adresse email`.
- **Typographie** : **Inter** variable (tout le texte) + **IBM Plex Mono**
  (toute donnée, tout code).
- **Icônes Lucide** — glyphes standards associés à leur action; noms historiques
  conservés pour les données et les écrans existants.
- **Verre clair transparent** : cartes = verre **par transmission** (aucun
  voile de couleur + reflet + liseré, sans calcul live → défilement fluide) ;
  barres, volants et le FAB floutent le fond en direct; le composeur garde
  un liseré directionnel discret, sans filtre de déformation.

Aucun angle droit — contrôles, glyphes et images arrondis par la couche de base.
- **Symboles Adinkra** conservés en filigrane à 10 % d'opacité — jamais sur du texte.

## Structure

```
app/
  layout.tsx          polices + métadonnées
  page.tsx            routeur (session → /feed ou /login)
  login/ register/    auth
  feed/               fil, compose, temps réel
  groups/ [id]/       groupes, canaux, discussion
  messages/           messages privés
  profile/            profil éditable
  setup/              diagnostic du backend
components/           AppShell, BottomNav, StatusBar, PostCard, StoryRail,
                      ProgressPanel, ContributionMap, CodeBlock, Icon, Logo,
                      Avatar, Sheet, Toast, BackendGate, BackendBanner,
                      ProjectWikiPanel, MessageExtras, GithubPanel,
                      PresenceRail
lib/
  types.ts            types du domaine
  utils.ts            helpers (temps relatif, échappement, classes)
  highlight.ts        tokenizer de coloration syntaxique
  doc.ts              découpage d'une page de wiki en blocs (pur)
  pages.ts            wiki de dépôt — pages, création, modification
  gamification.ts     moteur de progression (pur)
  progress.ts         chargement de la progression
  seed.ts             contenu d'exemple, généré depuis l'application
  stories.ts          stories réelles (table `stories`, échéance 24 h)
  messages.ts         réactions, épingles et réponses de messages
  presence.ts         présence du dépôt : qui travaille sur quel fichier
  git/                dépôt interne : objets, chemins, historique
  groups/channels.ts  règles de canaux : slug, tri, sélection
  execution/          choix du runtime d'exécution et garde-fous
  github/             raccordement d'un projet à un dépôt GitHub (+ écran)
  backend.ts          sonde de disponibilité du backend
  demo/               backend local de démonstration
  supabase/           client + résolution de profil
hooks/                session, progression, requête média
supabase/             migrations SQL
scripts/              suites de tests
```

Un document de référence : `ROADMAP.md` (état du produit et plan de fonctionnalités).

## Scripts

```bash
npm run dev                # développement
npm run build              # build de production
npm run lint               # ESLint
npm run test               # toutes les suites unitaires (1223 vérifications)
npm run test:demo          # backend de démonstration
npm run test:pages         # wiki de dépôt (découpage + données)
npm run test:profond       # réponses, réactions/épingles, stories, GitHub
npm run test:presence      # présence du dépôt et garde de divergence
npm run test:highlight     # coloration syntaxique
npm run test:gamification  # score, séries, paliers, badges, quêtes
npm run test:foundation    # dépôt interne, chemins, exécution, GitHub
npm run test:editor        # éditeur (complétion, indentation, paires)
npm run test:execution     # exécution (moteur pur, TypeScript, refus)
npm run test:scoring       # score /1000 (ligne, fichier, projet, dépôt)
npm run test:proofs        # preuves (empreinte, rejeu, réputation) et compatibilité
npm run test:ecran         # parcours navigateur + téléphone
diagnostic-profond.py      # vérifie au navigateur les nouveautés 018 + GitHub
diagnostic-presence.py     # vérifie au navigateur le rail et les deux bandeaux
npx tsc --noEmit           # vérification de types
```

## Coloration syntaxique

`lib/highlight.ts` — tokenizer maison, zéro dépendance, 13 langages. `shiki` et
`prism-react-renderer` pèsent ~120 ko gzip pour couvrir des langages qu'on
n'affiche jamais ; DevNet n'en montre que quelques-uns.

`<CodeBlock>` a deux variantes : `paper` (code posé sur la page — la signature
DevNet) et `terminal` (fond encre, pour isoler fortement). La variante ne
change que des variables CSS, la coloration est calculée une seule fois.

**La règle de palette :** quand du vert ou du bleu apparaît sur DevNet, c'est du
code. Jamais un bouton.

- `/preview-code` — banc d'essai, montre les deux variantes et le jeu d'icônes

## Progression : score, séries, paliers

Onglet **Progrès** de `/profile`, plus un rail de contributions en tête du fil.

### Le parti pris : rien n'est stocké

Il n'existe **pas** de colonne `users.xp`. Le score est recalculé à chaque
ouverture de l'onglet, à partir des événements réels déjà en base — posts,
messages de groupe, likes reçus. Trois raisons :

- la progression ne peut pas mentir, elle est le résumé exact de ce qui a
  été publié ;
- un post supprimé ne laisse pas de score fantôme ;
- **aucune migration n'est obligatoire** pour que la fonctionnalité existe.

`lib/gamification.ts` ne dépend de rien — ni React, ni réseau. C'est ce qui
permet de le tester à fond (`npm run test:gamification`, 159 vérifications) sur
les cas dégénérés qu'aucun écran ne visitera : série rompue depuis un an, gel
épuisé, palier maximum.

### Barème

| Action | Points | Pourquoi |
|---|---|---|
| Post | 10 | la contribution de base |
| Post **avec code** | **20** | le code vaut le double : c'est la thèse du produit, et c'est ce qu'on relit dans six mois |
| Message de groupe | 5 | aider vaut moins que publier, mais compte |
| Message de groupe **avec code** | 10 | idem |
| Like reçu | 2 | le score mesure aussi la valeur reçue |
| Première action du jour | 5 | le rendez-vous quotidien |
| Bonus de série | +2/jour, plafonné à +14 | récompense la régularité sans la rendre facile |

### Paliers

Dix paliers à seuils Fibonacci — 0, 60, 150, 320, 600, 1050, 1700, 2700,
4200, 6500 — de **Nouveau** à **Légende**. Le coût d'un palier monte plus
vite que le précédent : la courbe accélère puis se calme, au lieu d'une
longue plate suivie d'un mur.

### Séries et gels de série

Un gel est gagné **tous les sept jours d'activité** et absorbe un jour
manqué. Duolingo vend ce mécanisme en abonnement ; ici il tombe du calcul,
sans table supplémentaire. La reconstitution est *rejouable* : les jours
sont parcourus du plus ancien au plus récent en dépensant un budget de gels,
donc deux appels avec le même ensemble de jours donnent le même résultat,
dans n'importe quel ordre.

### Défis du jour

Trois quêtes tirées d'un réservoir de cinq, en rotation déterministe sur le
numéro du jour. Pas de stockage : la rotation est calculée, l'accomplissement
est lu dans les actions du jour.

### Stories

Rail horizontal en tête du fil, lecteur plein écran avec barres de
progression, avance automatique, clavier (`←` `→` `Échap`) et pause au survol.

L'analogie Instagram est assumée, mais le contenu n'est pas un statut écrit à
la main : **une story est un post réellement publié**, et il est impossible
d'en publier une vide. Une personne qui n'a rien publié dans les dernières
24 h n'a pas de story. Ici la story répond à « qui est actif en ce moment »,
ce qui est l'information la plus utile d'un réseau professionnel.

### Top de la semaine

Classement sur une **fenêtre glissante de 7 jours**, jamais sur le score
cumulé : au bout de six mois, le cumul ne distingue plus rien — il ne mesure
plus que l'ancienneté d'inscription.

## Fondations : groupes, dépôt interne, GitHub

`supabase/004_foundation.sql` pose les tables des trois axes qui suivent, et
`lib/` pose leurs moteurs. **Il n'y a pas encore d'interface** : c'est la
socle, pas le produit.

### Espace de groupe façon Discord

Un groupe n'a plus « une conversation » mais des **canaux** (`channels`,
`channel_members`) ; `group_messages` gagne un `channel_id`.

C'est la seule partie des fondations qui soit **visible** : `/groups/[id]`
affiche les canaux, on peut en créer, et la discussion suit le canal
ouvert. Le rail est vertical à partir de 768 px, et devient une bande
défilante en dessous — un rail de 164 px volerait 42 % d'un écran de 390 px
pour rendre la discussion illisible.

Trois décisions d'écran :

- **l'URL suit le canal** (`?c=aide`) : le lien se partage et le
  rechargement revient au bon endroit ; un lien vers un canal supprimé
  ramène vers un canal réel au lieu d'afficher un écran vide ;
- **les messages sont mémorisés par canal** (`{channelId, rows}`) au lieu
  d'être remis à zéro au changement — sinon les messages du canal précédent
  s'afficheraient sous l'en-tête du nouveau pendant la requête ;
- **le canal créé est ouvert immédiatement.** L'utilisateur vient de dire
  « ici, maintenant » ; le renvoyer ailleurs serait une faute.

`004` retire explicitement les politiques RLS `gm_read` / `gm_insert` de la
migration 001 au lieu d'en ajouter de nouvelles. Les politiques d'une même
table s'appliquent en OU : en aurait-on laissé une, la règle large
« lisible par tout utilisateur connecté » aurait continué de fonctionner,
et n'importe quel membre de la plateforme lirait les canaux privés d'un
groupe.

### Dépôt interne conforme à git

`lib/git/` réimplémente le **modèle d'objets** de git : l'identité d'un
objet est le hachage de son contenu.

- `objects.ts` — SHA-1, format `blob` / `tree` / `commit` ;
- `paths.ts` — validation et canonisation des chemins, arbre de fichiers ;
- `history.ts` — construction d'arbre, diff ligne à ligne, commits, ancêtres.

Les sha produits sont **identiques à ceux de `git`**. C'est vérifié :
`scripts/test-foundation.ts` compare à des valeurs produites par git 2.43 sur
un vrai dépôt (blob vide, blob Python, arbre plat, arbre imbriqué, sous-
dossier, commit initial, commit avec parent). Une régression d'un octet dans
le format d'objet ne planterait nulle part dans l'interface — elle
produirait simplement des sha faux, invisibles jusqu'au premier push.

Pas de fusion automatique, volontairement : deux personnes qui modifient le
même fichier doivent **le voir**. Une fusion qui choisit un camp donne
l'illusion que tout va bien alors qu'une modification est perdue.

### Exécution dans le navigateur

`lib/execution/runtime.ts` déclare deux moteurs — Pyodide pour Python,
Sandpack pour JavaScript et TypeScript — et leurs garde-fous (délai, taille
de sortie, taille de fichier, nombre de fichiers).

Le choix est structurel : un exécuteur distant impose un serveur à
provisionner, payer et durcir. Sur l'appareil, aucun code d'un membre ne
tourne chez nous, il n'y a aucun coût par exécution, et ça marche hors
ligne — ce qui compte quand la connexion est le premier obstacle.

### Raccordement GitHub

`lib/github/link.ts` : analyse d'une référence de dépôt, validation de nom
de branche, et **plan de synchronisation** affiché avant toute action.

Trois partis pris :

1. **Le projet DevNet reste la source de vérité.** Le dépôt GitHub est une
   destination, jamais une base primaire.
2. **La connexion est par personne.** Personne ne pousse avec le jeton de
   quelqu'un d'autre — une seule révocation ne casse pas le groupe. Le jeton
   n'est jamais stocké en clair : `github_connections.token_ref` ne contient
   qu'une référence vers un coffre, et la politique RLS n'ouvre la table
   qu'à son propriétaire.
3. **Le mode par défaut est manuel.** Pousser rend le code public, et
   « public » est une décision, pas un effet de bord. Quand les deux côtés
   ont avancé depuis la dernière synchronisation, le plan renvoie
   `divergence` et **refuse** de choisir.
