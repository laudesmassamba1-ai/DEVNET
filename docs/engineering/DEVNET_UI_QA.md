# DEVNET — QA interface et accessibilité

> Vérifié le 2026-11-14. Les captures de référence existantes sont dans
> `docs/design-captures/` et `docs/ui/audit/`. Une capture ne remplace pas un
> test sur appareil réel.

## 1. Viewports à couvrir

| Largeur × hauteur | Usage |
|---|---|
| 320 × 568 | petit iPhone SE |
| 360 × 800 | Android compact |
| 390 × 844 | iPhone 12/13/14 |
| 430 × 932 | iPhone Pro Max |
| 768 × 1024 | tablette portrait |
| 1024 × 768 | tablette paysage |
| 1366 × 768 | portable |
| 1440 × 900 | bureau |
| 1920 × 1080 | grand écran |

Contrôles : aucun scroll horizontal involontaire, pas de contenu sous les
barres système, safe areas (`env(safe-area-inset-*)`), clavier virtuel,
modale toujours fermable, cible tactile ≥ 44 px, focus visible.

## 2. Routes et états à inspecter

| Écran | Chargé | Vide | Erreur | Modale |
|---|---|---|---|---|
| `/login`, `/register` | oui | — | oui | — |
| `/feed` | oui | oui | oui | feuille « Actions » |
| `/messages` | oui | oui | oui | pièces jointes |
| `/profile`, `/u/[pseudo]` | oui | oui | oui | édition |
| `/settings` | oui | — | oui | thèmes |
| `/projects`, `/projects/[id]` | oui | oui | oui | import GitHub |
| Stories : rail, lecteur, éditeur | oui | oui | oui | stickers/GIF |
| `/admin` | oui | oui | 404 volontaire | — |

## 3. Mesures déjà vérifiées (émulation Chromium 390 × 844, thème Savane)

- En-tête : 48 px ; barre de navigation basse : 52 px.
- Barre d'actions d'une publication : 44 px sur un seul rang.
- Feuille « Actions » : lignes de 44 px.
- Messages : en-tête 48 px, bulles 8 × 12 px, composeur 68 px.
- Aucun débordement horizontal détecté.

Ces mesures viennent d'une **émulation**, pas d'un iPhone physique. Le test
Safari iOS réel reste à faire.

## 4. Design system

- Palette : vert `#087F5B`, vert foncé `#0B1715`, or `#D6A84F`, blanc
  `#F4F1E8`, turquoise `#20BFA9`.
- Thèmes : sombre, clair, Savane, Savane clair (`lib/theme.ts`).
- Or réservé aux distinctions (niveau, badge vérifié, anneau de story) via
  `--color-level`, pas aux actions principales.
- Tokens attendus : couleurs sémantiques, typographie, espacements, rayons,
  ombres, z-index, tailles de contrôle, durées, largeurs, breakpoints.
- Les valeurs arbitraires de scène média (position, taille, rotation) sont
  légitimes ; les autres doivent migrer vers les tokens.

## 5. Accessibilité — état

| Point | État |
|---|---|
| Labels des boutons icône seule | majoritairement `aria-label`/`sr-only` |
| `type="button"` explicite | couvert par `ui:lint` |
| Focus visible | à vérifier écran par écran |
| Focus trap des modales | partiel — lecteur de stories à compléter |
| `prefers-reduced-motion` | géré par le thème, à vérifier sur les transitions |
| `autoFocus` | usages à réduire (champs de recherche) |
| Sélection de texte | `user-select: none` retiré du `body` en PWA, limité aux contrôles gestuels |
| Contraste | script `npm run ux:check` ; seuils à confirmer manuellement |
| Textes < 12 px | encore présents (métadonnées) — inventaire à faire |

## 6. Commandes

```bash
npm run lint             # ESLint (0 erreur, 9 avertissements connus)
npm run ui:lint          # règles DS, animations, UI morte
npm run ui:motion
npm run ux:scan          # métriques JSON
npm run ux:check         # ratchet
npm run verify:ui        # les trois ci-dessus
npm run verify:ui:browser  # Playwright
```

## 7. Défauts UI confirmés à traiter

1. `components/StoryViewerLive.tsx` : `setState` synchrone dans deux effets
   (`viewers`, `mediaDuration`) — dériver l'état ou remonter la clé du
   composant.
2. `scripts/ux-scan.mjs` : variables `textOf`, `TINY`, `CSS_COLOR` inutilisées.
3. Trois `eslint-disable` dans le client REST à justifier ou supprimer.
4. Icône d'œil associée à un compteur de likes signalée par un audit
   antérieur : à revérifier dans `PostCard` avant modification.
5. Captures de référence manquantes pour l'éditeur et le lecteur.
