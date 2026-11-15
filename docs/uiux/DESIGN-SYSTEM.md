# Système de design DevNet — état réel

Ce document décrit ce qui est **codé**, pas une intention. Il résout la
contradiction historique avec le README (« Liquid Ivoire »).

## Direction artistique

Quatre thèmes, une seule grammaire. Les thèmes sont des jeux de tokens CSS
dans `app/globals.css`, choisis dans Réglages, mémorisés sous
`devnet:theme`, appliqués par `data-theme` sur `<html>`.

| Thème | `data-theme` | Fond | Accent | Typographie |
| --- | --- | --- | --- | --- |
| Encre (défaut) | `dark` | `#11110E` | ambre | Space Grotesk (titres) + Instrument Sans (texte) + IBM Plex Mono |
| Papier | `light` | `#F6F4EF` | ambre | Space Grotesk (titres) + Instrument Sans (texte) + IBM Plex Mono |
| Savane | `savane` | `#0B1715` | turquoise `#20BFA9`, or `#D6A84F` | Inter + Poppins |
| Savane clair | `savane-clair` | ivoire | turquoise / or | Inter + Poppins |

`color-scheme` suit le thème (`dark` ou `light`). Aucun
`prefers-color-scheme` n’impose un thème.

## Matière — lavis de page

Le fond n’est plus un aplat : `--page-wash` pose un **lavis très bas**,
propre à chaque thème (ambre et phosphore dans Encre, chaleur papier dans
Papier, turquoise/or dans Savane). Il est appliqué au `body` en
`background-image`, sans `fixed` ni filtre : pas de halo clignotant, pas de
coût de défilement. Les surfaces de contenu restent opaques pour que le
texte garde son contraste.

Les titres et la marque passent à **Space Grotesk** (déjà chargée par
`next/font`) dans Encre et Papier ; Savane conserve Poppins. Le corps reste
Instrument Sans, les données IBM Plex Mono. Aucune famille supplémentaire
n’est téléchargée.

**Liquid Ivoire** (ivoire unique, olive, barre d’onglets en haut) n’existe
pas dans le code. Le README le signalait encore ; il est désormais corrigé.
La DA n’a pas été remplacée : toute refonte demande une décision explicite.

## Typographie

| Rôle | Taille | Détail |
| --- | --- | --- |
| Corps | 15 px / 1,55 | `--text-body` |
| Corps secondaire | 13 px | `--text-body-s` |
| Légende | 12 px / 1,45 | `--text-caption` |
| Label | **12 px** / 1,35 | `--text-label` (était 11 px) |
| Micro / mono | **12 px** / 1,35 | `--text-micro` (était 11 px) |
| Code | 13 px / 1,65 | `--text-code` |
| Titres / marque | Space Grotesk (Encre, Papier), Poppins (Savane) | `font-display` |

Règles :
- **Aucun texte essentiel sous 12 px** à partir de 340 px. À 320 px, seule la
  navigation repasse à 11 px pour tenir six onglets sans débordement.
- Les libellés de navigation et les métadonnées de cartes sont à 12 px.
- Les liens inline et les compteurs de notification suivent la taille du
  texte qui les porte.

## Couleurs et surfaces

- Le **verre** est réservé aux surfaces flottantes : en-tête, navigation
  basse, feuilles, composeur, bannière PWA. Liseré, ombre de contact, flou.
- Les **cartes de contenu** restent opaques : contraste du texte d’abord.
- Les couleurs sémantiques (`ok`, `danger`, `warn`, `info`, `phosphor`) sont
  rares et réservées au sens.
- Aucune couleur en dur dans les composants : `npm run ui:lint` vérifie
  DS-01 (0 couleur en dur).

## Formes, espace, cibles

