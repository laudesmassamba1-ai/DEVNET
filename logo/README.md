# Logo KICHUB — maître et déclinaisons

Refonte du 22 octobre (demande client : *« sans mascotte, sobre, bien
fait »*). Le logo est une construction **monoline** : un **K** tracé au
trait uniforme à embouts arrondis, dont le coude porte un **nœud
magenta** — le point de connexion du réseau — et le wordmark
**KICHUB** posé en **Inter Display SemiBold** (vectorisé par inkscape,
aucune lettre dessinée à la main).

## Palette (conservée du fichier source)

| Rôle | Couleur |
|---|---|
| Indigo électrique | `#2505B7` — le K et le mot |
| Magenta | `#E038D1` — le nœud (accent unique) |
| Blanc | `#FFFFFF` — variante sur fond sombre |

## Fichiers

| Fichier | Rôle |
|---|---|
| `kichub.svg` | maître — fond transparent, lisant sur fond clair |
| `kichub-dark.svg` | variante sombre — K et mot blancs, nœud magenta |
| `kichub-preview.png` | rendu de contrôle (généré, jamais retouché) |
| `kichub-anim-A.lottie.json` | animation **Le tracé** (one-shot ≈ 3,2 s) |
| `kichub-anim-B.lottie.json` | animation **Connecté** (boucle exacte, 2 × 1,5 s) |
| `KICHUB_transparent-.png` | source historique — référence de palette seulement |

## Construction (source de vérité unique)

Toute la géométrie vit dans `scripts/kichub_geom.py` : trois segments
de K (hampe `K_STEM`, jambes `K_UP`/`K_DOWN`, épaisseur `SW = 30`),
le nœud `K_NODE`, la spec du wordmark. Deux générateurs la
consomment **sans rien redessiner** :

- `scripts/build_kichub_svg.py` — svg maître (K en traits, nœud en
  cercle, mot en `<text>`) → inkscape `--export-text-to-path` →
  `kichub.svg`/`kichub-dark.svg` + PNG de contrôle. Le gabarit est
  resserré sur l'encre (`fit_viewbox`, marge 30).
- `scripts/build_lottie.py` — le wordmark est relu directement dans
  `kichub.svg` (parseur de chemins relatif→absolu intégré), le K est
  tracé au trait (`st`, pas de remplissage sur lignes ouvertes) :
  - **A — Le tracé** : la hampe se dessine (trames 0–16), les deux
    jambes montent ensemble (12–30), le nœud pointe en ressort
    (28–36), le mot s'élève du dessous en fondu (44–60).
  - **B — Connecté** : le lockup posé, immobile ; le nœud bat deux
    fois (cycles de 45 trames) et une onde de connexion — un anneau
    magenta qui grandit et s'éteint — repart du nœud ; `op = 90` fait
    deux cycles exacts, la boucle ne saute pas.
- `scripts/build_lottie.py` lit `logo/kichub.svg` : **reconstruire le
  SVG avant les animations** (`make` ci-dessous).

## Rebuild

```sh
python3 scripts/build_kichub_svg.py   # SVG + PNG de contrôle
python3 scripts/build_lottie.py       # les deux Lottie
```

## Règles d'usage

- Le nœud magenta est l'accent **unique** : pas un de plus.
- Sur fond sombre, la variante `kichub-dark.svg` — ne pas réinverser
  les couleurs à la main.
- Aire protégée : la marge du gabarit (`fit_viewbox`), soit 30 unités
  de vue autour du lockup.
- Les durées des Lottie sont des livrables de marque — elles se
  changent dans `build_lottie.py`, pas dans les JSON.
