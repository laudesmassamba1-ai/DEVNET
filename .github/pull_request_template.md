## Ce que change cette PR

<!-- Une phrase : le problème, puis la solution. -->

## Contrat d'expérience — conformité (PR-01)

Règles concernées et **preuve** pour chacune (commande + résultat, capture) :

| Règle | Preuve |
|---|---|
| PR-03 (tests, tsc, lint, build) | `npm test`, `npx tsc --noEmit`, `npx eslint .`, `npm run build` |
| PR-02 (aucun contournement) | `npm run verify:ui` |
| DS-01 / MO-02 / MO-05 | `npm run ui:lint` |
| MO-06 (animations documentées) | `npm run ui:motion` |
| FT-01 (aucune UI morte) | `npm run ui:lint` |

## Ce que je n'ai pas vérifié

<!-- Honnêteté : axe, Lighthouse, Playwright, appareil réel… -->
