# Journal de design — novembre 2026

## Références consultées

- **GitHub** : la densité des métadonnées et le contexte d'un dépôt rendent
  les actions techniques scannables. Je ne reprends pas son chrome de produit
  complet ni ses panneaux omniprésents.
- **Linear** : hiérarchie compacte, états visibles et retours rapides. Je ne
  copie ni son univers de gestion de tâches ni ses animations d'entrée.
- **Are.na** : les liens entre contenus et la curation personnelle donnent
  une bonne piste pour les projets. Sa toile libre se transpose mal à un fil
  mobile consulté sur réseau lent.
- **Bluesky** : l'anatomie auteur/temps/contenu/réponse se lit bien sur
  téléphone. Je ne reprends pas le défilement infini.
- **Mastodon** : une timeline lisible et des actions explicites soutiennent
  les conversations. Je ne reprends ni l'interface d'administration d'instance
  ni ses contrôles de densité.
- **Read.cv** : la page a répondu HTTP 402 pendant la consultation ; aucune
  observation visuelle n'est revendiquée.

## Trois directions

### A — Marge de contribution (retenue)

Le fil se lit comme un carnet d'atelier, avec une gouttière de repères stable
et un code traité comme un extrait consultable.

- Palette : papier `#F6F4EF`, surface `#FBFAF7`, encre `#16150F`, secondaire
  `#6B685E`, filet `#E3DFD3`, terre cuite `#C2410C`.
- Typographie : Instrument Sans pour la lecture, IBM Plex Mono pour les
  valeurs et le code.
- Signature : une marge numérotée, qui sépare visuellement discussion et
  contenu technique.

```text
┌────────────────────────────────────────┐
│ Fil                      Confortable   │
│ ─ Tout   Abonnements   Communautés ─── │
│ 01 │ Awa K.  @awa · il y a 8 min       │
│    │ Une question de cache sur mobile…  │
│    │ ┌ TypeScript · Copier ──────────┐ │
│    │ │ 01  const key = ...           │ │
│    │ └───────────────────────────────┘ │
│    │ ♥ 4   Répondre  ↗                  │
└────────────────────────────────────────┘
```

### B — Cahier de revue

Une page claire presque monochrome où les publications ressemblent à des
entrées de revue de code, avec les annotations comme premier niveau.

- Palette : craie `#F9F8F4`, graphite `#24231F`, gris `#76736A`, filet
  `#D9D6CE`, brique `#9B3D21`.
- Typographie : IBM Plex Sans pour les libellés, IBM Plex Mono pour les
  diffs.
- Signature : annotations latérales reliées aux lignes de code.

```text
┌────────────────────────────────────────┐
│ Revue                                  │
│ Awa K. · @awa · 8 min                  │
│ Le cache réutilise-t-il la clé ?        │
│ ┌ diff ──────────────────────────────┐ │
│ │  + cache.set(key, result)          │ │
│ └────────────────────────────────────┘ │
│  ↳ annotation, réponse, lien vers dépôt │
└────────────────────────────────────────┘
```

### C — Index de terrain

Une timeline compacte à contraste fort, organisée par événements plutôt que
par grandes cartes.

- Palette : ardoise chaude `#24221E`, papier `#EAE6DC`, gris `#AAA699`,
  séparation `#454238`, ambre `#D47743`.
- Typographie : Instrument Sans et IBM Plex Mono.
- Signature : repères de temps continus entre publications, commits et
  réponses.

```text
┌────────────────────────────────────────┐
│ 08:42 ─ Awa publie une question         │
│   │     extrait TypeScript              │
│ 08:51 ─ Nafi répond                     │
│   │     lien vers le projet              │
│ 09:03 ─ commit associé                  │
└────────────────────────────────────────┘
```

## Choix

La marge de contribution donne à DevNet une signature issue du travail du
développeur, sans faire d'illustration culturelle.
Elle rend le contenu technique et la conversation faciles à distinguer d'un
coup d'œil, y compris dans une timeline dense.
Les tons chauds reprennent la palette demandée, mais Instrument Sans évite le
duo papier-crème/serif qui aurait rapproché l'interface d'un modèle éditorial.
Les filets remplacent les cartes empilées et leurs ombres ; la seule élévation
sert aux feuilles et aux menus.
La densité reste contrôlable et le fil demande « Charger plus » au lieu de
consommer du réseau en défilement automatique.

