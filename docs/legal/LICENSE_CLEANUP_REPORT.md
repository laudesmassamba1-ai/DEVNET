# Rapport de mise en conformité des licences

Date : 15 novembre 2026. Périmètre : tout le dépôt DEVNET (dépendances
directes, transitives, optionnelles, binaires natifs, ressources, outils de
build et de test).

## 1. Inventaire initial

`npm ci` puis `npm ls --all` sur le `package-lock.json` livré : **602 paquets**
(485 installés sur cette plateforme). Licences déclarées, avant travaux :

| Licence | Paquets |
| --- | --- |
| MIT | 473 |
| Apache-2.0 | 52 |
| ISC | 26 |
| **MPL-2.0** | 15 |
| **LGPL-3.0-or-later** | 10 |
| BSD-2-Clause / BSD-3-Clause | 11 |
| Apache-2.0 **AND LGPL-3.0-or-later** | 3 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |
| CC0-1.0, 0BSD, BlueOak, Python-2.0, CC-BY-4.0 | 8 |

Les quatre points bloquants étaient :

1. **`web-push@4`** — MPL-2.0 (`npm explain web-push`).
2. **`sharp@0.35.5`** — Apache-2.0 **affiché**, mais les binaires
   `@img/sharp-libvips-*` et `@img/sharp-heif` sont **LGPL-3.0-or-later**.
   C'est le cas le plus dangereux : le paquet paraît conforme.
3. **`lightningcss@1.32`** — MPL-2.0, requis par `@tailwindcss/node`
   (`npm explain lightningcss`), donc dépendance transitive de Tailwind v4.
4. **`axe-core` / `@axe-core/playwright`** — MPL-2.0.

## 2. Remplacements

### 2.1 Web Push : `web-push` → `@block65/webcrypto-web-push`

- MIT, une seule dépendance (`uint8array-extras`, MIT), WebCrypto uniquement.
- **Mêmes clés VAPID** : clé publique = point P-256 non compressé base64url
  (65 octets), privée = scalaire `d` base64url. Aucune migration, aucun
  réabonnement des appareils.
- Conservés : `aes128gcm` (RFC 8291), VAPID (RFC 8292), TTL 24 h, `urgency`,
  suppression des abonnements 404/410, `pushTransport.send` espionnable
  (`scripts/test-push-notify.ts` inchangé dans son intention).
- Vérifié : `npm run test:push-notify` (24 vérifications).

Analyse de l'alternative `@pushforge/builder` (MIT, zéro dépendance) : elle
exige une clé privée **JWK** (`d`, `x`, `y`), donc une conversion des clés
existantes. Écartée pour éviter toute migration de clé.

### 2.2 Images : `sharp` → `@napi-rs/image` + code DEVNET

- `@napi-rs/image` (MIT) : orientation EXIF, redimensionnement (dont
  `withoutEnlargement`, recalculé), encodage WebP/PNG/JPEG/AVIF, pixels bruts,
  rasterisation SVG, `limitInputPixels` équivalent par en-tête.
- **Le GIF n'est pas dans `@napi-rs/image`** (README : codecs non compilés,
  aucune animation). `lib/media/gif.ts` décode le GIF (`omggif`, MIT, avec
  disposition/transparence et budget de décodage), `lib/media/webp-animation.ts`
  assemble le WebP animé (VP8X/ANIM/ANMF) et relit les WebP animés existants.
- Conservés : limite 50 Mpx, refus des fichiers tronqués (`failOn: error`),
  WebP qualité 82 borne 1920, stickers 512 px / 60 Ko / 1,5 Mo animés / 80
  images, statuts 1080×1920 / 900 Ko / 3 Mo animés / 120 images, pHash dHash
  9×8, ratio de tons chair 64 px, icônes PWA.
