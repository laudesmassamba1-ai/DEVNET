# Échelles et seuils — UI DevNet

> Le cahier des charges chiffré des correctifs. Tout correctif s'exprime en
> **variables** de `app/globals.css`, jamais en valeurs en ligne. Ce document
> décrit aussi l'écart entre l'échelle **actuelle** et l'échelle **requise** :
> c'est là que se joue une partie de LAU-005 (« design pas abouti »).

## 1. Typographie

| Rôle | Variable | Valeur actuelle | Valeur requise | Écart |
|---|---|---|---|---|
| Corps | `--text-body` | 15 px (0,938 rem) | 16 px | −1 px |
| Corps secondaire | `--text-body-s` | 13 px (0,8125 rem) | 14 px | −1 px |
| Légende | `--text-caption` | **12 px** | 12 px | ✅ |
| Étiquette | `--text-label` | **11 px** | **12 px** | ✗ sous le plancher |
| Micro | `--text-micro` | **11 px** | **12 px** | ✗ sous le plancher |
| Code | `--text-code` | 13 px | 13–14 px | ✅ |

**Constat mesuré** : deux jetons de l'échelle descendent sous 12 px, et
l'interface les utilise **206 fois** (`ux-metrics.json` → `tinyTextUses`).
Tant que `--text-label` et `--text-micro` valent 11 px, remplacer les
`text-[11px]` en ligne ne fera que déplacer le problème : le plancher doit
d'abord être relevé dans l'échelle.

Interlignes : `--lh-body` 1,6 ; `--lh-caption` 1,45 ; `--lh-label` 1,35 ;
`--lh-code` 1,65. Longueur de ligne cible : 45–75 caractères. Chiffres
tabulaires (`.tnum`) pour tous les compteurs.

Champs de saisie : **≥ 16 px** (évite le zoom iOS). `--h-input` fait 44 px :
la hauteur est bonne, la police d'un champ reste à vérifier au navigateur.

## 2. Espacement

Base 4 px. Échelle existante : `--space-xs` 4, `--space-sm` 8, `--space-md` 12,
`--space-lg` 16, `--space-xl` 24, `--space-2xl` 32. Échelle requise :
`4, 8, 12, 16, 24, 32, 48, 64` — les deux derniers manquent, à ajouter
**dans l'échelle** si un besoin réel se présente, jamais en `p-[42px]`.

Constat : **2 315 valeurs Tailwind arbitraires** dans les `className`
(`arbitraryValues`). Objectif : décroissance par composant, pas
remplacement global.

## 3. Cibles tactiles

- **≥ 44 × 44 px** pour tout élément interactif (zone cliquable, pas le dessin).
- **≥ 8 px** entre deux cibles.
- Hauteur de champ ≥ 44 px — `--h-input` et `--h-tap` valent déjà 44 px.
- Mesure : `boundingBox()` Playwright sur les routes P0 (`npm run ux:measure`).

## 4. Contraste (WCAG 2.1 AA)

- Texte : **≥ 4,5:1** ; grand texte (≥ 24 px ou ≥ 19 px gras) : **≥ 3:1**.
- Composants, icônes porteuses de sens, **indicateur de focus** : **≥ 3:1**.
- Vérifier **chaque thème** (`data-theme` clair/sombre) : un jeton correct en
  clair peut échouer en sombre.
- Jamais d'information transmise par la couleur seule.

## 5. Focus

- Anneau **≥ 2 px**, contraste **≥ 3:1**, décalage 2 px, identique partout.
- Interdit : `outline-none` sans remplacement `focus-visible` explicite.
- Constat : **79 `outline-none`** contre **18 `focus-visible:`** explicites ;
  un style global `:focus-visible` existe — son effet réel se mesure au
  navigateur (UX-004), il ne se suppose pas.

## 6. Points de rupture

360 (base), 640, 768, 1024, 1280, 1536. Mobile d'abord. Aucun défilement
horizontal de page à 360 px. `--breakpoint-shell` et `--breakpoint-wide`
existent : les réutiliser plutôt que d'inventer des media queries.

## 7. Zones sûres et défilement

`env(safe-area-inset-*)` sur les barres fixes (`viewportFit: cover` est actif).
Hauteurs en `dvh`. `scroll-margin-top` sur les ancres sous les en-têtes fixes.
Pas de défilement imbriqué qui piège le doigt.

## 8. Couches (z-index)

Échelle existante, à utiliser exclusivement : `--z-base` 0, `--z-sticky` 80,
`--z-composer` 90, `--z-nav` 100, `--z-sheet` 200, `--z-modal` 300,
`--z-toast` 400. Aucune valeur libre (`z-[999]`).

## 9. Mouvement et durées

Variables existantes : `--d-instant`, `--d-fast`, `--d-base`, `--d-slow`,
`--d-enter`, `--d-story`, `--d-caret`, `--d-burst`, `--d-orbit`, `--d-scene` ;
courbes `--ease-snap`, `--ease-pop`, `--ease-entrance`, `--ease-gravity`,
`--ease-spring`, `--ease-continuous`, `--ease-timing` (LAU-006 : le
vocabulaire existe, il est inégalement appliqué).

Règles :
- une animation **essentielle** ne disparaît jamais seule ;
- toast **≥ 5 s**, pause au survol/focus ;
- sous `prefers-reduced-motion: reduce`, aucune animation non essentielle
  (`document.getAnimations()` doit être vide hors indispensables) ;
- une même action s'anime **partout pareil** (ouverture de surcouche,
  apparition de liste, changement d'onglet).

## 10. Formats français

`Intl.NumberFormat('fr-FR')`, `Intl.DateTimeFormat('fr-FR')`,
`Intl.RelativeTimeFormat`, `Intl.PluralRules`. Espace insécable fine avant
`:` `;` `!` `?` et dans « … » ; apostrophe typographique ’.

## 11. Seuils d'acceptation (cliquet)

Indicateurs figés dans `docs/ui/ratchet.json` (généré par `npm run ux:scan`,
vérifié par `npm run ux:check` en CI, **avant** lint et build). Toute
amélioration resserre la référence dans la même PR ; aucune PR ne peut la
relâcher sans décision écrite (ADR).
