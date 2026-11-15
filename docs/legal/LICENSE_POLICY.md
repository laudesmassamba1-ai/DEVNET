# Politique de licences — DEVNET

Référence : **article 6 du règlement CADEV 2026**. Ce document dit ce que le
projet accepte, comment il le vérifie, et ce qui se passe quand une dépendance
sort du cadre.

## Liste autorisée

| Licence | Statut |
| --- | --- |
| MIT | autorisée |
| Apache-2.0 | autorisée (conserver `LICENSE` et `NOTICE`) |
| BSD-2-Clause | autorisée |
| BSD-3-Clause | autorisée |

## Licences interdites

**GPL, AGPL, LGPL** et **MPL-2.0** n'entrent pas dans l'arbre. MPL-2.0 est
écartée par précaution : aucune autorisation écrite de Systalink n'existe à ce
jour.

Le contrôle est automatique (`npm run license:check`) et bloquant en CI.

## Licences examinées au cas par cas

ISC, Zlib, IJG, 0BSD, CC0-1.0, Unlicense, BlueOak-1.0.0, Python-2.0, MIT-0,
CC-BY-3.0/4.0. Elles ne sont **ni déclarées conformes d'office, ni interdites** :
chaque paquet concerné figure dans `docs/legal/EXCEPTIONS.json` avec sa
justification.

## Expressions SPDX

Les expressions sont **évaluées**, pas comparées comme du texte :

- `A OR B` : conforme si **une** branche est acceptable. L'élection est
  consignée (`dompurify` : `MPL-2.0 OR Apache-2.0` → Apache-2.0).
- `A AND B` : conforme seulement si **toutes** les branches le sont.
  `Apache-2.0 AND LGPL-3.0-or-later` (les binaires `sharp` d'autrefois) est
  refusé — c'est exactement le piège que la matrice doit rendre visible : le
  `package.json` affichait Apache-2.0.

## Binaires natifs et contenus

Un paquet n'est pas jugé sur son seul champ `license` :

- `sharp` annonçait Apache-2.0 et livrait `libvips`/`libheif` en LGPL-3.0.
- `@napi-rs/image` annonce MIT ; ses codecs sont inventoriés un par un
  (MIT/Apache-2.0, BSD-2-Clause, BSD-3-Clause, Zlib, Apache-2.0 OR MIT) dans
  `THIRD_PARTY_NOTICES.md`.
- Les polices, images, GIF et icônes ont leurs propres licences (contenu ≠
  code) et sont documentées séparément.

## Outils de build et programmes externes

Les dépendances de développement sont dans le périmètre. Les **programmes
externes** invoqués à l'exécution (`ffmpeg`, `ffprobe`) ne sont pas distribués
par DEVNET : ils sont appelés par `child_process` quand l'hôte les fournit.
Leur licence est celle de l'hôte (LGPL/GPL selon la compilation). **Décision
Systalink requise** avant de considérer la conformité comme définitive.

## Gestion des exceptions

1. Une dépendance hors liste est refusée par la CI.
2. Pour la conserver : entrée dans `docs/legal/EXCEPTIONS.json` (nom, version,
   licence, justification, `authorization`).
3. Sans autorisation écrite, l'entrée porte `EN ATTENTE` et la décision est
   soumise à Systalink.
4. Une exception n'est jamais un `license` réécrit dans un `package.json` :
   les champs de licence ne sont **jamais** modifiés pour faire passer un
   contrôle.

## Vérifications

| Commande | Rôle |
| --- | --- |
| `npm run license:check` | porte : échoue sur interdite / absente / inconnue / hors liste |
| `npm run license:matrix` | régénère la matrice et les notices |
| `npm run sbom` | régénère `sbom.cdx.json` et `sbom.spdx.json` |
| `npm run css:parity` | vérifie que le shim MIT de `lightningcss` rend le même CSS |
| `npm run verify:legal` | les trois, dans l'ordre de la CI |

## Portée de ce document

Ce document décrit la **politique technique** du dépôt et son application
automatique. Il ne vaut pas avis juridique : la conformité définitive à
l'article 6 suppose la validation de Systalink, en particulier pour l'entrée
`axe-core` (développement uniquement) et pour `ffmpeg`.
