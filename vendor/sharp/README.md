# `sharp` — adaptateur MIT pour l'optimiseur d'images de Next.js

Ce dossier n'est **pas** `sharp`. C'est un paquet local portant le même nom et
la même version (`0.35.5`) pour deux raisons :

1. `next@16` déclare `sharp` en dépendance **optionnelle** : npm l'installe
   automatiquement, et `next/image` refuse d'optimiser sans lui. Supprimer
   `sharp` du `package.json` racine ne suffit donc pas — il revient par `next`.
2. `sharp` est Apache-2.0, mais ses binaires embarquent `libvips` et `libheif`,
   publiés sous **LGPL-3.0**. La politique de licences de la CADEV 2026
   (article 6) interdit LGPL. Le paquet affiché est permissif ; ce qu'il
   télécharge ne l'est pas.

## Ce que cet adaptateur fait

Il implémente exactement la surface que `next@16.3.8` appelle dans
`next/dist/server/image-optimizer.js` :

| Appel de Next | Réalisation |
| --- | --- |
| `sharp(buffer, { limitInputPixels, sequentialRead })` | `Transformer` de `@napi-rs/image` |
| `.timeout({ seconds })` | `Promise.race` — la requête échoue au délai, comme avant |
| `.rotate()` | orientation EXIF |
| `.resize(width, height?, { withoutEnlargement })` | `resize` avec cible calculée |
| `.avif({ quality, effort })` | `avif({ quality })` |
| `.webp({ quality })`, `.png({ quality })`, `.jpeg({ quality, mozjpeg })` | encodeurs correspondants |
| `.toBuffer()` | `Buffer` |
| `sharp.block/unblock/cache/concurrency` | sans effet (réglages propres à libvips) |

Tout autre appel lève une erreur explicite « non implémenté ». C'est
volontaire : une montée de version de Next qui utiliserait une méthode
supplémentaire doit casser bruyamment, pas produire une image dégradée en
silence. La CI construit le projet et exécute les tests navigateur, qui
couvrent le rendu des images.

## Ce que cet adaptateur ne fait pas

- Pas de SVG (Next refuse les SVG non optimisés avant d'appeler `sharp`).
- Pas de TIFF/HEIF en entrée : `@napi-rs/image` lit HEIC seulement via le codec
  du système (macOS, Windows), jamais sur Linux. Une image HEIC envoyée à
  `/_next/image` est donc refusée, alors que `sharp` la lisait. Aucun écran de
  DEVNET ne sert de HEIC : les envois passent par `/api/media`, qui refuse ce
  format et normalise en WebP.
- Pas de `palette`/`mozjpeg` : ce sont des réglages de compression, pas de
  rendu.

## Licence

MIT — voir `LICENSE`. Aucun code de `sharp`, de `libvips` ou de `libheif` n'est
copié ici.
