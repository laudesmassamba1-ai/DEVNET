# Registre des défauts d'UI/UX — DevNet

> Référence logique : `.agents/skills/devnet-ux-repair`. Chaque ligne porte une
> **preuve** : `docs/ui/ux-metrics.json` et `docs/ui/ux-details.json` sont
> produits par `npm run ux:scan` (analyse syntaxique TypeScript, 166 fichiers,
> 37 pages, 9 nov. 2026). Les mesures de rendu (contraste, cibles, focus)
> viennent de `npm run ux:measure` (Playwright) et sont consignées dans
> `docs/ui/measurements.json`.
>
> Statuts : **ouvert** → en cours → corrigé (preuve) → **verrouillé** (test +
> cliquet rétréci dans la même PR). Un défaut « corrigé » sans test ni cliquet
> n'est pas terminé.

## Priorisation

1. Bloquant accessibilité/sécurité (AX).
2. Plaintes de Laudes (LAU) — **elles priment à gravité égale**.
3. États manquants (chargement, vide, erreur).
4. Cohérence (échelles, couleurs).
5. Parcours clés (connexion, publier, message, signaler).
6. Performance perçue.
7. Finition.

---

## Plaintes de Laudes (recueillies le 9 novembre 2026)

Recopiées **telles quelles**, avec leur rattachement aux défauts mesurables.

### LAU-001 — « les icônes moches et non sens » — [MAJEUR] [statut : corrigé sur le fil et la messagerie]
- Origine : plainte de Laudes.
- Le chiffre initial « 16 sans nom » était **faux à 10 près** : le scan ne
  voyait pas le texte rendu par une expression (`{c.name}`, `{busy ? … : "Se
  connecter"}`) et comptait des boutons « Canal #debogage », « onglet »,
  « fichier » comme icon-only. Scan corrigé : **6 vrais** défauts, tous nommés
  (sélecteurs d'icônes avec `aria-pressed`, suppressions de ligne, envoi de
  réponse). Cliquet `0`, vérifié au navigateur (17/17).
