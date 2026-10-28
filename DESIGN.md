# DevNet — Direction artistique

> **Système « LIQUID IVOIRE »** — un fond ivoire mat porte des panneaux
> de verre translucide ; reflets directionnels, bords fins, ombres de
> contact et flou réservé aux surfaces flottantes révèlent leur profondeur
> sans halo lumineux. Graphite, accent olive, Inter et IBM Plex Mono;
> une seule identité claire, pensée pour le travail des développeurs.
> Issu des systèmes
> « TERMINAL », « PHOSPHORE », « PAPIER » puis « VERRE CLAIR », qu'il
> prolonge sans les renier.

---

## 1. Le concept

Trois décisions structurent tout le reste.

### 1.1 La mer et le verre liquide

Le fond est un dégradé ivoire très léger, mat et sans nimbes. Les panneaux
sont du **verre translucide** : une teinte claire garde la lecture stable,
un reflet linéaire dessine le bord et des ombres neutres marquent le
contact. Le volume vient des plans, pas d'une lumière colorée. Zéro cadre
épais, zéro ombre dure.

Le flou est réservé aux surfaces fixes ou flottantes — barres, feuilles,
bulle de saisie. Les cartes et rangées restent légères : elles utilisent
la transparence, le reflet et l'ombre, sans `backdrop-filter`.

Une seule identité claire : pas de variante sombre ni de bloc
`prefers-color-scheme`. `--color-void` reste l'encre (texte sur accent,
voiles), `--color-page` est le fond mat de page.

Corollaire : **l'encre est la couleur du texte, pas du fond.** Les tokens
portent des noms qu'on ne renomme que pour mentir — `--color-ink` →
`--color-chalk`, conservé.

### 1.2 Un accent olive, une donnée vivante

