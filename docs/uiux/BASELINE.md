# Baseline UI/UX — DevNet

Mesure du **14 novembre 2026**, avant et après la passe de correction UI/UX.
Elle sert de référence aux fichiers `ISSUES.md` et `DESIGN-SYSTEM.md`.

## Méthode

- Application locale en mode démo : `NEXT_PUBLIC_FORCE_DEMO=true npm run dev`.
- **Chromium headless via Playwright**, contexte mobile (`isMobile`, `hasTouch`,
  DPR 2), viewports **320 × 844**, **360 × 844** et **390 × 844**.
- Connexion : `/login?demo=1`, puis fermeture explicite de la visite guidée
  (`Quitter`) pour ne pas mesurer l’overlay de première visite.
- Thèmes appliqués par `document.documentElement.dataset.theme` :
  `dark` (Encre), `light` (Papier), `savane`, `savane-clair`.
- Écrans mesurés : `/feed`, `/messages`, `/profile`, `/settings`, `/projects`.

### Définitions

| Métrique | Définition |
| --- | --- |
| Texte < 12 px | Nœud texte visible dont `font-size` calculé est inférieur à 12 px |
| Débordement | Élément visible dont le rectangle dépasse `innerWidth`, **hors conteneur `overflow-x-auto`** |
| Largeur de page | `document.documentElement.scrollWidth` comparé à `visualViewport.width` |
| Cible < 44 px | `a`, `button`, `[role=button]`, `input`, `select`, `textarea` visible dont largeur **ou** hauteur est < 44 px |

Les liens **dans une phrase** et les cases à cocher **dans un label** sont
relevés puis classés séparément : le WCAG 2.2 (2.5.8) les exempte, leur zone
d’activation étant le texte ou le label.

## Résultats — 390 px (thème Encre)

| Écran | Texte < 12 px avant | après | Débordements avant | après | Cibles < 44 px avant | après |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/feed` | 52 | **0** | 30* | **0** | 22** | 22** |
| `/messages` | 16 | **0** | 0 | **0** | 0 | 0 |
| `/profile` | 52 | **0** | 2 | **0** | 2 | 1*** |
| `/settings` | 10 | **0** | 0 | **0** | 4**** | 4**** |
| `/projects` | 42 | **0** | 0 | **0** | 6 | **0** |

\* Les 30 « débordements » du fil étaient les jetons colorés d’un bloc de code
**à l’intérieur d’un conteneur `overflow-auto`** : la page, elle, restait à
320/320. Le `CodeBlock` est donc déjà défilable ; aucun correctif n’était
nécessaire. L’audit final exclut ces conteneurs.

\** Boutons `#hashtag` placés dans le texte d’une publication (23 px de haut),
exemptés par 2.5.8.

\*** Après correction, reste le lien de dépôt **inline** dans le panneau
Travail. Le lien « Dépôts » (38 → 50 px de large, 44 px de haut) a été corrigé.

\**** Deux cases à cocher de 20 px **à l’intérieur de leur label** (la zone
cliquable est le label) + deux liens inline « Aide » et « CGU ».

## Écrans restants — 360/390 px

| Écran | Texte < 12 px avant | après | Cibles < 44 px avant | après | Débordement avant | après |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/groups` | 12 | **0** | 2 | **0** | 0 | **0** |
| `/communities` | 7 | **0** | 1 | **0** | 0 | **0** |
| `/projects/p-1` | 28 | **0** | 3 | **0** | 2 (320 px) | **0** |
| `/settings` | 0 | **0** | 4* | 4* | 0 | **0** |

\* Cases à cocher dans leur label + liens inline « Aide »/« CGU » :
zone d’activation du label, exemption 2.5.8.

## Résultats — largeurs contraintes

| Écran | Largeur de page avant | après | Texte < 12 px après (320 / 360) |
| --- | --- | --- | --- |
| `/feed` | 320 / 320 | **320 / 320** | 9 / 0 |
| `/profile` | 320 / 320 | **320 / 320** | 6 / 0 |
| `/projects` | **363 / 363** | **320 / 360** | 6 / 0 |
| `/messages` | 320 / 320 | **320 / 320** | 6 / 0 |
| `/settings` | 320 / 320 | **320 / 320** | 6 / 0 |

À 320 px, les 6–9 textes restants sont :
- les **cinq libellés de navigation** passés à 11 px sous 340 px pour éviter
  un débordement de 5 px (12 px dès 340 px) ;
- la ligne d’état terminal (`~/fil`, `démo`, horloge), déjà à 11 px et
  purement décorative.

Aucun autre texte n’est sous 12 px à 320 px.

## Captures

- **Avant** : `docs/uiux/before/390-{dark,savane}-{feed,messages,profile,settings,projects}.png`.
  Certaines captures montrent la visite guidée de première visite ; c’est un
  état réel du produit, mais les mesures ont été refaites overlay fermé.
- **Après** : `docs/uiux/after/final-{320,390}-{feed,messages,profile,settings,projects}.png`
  et les variantes de thèmes `docs/uiux/after/390-{dark,savane,light,savane-clair}-*.png`.

Données brutes : `audit-before.json`, `audit-after.json`, `audit-final.json`,
`audit-rest.json`. Captures DA : `after/da-390-{dark,light,savane}-*.png`.

## Porte de non-régression

`tests/e2e/layout.spec.ts` (`npm run test:layout`) parcourt **8 écrans ×
3 largeurs** (320, 360, 390) et échoue si la largeur du document dépasse le
viewport, si un élément visible sort de l’écran hors conteneur de
défilement, ou si un texte essentiel est rendu sous 12 px. Les exceptions
sont explicites : `data-allow-tiny` sur la navigation (11 px ≤ 340 px) et
la ligne d’état ; les liens inline ne sont pas testés comme cibles.

Résultat sur l’état final : **3 tests passés**.

## Limites

- **Aucun iPhone ni Safari physiques** n’ont été testés. Les mesures sont
  Chromium émulé ; elles ne remplacent pas un test sur appareil.
- Le bandeau Next.js « Compiling… » du serveur de développement peut apparaître
  dans certaines captures ; il n’existe pas en production.
- Les états de chargement, d’erreur et les feuilles modales n’ont pas tous été
  parcourus à chaque largeur.
- La visite guidée reste un overlay de première visite : elle est fermée pour
  les mesures, pas supprimée.