- Rayons : `--radius-chip` / `--radius-input` = 6 px, `--radius-card` = 10 px.
- Aucun angle droit sur les contrôles, glyphes et images.
- Cible tactile minimale : **`--h-tap` = 44 px** (règle dure).
- Hauteurs de coque : en-tête 56 px + safe-area, navigation basse 60 px +
  safe-area, ligne d’état 22 px.
- Gouttière de page : `--gutter` ; colonne de lecture max 560 px mobile,
  720 px bureau, sidebar 236 px à partir de 880 px.

## Hiérarchie éditoriale

- **Profil** : identité sur une ligne (avatar + nom + pseudo + badges), bio
  et langages pleine largeur, statistiques compactes. Les six cartes de
  métriques ont été allégées (bord `line-2`, fond `surface-2/60`).
- **Carte projet** : le score de compatibilité quitte l’en-tête et rejoint
  le pied, à côté de « Postuler ». La description retrouve toute la largeur
  et ne se comprime plus sous le badge.
- **Publication** : la barre d’actions est séparée du texte par un filet,
  ce qui la pose comme une commande et non comme une continuation du post.

## Navigation

- Mobile : barre basse à 6 entrées — Fil, Explorer, Créer, Messages, Profil,
  Plus (feuille « Toutes les sections »).
- Bureau : barre latérale sticky avec Explorateur, Activité, Espace de travail
  et ligne d’état.
- L’onglet actif est une gélule de surface + accent ; l’icône passe de 1,8 à
  2 px de trait.
- Profil : 5 onglets égaux (Posts, Travail, Progrès, Infos, Réglages), tous
  visibles à 320 px, sans défilement horizontal.

## Focus et mouvement

- Focus unique : `outline: 2px solid var(--color-signal); outline-offset: 2px`.
- Pression : `scale(0.97)` sur boutons, `0.985` sur liens.
- Mouvement par transitions de surface et élévation, pas d’animation
  lumineuse permanente. `prefers-reduced-motion` neutralise les durées.
- Courbes : `--ease-continuous`, `--ease-spring`, ressorts `linear()` quand
  le navigateur les comprend.

## PWA / iOS

- Manifeste, icônes maskables, captures, service worker et page hors-ligne
  vérifiés par `npm run test:pwa` (**175 vérifications**).
- `theme-color` est mis à jour à chaque changement de thème :
  `#11110E`, `#F6F4EF`, `#0B1715`, `#F4F1E8`.
- `apple-mobile-web-app-status-bar-style` passe de `default` (thèmes clairs) à
  `black-translucent` (thèmes sombres).
- Zones sûres : `env(safe-area-inset-*)` sur la coque, la navigation, les
  feuilles et les bannières.
- Écrans de démarrage iOS générés pour les principales tailles.

## Formulaires

- Chaque champ a un `label` associé (`htmlFor`).
- Une erreur de formulaire porte un `id`, `role="alert"`, et les champs
  concernés reçoivent `aria-invalid` + `aria-describedby`.
- Les messages sont en français, sans exposer de détail technique.
- Les liens externes portent `rel="noopener noreferrer"`.

## Vérifications de la passe

| Commande | Résultat |
| --- | --- |
| `npx tsc --noEmit` | 0 erreur |
| `npm run lint` | 0 erreur, 4 avertissements préexistants |
| `npm run ui:lint` | 0 régression (DS-01 = 0) |
| `npm run ux:check` | cliquet tenu — 1 124 valeurs arbitraires, 115 textes < 12 px |
| `npm run test:layout` | 3 largeurs × 8 écrans : 0 débordement, 0 texte < 12 px |
| `npm run build` | succès |
| `npm run test:pwa` | 175 vérifications |

## Limites connues

- Pas de test sur iPhone/Safari physique.
- Exceptions 44 px : liens inline, cases à cocher dans leur label.
- 320 px : navigation à 11 px (arbitrage de non-débordement).
- Les 2 222 valeurs arbitraires et les 685 tailles explicites du dépôt n’ont
  pas toutes été normalisées ; la passe a couvert les écrans mesurés.