## Implémentation et compromis

- Tokens clairs/sombres, Instrument Sans locale, IBM Plex Mono, focus visible,
  rayons et élévation resserrés.
- Le fil propose les densités « Confortable » et « Compacte », mémorisées
  localement. Les brouillons du composeur restent conservés.
- Les extraits ont des numéros, une action de copie et un repli après douze
  lignes. Le surligneur maison reste léger, mais n'est pas Shiki.
- Le rappel horaire en surimpression a été retiré : il masquait l'action
  « Publier » sur mobile. L'alerte du jour reste dans la cloche.
- Les commentaires et publications restent en texte brut ; le Markdown
  complet n'est pas implémenté dans cette tranche.
- Pas de score Lighthouse avancé : aucune mesure instrumentée n'a été exécutée.

## Utilité des réglages et de la console

La première version avait des interrupteurs email/push qui ne pilotaient
aucun service et un bouton de suppression qui ne supprimait rien. Ces
contrôles ont été retirés. Les réglages exposent maintenant les préférences
qui agissent réellement : thème de compte, densité du fil et réduction du
mouvement sur cet appareil.

L'admin s'ouvre sur un tableau de bord : volumes réellement lus depuis le
backend et barres SVG de publications par semaine sur huit semaines. Le dessin
est léger, responsive, accessible par un tableau masqué aux lecteurs visuels
et animé en 180 ms ; la préférence de mouvement le désactive. La série est
explicitement plafonnée à 1 000 lignes pour éviter de cacher un échantillonnage.
Les barèmes XP sont consultables dans les paramètres admin mais restent
immuables depuis l'interface : ils doivent changer avec le code et ses tests.

Le compromis est assumé : cette console n'a pas encore d'événements d'audit,
de drapeaux globaux ni de métriques de sessions. Elle ne les simule pas.

## Critique visuelle

La capture mobile sombre montrait deux collisions : le panneau horaire des
défis masquait le début du fil, et le bouton flottant de rédaction recouvrait
une publication. Le composeur est maintenant dans l'en-tête ; le panneau
horaire a été retiré au profit de l'alerte déjà disponible dans la cloche.

La vérification visuelle au navigateur n'a pas pu être refaite après le
retrait : le serveur local ne répondait pas. Les captures systématiques aux
largeurs 375, 768 et 1440 px, dans les deux thèmes, ainsi que les notes par
écran, restent à faire ; aucun score visuel ni Lighthouse n'est revendiqué.

## Finition des feuilles et du retour

Les identifiants d'icône des ateliers (« package », « terminal ») sont rendus
par Iconoir, tandis que les vrais emoji restent du texte.
Le retour est présent dans l'en-tête partagé et revient au fil ou au parent
pertinent si aucun historique navigateur n'est disponible. Les feuilles reçoivent un verre très opaque, limité à leur surface ; le mouvement d'entrée
vit sur un conteneur distinct du déplacement piloté au doigt, afin que les
deux transformations ne se neutralisent pas. L'effet respecte la règle de
mouvement réduit existante.

## Recherche et choix de l'iconographie

Les familles ont été comparées à partir de leurs catalogues, dépôts et
métadonnées de paquets, pas choisies à partir d'une capture isolée.