- Planche produite : `docs/ui/audit/icones.md` (57 noms d'icônes recensés,
  usages, boutons sans nom d'origine).
- Ce qui reste **subjectif** : « moches » et « non sens » — le choix
  graphique et le lien icône↔action restent à trancher sur captures.
  infobulle au survol **et** au focus.
- Test : e2e « tout bouton-icône a un nom accessible » + cliquet `16 → 0`.

### LAU-002 — « les bugs d'interface » — [BLOQUANT] [statut : ouvert]
- Origine : plainte de Laudes.
- Ce qui est mesurable : erreurs de console, débordement horizontal à 360 px,
  cibles < 44 px, focus invisible, fermeture de surcouche sans restitution du
  focus (mesures Playwright, §3.4 et §3.5). Les bugs fonctionnels précis
  (action qui ne fait rien, état bloqué) demandent une reproduction : la
  plainte ne nomme pas de page — ⚠️ une seule question à Laudes à la prochaine
  étape (« quelle page, quel geste, quel résultat attendu ? »).
- Correctif prévu : un bug = un test de régression Playwright.

### LAU-003 — « les sections mal faites » — [MAJEUR] [statut : ouvert]
- Origine : plainte de Laudes.
- Ce qui est mesurable : **9 fichiers > 800 lignes** (dont
  `app/projects/[id]/page.tsx`, `app/profile/page.tsx`, `components/ScorePanel.tsx`),
  hiérarchie de titres et de sections incohérente d'un écran à l'autre,
  métadonnées absentes sur **33 pages sur 37**.
- Correctif prévu : revue écran par écran avec captures avant/après ;
  découpage des pages géantes (Vague 5) sans changer la logique.

### LAU-004 — « les fonctionnalités ui manquantes » — [MAJEUR] [statut : ouvert]
- Origine : plainte de Laudes.
- Ce qui est mesurable : **0 `aria-invalid`, 0 `aria-describedby`** (aucune
  sémantique d'erreur de formulaire) ; **0 `global-error.tsx`** ; `error.tsx`
  sur 1 segment, `not-found.tsx` sur 1 segment pour 37 pages ; **15 `loading.tsx`
  tous identiques**, sans squelette.
- Correctif prévu : `Field` (§5.2), états système par segment (§5.18),
  métadonnées par page (§5.19).

### LAU-005 — « le design pas abouti » — [MAJEUR] [statut : ouvert]
- Origine : plainte de Laudes.
- Ce qui est mesurable : **206 usages de texte < 12 px** (contre un minimum
  absolu de 12 px) ; **2 315 valeurs Tailwind arbitraires** ; **79 `outline-none`**
  pour 18 `focus-visible:` explicites ; 8 couleurs en dur ; 4 pages seulement
  avec métadonnées.
- Correctif prévu : Vague 3 (échelles typographiques et d'espacement en
  variables), **par composant**, jamais par remplacement global.

### LAU-006 — « les animations inexistantes » — [MAJEUR] [statut : partiellement corrigé — fil, messagerie, studio]
- Origine : plainte de Laudes.
- Ce qui est mesurable : à établir au navigateur — nombre de transitions et
  d'animations par écran, et respect de `prefers-reduced-motion` (⚠️ mesure
  Playwright à produire ; le scan statique ne compte que les classes `mo-*`).
- Ce qui est probable : le mouvement existe (composant `Motion`, classes
  `mo-press`), mais il est **inégal** d'un écran à l'autre — un état ne
  s'anime pas, un autre oui, sans règle écrite.
- Correctif prévu : une échelle de durées et de courbes **unique** (§4), un
  vocabulaire d'animation (apparition de liste, ouverture de surcouche,
  changement d'onglet), et **toujours** un repli en mouvement réduit.

---

## Défauts mesurés (revérifiés le 9 novembre 2026)

Les chiffres de la table de départ du protocole ne sont **pas** repris tels
quels : chacun a été recompté. Les écarts sont signalés.

### UX-001 — Texte sous 12 px — [MAJEUR] [statut : ouvert]
- Mesure (✅ AST) : **206** usages de `text-[9px] | text-[10px] | text-[11px]`
  (le protocole en annonçait 208) — `ux-metrics.json` → `tinyTextUses`.
- Pires fichiers : `components/GithubPanel.tsx` (16), `app/ide/[project]/page.tsx` (11),
  `components/PullRequestPanel.tsx` (9).
- Impact : lisibilité et zoom texte (WCAG 1.4.4) ; les métadonnées deviennent
  illisibles en mobilité.
- Correctif : échelle typographique en variables (`docs/ui/scale.md`), plancher
  **12 px** ; cliquet `206 → 0`.
- Test : Playwright « aucune police calculée < 12 px » sur les routes P0.

### UX-002 — Valeurs Tailwind arbitraires — [MAJEUR] [statut : ouvert]
- Mesure (✅ AST) : **2 315** tokens `[…]` dans les `className`
  (le protocole annonçait 1 410) — `arbitraryValues`.
- Correctif : échelle d'espacement en variables ; les valeurs manquantes
  s'ajoutent **à l'échelle**, pas en ligne.

### UX-003 — Couleurs en dur — [MINEUR, revu à la baisse] [statut : ouvert]
- Mesure (✅ AST) : **8** occurrences de couleur littérale (`#hex`, `rgb()`,
  `hsl()`) dans les `className`/`style` — le protocole annonçait 120. Une
  recherche de texte brute en trouve 25 (commentaires et chaînes comprises) :
  l'écart venait donc d'un comptage textuel, pas de l'interface.
- Conséquence honnête : le défaut est **beaucoup moins grave** qu'annoncé.
  Les 8 sont à remplacer par les variables de `app/globals.css`.

### UX-004 — Focus potentiellement invisible — [BLOQUANT ⚠️] [statut : en cours]
- Mesure (✅ AST) : **79 `outline-none`** contre **18 `focus-visible:`**
  explicites. Un style global `:focus-visible` existe dans `app/globals.css`.
- Mesure de rendu (✅ Playwright, 9 routes × 2 fenêtres, 12 arrêts de
  tabulation chacune) : **aucun anneau invisible** — le `:focus-visible`
  global (2 px, `--color-signal`, opaque) l'emporte sur les `outline-none`
  des routes mesurées. Le défaut n'est donc **pas bloquant**, contrairement
  à l'hypothèse ; il reste un risque sur les routes non mesurées et sur le
  contraste de l'anneau (non calculé ici).
- Action : ne pas « corriger » les 79 `outline-none` à l'aveugle ; les
  retirer au fur et à mesure des composants touchés, avec le test de focus.
  Cliquet `outlineNone` conservé pour empêcher toute hausse.

### UX-005 — États de chargement pauvres — [MAJEUR] [statut : ouvert]
- Mesure (✅ AST) : **15 `loading.tsx`** pour **37 pages**, tous le même
  spinner plein écran ; aucun squelette de la forme du contenu.
- Correctif : squelettes par segment (§5.18), hauteur réservée.

### UX-006 — États d'erreur quasi absents — [BLOQUANT] [statut : ouvert]
- Mesure (✅ AST) : `error.tsx` **1**, `not-found.tsx` **1**,
  `global-error.tsx` **0** pour 37 pages.
- Correctif : `error.tsx` + `not-found.tsx` par segment majeur, `global-error.tsx`.

### UX-007 — Titres et partage — [MAJEUR] [statut : ouvert]
- Mesure (✅ AST) : **4 pages sur 37** définissent `metadata`/`generateMetadata`.

### UX-008 — Champs sans étiquette associée — [BLOQUANT] [statut : corrigé]
- Mesure initiale (✅ AST) : **60 champs sur 122** sans nom (le protocole
  annonçait 59/115). Cause racine : trois copies de `Field` rendaient
  `<label>` en **frère** du champ, sans `htmlFor` ni `id`.
- Correctif : `components/Field.tsx` (un `useId`, `htmlFor` ↔ `id`, groupe
  nommé par `aria-labelledby` quand l'enfant n'est pas un champ) + 49 noms
  explicites sur les champs hors `Field`.
- Vérifié au navigateur : **0 champ sans nom** sur 9 routes × 2 fenêtres, dans
  les feuilles « Nouvelle communauté » et « Publier une extension », et dans
  les commentaires du fil ; cliquer l'étiquette donne le focus (17/17).
- Limite assumée : `aria-label` duplique le libellé visible sur les champs
  hors `Field` ; la conversion au composant reste à faire au fil des retouches.
- Cliquet `60 → 0` (mesure navigateur `fieldsWithoutName` aussi).

### UX-009 — Formulaires sans sémantique d'erreur — [BLOQUANT] [statut : ouvert]
- Mesure (✅ AST) : **0 `aria-invalid`**, **0 `aria-describedby`**.
- Correctif : `Field` (§5.2) + résumé d'erreurs ; test e2e sur la connexion et
  l'inscription.

### UX-010 — Boutons-icônes sans nom accessible — [BLOQUANT] [statut : corrigé]
- Mesure (✅ AST) : **6 sur 51** après correction du scanner (il annonçait 16,
  dont 10 faux positifs sur du texte rendu par expression) ; puis **0** après
  nommage.
- Correctif : noms explicites + `aria-pressed` sur les sélecteurs d'icônes.
- Vérifié au navigateur : un seul choix pressé à la fois, nommé « Icône … ».
- Cliquet `0`. L'`IconButton` à `label` obligatoire reste souhaitable pour
  empêcher la régression à la source (Vague 2, composants partagés).

### UX-011 — Ordre de tabulation — [MAJEUR] [statut : ouvert, partiellement faux]
- Mesure (✅ AST) : **0 `tabIndex` positif** (le protocole en annonçait 2 : le
  seul `tabIndex` de `ReportButton` est conditionnel `0 | -1`, jamais positif) ;
  **8 `autoFocus`**.
- Correctif : retirer les `autoFocus` de chargement de page ; garder ceux des
  surcouches demandées.

### UX-012 — Pages géantes — [MAJEUR] [statut : ouvert]
- Mesure (✅ AST) : **9 fichiers > 800 lignes** (le protocole en annonçait 8).

### UX-013 — Défauts ponctuels — [MINEUR] [statut : ouvert]
- Mesure (✅ AST) : **1 bouton sans `type`**, **1 `target="_blank"` sans `rel`**
  (`app/register/page.tsx:344`, un `Link`), **2 clics sur élément non
  sémantique** ; aucun lien `href="#"`.

### UX-014 — Mouvement réduit — [MAJEUR, non bloquant mesuré] [statut : ouvert]
- Mesure (✅ Playwright) : sous `prefers-reduced-motion: reduce`, **0 animation
  en cours** sur les 9 routes × 2 fenêtres. Les transitions CSS ne tournent
  pas en animation continue : rien ne clignote, rien ne boucle.
- Limite : `getAnimations()` ne dit pas si une transition **ponctuelle**
  (survol, apparition) est supprimée ; à confirmer par revue des classes
  `mo-*` et des durées (Vague 6).

### UX-015 — Fenêtres superposées — [MAJEUR ⚠️] [statut : ouvert]
- Mesure (✅ AST) : **4 éléments `role="dialog"`** ; gestion d'Échap à
  confirmer au clavier (piège de focus + restitution) ⚠️.

### UX-016 — Texte non internationalisable — [MINEUR] [statut : ouvert]
- Aucune bibliothèque d'i18n ; chaînes françaises en dur. À traiter avant
  l'anglais, pas avant.

### UX-017 — Installation, thème, ressources d'exemple — [MINEUR] [statut : ouvert]
- ⚠️ manifeste d'application à confirmer ; `themeColor` unique ;
  `public/{file,globe,next,vercel,window}.svg` encore présents.

### UX-018 — Cibles tactiles — [BLOQUANT] [statut : ouvert]
- Mesure (✅ Playwright, liens « en ligne » exclus comme le prévoit WCAG
  2.5.8) : **/feed mobile 83 cibles sur 143** sous 44 × 44 px ; /login 2/17 ;
  /projects 6/21 ; /profile 9/26 ; /projects/p-1 5/27.
- Exemples sur le fil : bouton auteur 78 × 29, hashtag 86 × 26, actions de
  publication 40 × 44, 34 × 44, 30 × 44.
- Note honnête : ces cibles passent le minimum WCAG 2.2 AA (24 × 24) ; elles
  échouent le seuil du contrat (44 × 44). Correctif : étendre la zone
  cliquable (padding transparent), pas grossir l'icône.

### UX-019 — Éditeur Monaco et clavier — [BLOQUANT ⚠️] [statut : ouvert]
- ⚠️ à vérifier sur `/ide/<projet>` : la touche `Tab` sort-elle de l'éditeur ?

---

## Mesures de rendu (Playwright, démonstration forcée, 9 nov. 2026)

9 routes × 2 fenêtres (360×640, 1440×900). Captures : `docs/ui/audit/`.
Données brutes : `docs/ui/measurements.json`. Liens « en ligne » exclus des
cibles tactiles (exception WCAG 2.5.8).

| Route | Débordement 360 px | Texte < 12 px (mobile / bureau) | Cibles < 44 px (mobile / bureau) |
|---|---|---|---|
| /login (déconnecté) | non | 22 / 22 | 2 sur 17 / 2 sur 17 |
| /feed | non | 53 / 56 | **83 sur 143** / 102 sur 157 |
| /profile | **oui** | 49 / 52 | 9 sur 26 / 28 sur 40 |
| /projects | **oui** | 38 / 41 | 6 sur 21 / 25 sur 35 |
| /projects/p-1 | **oui** | 31 / 49 | 5 sur 27 / 28 sur 51 |
| /u/aminata_dev | non | 57 / 60 | 6 sur 17 / 25 sur 31 |
| /messages | non | 17 / 20 | 0 sur 13 / 19 sur 27 |
| /settings | non | 10 / 13 | 7 sur 25 / 26 sur 39 |
| /extensions | non | 61 / 64 | 19 sur 40 / 38 sur 54 |

**Débordement à 360 px** (LAU-002/LAU-005) : `/profile`, `/projects` et
`/projects/p-1` dépassent la largeur de l'écran — un défaut reproductible,
visible sur les captures `profile-360.png`, `projects-360.png`,
`projects-p-1-360.png`.

**Focus** : aucun anneau invisible sur les 108 arrêts de tabulation mesurés
(9 routes × 2 fenêtres × 12 arrêts) — le style global opaque de 2 px gagne.

**Mouvement** (LAU-006) : les transitions existent (**14 à 182** éléments par
écran selon la route : 170 sur le fil mobile, 22 sur la connexion), mais les
animations **en cours** au repos sont rares (0 à 2). La plainte « animations
inexistantes » se lit donc ainsi : le mouvement est présent sur les états
interactifs, quasi absent sur l'arrivée de contenu et les changements de vue —
il est inégal, pas inexistant. Sous mouvement réduit : 0 animation en cours
partout (✅).

**Noms accessibles rendus** : 0 contrôle sans nom sur les 9 routes (le scan
statique en trouve 16 dans le code, sur des écrans ou états non visités).

### Deux corrections de la mesure elle-même (9 nov.)

1. **Boutons-icônes** : le scanner lisait le JSX mais pas le texte rendu par
   une expression. `<button><Icon/><span>{c.name}</span></button>` passait pour
   icon-only : 10 des 16 signalements étaient faux. La règle tient maintenant
   compte des expressions (ternaire, `&&`, gabarits, fragments) et ignore les
   sous-arbres `Icon`/`Spinner`/`svg`.
2. **Champs** : la zone de saisie interne de Monaco (`.ime-text-area`) n'a pas
   de nom par conception ; elle est désormais exclue des mesures. Sans cette
   exclusion, `/projects/p-1` affichait un faux défaut.

Ces deux corrections ne changent **aucune** observation de Laudes : elles
évitent de « réparer » du code sain et de laisser croire à des défauts qui
n'existent pas.

## Ce que la mesure a démenti

Trois chiffres du protocole ne tiennent pas sur ce dépôt : **couleurs en dur**
(120 → 8), **tabIndex positifs** (2 → 0), **boutons-icônes sans nom**
(30 → 16). Deux sont surestimés par un comptage textuel, un est un défaut
déjà corrigé. Le registre garde les chiffres **mesurés**, pas ceux du
document de départ.

## Vague 7 — fil, messagerie, studio (10 novembre 2026)

Réponse directe aux deux demandes : « change les icônes sur le fil, améliore
les visuels, règle les bugs, ajoute les GIF » puis « stickers et GIF dans
toutes les sections de messagerie, un vrai studio de statut, des
micro-animations ».

### Fil

- **Icône repost** : `ChatLines` (une bulle de chat, déjà utilisée pour
  « Messages ») → `Repeat`. Une icône qui dit deux choses n'en dit aucune.
- **Barre d'actions unifiée** : `ACTION` / `ACTION_ICON` dans `PostCard.tsx`,
  cibles 44 × 44 px, `aria-pressed` sur les bascules. Typo de carte fixée
  (nom 14 px, pseudo et méta 12 px, corps 15 px).
- **GIF du fil** : migration `052_post_gifs.sql` (`gif_url`, `gif_alt`),
  sélecteur `GifPicker`, route `/api/gifs/search` (Tenor, repli Giphy, clé
  **serveur**), rendu dans `PostCard`, envoi possible sans texte.
- Sans clé, la route répond **200 `{configured:false}`** : l'écran explique
  quelle variable poser au lieu d'afficher une erreur console.

### Messagerie (`/messages`, `/groups/[id]`)

- Migration `053_message_media.sql` : `gif_url`, `gif_alt`, `sticker_id` sur
  `direct_messages` et `group_messages`, URL en `https` exigée, `alt` borné.
- `MessageAttachmentButtons` (GIF + sticker, 44 px) branché dans le composeur
  des deux surfaces ; le choix **envoie** immédiatement — un sticker est un
  geste, pas un brouillon.
- `MessageAttachmentView` rend le média dans la bulle, avec l'animation
  `mo-burst` à l'arrivée. Le catalogue de stickers est chargé une fois par
  écran (map `id → ligne`).
- En mode démo forcé, `/api/stickers` sert le catalogue de la maison
  (`lib/sticker-catalog.ts`) : sans base, le sélecteur restait vide et
  paraissait cassé.
- Règles partagées dans `lib/message-media.ts` : média seul accepté, URL non
  sûre refusée, identifiant de sticker validé.

### Studio de story (`components/StoryStudio.tsx`)

- Aperçu 9:16 qui est **le brouillon et le rendu** : la légende s'écrit dans
  le cadre, le média s'y pose, l'en-tête montre l'auteur et l'échéance 24 h.
- Légende avec compteur (`STORY_MAX`), avertissement à 20 caractères de la
  limite, sortie par `Motion role="scale"`.
- Média : photo ou vidéo, aperçu local, retrait possible ; publication par le
  chemin existant `publishStoryMedia` (re-encodage serveur), texte seul par
  `publishStory`. Un refus serveur est dit, la story n'est pas publiée à moitié.
- Aucun état inventé : pas de fond ni d'alignement qui ne seraient pas stockés.

### Vérifications du 10 novembre

| Contrôle | Résultat |
|---|---|
| `tsc --noEmit` | 0 erreur |
| ESLint (fichiers touchés) | 0 erreur, 0 avertissement |
| `npm run build` | 0 erreur, 37 routes |
| `test:gifs` (dont `message-media`) | 43/43 |
| `test:demo` | 59/59 |
| `test:pages` | 30/30 |
| `test:extensions` | 46/46 |
| `ux:check` | cliquet tenu (18 indicateurs ; arbitraires 2 314, `outline-none` 79) |
| Navigateur — messagerie (`/tmp/verif_msg.py`) | 10/10 |
| Navigateur — studio (`/tmp/verif_studio.py`) | 13/13 |

**Limite connue** : aucune clé Tenor/Giphy réelle n'est posée, donc la
recherche GIF *live* n'a pas été exercée — seuls l'état « non configuré » et
le filtrage unitaire le sont. Le studio n'a pas été vérifié contre un backend
réel pour le média (route serveur) : la publication texte l'a été.

### Compléments du 10 novembre (retours de Laudes)

- **Créateur de sticker dans la messagerie** : le sélecteur porte un bouton
  « Créer un sticker » qui ouvre `StickerCreator` sur place — image obligatoire
  (PNG/WebP/JPEG, 8 Mo), nom, visibilité privée par défaut. Le sticker créé
  entre dans la grille sans rechargement. Plus besoin d'aller dans la section
  Stickers puis de revenir.
- **Un sticker est une image, pas un emoji** : le repli de démonstration ne
  sert plus des glyphes (`★`, `⚡`…) mais six **images SVG embarquées**
  (`public/stickers/*.svg`), rendues par `StickerFace` via le champ `builtin`.
  Le catalogue reste un catalogue de médias, comme le studio de stickers.
- **Stickers et GIF dans les commentaires** : migration `054_comment_media.sql`
  (`gif_url`, `gif_alt`, `sticker_id`, contrainte « média seul »), `addComment`
  partage les règles de `lib/message-media.ts`, composeur avec pièce jointe en
  attente et bouton d'envoi actif même sans texte, rendu dans la ligne du
  commentaire. `npm test` couvre la migration (`test:db-migrate`).
- Vérifications : `tsc` 0, ESLint 0, `ux:check` tenu, build 0, `npm test`
  (54 migrations, `test:gifs` 43/43), navigateur commentaires **16/16**,
  messagerie **10/10**, studio **13/13**.
