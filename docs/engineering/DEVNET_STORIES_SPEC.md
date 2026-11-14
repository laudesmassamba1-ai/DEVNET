# DEVNET — spécification Stories

> État vérifié le 2026-11-14. Décrit les invariants réellement appliqués et
> les fonctions encore absentes. Ne pas exposer une UI dont le backend ne
> garantit pas la règle.

## 1. Modèle actuel

| Objet | Table / module | Remarque |
|---|---|---|
| Story | `stories` (`id`, `author_id`, `caption`, `media_url`, `expires_at`) | `expires_at` par défaut `now() + 24 h` |
| Média re-encodé | `story_media` (`story_id`, `mime`, `bytes`, dimensions, durée) | `bytea`, policy par story |
| Vue | `story_views` | lisible par l'auteur seul |
| Réaction | `story_likes` | like idempotent par (story, utilisateur) |
| Réponse | message privé via `reply` | crée la conversation et le message |
| Sticker posé | `story_stickers` | coordonnées normalisées 0–1 |
| Catalogue | `stickers` | image validée côté serveur |

## 2. Invariants

- Une story appartient à un seul propriétaire, lu depuis la session.
- Une story expirée n'est lisible par aucune route normale : la policy
  `expires_at > now()` s'applique en base ; le client ne filtre pas.
- Une vue est dédupliquée par (story, lecteur) ; le rail lit l'état « déjà vu »
  dans le stockage local de l'appareil, car `story_views` est privé.
- Un like, une réponse ou un sticker ne peuvent pas être faits au nom d'un
  autre : l'identifiant vient de la session.
- Les gestes invalides sont refusés avant Postgres (`readStoryAction`).
- Le média d'une story n'est lisible que par les personnes autorisées à lire
  la story.

## 3. Audience — **non implémentée**

Il n'existe aujourd'hui qu'une règle implicite : toute story vivante est
lisible par tout compte authentifié. Les options « abonnés », « liste
personnalisée », « cercle » et « exclusions » ne sont **pas** disponibles.

Pour l'ajouter sans mettre en danger les contenus privés :

1. Ajouter `audience_policy` (enum ou JSON validé) et `audience_updated_at`.
2. Écrire une fonction SQL `can_read_story(story_id)` couvrant public,
   abonnés (`follows`), liste et exclusions.
3. Remplacer la policy `stories_read` et `story_media_read` par cette fonction.
4. Tester : A lit une story publique ; B ne lit pas la story « liste » de A ;
   anonyme ne lit rien de privé ; l'auteur lit toujours la sienne.
5. Seulement ensuite, exposer l'UI de choix d'audience.

Le sens de `follows` est explicite : `follower_id` suit `followee_id`.
« Abonné de A » = ligne où `followee_id = A`.

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

### Connu non fait

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
npm run verify:ui:browser       # Playwright, stories incluses
```

À ajouter : progression image/texte, durée vidéo réelle, fin vidéo, autoplay
refusé, pause sur média enfant, onglet caché, navigation entre auteurs,
clavier dans un champ, déplacement de sticker aux flèches, états d'erreur.
