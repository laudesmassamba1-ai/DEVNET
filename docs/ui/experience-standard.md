# Norme d'expérience — DevNet

**Statut : contraignante.** Toute surface, tout mouvement, tout payload et
toute exécution de code s'y conforment. Un écart se justifie par une mesure,
jamais par un goût. Les budgets du §4 se vérifient ; les règles du §1 se
relisent en revue.

Sources de vérité existantes : `app/globals.css` (jetons),
`components/Motion.tsx` (grammaire de mouvement), `docs/ui/inventory.md`
(état réel des surfaces), `docs/ui/coverage.md` (feuille de route).

## 1. Doctrine

DevNet n'est pas un fil d'actualité avec du code à côté. C'est un **réseau de
développeurs** : ce qu'on y publie doit pouvoir être lu, compris, exécuté et
relié à un dépôt. Trois conséquences, qui décident de tout le reste :

1. **La donnée est pauvre, le geste est riche.** Un post transporte du texte,
   du code, une référence de média — jamais un nom d'auteur recopié, jamais un
   compteur figé. L'interface compense par le mouvement, la typographie et la
   réponse immédiate, pas par des kilo-octets.
2. **Le serveur décide, l'écran propose.** Toute lecture passe par `/api/**`,
   sous RLS, avec l'identité de la session. Un écran qui interroge la base est
   un contournement de la règle d'accès, pas une optimisation.
3. **Le mouvement explique, il ne décore pas.** Il dit d'où vient un élément,
   ce qui vient de changer, ce qui a été acquitté. S'il ne dit rien, il coûte
   et il part.

### 1.1 Règles non négociables

- Jetons uniquement : aucune couleur, durée, courbe ou rayon en dur hors
  `AnimatedLogo`, `SplashScreen`, `LoadingLogo`, `themeColor`.
- On anime `transform`, `opacity`, `filter`, `clip-path`. Jamais la
  disposition (`width`, `height`, `top`, `left`, `margin`).
- `prefers-reduced-motion` neutralise tout, y compris le JavaScript
  (`Tilt`, `useCount`, `waitForExit`).
- Une page de fil = une requête de fil + une requête d'hydratation.
- Toute liste est bornée ; au-delà de 60 éléments, elle est virtualisée.
- Le code publié ne s'exécute que sur clic, dans un bac à sable, avec limites.
- Cinq états par écran : chargement, vide, erreur avec reprise, hors-ligne,
  succès.

## 2. Stories

Une story est une ligne de `stories` (migration `018`), avec `expires_at` posé
par la base. Elle vit 24 h et disparaît par la politique de lecture — jamais
par un filtre client.

### 2.1 Ce qu'une story doit permettre

| Geste | Comportement attendu | Donnée |
|---|---|---|
| Aimer | double-tap ou cœur ; acquittement immédiat, compteur visible par l'auteur | `story_likes(story_id, user_id)` |
| Répondre | réponse écrite → fil de messages privé entre les deux personnes | `story_replies(story_id, from_id, dm_message_id)` |
| Poser un sticker | glisser, pincer, tourner ; coordonnées **normalisées** (0–1) | `story_stickers(story_id, sticker_id, x, y, scale, rotation, z)` |
| Voir qui a vu | liste pour l'auteur seulement | `story_views(story_id, viewer_id, seen_at)` |
| Signaler | même composant que le reste du produit | `reports` existant |

Les coordonnées normalisées sont une décision de conception, pas un détail :
une story se regarde en 9:16 sur téléphone et en portrait centré sur bureau ;
des pixels absolus casseraient l'un des deux.

### 2.2 Lecture

- Progression segmentée en haut, une barre par story de la série.
- Appui maintenu = pause ; relâchement = reprise ; glissement vertical =
  fermeture ; horizontal = story suivante/précédente.
- Clavier : `←`/`→` naviguent, `Espace` met en pause, `Échap` ferme.
- Préchargement des **deux** stories suivantes, jamais de la série entière.
- Le média est une **référence** (`media_url`), pas des octets en base : une
  story de 400 Ko dans une colonne ferait payer chaque lecture de la liste.
- Sans média, la story se lit quand même (texte + dégradé du thème). L'écran
  ne doit jamais supposer une image.

### 2.3 Réponses et stickers

