# Journal de direction artistique (DS-02)

Trois directions **réellement différentes**, comparées au sujet : un réseau
social de développeurs d'Afrique francophone, lu sur des mobiles modestes et
des réseaux lents. Aucune n'est produite en masse avant validation de
Laudes.

Le produit actuel ressemble à la direction A (déjà en place). Les deux
autres sont des ruptures assumées, pas des variantes.

---

## A — « Atelier de nuit » (direction actuelle, à renforcer)

**Concept.** L'écran est un établi : fond profond, traits fins, une seule
couleur qui appelle à l'action. Le code est chez lui.

**Palette.** `void #11110E` (fond) · `surface #1B1A15` · `chalk #ECE9DF`
(texte) · `signal #FF7A45` (action) · `phosphor #5FBF86` (succès) · `line #2C2A22`.

**Typographie.** Inter (texte, chiffres tabulaires) ; JetBrains Mono pour les
étiquettes, les compteurs, le code. Étiquettes micro en capitales espacées —
déjà présentes partout.

**Signature.** Le **bord vivant** : un `conic-gradient` animé sur la carte
« Exécuter » et le badge de niveau, deux dégradés animés au maximum.

**Mouvement.** Ressorts courts (150–240 ms), cascade limitée aux 6 premiers
posts, aucune boucle décorative. Le mouvement confirme, il ne décore pas.

**Croquis.**

```
┌──────────────────────────────┐
│ ≡  DevNet          ⌕  ◉  ▤  │
│ ┌──────────────────────────┐ │
│ │ Koffi · 2 min      ⟨/⟩   │ │
│ │ le fil, en une requête   │ │
│ │ ┌──────────────────────┐ │ │
│ │ │ ▶ Exécuter   JS · 12ms│ │ │
│ │ └──────────────────────┘ │ │
│ │ ♥ 12   ↺ 3   💬 5   ⤴   │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

**Tenue sur mobile lent.** Excellente : pas d'image de fond, un seul accent,
polices locales, animations en `transform`.

**Risque.** Peut lire « outil de développeur » avant « lieu de rencontre » ;
la chaleur humaine repose sur les visages et le vocabulaire.

---

## B — « Marché de quartier »

**Concept.** Une place vivante à l'heure du marché : matières chaudes,
formes franches, écriture manuscrite pour les moments humains, dense mais
accueillant. Aucun motif folklorique : la chaleur vient des couleurs et du
rythme, pas des clichés.

**Palette.** `nuit #171310` · `sable #F3E6D0` · `terre #C4552D` (action) ·
`indigo #2E3A8C` (liens, focus) · `ocre #E0A33E` (progression) · `feuille #3E6B4F`.

**Typographie.** Une display à empattements (Fraunces, sous-ensemble) pour
les titres de section et les noms ; Inter pour le corps ; mono pour le code.
Les étiquettes ne sont **plus** toutes en capitales : les sections portent
une phrase écrite à la main (une seule police script, réservée aux
célébrations).

**Signature.** La **bande de tissu** : un filet tissé (SVG de 700 octets)
sépare les grandes zones et se teinte selon la section ; les badges sont des
**tampons** légèrement inclinés.

**Mouvement.** Plus ample : feuilles qui montent avec un léger dépassement,
réactions qui rebondissent, compteurs qui roulent. Budget : deux effets
spectaculaires par écran.

**Croquis.**

```
╔══════════════════════════════╗
║ ▚▚▚▚▚▚▚▚ tissu ▚▚▚▚▚▚▚▚▚▚▚▚║
║  Le fil du jour              ║
║ ╭──────────────────────────╮ ║
║ │ Aminata · il y a 4 min   │ ║
║ │ « mon premier déploiement »│
║ │  ♥ 24   5 réponses        │ ║
║ ╰──────────────────────────╯ ║
╚══════════════════════════════╝
```

**Tenue sur mobile lent.** Bonne si les polices sont sous-ensemblées et le
tissu en SVG ; les arrondis et ombres doivent rester des traits, pas des
flous.

**Risque.** Deux familles supplémentaires = poids ; risque de « chaleureux
générique » si la typographie n'est pas tenue avec rigueur.

---

## C — « Signal »

**Concept.** DevNet comme une **fréquence** : le réseau est un signal qu'on
capte. Fond presque noir, deux accents électriques, grille fine, données
mises en avant. Esthétique d'instrument de mesure, pas de réseau social.

**Palette.** `encre #0A0C10` · `graphite #141821` · `blanc froid #E8EDF5` ·
`cyan #35E0D0` (action) · `magenta #FF4D8D` (alertes, réactions) ·
`grille #1E2633`.

**Typographie.** Une condensée pour les titres (Archivo Narrow) et une mono
pour **tout** le reste, y compris les noms. Les chiffres sont rois.

**Signature.** L'**onde** : un trait de waveform sépare les sections et
s'anime brièvement quand un post arrive ; la pastille « en direct » émet
trois impulsions puis se tait.

**Mouvement.** Balayages horizontaux, révélations par masque, très peu de
rebonds. Le mouvement ressemble à un balayage de radar.

**Croquis.**

```
┌──────────────────────────────┐
│ DEVNET   ▁▃▅▇▅▃▁   12:04:22 │
│ ─────────────────────────────│
│ KOFFI  · 02:14               │
│ le fil en une requête        │
│ ▶ RUN   JS      12ms   ✔     │
│ ♥12  ↺3  ✎5  ⤴               │
└──────────────────────────────┘
```

**Tenue sur mobile lent.** Très bonne : aucune image, contrastes nets,
animation minimale. Le texte mono partout coûte de la lisibilité sur les
longs paragraphes.

**Risque.** Froideur ; convient aux développeurs, moins aux nouveaux venus.
Accessibilité : le cyan sur encre doit être vérifié (AA) avant production.

---

## Comparaison

| Critère | A — Atelier | B — Marché | C — Signal |
|---|---|---|---|
| Différenciation | moyenne (déjà installée) | forte | très forte |
| Chaleur communautaire | moyenne | forte | faible |
| Lisibilité longue | forte | moyenne | moyenne |
| Poids / mobile lent | excellent | bon (polices) | excellent |
| Coût de migration | nul (statu quo renforcé) | élevé | élevé |
| Risque d'« encore un réseau » | moyen | faible | faible |

## Recommandation

**A comme base, avec un emprunt à B** : garder l'atelier (contraste, mono,
signal), et introduire **une** signature chaleureuse — la bande tissée en
filet entre les grandes zones, teintée par section. On obtient une identité
reconnaissable sans refonte ni budget de police supplémentaire.

Décision attendue : Laudes choisit A, B, C, ou « A + tissu ».

## Décision — 10 novembre 2026

**Direction retenue : A « Atelier de nuit » + la bande tissée de B.**

- La bande est un composant unique (`components/WovenBand.tsx`), SVG en
  `currentColor`, 8 px de haut, sans animation, `aria-hidden`.
- Posée aux **grandes frontières** : entre l'en-tête du fil et le contenu
  (teinte `signal`), entre l'identité et les onglets du profil (`phosphor`).
- Pas de nouvelle police, pas de nouvelle couleur : la teinte vient des
  tokens existants (`text-signal/45`, `text-phosphor/45`).
- Vérifié au navigateur : rendue sur `/feed`, `/profile`, `/u/<pseudo>`,
  pleine largeur, 8 px, teintes distinctes par section, zéro erreur console.
  `verify:ui` reste vert (aucune valeur arbitraire ajoutée).
