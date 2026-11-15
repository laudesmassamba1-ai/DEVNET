# DEVNET — spécification Stories

> État vérifié par lecture du code le 2026-11-15, commit `203fd1a`. Ce
> document décrit les invariants réellement appliqués, les limites connues et
> les preuves encore dues. Il ne remplace pas un test d'intégration.

## 1. Modèle actuel

| Objet | Table / module | Remarque |
|---|---|---|
| Story | `stories` (`id`, `author_id`, `caption`, `media_url`, `audience`, `expires_at`) | `expires_at` par défaut `now() + 24 h` |
| Média re-encodé | `story_media` (`story_id`, `mime`, `bytes`, dimensions, durée) | `bytea`, policy par story |
| Média objet | `stories.media_url` → `/api/media/<path>` ou URL objet | vérifié à la publication |
| Vue | `story_views` | lisible par l'auteur seul |
| Réaction | `story_likes` | like idempotent par (story, utilisateur) |
| Réponse | message privé via `reply` | crée la conversation et le message |
| Sticker posé | `story_stickers` | coordonnées normalisées 0–1 |
| Catalogue | `stickers` | image validée côté serveur |

## 2. Invariants

- Une story appartient à un seul propriétaire, lu depuis la session.
- Une story expirée n'est lisible par aucune route normale : les policies
  combinent `expires_at > now()` et l'audience.
- Trois audiences existent : `public`, `followers`, `private`. La fonction
  `story_is_live(uuid)` (migration `070`) porte la décision pour la story et
  ses tables filles ; `stories_read` et `story_media_read` l'appliquent.
- Une vue est dédupliquée par (story, lecteur) ; le rail lit l'état « déjà vu »
  dans le stockage local de l'appareil, car `story_views` est privé.
- Un like, une réponse ou un sticker ne peuvent pas être faits au nom d'un
  autre : l'identifiant vient de la session.
- Les gestes invalides sont refusés avant PostgreSQL (`readStoryAction`).
- Le média d'une story n'est lisible que par les personnes autorisées à lire
  la story, sur les deux chemins. Cette règle est portée par `story_is_live`
  pour `story_media` et par `can_read_media_file` (migration `081`) pour
  `/api/media/<path>`.

## 3. Audience et média — état réel

L'audience est **implémentée** dans la base et dans l'interface. Le sens de
`follows` est explicite : `follower_id` suit `followee_id` ; « abonné de A » =
ligne où `followee_id = A`.

Deux chemins de média coexistent :

1. **`story_media`** : les octets sont lus par
   `app/api/stories/[id]/media/route.ts` via `fetchStoryMedia`, sous la policy
   `story_media_read` et donc via `story_is_live`. Le cache est
   `private, no-store`.
2. **`stories.media_url`** : une URL objet ou `/api/media/<path>`. Les octets
   passent alors par `app/api/media/[path]/route.ts`, qui applique
   `can_read_media_file`.

Le second chemin était un **défaut de confidentialité P1** : la migration
`068` classait bien un média de story comme privé, mais `can_read_media_file`
autorisait toute story vivante à `auth.uid() is not null`, sans vérifier
l'audience. La migration `081_story_media_audience.sql` ferme ce défaut :

- la branche story applique désormais `public`, `followers` ou `private` et
  exige `expires_at > now()` ;
- le propriétaire du média doit être l'auteur de la story ;
- `media_path_of()` extrait le chemin exact en fin d'adresse, sans joker SQL,
  et reconnaît la forme relative comme l'URL absolue de même origine ;
- `enforce_media_owner()` s'applique aussi aux stories ;
- l'auteur conserve l'accès après expiration par la branche `owner_id`.

Preuves exécutées : `npm run test:media-security` (36 vérifications) et
`npm run test:stories-audience` sur base locale (26 vérifications : trois
audiences, anonyme, abonné, tiers, auteur, URL absolue, story expirée, refus
d'un média d'autrui). La migration `081` est appliquée en local et en
production ; le contrat de schéma et `/api/ready` restent verts.

Limite restante : un média stocké sur R2/Blob avec une URL publique reste
lisible directement par cette URL. Le repli PostgreSQL est le seul chemin
réellement privé de bout en bout.