Une réponse à une story ouvre un message privé citant la story : la réponse
n'est pas un commentaire public, c'est une conversation. Un sticker posé est
une **référence** à un sticker du catalogue ou créé par l'auteur ; il n'est
jamais aplati dans l'image, sinon on perd le lien, le signalement et le
compteur d'usage.

## 3. Stickers

Les stickers sont le vocabulaire rapide du réseau : un développeur n'écrit pas
« je suis d'accord », il pose le sticker qui le dit.

### 3.1 Modèle

| Table | Rôle |
|---|---|
| `stickers` | un sticker : propriétaire, pack, type (`image`, `animé`, `texte`), clé de stockage, dimensions, octets, empreinte |
| `sticker_packs` | un pack nommé, visibilité `privé` / `abonnés` / `public` |
| `comment_stickers` | usage dans un commentaire (`≤ 3` par commentaire) |
| `story_stickers` | pose sur une story (§2) |
| `message_stickers` | envoi en message privé |

Comme les médias de story : **le stockage porte les octets, la base porte la
référence**. Une colonne `bytea` rendrait chaque liste de packs coûteuse.

### 3.2 Studio

Créer un sticker : photo recadrée, dessin au doigt, texte composé, assemblage
d'emoji. Quatre contraintes :

1. **Re-encodage serveur obligatoire.** Le client propose ; le serveur
   ré-encode, redimensionne (≤ 512 × 512), retire les métadonnées et calcule
   l'empreinte. Un fichier client n'est jamais publié tel quel.
2. **Animé ≤ 60 Ko, ≤ 3 s.** WebP animé de préférence ; au-delà, c'est une
   vidéo de story, pas un sticker.
3. **Fond transparent conservé** (WebP avec alpha) ; pas de JPEG pour un
   sticker détouré.
4. **Modération dès la publication** : signalement, retrait, et pack
   `public` soumis à revue. Un sticker public est visible par tous : c'est un
   contenu, pas un réglage.

### 3.3 Usage

- Commentaires : rendu en ligne, taille bornée, jamais cliquable vers un
  fichier arbitraire.