`--color-signal` (#C5D58C, l'olive doux de l'accent) est **le seul**
accent interactif : lien, bouton, focus, sélection, barre de progression,
série active. Il n'est jamais décoratif. Il évoque l'action nette d'un
lien — c'est la seule couleur que l'on autorise à « parler ». Sa version
foncée `--color-signal-d` (#496439) sert aux textes et icônes d'accent,
lisibles sur l'ivoire.

`--color-phosphor` (vert) est la **matière qui vit** : présence
d'éditeur, pastille « en ligne », donnée sémantique. Jamais sur un
bouton, jamais en fond de carte — la donnée n'est pas un élément de
commande.

Le vert (`--color-ok`), le rouge, l'or et le cyan existent mais sont
**sémantiques et rares** : succès, erreur, vérifié, annotation.

### 1.3 Le mono porte la donnée, le sans porte le propos

Tout ce qui est *une valeur* — compteur, pseudo, unité, horodatage,
chemin — est en mono. Ce qui est *une phrase* est en sans. Ce
partage-là fait le travail que faisait le gras dans une DA classique.

---

## 2. Couleurs

### Substrat — quatre plans

| Token | Valeur | Rôle |
|---|---|---|
| `--color-void` | `#24261F` | l'encre graphite et les aplats sombres |
| `--color-page` | `#F1EFE6` | le fond de page ivoire mat |
| `--color-surface` | `rgba(255,255,255,.24)` | cartes et panneaux translucides |
| `--color-surface-2` | `rgba(255,255,255,.40)` | champs, zones surélevées |
| `--color-surface-3` | `rgba(255,255,255,.62)` | survol, trames, désactivé |

Quatre plans suffisent : au-delà, on ne sait plus dire « un cran plus
haut » ni « deux crans plus haut », et l'interface perd sa hiérarchie.
Sur le fond ivoire, les surfaces gardent une translucidité visible; le
reflet et les filets distinguent les plans sans les transformer en cartes
blanches opaques.

### Encre

| Token | Valeur |
|---|---|
| `--color-chalk` | `#272A24` (graphite) |
| `--color-chalk-2` | `#41443D` |
| `--color-chalk-3` | `#62655D` |
| `--color-chalk-4` | `#6B6E65` |

**Filets**

| Token | Rôle |
|---|---|
| `--color-line` | `.08` (42,45,38) séparation discrète |
| `--color-line-2` | `.14` bordure de carte |
| `--color-line-3` | `.24` bordure appuyée, filet de l'onglet actif |

### Sémantique

Sur l'ivoire : signal `#C5D58C` · signal-d `#496439` · phosphor `#4F8A5B`
· ok `#327A4D` · danger `#B2433D` · warn `#855B16` · info `#386D74` —
les teintes **sémantiques** restent rares et contrastées.

### Dégradés — famille bleu

Plus aucun dégradé « Instagram » : la piste rose/violet/soleil a été
retirée dès v2. La marque est strictement `bleu → phosphor`.
`--gradient-amber-fire` (ambre→rouge) et `--gradient-ember` (ambre→or)
sont conservés pour les gains et le badge vérifié ; l'anneau de story
(`--story-ring-gradient`) est le dégradé bleu→vert, signature de l'app.

### Règle de contraste sur aplat signal

L'olive d'action est **clair et doux**. Posé en aplat, il porte un texte
graphite (`text-void`). Les liens et icônes utilisent l'olive foncé
`--color-signal-d`, contrasté sur le fond ivoire.

### Avatars

Pastels (`--color-av-*-bg` / `--color-av-*-fg`), conservés de la v1 :
ils doivent rester distincts sur l'ivoire. Ils ne sont utilisés que dans les
avatars — pas de puce colorée ailleurs, sinon la page devient un carnet
de couleur.

---

## 3. Typographie

| Rôle | Famille | Prais |
|---|---|---|
| Texte | **Inter** variable 400–800 | corps, titres, descriptions, libellés |
| Donnée | **IBM Plex Mono** 400–700 | compteurs, pseudos, code, libellés mono |

### Pourquoi ces deux

**Inter** est la police d'interface de référence : neutre, nette, sans
empattement ni envolée, on la lit vite à petit corps. Sur le fond ivoire
elle ne rivalise pas avec les surfaces — c'est exactement le rôle du
« bon verre ». Elle remplace l'ancien duo Chakra Petch + IBM Plex
Sans.

**IBM Plex Mono** reste pour la **donnée** : compteurs, pseudos,
horodatages, code. La séparation mono/sans fait le travail que faisait
le gras dans une DA classique.

### Échelle

`display-xl` 28px · `display-l` 22px · `display-m` 18px ·
`body` 15px · `body-s` 13.5px · `caption` 12px · `label` 10.5px ·
`micro` 9.5px · `code` 12.5px

### Les deux utilities de libellé

- `label` — mono, 10.5px, 700, interlettré 0.14em, uppercase.
- `prompt-label` — identique, **préfixé du prompt `❯` en accent**.
  `❯ CARTE D'ACTIVITÉ`, `❯ adresse email`.

C'est le repère d'héritage du système terminal : il relie les titres de
section, les libellés de formulaire et l'écran de connexion à la même
grammaire qu'un shell, sans reconduire son esthétique.

---

## 4. Mise en page

### La coque : deux dispositions

L'application change de coque à deux seuils déclarés dans `@theme`
(`globals.css`) comme des **capacités**, pas des tailles d'écran :

- `--breakpoint-shell: 55rem` (880 px) — le panneau de gauche apparaît.
- `--breakpoint-wide: 90rem` (1440 px) — la colonne passe de 620 à 720 px.

Le calcul de `shell` : 236 (panneau) + 560 (la colonne que le mobile
affiche déjà) + 2 × 40 de gouttière. En dessous, le panneau ne ferait
que rogner le contenu : franchir le seuil RÉTRÉCIRAIT la page, ce qui
est l'inverse de ce qu'on attend d'un écran plus grand. (L'ancien seuil
Tailwind `md:` à 768 px donnait 532 px de contenu collé aux bords —
plus étroit que le mobile qu'on venait de quitter.)

```
< 880 px (mobile)              ≥ 880 px (shell)
┌──────────────────┐   ┌────────┬──────────────────┐
│ ▍ FIL       [ ⌨ ]│   │ ❯ nav  │ ▍ FIL      [ ⌨ ] │  ← h-56
├──────────────────┤   ├────────┼──────────────────┤
│                  │   │ FIL    │                  │
│     contenu      │   │ GROUPS │      contenu     │  ← colonne
│     max 560      │   │ MESS.  │      max 620     │     620 / 720
│                  │   │ PROFIL │      (720 en     │  + filets latéraux
├──────────────────┤   │        │       wide)      │
│ ╳ FIL GROUPS ... │   │        │                  │
├──────────────────┤   ├────────┴──────────────────┤
│ ❯ ~/fil ⚡  22:59│   │ ❯ ~/fil  ⚡ démo   22:59  │  ← statut au pied
└──────────────────┘   └──────────────────────────┘
```

**Panneau de gauche (≥ 880)** — 236 px fixes, bordure droite filet.
Navigation principale en haut, ligne de statut reportée au pied du
panneau : les mêmes informations (*où*, *quel* mode, *quand*), à la
même place fonctionnelle — le bas d'une coque d'éditeur.

**Barre de statut (mobile)** — collée sous la barre d'onglets. Trois
informations par ordre de valeur décroissante : *où* on est (chemin),
*quel* mode (démo / en ligne), *quand* (heure du poste). Le mode démo
ne s'affiche que lorsqu'il est actif : une information toujours
présente cesse d'être lue.

**Barre d'onglets (mobile uniquement)** — l'onglet actif se décolle par
un liseré d'accent et un fond `--color-surface-2`. Libellés en
minuscules : ce sont des onglets, pas des titres. Sur grand écran, la
navigation vit dans le panneau : une navigation à deux endroits
serait une navigation dont on ne sait plus qui commande.

**Colonne de contenu** — centrée, filets latéraux `--color-line-2/40`
sur desktop : la colonne se détache du fond comme une page d'éditeur.
À 620 px jusqu'à `wide`, puis 720 px. Au-delà de ~1920 px, l'écran
affiche deux voids de ~500 px de chaque côté — le comportement normal
d'une colonne de lecture centrée (GitHub, Twitter), et le remplir
serait de la décoration.

**Cohérence hook / CSS** — `useIsDesktop()` (`hooks/useMediaQuery.ts`)
valide `(min-width: 880px)`, identique à `--breakpoint-shell`. Les deux
fichiers doivent évoluer ensemble : c'est le même seuil, écrit deux
fois parce que l'un vit en CSS et l'autre en JS.

### La gouttière de lignes

Chaque carte de post porte à gauche une colonne de 26 px : icône de
fichier, numéro `1`, filet vertical, icône de commentaire. Ce n'est pas
décoratif — le contenu est un flux, mais la **structure** doit être
stable, et c'est ce qui permet à l'œil de parcourir le fil sans lire.

### Grille : base 4 px

`--space-xs` 4 → `--space-2xl` 32. Gutter 1.1rem.

---

## 5. Surfaces, rayons, ombres

### Rayons : capsules et coques continues

Trois jetons : la commande devient une **gélule** (`--radius-chip` 999 px —
puces, onglets, boutons ronds), le champ un arrondi franc (14 px), la
carte une coque (18 px). **Rien n'a d'angle droit** : une règle de base
arrondit tout contrôle de formulaire, tout glyphe (`kbd`, `code`) et
toute image, que les utilitaires (`rounded-full`) peuvent encore
surcharger au cas par cas.

### Surfaces : le verre clair et le verre flottant

Les surfaces sont du **verre translucide** : `--glass-bg` (34 %) et
`--glass-bg-strong` (52 %) laissent le fond ivoire affleurer. Un reflet
linéaire discret, un bord fin et
des ombres neutres donnent l'épaisseur; les cartes et rangées n'ont pas de
`backdrop-filter`. Le flou reste sur les barres et les surfaces flottantes
où le contenu défile dessous (`blur(16px) saturate(1.08)`, jusqu'à 22 px
sur le composeur).

Le verre flottant conserve un liseré directionnel doux, sans filtre de
déformation ni éclat coloré : le mouvement vient des transitions de
surface et de l'élévation, pas d'une animation lumineuse permanente.

Le fond est un dégradé vertical ivoire, sans radiaux d'ambiance. Le
contraste de plans et les ombres de contact suffisent à détacher le verre.

### Ombres : douces, diffusées dans la profondeur mate

L'ombre est **neutre et discrète**, avec trois crans d'élévation. Deux
couches quand la surface se soulève : un contact court et une portée
diffuse. Jamais d'ombre noire, jamais d'ombre dure — elle « collerait » le verre.
Le contour des verres est un filet discret (`--color-edge`) ; les actions
gardent une ombre neutre (`--shadow-action`), sans halo bleu.

### Focus

Une seule définition pour toute l'application :

```css
:focus-visible { outline: 2px solid var(--color-signal); outline-offset: 2px; }
```

Elle reste branchée sur `--color-signal-d` (olive foncé), ≥3:1 sur le fond.

L'interface vit sur **une seule identité** : il n'existe pas de bloc
`prefers-color-scheme` dans `globals.css`. Les écritures d'accent
(`.text-signal`, `.text-danger`, …) sont claires, lisibles au-dessus de
la mer — les `bg-signal`, `bg-ok` restent vifs : un aplat d'accent se
porte vif, il s'écrit foncé (`text-void`).

---

## 6. Coloration syntaxique

Deux variantes, mêmes jetons, basculées par un attribut :

- `paper` → `data-code-variant="paper"` : surface normale, contraste standard.
- `terminal` → `data-code-variant="terminal"` : fond plus profond que
  l'UI, contraste poussé d'un cran. Pour les lectures longues.

La palette dérive des teintes de l'interface : passer d'une card à un
bloc de code ne doit pas donner l'impression d'un autre univers.

| Jeton | Rôle |
|---|---|
| `--color-code-keyword` | `import`, `const`, `return` |
| `--color-code-string` | chaînes, littéraux |
| `--color-code-number` | nombres |
| `--color-code-function` | appels |
| `--color-code-type` | types, classes |
| `--color-code-comment` | commentaires (italique) |
| `--color-code-punct` | ponctuation |

Tokenizer maison (`lib/highlight.ts`), 13 langages, zéro dépendance.
Invariant testé : le texte restitué est **identique** à l'entrée.

---

## 7. Icônes

Jeu maison, grille 24×24, trait 1.7, **`strokeLinecap="square"`** et
**angles coupés**. Sur un carré de 3→21, le chanfrein vaut 2 px :

```
M5 3 H19 L21 5 V19 L19 21 H5 L3 19 V5 Z
```

Le chanfrein est assez marqué pour se voir à 12 px, assez faible pour
ne pas devenir une identité de marque à lui seul. C'est ce qui empêche le
jeu de ressembler à Feather, Lucide ou Phosphor — trois jeux qu'on
reconnaît à leur premier glyphe.

60 icônes, dont un vocabulaire d'outillage : `terminal`, `branch`,
`command`, `hash`, `package`, `server`, `bolt`, `layers`, `grid`,
`cursor`, `keyboard`, `file`.

Tailles autorisées (union, pas `number`) : `9 11 12 14 16 18 20 24`.
Une union empêche l'introduction d'un `size={17}` qui dériverait.

---

## 8. Textures

| Utility | Effet |
|---|---|
| `scanlines` | lignes de tube cathodique, opacité 22 % |
| `hatch` | trame diagonale, plans techniques |
| `adinkra-motif` | motif Nkran, **10 % d'opacité max** |
| `grid-bg` (body) | grille 32 px + lignes 3 px |

Le motif Adinkra est le seul lien avec la marque d'origine. Il habille
un fond, **jamais** un texte : au-delà de 10 %, il rend les libellés
illisibles (constaté puis corrigé sur la carte de palier).

---

## 9. Ce qu'on refuse

- **Neon / cyberpunk.** Un réseau de développeurs n'est pas un jeu vidéo.
  Le seul accent est un ambre de tube, pas un dégradé rose-cyan.
- **Le verre sans lumière.** Une surface translucide sans reflet ni
  liseré est un aplat gris : toute surface de verre porte son
  `--glass-sheen`, son `--glass-rim` et son ombre ambiante. Un contour
  noir décalé (l'ancien néobrutalisme) est également refusé.
- **Le fond uniforme.** Sans lueurs ambiantes derrière, le flou n'a
  rien à flouter : le verre semblerait transparent.
- **Bleu système, vert « succès » générique.** Le focus est l'ambre, le
  succès est un vert phosphore, et rien d'autre n'est coloré.
- **Icônes à coins arrondis** au milieu d'un jeu chanfreiné.
- **La mode « terminal » comme costume.** Le fond sombre et la barre de
  statut ne sont pas décoratifs : ils cadrent une lecture dense. Si une
  page n'a pas besoin de densité, elle n'a pas besoin de ce système.

---

## 10. Implémentation

Tout est centralisé dans `app/globals.css` (`@theme`). Les composants ne
doivent contenir **aucune couleur littérale** : un token de plus vaut
mieux qu'une exception, et une couleur en dur casse les deux thèmes comme
la recherche et la navigation clavier.

`npm run lint` + `npx tsc --noEmit` + captures navigateur à chaque
refonte : une DA ne se valide pas à la lecture du CSS, elle se regarde.