| Pack | Constats vérifiés | Décision |
|---|---|---|
| [Iconoir](https://github.com/iconoir-icons/iconoir) | MIT, 1 383 dessins sur grille 24 px et 288 variantes solides ; paquet React officiel. | Retenu : glyphes plus expressifs que de simples contrôles linéaires, empreinte distribuée exploitable par tree-shaking. |
| [Tabler](https://github.com/tabler/tabler-icons) | MIT, plus de 6 250 SVG, contours 2 px et variantes pleines. | Rejeté : couverture excellente, mais silhouette contour uniforme déjà très répandue. |
| [Phosphor](https://github.com/phosphor-icons/react) | MIT, plusieurs épaisseurs et styles de remplissage. | Rejeté : la liberté de poids n'a pas suffi à différencier le résultat dans la coque DevNet. |
| [Google Material Symbols](https://github.com/google/material-design-icons) | Famille actuelle de Google, axes variables de poids, remplissage, grade et taille optique. | Rejeté : immédiatement reconnaissable comme langage Material, et la police variable serait un téléchargement supplémentaire. |
| [Solar Icons for React](https://github.com/saoudi-h/solar-icons) | MIT, variantes visuelles nombreuses ; la dernière archive NPM observée pesait 57,6 Mo décompressée. | Rejeté : dessin intéressant, mais surface de paquet trop grande pour le budget mobile sans mesure de bundle prouvant le contraire. |

Iconoir est installé depuis NPM, sans requête vers un serveur d'icônes. Les
glyphes utilisés sont centralisés dans `components/Icon.tsx`; les icônes au
repos sont fines, tandis que les actions actives ayant une variante fournie
basculent vers le dessin solide natif. `optimizePackageImports` limite
l'import de la grande bibliothèque à ses composants utilisés.

Les noms historiques sont conservés pour ne pas modifier les écrans appelants,
mais leur mapping est désormais sémantique : partage système, boussole,
structure Git et graphe ont chacun un dessin dédié. les recherches d'icônes
ont aussi révélé qu'Iconoir n'a pas de clavier dédié ; les raccourcis utilisent
un glyphe de touche Commande, et l'entrée « clavier » une touche seule. Le
contrôle d'arrêt utilise un carré plutôt qu'un pictogramme de pause.

## Fusion des trois directions — « Carnet de terrain »

Les trois directions n'étaient pas trois styles concurrents : c'étaient trois
réponses à trois questions différentes. A répond « comment lit-on un fil
dense ? », B « comment lit-on une annotation ? », C « comment sait-on quand
les choses ont eu lieu ? ». Retenir une seule direction laissait deux
questions sans réponse. La fusion les garde toutes les trois, en refusant
d'ajouter une couleur pour les distinguer.

| Direction | Ce qui est gardé | Ce qui est écarté |
|---|---|---|
| A — Marge de contribution | Papier chaud, filets, gouttière stable, Instrument Sans, terre cuite unique | La gouttière numérotée décorative : le numéro `01` était identique sur toutes les publications |
| B — Cahier de revue | Le registre d'annotation indenté, métadonnées en mono, la lecture par blocs | IBM Plex Sans et le duo papier/serif ; le ton monochrome intégral |
| C — Index de terrain | L'heure absolue en marge, le rail de temps continu, le contraste franc des repères | La timeline pleine largeur et l'organisation par événements qui aurait mélangé posts, commits et réponses dans un seul flux |

### Décision de mise en œuvre

- **La marge porte l'heure.** La gouttière affichait `01` en dur sur chaque
  publication : un repère qui ne variait pas n'informait pas. Elle affiche
  maintenant l'heure réelle du contenu, empilée sur deux lignes (`08` / `42`),
  ce qui tient dans les 32 px existants sans élargir la colonne de lecture.
  L'en-tête garde l'heure relative ; les deux ne se répètent pas.
- **Aucun nouveau jeton de couleur.** La fusion aurait pu ajouter un bleu
  « annotation ». C'eût été un troisième système déguisé en détail. Le
  registre se signale par le retrait et le filet, la marge par la fonte mono.
- **Le registre reste une règle, pas encore un écran.** Les panneaux de
  réponses existants n'ont pas été réécrits dans cette tranche ; la règle est
  consignée pour la tranche « Confiance » (contestation, mots masqués) où les
  annotations deviennent centrales.

### Compromis assumé

Une heure empilée se lit moins vite qu'une heure sur une ligne. C'est le prix
de la largeur de marge : élargir la gouttière aurait rogné le texte sur un
écran de 375 px, où la colonne fait déjà 343 px. Le `title` et le texte
« Publié à 08:42 » réservé aux lecteurs d'écran rétablissent l'information
complète.

La fusion ne prétend pas régler la dette transverse : i18n, pages 403/500,
hors-ligne et audit d'accessibilité restent ouverts. La planche de référence
de `DESIGN.md` décrit la cible, pas un écran mesuré.
