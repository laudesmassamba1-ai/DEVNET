# DevNet — guide de style

## Direction — « Carnet de terrain »

Trois directions ont été explorées : **Marge de contribution** (carnet
d'atelier), **Cahier de revue** (annotations) et **Index de terrain** (repères
de temps). Le système retenu les compose au lieu d'en choisir une : DevNet est
un carnet de terrain, c'est-à-dire un support de lecture daté, annoté et
structuré par une marge.

La règle qui rend la fusion tenable : **une seule teinte d'action, aucune
couleur supplémentaire pour distinguer les registres**. La marge, le filet et
la typographie suffisent à séparer conversation, code et annotation. Une
troisième couleur d'accent aurait transformé la fusion en trois systèmes
juxtaposés.

### Les trois couches

| Couche | Héritage | Ce qu'elle apporte | Où ça se voit |
|---|---|---|---|
| **Marge** | Marge de contribution | Papier chaud, filets à la place des cartes empilées, gouttière de repères stable | Fil, publications, blocs de code |
| **Cadran** | Index de terrain | Heure absolue dans la marge, heure relative dans l'en-tête, rail vertical continu entre deux publications | `components/PostCard.tsx` |
| **Registre** | Cahier de revue | Les annotations (réponses, contestations) se lisent dans un registre indenté, métadonnées en mono | Panneaux de commentaires et de modération (à étendre) |

La fusion ne change ni la palette, ni les fontes : elle change **ce que la
marge raconte**. Avant, la gouttière affichait un numéro de ligne fixe ; elle
porte maintenant l'heure du contenu, comme un carnet qu'on date en marge.

### Ce que la fusion écarte

- La carte flottante, l'ombre portée et le verre : les publications sont
  séparées par un filet, jamais empilées comme des vignettes.
- Une seconde couleur structurelle : le registre se distingue par le retrait,
  le filet et la fonte mono, pas par un bleu « annotation ».
- Le défilement infini et les animations d'entrée longues : le fil reste un
  dossier qu'on parcourt, avec « Charger plus » explicite.
- Les motifs culturels décoratifs : la signature vient de la structure, pas
  d'un ornement.

## Couleurs

| Rôle | Clair | Sombre |
|---|---|---|
| Fond | `#F6F4EF` | `#11110E` |
| Surface | `#FBFAF7` | `#191914` |
| Encre | `#16150F` | `#ECE9DF` |
| Texte secondaire | `#6B685E` | `#9A978B` |
| Filet | `#E3DFD3` | `#2A2A23` |
| Action | `#C2410C` | `#FF7A45` |
| Succès | `#2F7D4F` | `#5FBF86` |
| Erreur | `#B3261E` | `#FF6B61` |

L'accent sert aux liens, à l'onglet actif et à l'action principale. Sur une
action pleine, le texte est clair en thème clair et encre en thème sombre.
Le succès et l'erreur ne colorent que des états sémantiques. Les tokens sont
définis dans `app/globals.css` sous `@theme` et les thèmes sont posés sur
`html[data-theme]`.

La règle du vert et du bleu reste celle du produit : **quand ils apparaissent,
c'est du code ou de la donnée vivante, jamais un bouton.**

## Typographie

- **Instrument Sans** : interface, lecture et titres.
- **IBM Plex Mono** : code, pseudonymes, dates, compteurs et repères de marge.
  Elle n'est pas préchargée sur toutes les pages : le navigateur la récupère
  seulement quand un écran utilise effectivement le monospace.

Les deux fontes sont auto-hébergées dans `app/fonts/` via `next/font/local`
avec `display: swap`. La hiérarchie suit sept tailles : 28, 22, 18, 15, 13,
12 et 11 px. Les compteurs et les heures utilisent les chiffres tabulaires
(`tnum`), pour qu'une colonne de repères ne danse pas d'une ligne à l'autre.

### Registres de lecture

| Registre | Fonte | Rôle |
|---|---|---|
| Conversation | Instrument Sans, 14,5 px, interligne 1,66 | Le texte d'une publication ou d'une réponse |
| Métadonnées | IBM Plex Mono, 11 px, `label-micro` | Auteur, date, compteurs, heure de marge |
| Code | IBM Plex Mono, 13 px, interligne 1,65 | Extrait, diff, sortie d'exécution |

Un même écran peut afficher les trois, mais jamais deux registres dans la même
taille : c'est la fonte qui sépare, pas la couleur.

## Espacement et formes