## 4. Lecteur (`components/StoryViewerLive.tsx`)

### États

- Chargement, story absente, média indisponible, erreur réseau.
- Lecture, pause (appui long, onglet caché, menu, modal), transition, fin.
- Fin de série de l'auteur → auteur suivant ; fin du fil → fermeture/état de
  fin explicite.

### Progression

- Image/texte : durée `STORY_MS` (7 s), horloge basée sur le temps écoulé.
- Vidéo : durée réelle (`loadedmetadata`), avancement sur `ended`, pas sur une
  constante. Pause sur `visibilitychange` (onglet caché).
- Nettoyage des timers à chaque changement de story et au démontage.

### Gestes

- Tap droite : avancer ; tap gauche : revenir.
- Appui long : pause ; relâchement : reprise si aucune autre pause active.
- Balayage vertical : fermer ; horizontal : changer d'auteur (hors contrôle
  interactif).
- Un geste sur un sticker, un lien, un bouton audio ou la barre de réponse ne
  déclenche pas la navigation (`stopPropagation` + cible interactive).

### Clavier et accessibilité

- `Escape` ferme, `Espace` met en pause/reprend, flèches naviguent **sauf**
  quand le focus est dans un champ ou sur un calque en déplacement.
- Dialogue modal : focus enfermé, restauré à la fermeture.
- `aria-live="polite"` pour les changements utiles (story suivante, erreur),
  sans annonce à chaque image.
- Le lecteur reste utilisable sans geste tactile (boutons visibles).

### Preuves encore dues

- Machine d'état formelle (`idle → loading → playing ↔ paused → …`).
- Focus trap complet et restauration vérifiée.
- Gestion explicite du blocage autoplay (démarrage utilisateur).
- Libération des sources vidéo à la sortie (`video.src = ""`, `load()`).

## 5. Rail (`components/StoryRail.tsx`)

- Avatar réel (`avatar_url`) avec repli sur les initiales/couleur.
- Distingue non vu / partiellement vu / tout vu (stockage local).
- Bouton de création : nom accessible, surface ≥ 44 px, focus visible.
- Défilement horizontal naturel, sans bloquer le scroll vertical.
- Ne montre aucun aperçu d'une story non autorisée.

## 6. Éditeur (`components/StatusComposer.tsx`, `components/StoryStudio.tsx`)

Deux composants coexistent encore ; c'est une dette identifiée (ARC-002).

- Sélection d'un nouveau média : l'ancienne référence est invalidée
  (`imageRef` réinitialisé) pour éviter d'exporter l'image A après avoir
  choisi B.
- Publication : `await` des handlers, fermeture seulement après succès,
  message d'erreur sans perte de composition.
- Composition : texte, sticker, position normalisée, rotation, échelle.
- **Absent** : modèle de scène versionné, export composite vidéo+texte,
  filtres/recadrage complets, dessin, timeline vidéo, brouillons persistants,
  recherche GIF réelle sans clé (l'UI doit dire « non configuré »).

## 7. Tests

Disponibles :

```bash
npm run test:api-stories
npm run test:stories-postgres   # nécessite une base de test, jamais la prod
npm run test:stories-audience   # base locale uniquement, écrit puis nettoie
npm run verify:ui:browser       # Playwright, stories incluses
```

À ajouter ou à faire tourner :

- test HTTP multi-comptes sur `/api/stories/[id]/media` et
  `/api/media/<path>` (le test SQL couvre déjà la décision média) ;
- progression image/texte, durée vidéo réelle, fin vidéo, autoplay refusé ;
- pause sur média enfant, onglet caché, navigation entre auteurs ;
- clavier dans un champ, déplacement de sticker aux flèches, états d'erreur.

## 8. Décision de publication

Une story `followers` ou `private` peut être présentée comme protégée côté
base et côté route `/api/media` : la décision d'audience est appliquée et
testée. La réserve commerciale reste le stockage objet à URL publique et
l'absence de test HTTP multi-comptes sur les deux routes ; ne pas promettre
une confidentialité des octets chez le fournisseur tant que le bucket privé
n'est pas livré.
