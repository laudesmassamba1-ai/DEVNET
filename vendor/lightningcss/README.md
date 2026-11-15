# `lightningcss` — shim MIT de DevNet

Ce dossier n'est **pas** `lightningcss`. C'est un paquet local qui porte le même
nom et la même version (`1.32.0`) pour une seule raison : `@tailwindcss/node`
déclare `lightningcss@1.32.0` en dépendance de production de build, et npm ne
sait pas remplacer une dépendance transitive par un paquet maison autrement
qu'en la faisant résoudre vers un chemin local de même nom et de même version
(`devDependencies` + `file:`, voir `package.json` racine).

## Pourquoi

`lightningcss` est publié sous **MPL-2.0**. La politique de licences de la CADEV
2026 (article 6) et la politique interne de DEVNET interdisent cette licence
dans le périmètre du projet. Tailwind CSS v4 ne peut pas s'en passer : son
compilateur Node charge `require("lightningcss")` au démarrage du module et
s'en sert pour abaisser la syntaxe CSS et minifier la feuille finale.

Trois options existaient :

1. **Migrer vers Tailwind v3.4** (MIT) : cela demanderait de réécrire
   `app/globals.css` (3 700 lignes, 60 blocs `@utility`, un bloc `@theme`) et de
   renommer des centaines de classes dont la sémantique a changé entre v3 et v4.
   Le rendu ne serait pas préservé — c'est exclu par le cahier des charges.
2. **Conserver `lightningcss`** : MPL-2.0 reste dans l'arbre. Exclu.
3. **Fournir l'interface utilisée, en MIT** : c'est ce paquet.

## Ce qui est réellement utilisé

`@tailwindcss/node@4.3.3` n'importe que deux symboles :

- `Features` — un jeu de drapeaux passé à `transform()` (`Nesting`,
  `MediaQueries`, `LogicalProperties`, `DirSelector`, `LightDark`) ;
- `transform({ code, filename, minify, sourceMap, targets, ... })` — appelé par
  `optimize()`, lui-même appelé par `@tailwindcss/postcss` quand `optimize` est
  actif (par défaut en `NODE_ENV=production`).

Aucun autre point d'entrée n'est atteint pendant `next dev`, `next build` ou
`next start`.

## Ce que fait le shim

| Attendu de `lightningcss` | Réalisé ici |
| --- | --- |
| Abaisser le CSS imbriqué (`&`) | `postcss-nested` (MIT) |
| Préfixes navigateurs selon `targets` | `autoprefixer` (MIT), cibles déduites des `targets` |
| Minifier quand `minify: true` | `csso` (MIT) |
| Rendre `{ code, map, warnings }` | `postcss` (MIT) |
| `Features` (drapeaux) | constantes exportées, sans effet de bord |
| Abaisser les propriétés logiques, `:dir()`, `light-dark()` | **non fait**, exactement comme l'appelant qui les met dans `exclude` |
| Abaisser `@custom-media` | non fait : aucun `@custom-media` dans le dépôt (vérifié en CI par `scripts/legal/css-parity.mjs`) |
| Transtyper la syntaxe de plage `@media (width >= …)` | non fait : aucune plage dans le dépôt (même vérification) |

Si l'une de ces deux dernières syntaxes apparaissait un jour, la CI échoue au
lieu de produire un CSS que le navigateur ignorerait en silence.

## Vérification

`scripts/legal/css-parity.mjs` compile `app/globals.css` avec Tailwind en mode
production, puis compare la feuille produite par ce shim à celle produite par
`lightningcss` réel (installé dans un dossier temporaire hors dépôt). Les
sélecteurs et déclarations sont comparés, pas les octets : `csso` et
`lightningcss` ne choisissent pas les mêmes raccourcis.

## Licence

MIT — voir `LICENSE`. Aucun code de `lightningcss` ni de `parcel-css` n'est
copié ici.
