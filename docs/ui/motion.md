# Mouvement — catalogue et buts (MO-06)

Chaque animation de DevNet est listée ici avec **un but**. Pas de but, pas
d'animation. Les durées et courbes viennent des tokens de
`app/globals.css` (`--d-instant`, `--d-fast`, `--d-base`, `--d-slow`,
`--d-hero`, `--ease-*`) : aucune valeur en dur dans un composant (MO-01).

**Buts** : *feedback* (confirmer une action), *orientation* (d'où vient /
où va un élément), *hiérarchie* (guider l'attention), *plaisir* (rare,
mérité).

## Rôles du composant `Motion`

| Rôle | But | Ce qu'il fait |
|---|---|---|
| `fade` | orientation | Fondu simple, texte secondaire. |
| `slide` | orientation | Ascension + fondu : un contenu qui arrive. |
| `rise` | orientation | Ascension avec léger recul, panneaux et cartes. |
| `scale` | orientation | Apparition par l'échelle, surfaces (feuille, carte). |
| `soft` | hiérarchie | Émergence par le flou, surfaces uniques (héros, en-tête). |
| `rotate` | plaisir | Entrée à 4°, marques et prompts. |
| `exit` | feedback | Retrait d'un élément qui disparaît. |
| `pop` | feedback | Rebond d'un compteur quand sa valeur change. |
| `lift` | feedback | Élévation au survol. |
| `press` | feedback | Compression au clic. |
| `spin` | feedback | Rotation continue : chargement uniquement. |
| `pulse` | feedback | Opacité pulsée : chargement et présence. |
| `breathe` | hiérarchie | Respiration discrète d'un état actif. |
| `scan` | feedback | Balayage vertical : chargement. |
| `burst` | plaisir | Éclat d'une réaction ou d'un sticker posé. |
| `deny` | feedback | Refus : deux secousses, sans déplacement final. |
| `sheet` | orientation | Montée d'une feuille depuis le bas. |
| `veil` | hiérarchie | Assombrissement du voile derrière une feuille. |

## Utilitaires CSS (`mo-*`)

| Utilitaire | But | Notes |
|---|---|---|
| `mo-slide` | orientation | Entrée standard d'une ligne. |
| `mo-rise` | orientation | Carte ou panneau. |
| `mo-scale` | orientation | Surface. |
| `mo-fade` | orientation | Texte secondaire. |
| `mo-soft` | hiérarchie | Surface unique, coût de filtre payé une fois. |
| `mo-rotate` | plaisir | Marque. |
| `mo-exit` | feedback | Sortie. |
| `mo-pop` | feedback | Valeur qui change. |
| `mo-grow` | feedback | Progression (barre, anneau). |
| `mo-press` | feedback | Cible tactile : compression de 1 px. |
| `mo-lift` | feedback | Survol d'une surface actionnable. |
| `mo-burst` | plaisir | Média qui se pose (sticker, GIF). |
| `mo-deny` | feedback | Refus. |
| `mo-sheet` | orientation | Feuille du bas. |
| `mo-veil` | hiérarchie | Voile de feuille. |
| `mo-msg-in` | orientation | Bulle reçue (arrive par la gauche). |
| `mo-msg-in-alt` | orientation | Bulle envoyée (arrive par la droite). |
| `mo-spin` | feedback | Chargement. |
| `mo-pulse` | feedback | Chargement (squelette). |
| `mo-breathe` | hiérarchie | État actif. |
| `mo-scan` | feedback | Chargement (balayage). |
| `mo-pre` | — | Neutralise l'animation avant hydratation. |

## Règles tenues par `verify:ui`

- Aucune boucle `infinite` hors indicateur de chargement (MO-05) :
  `ui-lint` échoue sinon. `mode-live` bat trois fois puis se tait.
- Aucune animation de `width`, `height`, `top`, `left`, `margin`,
  `padding` (MO-02) : `ui-lint` échoue. Les déplacements passent par
  `transform`.
- Aucune couleur en dur dans un composant (DS-01) : les lueurs et anneaux
  sont des tokens (`--glow-signal`, `--shadow-avatar-ring`,
  `--color-signal-soft`).
- `prefers-reduced-motion` coupe les animations non essentielles
  (`app/globals.css`, bloc mouvement réduit) — vérifié à la main, test
  Playwright à brancher (voir `docs/ui/defects.md`, dette de mesure).
- Une animation ne dépasse pas 1 s hors célébration unique (MO-05).

## Dette connue

- Le niveau N0/N1/N2/N3 (MO-04) existe partiellement (mouvement réduit et
  `mode-live`), mais n'est pas surchargeable dans les paramètres et n'a pas
  de test automatisé par niveau.
- Aucun test Playwright de mouvement : dépendance à approuver.