- Stories : glisser/pincer/tourner, coordonnées normalisées, ordre `z`.
- Messages : envoi direct, historique conservé même si le sticker est retiré
  du catalogue (référence + copie d'affichage en cache).
- Packs : création, partage d'un pack, favoris. La RLS lit un sticker si son
  pack est public, si on en est l'auteur, ou si on est abonné à l'auteur.

## 4. Compression, latence, mémoire

Objectif : un fil qui s'ouvre en moins de deux secondes sur un téléphone
correct, sans faire gonfler la facture de la base Systalink.

### 4.1 Budgets mesurables

| Mesure | Plafond | Où |
|---|---|---|
| JS initial par route | 170 Ko gzip | build Next |
| Première page de fil (JSON) | 60 Ko gzip | `curl --compressed` |
| Hydratation du fil | 4 Ko gzip | `/api/feed/hydration` |
| p95 route de lecture | 250 ms | journaux serveur |
| Requêtes SQL par écran de fil | 6 | journal Postgres |
| Image de publication | 120 Ko | fichier servi |
| Story vidéo | 1,5 Mo, ≤ 30 s, 9:16 | fichier servi |
| Sticker animé | 60 Ko, ≤ 512², ≤ 3 s | fichier servi |
| Animation d'interface | 90–300 ms | jetons `--d-*` |
| Éléments avant virtualisation | 60 | code |
| Mémoire d'onglet au repos | 250 Mo | DevTools |

### 4.2 Payload

- **Projection** : on ne renvoie que les colonnes affichées. `select *` est
  toléré dans l'adaptateur historique du fil, interdit dans tout nouvel
  adaptateur.
- **Curseur** `(created_at, id)` : l'égalité de dates ne doit ni sauter ni
  dupliquer une ligne. Taille de page 12 par défaut, 30 au maximum.
- **Pas de doublons d'auteur** : l'auteur est joint une fois par page, jamais
  recopié dans chaque ligne.
- **Compression HTTP** : brotli au-delà de 1 Ko ; `no-store` pour tout ce qui
  dépend du lecteur ; `ETag` + `If-None-Match` pour les listes publiques.
- **Binaire (CBOR/MessagePack) : seulement après mesure.** Si JSON reste sous
  30 Ko et se parse en moins de 8 ms, un format binaire ajoute une dépendance
  et un débogage pour rien.
- **Hydratation** : une requête, quatre états (§5 de `modules/feed`), aucun
  tableau vide sérialisé à la place de `null`.

### 4.3 Images et médias

- Pipeline serveur : original → AVIF + WebP, largeurs 320 / 720 / 1080,
  qualité 45–60, métadonnées retirées, `srcset` + `sizes`.
- Espace réservé : `blurhash` court (≤ 30 caractères) ou dégradé du thème ;
  jamais de saut de mise en page (CLS contrôlé).
- Chargement différé sous la ligne de flottaison ; priorité haute pour la
  seule image du premier écran.
- `Cache-Control: public, max-age=31536000, immutable` sur les médias
  versionnés (empreinte dans l'URL) — jamais sur une réponse de fil.

### 4.4 Base de données

- Index de couverture `(user_id, post_id)` sur `post_likes`, `reposts`,
  `bookmarks`, `reactions` : l'hydratation est un `index-only scan`.
- `posts(created_at desc, id)` pour le fil ; `stories(expires_at)` pour le rail.
- Le fil « Abonnements » se lit par jointure sur `follows`, pas par un tableau
  d'identifiants transmis en paramètre.
- Une transaction `withUser` par requête, pas par ligne.
- `statement_timeout` court côté serveur ; une requête lente est une panne.

### 4.5 Client

- `lib/queryCache` : TTL 30 s, invalidation à la mutation, **plafond LRU**
  (200 entrées). Un cache sans plafond est une fuite.
- Changement de portée du fil : `startTransition`, jamais un blanc.
- Préchargement de la page suivante à 200 px du bas, sur `requestIdleCallback`.
- `content-visibility: auto` + `contain: content` sur les cartes hors écran.
- Libération des `blob:` URL ; pas de tampon média conservé après fermeture
  de la visionneuse.

### 4.6 Mémoire

- Virtualisation au-delà de 60 éléments, avec hauteur estimée puis mesurée.
- Aucune structure qui grandit sans borne dans un `useRef` (historique de
  frappe, piles de toasts, files de messages).
- Les abonnements temps réel sont retirés (`removeChannel`) au démontage :
  un canal oublié garde un socket et un tampon.

## 5. Code exécuté dans le fil

Le code publié doit pouvoir **tourner**, pas seulement s'afficher. C'est la
différence entre DevNet et un réseau social qui accepte des captures d'écran.

### 5.1 Règles de sûreté

1. **Jamais d'exécution automatique.** Un bouton « Exécuter » explicite, un
   clic, une surface nommée.
2. **Bac à sable** : `iframe` avec `sandbox="allow-scripts"` (sans
   `allow-same-origin`), `srcdoc`, CSP `default-src 'none';
   script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'`.
   Aucun accès au DOM de l'application, aux cookies, au stockage ni au réseau.
3. **Limites** : 2 s de CPU, 32 Mo, 1 Mo de sortie, 500 lignes affichées.
   Dépassement = arrêt, pas d'attente.
4. **Sortie en texte** : `<pre>`, échappé, jamais `innerHTML`. Une sortie est
   une donnée, pas du balisage.
5. **Rejouable, pas stocké comme vérité** : la sortie n'est jamais persistée
   comme résultat fiable ; « rejouer » réexécute le code.
6. **Chargement à la demande** : le moteur (voir `lib/execution/`) est
   importé dynamiquement au premier clic ; son shim reste sous 40 Ko gzip.

### 5.2 Parcours

- Carte de post avec code → bouton « Exécuter » → panneau de sortie dans la
  carte (pas de modale : on veut garder le fil lisible).
- Entrée standard demandée ? Un champ apparaît **avant** l'exécution, jamais
  pendant.
- Langages : ceux que le moteur sait déjà traiter (TypeScript transpilé,
  WASI). Un langage non supporté affiche « non exécutable ici » avec la
  raison — jamais un faux bouton.
- Résultat partageable : lien vers le post, pas vers une sortie.

## 6. Parité et complémentarité

### 6.1 Tableau de parité

`✅` livré · `◐` partiel · `—` absent · `✗` hors périmètre assumé

| Fonction | Instagram | Facebook | WhatsApp | X | DevNet |
|---|---|---|---|---|---|
| Fil chronologique | ◐ | ◐ | — | ✅ | ✅ |
| Fil algorithmique | ✅ | ✅ | — | ◐ | ✗ (choix : chronologique) |
| Images | ✅ | ✅ | ✅ | ✅ | — |
| Vidéo / reels | ✅ | ✅ | ◐ | ✅ | — |
| Stories texte | ✅ | ✅ | ◐ | — | ✅ |
| Stories média | ✅ | ✅ | ✅ | — | ◐ (`media_url` posé) |
| Aimer une story | ✅ | ✅ | — | — | — (spécifié §2) |
| Répondre à une story | ✅ | ✅ | ✅ | — | — (spécifié §2) |
| Stickers sur story | ✅ | ✅ | ◐ | — | — (spécifié §2) |
| Stickers personnalisés | ◐ | ◐ | ✅ | — | — (spécifié §3) |
| Réactions emoji | ◐ | ✅ | ✅ | ◐ | ✅ |
| Commentaires imbriqués | ✅ | ✅ | — | ✅ | ◐ (un niveau) |
| Repost / partage | ✅ | ✅ | ◐ | ✅ | ✅ |
| Signets / collections | ✅ | ✅ | ✅ | ✅ | ◐ (liste plate) |
| Messages 1:1 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Messages de groupe | ✅ | ✅ | ✅ | ◐ | — |
| Appels audio/vidéo | — | ◐ | ✅ | — | ✗ |
| Statuts / présence | ◐ | ◐ | ✅ | — | ◐ (rail de présence) |
| Groupes / communautés | — | ✅ | ◐ | ◐ | ◐ |
| Événements | — | ✅ | — | — | — |
| Sondages | ✅ | ✅ | ✅ | ✅ | — |
| Live | ✅ | ✅ | — | ✅ | ✗ |
| Recherche | ✅ | ✅ | ◐ | ✅ | ◐ |
| Hashtags | ✅ | ✅ | — | ✅ | ◐ |
| Mentions | ✅ | ✅ | ◐ | ✅ | ◐ |
| Notifications | ✅ | ✅ | ✅ | ✅ | ✅ |
| Blocage / sourdine | ✅ | ✅ | ✅ | ✅ | — (promis dans `/aide`) |
| Vérification | ✅ | ✅ | ◐ | ✅ | ✅ |
| Marketplace | ◐ | ✅ | — | — | ✗ |
| Code exécutable | — | — | — | — | ◐ (spécifié §5) |
| Lien dépôt / issue / PR | — | — | — | — | ✅ (import GitHub) |

Deux règles de lecture : une ligne `—` de DevNet sans spécification est une
ligne à écrire avant de coder ; une ligne `✗` est un choix, pas un oubli.

### 6.2 Ce que DevNet ne copie pas

- Pas de fil algorithmique opaque : le fil est chronologique et explique sa
  portée (« Tout » / « Abonnements »).
- Pas de métrique de vanité : pas de « vues » publiques sur un post.
- Pas de croissance par notifications agressives : les notifications sont
  catégorisées et réglables.
- Pas de dépendance à un seul fournisseur : lecture PostgreSQL directe,
  Supabase en retrait progressif.

### 6.3 Complémentarité avec GitHub

DevNet n'héberge pas la forge. Il **raconte** le travail dont GitHub garde la
trace.

- Un post peut référencer un dépôt, un commit, une issue, une PR ; la carte
  affiche l'état (ouvert, fusionné, échec CI) lu à la demande.
- Le code d'un post peut venir d'un fichier du dépôt importé ; le lien reste
  vers GitHub pour l'édition.
- Un extrait exécutable est un **banc d'essai**, pas un dépôt : pas de
  branches, pas de revue de code dans DevNet.
- Import à sens unique (lecture) ; toute écriture vers GitHub est explicite,
  confirmée, et journalisée.
- Ce que GitHub ne fait pas et que DevNet apporte : parcours, progression,
  preuves, communauté, relecture par les pairs, contexte africain.

## 7. Identité visuelle et mouvement

Les jetons sont la seule source. `app/globals.css` définit :

- Couleurs : `--color-void/page/surface/surface-2/surface-3/chalk/chalk-2/
  chalk-3/line/signal/phosphor/ok/danger/warn/info`, avatars pastel.
- Typographie : `--font-display`, `--font-sans` (Instrument Sans),
  `--font-mono` (IBM Plex Mono). Chiffres tabulaires, pseudonymes en mono.
- Courbes : `--ease-entrance`, `--ease-spring`, `--ease-continuous`,
  `--ease-pop`, `--ease-gravity`, `--ease-snap`, `--ease-timing`.
- Durées : `--d-instant` 90 ms, `--d-fast` 140, `--d-base` 180, `--d-slow`
  200, `--d-enter` 180, `--d-scene` 200, `--d-burst` 300 ; les durées longues
  (`--d-story`, `--d-caret`, `--d-orbit`) ne concernent jamais une surface.
- Formes : `--radius-chip` 6, `--radius-input` 6, `--radius-card` 10 ;
  gouttière 16 ; cible 44.
- Élévation : une seule ombre neutre (`--shadow-sh-1`), réservée aux feuilles
  et menus.

Rôles de `components/Motion.tsx` : `fade`, `slide`, `rise`, `scale`, `soft`,
`rotate`, `exit`, `pop`, `lift`, `press`, `spin`, `pulse`, `breathe`, `scan`,
`burst`, `deny`, `sheet`, `veil`, `none`. Un rôle = une intention ; on n'écrit
pas de `@keyframes` local dans une page.

Dégradés : un dégradé ne remplace pas une couleur de rôle ; il ne sert qu'à
la matière (anneau de story, héros, logo). En thème clair, il se réduit ou
disparaît — un dégradé décoratif qui reste identique dans les deux thèmes est
un oubli de thème.

## 8. Pages, fenêtres, navigation

- Routes existantes : voir `docs/ui/inventory.md` §2 (36 routes). Toute
  nouvelle surface ajoute sa ligne à `docs/ui/coverage.md` avant le code.
- Surfaces superposées et leur ordre : contenu 0, collant 80, composeur 90,
  navigation 100, feuille 200, modale 300, toast 400.
- Chaque surface superposée : `Échap` ferme, focus piégé, retour du focus à
  l'élément déclencheur, verrou de défilement rendu à la fermeture.
- Les surfaces partageables portent un état d'URL : `/stories/[id]`,
  `/post/[id]?comment=…`, `/feed?story=…`. Un état qui ne se partage pas
  n'existe pas pour un lien.
- Mobile : barre basse, feuilles glissantes (fermeture par glissement),
  zones sûres (`env(safe-area-inset-*)`), cibles 44 px.
- Palette de commandes `⌘K` / `Ctrl+K` : actions et navigation, jamais de
  contenu privé dans les suggestions.
- Raccourcis : `?` affiche l'aide ; `g` puis une touche navigue ; aucun
  raccourci ne déclenche une action destructive sans confirmation.

## 9. Accessibilité et langues

- Contraste AA minimum sur les deux thèmes ; le thème clair n'est pas une
  inversion automatique.
- `prefers-reduced-motion`, `prefers-contrast`, `forced-colors` : trois
  requêtes à respecter, pas une seule.
- Images décoratives `alt=""`, images de contenu `alt` utile ; un sticker a
  un texte alternatif (`:nom_du_sticker:`).
- Formulaires : libellé lié, erreur annoncée (`aria-live`), pas d'erreur
  uniquement par la couleur.
- Aucune information portée par la seule couleur (état d'une PR, d'un
  message, d'un formulaire).
- Textes en français aujourd'hui ; toute nouvelle chaîne évite la
  concaténation grammaticale et reste traduisible (pas de « 1 posts »).

## 10. Portes et définition de « terminé »

```bash
npm run test:experience   # norme, jetons, mouvement, motifs interdits
npm run test:boundaries   # le navigateur ne lit pas la base
npm test                  # suite complète
npx tsc --noEmit
npx eslint app components lib
```

Une surface est terminée quand : elle a cinq états, ses mesures sont notées,
`prefers-reduced-motion` la neutralise, le clavier la traverse entièrement,
`axe` ne signale rien de bloquant, et sa ligne de `coverage.md` est à jour.

**Ce qui n'est pas terminé :** une surface qui « marche » sur un écran large,
en thème sombre, avec une bonne connexion, sans état vide, sans mesure et
sans le moindre test de clavier.