- Ajout de sécurité : budget de décodage GIF (64 Mpx cumulés) et refus des
  bombes de décompression **avant** allocation (dimensions lues dans l'en-tête).
- Vérifié : `npm run test:media-images` (28 vérifications, dont le nombre
  d'images du WebP animé validé par le décodeur Chromium), `test:stickers-contract`,
  `test:pwa`, `test:story-*`.

**Effet de bord assumé et traité** : `next@16` déclare `sharp` en dépendance
**optionnelle** — il revient donc tout seul. `vendor/sharp` est un adaptateur
MIT de la surface réellement appelée par `next/dist/server/image-optimizer.js`
(`rotate`, `resize`, `avif/webp/png/jpeg`, `toBuffer`, réglages libvips sans
effet). Toute autre méthode lève une erreur explicite au lieu de dégrader en
silence. Vérifié : `GET /_next/image?...&w=96` renvoie un WebP 96×96.

### 2.3 `lightningcss` : shim MIT

- Origine : `@tailwindcss/node` uniquement (Tailwind v4), pas Next directement ;
  usage **build seulement**, uniquement dans `optimize()`.
- `vendor/lightningcss` (MIT) porte le nom et la version requis par npm et
  rend l'interface utilisée : `Features`, `transform()`. Réalisation :
  `postcss-nested` (imbrication), `autoprefixer` (préfixes selon les cibles),
  `csso` (minification), abaissement maison de la syntaxe de plage média
  (`(width < 340px)` → `not (min-width: 340px)`), sans quoi les utilitaires
  `max-[340px]:` disparaîtraient.
- **Parité vérifiée** : `scripts/legal/css-parity.mjs` compile `app/globals.css`
  en production et compare sélecteur par sélecteur à une feuille produite par
  `lightningcss@1.32.0` réel (référence versionnée :
  `docs/legal/evidence/css-parity-baseline.json`, 1 702 sélecteurs). Résultat :
  aucun sélecteur manquant, aucune propriété perdue ; seules des écritures de
  minifieur diffèrent (`0.25rem`/`.25rem`, `transparent`/`#0000`,
  `rgb(…/8%)`/hexadécimal alpha), sans effet de rendu.
- Tailwind v3.4 (MIT) était l'autre option : elle imposait de réécrire
  3 700 lignes de `globals.css`, 60 blocs `@utility` et des centaines de
  classes dont la sémantique change — refusé, le rendu devant être préservé.

### 2.4 Accessibilité : `axe-core` → `lib/a11y` (MIT)

- `accessibility-checker` (IBM, Apache-2.0) examiné : installe Chromium **et**
  Chromedriver en plus de Playwright, charge un moteur de règles séparé et
  active `@ibm/telemetry-js`. Deux piles de navigateurs et de la télémétrie
  pour un contrôle qui tient dans une page → écarté, analyse consignée.
- `lib/a11y/audit.ts` exécute 22 règles dans la page : noms accessibles,
  alternatives, **contraste calculé** (couleurs normalisées par le moteur du
  navigateur, composition des fonds translucides), structure de titres,
  repères, ARIA (attributs inconnus, attributs obligatoires, `aria-hidden`
  focusable, identifiants dupliqués), ordre de tabulation, `viewport`, cadres,
  listes. API compatible avec `AxeBuilder` (`withTags`, `exclude`, `analyze`,
  `violations[].impact`) : les tests n'ont pas été réécrits.
- Validé **contre axe-core** sur les mêmes écrans (comparaison hors dépôt) :
  mêmes règles bloquantes, mêmes éléments. Les tests ont révélé un vrai défaut
  (texte de l'illustration du générique) : le décor est désormais
  `aria-hidden`, le récit restant porté par le `<figcaption>`.
- Vérifié : `npm run test:a11y-engine` (36 vérifications) et
  `tests/e2e/a11y*.spec.ts` — 16 portes (4 écrans × 3 thèmes), vertes.

### 2.5 Ressources et composants tiers

| Élément | Licence | Traitement |
| --- | --- | --- |
| `lucide` | — | non utilisé : icônes locales (`components/icons`) |
| Polices | OFL-1.1 via `next/font` | fichiers non auto-hébergés dans le dépôt ; attribution dans les notices |
| `monaco-editor`, `marked`, `dompurify` | MIT, MIT, MPL-2.0 **OR** Apache-2.0 | Apache-2.0 élu pour `dompurify` |
| `highlight.js` | BSD-3-Clause | autorisée |
| GIF / images / icônes PWA | production DEVNET | générées par `scripts/pwa/generate-assets.mjs` (versionnées) |
| `ffmpeg` / `ffprobe` | binaire **externe** | non distribué ; appelé s'il existe. Décision Systalink requise |
| CDN | aucun script tiers à l'exécution | — |

### 2.6 Effet de bord : deux défauts de build révélés

En remplaçant `lightningcss`, un défaut préexistant est apparu, **reproduit à
l'identique avec `lightningcss` réel** : les dossiers de build
(`.next-http-test-*`) étaient scannés comme sources par Tailwind, et un chunk
périmé réinjectait une classe supprimée avec des octets corrompus (`\u0012`),
ce qui cassait `next build`. Corrigé à la racine : `@source not` explicite pour
les dossiers de build, suppression des artefacts, et la classe
`z-[calc(var(--z-modal)+10)]` remplacée par le jeton nommé
`--z-modal-stacked` (même valeur, 310).

## 3. État final

| Mesure | Résultat |
| --- | --- |
| Paquets de l'arbre | 572 |
| GPL / AGPL / LGPL | **0** |
| MPL-2.0 dans le build de production | **0** |
| MPL-2.0 restant | `axe-core`, dev uniquement, via `eslint-plugin-jsx-a11y` → exception en attente de Systalink |
| Licences absentes | 0 (hors paquet racine privé) |
| Binaires natifs inventoriés | `@napi-rs/image*`, `@tailwindcss/oxide*`, `@napi-rs/keyring*` |
| `npm ci` | OK |
| `tsc --noEmit` | OK |
| `eslint` | 0 erreur |
| `next build` | OK |
| Portes a11y navigateur | 16/16 |
| `license:check`, `css:parity`, `sbom` | OK |

## 4. Points soumis à Systalink

1. **`axe-core` (MPL-2.0, développement seulement)** : maintenir l'exception
   (obligations MPL satisfaites, paquet non modifié, jamais distribué) ou
   remplacer `eslint-plugin-jsx-a11y` par des règles locales.
2. **`ffmpeg` / `ffprobe`** : programme externe non distribué, licence de
   l'hôte (LGPL/GPL). DEVNET ne peut pas garantir la licence du binaire qui
   sera présent en production ; il faut une décision explicite (fournir un
   binaire permissif, ou assumer l'invocation d'un programme séparé).
3. **`caniuse-lite` (CC-BY-4.0)** : données, attribution portée dans les
   notices ; confirmer que cela suffit.
4. **`meta-viewport` (`user-scalable=no`, `maximum-scale=1`)** : défaut
   d'accessibilité réel, mesuré par le moteur et classé `moderate` comme
   `axe-core`. Le retrait autorise le zoom mais change le geste sur mobile :
   décision produit, pas décision de licence.
5. **Conformité juridique définitive** : ce rapport atteste d'un état technique
   vérifié, pas d'un avis juridique.

## 5. Reproduction

```bash
npm ci
npm run license:check      # porte de licences
npm run css:parity         # parité du shim lightningcss
npm run sbom               # SBOM CycloneDX + SPDX
npm run test:media-images  # pipeline images + WebP animé
npm run test:a11y-engine   # moteur d'accessibilité
npm run test:push-notify   # Web Push
npx tsc --noEmit && npm run lint && npm run build
```