- Échelle de 4 px : 4, 8, 12, 16, 24 et 32 px.
- Petit rayon : 6 px pour les champs et commandes.
- Rayon moyen : 10 px pour les panneaux et blocs de code.
- Filet de 1 px pour les séparations ; pas d'ombre sur les publications.
- Une élévation neutre est réservée aux feuilles et aux menus.
- Gouttière de repères : 32 px de large, filet vertical de 1 px à droite.
- Cibles tactiles de 44 px minimum ; focus clavier visible.

## Composants

- **Icônes** : Iconoir (MIT), choisi parmi les familles recherchées pour son
  dessin propre, ses glyphes orientés métier et ses variantes solides. Les
  icônes sont importées par le mapping unique `Icon`, puis optimisées par
  Next.js ; l'UI n'utilise aucun CDN.
- **Fil** : une colonne de lecture, tabs « Tout / Abonnements / Communautés »,
  densité confortable ou compacte, bouton « Charger plus » explicite.
- **Publication** : auteur et pseudonyme, date relative, contenu, code, projet
  et actions. La gouttière porte le fichier, **l'heure absolue sur deux
  lignes** et le nombre de réponses ; le rail vertical qui la traverse est une
  liaison, pas un séparateur.
- **Réponses et annotations** : registre indenté sous la publication, auteur et
  date en mono, filet à gauche du bloc. Une réponse n'est pas une seconde
  publication : elle ne reprend ni l'avatar de tête ni la barre d'actions
  complète.
- **Code** : coloration issue du surligneur local existant, thème adapté au
  clair/sombre, numéros de ligne, copie et repli au-delà de 12 lignes. Un nom
  de fichier n'est affiché que si la donnée existe.
- **Composeur** : brouillon conservé localement, champ extensible, ajout d'un
  extrait et choix de langage.
- **Réglages** : thème lié au compte, densité du fil et réduction du mouvement
  mémorisés localement ; les canaux email/push non implémentés ne sont pas
  présentés comme des options actives.
- **Admin** : vue d'ensemble avec volumes backend et activité hebdomadaire,
  puis vérifications et comptes ; les barèmes sont consultables mais non
  modifiables depuis l'interface.
- **Navigation** : panneau latéral à partir de 880 px ; barre basse mobile
  (Fil, Explorer, Créer, Messages, Profil) et feuille « Plus » pour les autres
  routes accessibles. Un bouton « Retour » contextuel complète la navigation,
  avec une destination de repli quand l'historique est vide. La console admin
  a son sélecteur de modules mobile.
- **Feuilles** : une transparence limitée et un flou de fond sont réservés aux
  panneaux superposés ; le reste de l'interface conserve ses surfaces mates.

## Mouvement et accessibilité

Les transitions d'état durent 120 à 200 ms, sans rebond. Le mouvement est
limité aux interactions ; `prefers-reduced-motion` et la préférence de
réduction des animations coupent les mouvements.
Les libellés, boutons et champs gardent une hiérarchie lisible au clavier et
au lecteur d'écran.

L'heure de marge est un `<time dateTime>` : la version empilée est masquée aux
lecteurs d'écran, qui reçoivent « Publié à 08:42 » en une phrase.

## Planche de référence

```text
┌────────────────────────────────────────┐
│ Fil                      Confortable   │
│ ─ Tout   Abonnements   Communautés ─── │
│ ┌──┐ Awa K.  @awa · il y a 8 min       │
│ │▤ │ Une question de cache sur mobile… │
│ │08│ ┌ TypeScript · Copier ──────────┐ │
│ │42│ │ 01  const key = ...           │ │
│ │  │ └───────────────────────────────┘ │
│ │▤ │ ♥ 4   Répondre  ↗                  │
│ └──┘                                    │
└────────────────────────────────────────┘
```

## Limites connues de cette tranche

- La coloration actuelle est un surligneur local léger, pas Shiki ; elle ne
  bloque donc pas le rendu réseau, mais sa couverture syntaxique est plus
  réduite.
- Les publications et commentaires n'ont pas encore un rendu Markdown complet.
- Le registre indenté des annotations est une règle de composition : les
  panneaux de réponses existants ne l'appliquent pas encore, et la modération,
  la contestation et les mots masqués ne sont pas des surfaces livrées.
- Les données du fil arrivent encore via la couche existante côté client ;
  cette refonte ne modifie ni les services ni le schéma.
- Le tableau admin affiche des comptes réels ; la série graphique utilise
  jusqu'aux 1 000 publications les plus récentes sur huit semaines.
- Email, push, suppression de compte, audit immuable et drapeaux globaux ne
  sont pas instrumentés ; l'interface ne propose pas de bascules factices.
- Aucune mesure Lighthouse n'est publiée sans exécution instrumentée.
