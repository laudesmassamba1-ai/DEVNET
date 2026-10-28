# Mémoire DevNet — décisions, direction, état

> Ce fichier est la mémoire de la session. Il ne décrit pas ce qui est *livré* (ça, c'est le code et `README.md`), mais **ce qu'on a choisi, ce qu'on a dit non, ce qu'on peut faire maintenant, et pourquoi**. À lire avant de proposer quoi que ce soit.

---

## 1. Ce que c'est, en une phrase

Un réseau de développeurs africains lu comme un éditeur de code — fond encre, ambre de tube cathodique comme seul accent, barre de statut, gouttière de lignes sur chaque post, libellés au prompt shell. Le produit n'est pas un copier-coller de Twitter : l'**identité visuelle est l'outillage**, pas un thème « sombre » posé par-dessus.

---

## 2. L'idée-produit — positionnement

DevNet est l'équilibre entre quatre sites, avec un axe propre :

| Plateforme | Ce qu'on garde | Ce qu'on refuse |
|---|---|---|
| **Twitter** | fil publique, temps réel, commentaires | l'usage sans preuve |
| **GitHub** | la preuve de travail est le profil | l'outillage distant, le workflow purement repo |
| **WhatsApp** | privé, fermé, fiable | DM de groupe, channels, appels |
| **Instagram** | identité visuelle (c'est la DA) | médias, stories vidéo, explorer |

**Le différenciateur DevNet :** un réseau où la *preuve de travail* et la *réputation* sont le même objet. Un étudiant qui cherche un stage et un professionnel qui recrute ont la même douleur — aucun des quatre sites ne la traite.

**Compte = échelle de capacités**, pas étiquette : `account_type` (`student` / `professional`) borne ce que peut faire un utilisateur, pas ce qu'il est. Un étudiant se crée en 30 secondes, donc on borne son utilité pour que le spam n'ait pas d'intérêt. Il peut devenir professionnel en cours d'année sans perdre ses posts, groupes ou réputation.

---

## 3. Ce qui est déjà livré et fonctionnel

### Auth — complet
`/login`, `/register`, déconnexion. Le profil est créé automatiquement par le trigger `handle_new_user()`.

### Fil + publication — complet
Post textuel, post avec snippet de code ( coloration maison, 13 langages, zéro dépendance), likes. Temps réel sur INSERT/UPDATE de posts. Bandeau de jeu d'exemple pour que la démo ne commence pas vide.

### Groupes + canal — fonctionnel (uni parmi les groupes)
Création de groupe, recherche, rejoindre. `/groups/[id]` affiche les canaux (`channels`), composition par canal, URL suit le canal, messages mémorisés par canal.

### Messages privés — complets
Conversations, recherche de destinataire, envoi avec `✓` / `✓✓` implicite, temps réel.

### Progression — livrée, cœur pur et testé
Score **dérivé** (pas de colonne `users.xp`), 10 paliers Fibonacci, séries avec gels toutes les 7 activations, 3 quêtes du jour en rotation déterministe, 11 badges, carte d'activité 15 semaines, classement hebdomadaire glissant. 159 tests de vérification.

### Dépôt interne conforme à git — livré, pas d'écran
`lib/git/objects.ts` (SHA-1 maison, `blob`/`tree`/`commit`), `lib/git/paths.ts` (validation, canonisation, arbre), `lib/git/history.ts` (commits, diff ligne à ligne, ancêtres). Les sha produits sont **identiques à ceux de `git` 2.43** (176 vérifications, dont comparaison réelle).

### Exécution dans le navigateur — prêt, pas d'écran
`lib/execution/runtime.ts` déclare Pyodide + Sandpack avec garde-fous (timeout, taille de sortie, taille de fichier, nombre de fichiers). Choix structurel : exécution locale, pas de serveur à provisionner.

### Raccordement GitHub — prêt, pas d'écran
`lib/github/link.ts` : analyse d'URL (`https://`, `git@`, `propriétaire/dépôt`), validation de nom de branche, plan de synchronisation `planSync()` qui refuse la divergence. Le jeton n'est jamais stocké en clair — `github_connections.token_ref` pointe vers un coffre.

### Mode démo — complet et honnête
Backend local de démonstration (`lib/demo/`) avec les mêmes tables, mêmes méthodes, mêmes sémantiques de retour que PostgREST. Persisté dans localStorage. Bandeau explicite « Mode démonstration », écran `/setup` pour le diagnostic et la réinitialisation.

### Fondation SQL — 004 livrée
Tables : `channels`, `channel_members`, `projects`, `project_members`, `git_commits`, `git_refs`, `git_files`, `github_connections`, `project_links`, `project_sessions`. RLS stricte sur toutes, fonctions `can_read_project` / `can_write_project` / `is_group_member`, realtime sur `group_messages` / `git_files` / `project_sessions`.

---

## 4. Bugs identifiés dans l'existant

### B1 — Faille RLS sur `posts_update` et `groups_update`
**Corrigé** par la migration 005.

### B2 — Le like ne survivra pas au durcissement de la RLS
**Corrigé** : le like est une ligne dans `post_likes`, le compteur est un cache écrit par un déclencheur.

### B3 — L'adhésion aux groupes a le même problème
**Corrigé** : l'adhésion est une ligne dans `group_members`.

### B4 — Données d'auteur dénormalisées
**Corrigé** : plus rien ne les écrit ni ne les lit ; `filiere`/`niveau` viennent de la jointure.

### B5 — `app/messages/page.tsx` : logique dupliquée
**Corrigé** : un seul chemin de chargement.

### B6 — Commentaires : `posts.comments` est un compteur sans table
L'icône de commentaire est un `<span>`, pas un bouton. Cliquer ne fait rien. **C'est le défaut le plus visible en démo.**

### B7 — Suivre absent ~~(corrigé — Vague 1)~~
La table `follows` existait déjà (migration 005) avec sa RLS et son déclencheur
`sync_follows()`, mais **aucun écran ne la lisait** : le graphe était écrit et
invisible. Corrigé : bouton de suivi, profil public, compteurs et liste
d'abonnés/suivis.

### B8 — Profil public absent ~~(corrigé — Vague 1)~~
`/profile` = « mon profil » seulement. Personne ne peut voir le profil de quelqu'un d'autre.

### B9 — Pagination en dur
`.limit(40)` en dur dans plusieurs endroits. Pas de cursor, pas de chargement incrémental.

### B10 — Modifier / supprimer son post absent
**Corrigé** : `hooks/usePostActions.ts` + `components/PostOwnerTools.tsx`, partagés par le fil et le profil public.

### B11 — Recherche absente
Seul le destinataire MP est recherchable.

---

## 5. État de l'interface / design system

> **Mise à jour du 12 octobre — direction « LIQUID IVOIRE »** : le fond
> ivoire mat utilise un dégradé vertical sobre, sans nimbes ni halos. Les
> surfaces de verre combinent une teinte translucide, un reflet
> directionnel et des ombres neutres; le flou est réservé aux éléments
> flottants, sans déformation SVG. Typographie **Inter** + IBM Plex Mono,
> accent **olive `#C5D58C`** (écriture `#496439`), une seule identité.
> Les icônes usuelles viennent de **Lucide**; les noms historiques restent
> stables. Détails : `DESIGN.md`, `globals.css`.

- **Système « Phosphore »** : encre indigo `#06070F`, 4 plans de surface, ambre `#FF8A3D` seul accent interactif, vert phosphore `#8FFF5C` pour la donnée vivante (présence/en ligne), vert/rouge/or/cyan sémantiques et rares. Aucun dégradé Instagram ; anneau de story = dégradé ambre→phosphor.
- **Typographie** : Chakra Petch (display) + IBM Plex Sans (texte) + IBM Plex Mono (données). Les trois chargées via `next/font`.
- **Icônes** : Lucide pour les glyphes usuels; l'API historique reste stable.
- **Barre de statut** en bas (chemin · mode · heure) + **barre d'onglets** en haut sur mobile, **sidebar** sur desktop (`≥880px`).
- **Coloration syntaxique** : deux variantes `paper` / `terminal`, mêmes jetons, basculées par attribut. Règle : quand vert/bleu apparaît, c'est du code, jamais un bouton.
- **Liquid Glass adaptatif** : surfaces translucides avec reflet `--glass-sheen` + liseré `--glass-rim`, **flou réservé aux barres et surfaces volantes** (24 px, `saturate(1.8)`, `contrast(1.08)`) — un flou par carte faisait chuter le défilement (21 → 2 par page). Ombres ambiantes sans décalé dur, rayons gélule/champ/coque (999/14/18 px), **aucun angle droit** : contrôles, `kbd`/`code` et images arrondis par une règle de base. `prefers-color-scheme` bascule encre→lait : jetons redéfinis hors couche dans `globals.css`, fond de page `--color-page`, écritures d'accent foncées (ambre profond ≥4,5:1) — les fonds d'accent restent vifs.
- **Motif Adinkra** en filigrane à 10% max, jamais sur du texte.

**Ce qui va** : la cohérence est forte, le système est documenté dans `DESIGN.md`, les tokens sont centralisés dans `globals.css`. **Ce qui peut monter en gamme** : l'éditeur de code, le dépôt, le mode terminal complet, les easter eggs — mais seulement après les fondations sociales (Vague 1 + 2 du ROADMAP).

---

## 6. Ce qui manque pour l'équilibre demandé (WhatsApp + Discord + Twitter + GitHub + Git interne)

### Ce qui est déjà là
- **WhatsApp** : MP privés complets, groupes avec canaux. ✓
- **Discord** : canaux par groupe, rôles, discussion par canal. ✓
- **Twitter** : fil, publications, likes, stories (= posts récents). ~ (manquent commentaires, notifications, suivi)
- **GitHub** : dépôt interne conforme, exécution locale, lien GitHub prêt. ~ (manquent écran éditeur, CRUD dépôt, OAuth, sync)

### Ce qu'il faut construire pour tenir la promesse
1. **Graphe social** : ~~table `follows`, profil public `/u/[pseudo]`, bouton
   suivre, bouton message.~~ **Livré (Vague 1).** Le bouton message ne filtre
   **pas** par type de compte : `can_message()` a été levée (§10) et il ne
   faut pas la rouvrir en s'appuyant sur le ROADMAP, qui est antérieur.
2. **Conversation** : table `comments`, table `post_likes` (reécriture du like), RLS cohérente, écran de post.
3. **Projets + dépôt** : écran de projet, éditeur de fichiers, exécution, commits depuis l'interface, branche, historique.
4. **GitHub** : OAuth via Supabase, connexion par personne, synchronisation avec `planSync`, jeton dans Vault.
5. **Notifications** : centre de notifications (likes, follows, mentions, messages non lus).
6. **Recherche** : `pg_trgm`, hashtags via colonne `tags` + trigger, onglets Personnes / Posts / Tags.
7. **Modération** : signalement, suppression par auteur, RLS revalidée.

---

## 7. Les modes transversaux demandés

### Mode terminal / ligne de commande
L'application est déjà **lue comme un terminal** au niveau DA (barre de statut, prompt shell, mono pour les données, fond encre). Le mode terminal *contenu* (éditeur de code, dépôt, exécution) est prêt dans `lib/git` + `lib/execution` mais sans écran. Un mode « shell » au sens fonctionnel — taper `/msg koffi Bonjour`, `/cd groupe/python`, `/git commit -m "..."`, `/git push` — est possible et cohérent avec l'identité, à construire après l'éditeur.

### Easter eggs
À placer de façon discrète, cohérente avec l'univers informatique :
- Invite cachée dans la barre de statut (ex. taper un chemin dans la barre → navigation rapide).
- Message caché dans `/setup` ou `/preview-code` (message du fondateur, devinette).
- Réponse particulière à certains invites (pseudo célèbre, commande secrète).
- Comportement fêlé dans la progression (ex. un badge « Noir » invisible sauf si on connaît la combinaison).

Règle : **l'oeuf ne doit pas être nécessaire à l'utilisation**, et il doit se découvrir, pas s'énoncer.

### DA unique, style « univers de l'informatique »
Déjà posée : fond encre, ambre cathodique, icônes chanfreinées, typographie Petch/Plex, motif Adinkra en filigrane. À ne pas élargir — le risque est de devenir « cyberpunk » générique. Le cadre existant est assez riche pour tout contenir.

---

## 8. Ordre de travail recommandé

D'après `ROADMAP.md` (qui est la direction de produit de la session précédente), la séquence est :

1. **Vague 1 — Graphe social** (profil public, suivi, bouton message). ~1,5 jour. Risque faible. **Si une seule chose avant une démo, c'est celle-là.**
2. **Vague 2 — Conversation** (commentaires, reécriture du like, corrections RLS). ~2,5 jours. Risque moyen (casse le like si mal fait).
3. **Vague 4 — Projets/GitHub** (axe différenciant). ~2 jours. Peut se paralléliser avec la Vague 3.
4. **Vague 3 — Découverte** (recherche, hashtags, filtre abonnements). ~2 jours.
5. **Vague 5 — Polish WhatsApp** (pastille non-lus, accusés de lecture, « en train d'écrire »). ~1 jour.
6. **Vague 6 — Média** (bannière, avatar uploadé). ~1 jour. seulement si le temps le permet.

Les modes terminal/CLI, easter eggs, éditeur de code, dépôt, sync GitHub viennent après les vagues 1–4, quand le socle social+projet existe.

---

## 9. Ce qu'on a dit non (et pourquoi)

- **Fusion automatique** : deux personnes qui modifient le même fichier doivent le voir. `lib/git/history.ts` refuse volontairement.
- **Média / stories vidéo / reels** : stockage, transcodage, modération vidéo. Hors budget, pas l'axe.
- **DM de groupe / channels / appels** : WhatsApp le fait mieux.
- **Feed algorithmique / recommandation** : `created_at desc` + filtre abonnements suffit. Reste explicite.
- **Route handlers API** : l'app interroge Supabase directement, la RLS décide. Une seconde couche d'auth = deux endroits où une erreur donne un accès.
- **Stocker le score** (`users.xp`) : le score est dérivé. Ça ne ment jamais, une suppression ne laisse pas de score fantôme, et aucune migration n'est obligatoire.

---

## 10. Décisions à ne pas rouvrir

- `account_type` est une échelle de capacités, pas une étiquette.
- Le projet DevNet reste la source de vérité ; GitHub est une destination.
- La connexion GitHub est par personne, jamais partagée.
- **La messagerie n'est pas restreinte par type de compte.** Un étudiant
  écrit à un professionnel s'il le veut. La règle qui faisait le contraire
  (`can_message`) est levée : elle interdisait le geste central du produit.
  Ne pas la rouvrir sous forme de « protection anti-spam ».
- Le mode de sync par défaut est manuel (pushing = rendre public = décision, pas effet de bord).
- Le score n'est pas stocké, il est dérivé des événements réels.
- Pas de fusion automatique dans le dépôt interne.

---

## 11. Tests et vérifications

| Suite | Résultat |
|---|---|
| `npm run test:highlight` | 62/62 ✓ |
| `npm run test:gamification` | 159/159 ✓ |
| `npm run test:foundation` | 176/176 ✓ |
| `npm run test:demo` | 59/59 ✓ |
| `npm run test:social` | 30/30 ✓ |
| `npm run test:reports` | 32/32 ✓ |
| `npm run test` (toutes) | 593 ✓ |
| `npm run test:navigateur` | 50/50 ✓ |
| `npx tsc --noEmit` | zéro erreur |
| `npm run build` | non relancé depuis la Vague 1 |
| Serveur de dev (`npm run dev`) | demarre, pages servies |

`parcours-navigateur.py` est le seul test qui **clique**. Les autres sont
purs; lui conduit un vrai Chrome : connexion, fil, notifications, profil
public, liste d'abonnés, bascule du bouton de suivi avec son compteur, et
la moitié du système de mouvement (filet d'onglet tracé ou replié, ligne
qui reste montée pendant son retrait, transitions de couleur non volées
par `mo-press`). C'est le seul moyen de voir un `setState` mal placé, un
`onChanged` appelé deux fois, ou un utilitaire qui écrase la transition
d'un élément — les trois bugs réellement trouvés jusqu'ici.

## 11 bis. Deux leçons à ne pas rouvrir

**Un composant écrit n'est pas un composant monté.** `ToastProvider`
existait, était exporté, et n'était référencé nulle part : `useToast()`
renvoyait donc la fonction vide du contexte par défaut, et **tous** les
`toast(…)` de l'application étaient des no-ops. Aucun `tsc`, aucun lint,
aucun test unitaire ne pouvait le voir — le composant est correct, il
n'est simplement jamais appelé. C'est le test navigateur qui l'a trouvé,
en cherchant une confirmation qui n'arrivait pas.

Un composant n'a de valeur que s'il est dans l'arbre. Un `grep` sur son
nom dans le code ne prouve rien : il faut le chercher **hors** de son
propre fichier.

### `reports` : une RLS qui porte sur une autre table

C'est la première politique du projet qui dépende d'une **autre** table
pour décider d'une lecture : on voit le signalement parce qu'on est
l'auteur de ce qu'il vise. Deux conséquences pratiques, déjà appliquées
mais notées ici :

* une RLS **trop permissive** ne se voit à rien — l'écran affiche juste
  plus de lignes que prévu. Il faut donc un test qui vérifie *l'absence*
  autant que la présence (`scripts/test-reports.ts` le fait sur les deux
  côtés).
* une RLS raisonne en **lignes**, jamais en colonnes. La politique
  `reports_update` protège la ligne, mais rien n'empêche d'y réécrire
  `reporter_id` — ce qui rendrait le signalement invisible à celui qui
  l'a porté. C'est le `UPDATE_FORBIDDEN_COLUMNS` du moteur de démo qui
  ferme cette porte, comme le `revoke update` le ferait en base.

**Un utilitaire ne doit jamais déclarer `transition:` en raccourci sur un
élément qui a sa propre liste de transitions.** `mo-press` le faisait, et
il volait à une partie des boutons leurs transitions de couleur. Pire :
la cascade de Tailwind ne tranche pas de la même façon d'un élément à
l'autre, donc *quels* boutons étaient lésés changeait selon la page — un
défaut qu'aucune relecture ne révèle et qu'aucun test ne voyait.

C'est pour ça que `mo-press` est désormais une **animation** sur `:active`
et non une transition : une animation ne touche à aucune propriété
`transition-*`, donc elle ne peut rien voler. Le test navigateur lit
`getComputedStyle(el).transitionProperty` pour le prouver.
| Production (`next start`) | toutes les routes rendent 200 |

---

## 12. Serveur de démo

Le serveur de développement est démarré en arrière-plan. L'application est accessible à `http://localhost:3000`. Les routes existantes rendent toutes `200` :

```
/  /feed  /login  /register  /messages  /profile  /groups  /preview-code  /setup
/groups/[id]  (dynamique)
```

Le mode démo est actif car le backend Supabase n'est pas joignable depuis cet environnement — c'est le comportement attendu. Le bandeau « Mode démonstration » s'affiche, et tous les écrans (auth, fil, groupes, messages, profil, progression, canaux) fonctionnent avec les données locales.

Pour arrêter le serveur : `./scripts/stop.sh`.

> ⚠️ **Le serveur mourait sans laisser de trace.** Dans cet environnement,
> un processus d'arrière-plan est tué quand la commande qui l'a lancé se
> termine. Un `next dev &` tenait quelques minutes, puis disparaissait —
> et le navigateur affichait `ERR_CONNECTION_REFUSED` alors que le journal
> ne disait rien. Rien n'indiquait l'arrêt : seul le silence le signalait.
>
> `setsid nohup ... &` ne suffisait pas : le processus reste dans la liste
> des descendants de la commande, qui est nettoyée avec elle. La solution
> est un **double fork** — le petit-fils est adopté par `init`, dans sa
> propre session — c'est ce que fait `scripts/serve.sh`.
>
> Corollaire pour la vérification : **un serveur lancé et testé dans la
> même commande ne prouve rien.** Il était encore vivant au moment du
> test. Il faut vérifier depuis une autre commande, ce qui est la seule
> façon d'observer la vraie tenue.
>
> ```
> ./scripts/serve.sh        démarre (attend que le port réponde)
> ./scripts/serve.sh 4000   autre port
> ./scripts/stop.sh         arrête
> ```

---

## 13. Système de motion (livré cette session)

Le motion n'est pas un habillage : c'est un jeton, comme la couleur ou le
trait. Toute l'animation passe par trois couches, et rien ne sort de ces
trois couches.

### 13.1 Les trois couches

1. **Les jetons** (`app/globals.css`, section « Durées / Courbes ») — une
   échelle courte et nommée par *intention*, pas par valeur. `--d-instant`,
   `--d-fast`, `--d-base`, `--d-slow`, `--d-enter`, `--d-scene`, plus
   `--d-orbit` (une révolution), `--d-story`, `--d-caret`. Les courbes sont
   nommées aussi : `--ease-entrance`, `--ease-spring`, `--ease-continuous`,
   `--ease-pop`, `--ease-gravity`, `--ease-timing`.
2. **Les utilitaires** (`mo-*`, `mode-*`) — des classes sans élément, qui
   n'ajoutent qu'un `animation`. Utilisables partout, y compris hors de
   `<Motion>`.
3. **`<Motion>`** (`components/Motion.tsx`) — le composant polymorphe qui
   choisit l'utilitaire, applique le `animation-delay` inline, et rend
   *l'élément même* (`as="section"`, `as="main"`, `as="h1"`…) — jamais un
   `<div>` autour, qui casserait les flex parents.

### 13.2 Règles qui ne se rouvrent pas

- **Aucun `transform`/`opacity` seul ne suffit** : une entrée doit porter un
  sens. Rotation réservée aux marques et prompts, `scaleX` aux jauges,
  direction latérale aux bulles, translation verticale aux panneaux.
- **`--d-slow` n'est pas une période de rotation.** Une révolution a sa
  propre durée (`--d-orbit: 1100ms`) : à 380 ms un spinner se lit comme une
  agitation, pas comme une attente.
- **Une bulle entre du côté de son auteur** (`mo-msg-in` / `mo-msg-in-alt`).
  L'origine du mouvement dit l'origine de la parole avant qu'on lise
  l'alignement.
- **Les mouvements continus sont rares.** Battement de pastille (2,6 s),
  rotation de spinner (1,1 s), onde du bandeau démo (1,8 s), clignotement du
  curseur. Au-delà d'une respiration et d'une attente, un mouvement continu
  devient du bruit et coûte du CPU.
- **Aucun mouvement n'est en dur dans un composant.** Ni `420ms`, ni
  `animate-spin` : ça passe par les jetons, sinon le `prefers-reduced-motion`
  ne peut pas tout arrêter d'un seul endroit.

### 13.3 Accessibilité

Le bloc `@media (prefers-reduced-motion: reduce)` fait deux choses : il
accélère les transitions à néant (`0.01ms`, `!important`) **et** il coupe
nomément les continus (`mo-spin`, `mo-pulse`, `mo-breathe`, `mo-scan`,
`mode-live`, `mode-ripple`, `caret`, `scanlines-live`) — parce qu'accélérer
une boucle ne l'arrête pas, et qu'une pastille qui respire reste une
animation pour qui a demandé l'arrêt du mouvement.

### 13.4 Bug trouvé en passent (classe morte)

Cinq classes d'animation étaient **référencées mais jamais définies** en CSS :
`animate-post-in`, `animate-pane-in`, `animate-msg-in`, `animate-auth-in`.
Elles ne faisaient strictement rien — silencieusement, sans erreur. C'est le
piège classique quand on migre un design system vers des jetons.

*Vérification de non-régression :* comparer les classes `animate-*|mo-*|mode-*`
utilisées dans `app/` et `components/` avec les `@utility` et `@keyframes`
définis dans `globals.css`. Toute classe orpheline est un mouvement mort.

---

## 14. Session du 4 octobre — nettoyage, vérification des vagues 1 et 2

### Ce qui a été trouvé

Les vagues 1 et 2 étaient **livrées** mais jamais vérifiées. Leur audit a
sorti quatre choses, dont deux que le MEMO ne comptait pas.

**Deux failles que le mode démo rendait invisibles.** C'est le motif le
plus important de la session, et il deserveait d'être sa règle à lui
seul :

- `can_message()` était définie depuis la migration 002 et **appelée
  nulle part**. La règle « un étudiant n'écrit pas à un pro » n'existait
  que dans un commentaire.
- `cm_insert` autorisait `auth.uid() = user_id`. Comme `dm_read` passe
  par `conversation_members`, **s'ajouter soi-même à une conversation
  suffisait à en lire le contenu**.
- Pire : l'application créait une conversation en écrivant dans
  `conversations` et **jamais dans `conversation_members`**. La politique
  `dm_read` exige cette table — donc, en production, **toute conversation
  créée depuis l'app était illisible**. Le mode démo n'a pas de RLS, la
  lecture passait toujours. Corrigé par la migration 006 (déclencheur
  `conversations_sync_members`).

> **Règle tirée de là :** tout ce que le mode démo ne peut pas vérifier
> doit être lu comme un doute. La démo est un filet, pas une preuve.

### Bugs du MEMO corrigés

| | Correction |
|---|---|
| **B4** | Les colonnes d'auteur recopiées (`author_name`, `filiere`…) ne sont plus écrites ni lues. `filiere`/`niveau` entrent dans la jointure `author:users(...)`, et `PostCard` comme le classement hebdomadaire lisent l'auteur, jamais une copie. Un nom affiché ne peut plus être périmé. |
| **B5** | Un seul chemin de chargement dans `/messages` : `refresh()` prend un `isAlive` optionnel, l'effet de montage passe par lui. |
| **B10** | Modifier et supprimer son post, sur le fil **et** le profil public. Logique dans `hooks/usePostActions.ts`, rendu dans `components/PostOwnerTools.tsx` — partagés, parce que deux copies divergent. |

### La restriction de messagerie a été supprimée

`can_message` interdisait à un étudiant d'écrire le premier à un
professionnel. En l'appliquant enfin, on interdisait **la scène centrale
de DevNet** — et le jeu de démo l'illustrait : un étudiant demande
conseil à une pro. **Décision : la restriction est levée.** Le principe
qu'elle exprimait reste vrai, mais il est porté par la réputation, pas
par une porte d'entrée que le produit lui-même n'emprunte pas.

### La parité démo a tenu sa promesse — et payé

Deux suites nouvelles ont trouvé **deux vraies divergences** que le mode
démo laissait passer :

- `comments` acceptait un `update` — la migration 005 n'ouvre aucune
  politique de mise à jour : un commentaire ne se réécrit pas ;
- `conversation_members` acceptait l'écriture du client — et lui
  inventait une colonne `id` que la table n'a pas ;
- `follows_no_self` n'était pas simulé : on pouvait se suivre soi-même en
  démo, ce que Postgres refuse.

`scripts/test-social.ts` — 22 vérifications sur les invariants des vagues
1 et 2. **463 vérifications au total**, `tsc` propre, build OK.

### Ce qui reste

- **B9** — pagination : `.limit(40)` en dur sur le fil et le profil.
- **Vague 3** — Découverte. Nécessite d'étendre le moteur démo : `.or()` et
  `.overlaps()` n'existent pas encore (`.in()` a été ajouté pour les likes).
- **Vague 4** — Projets / dépôt : fondations SQL et moteur git prêts,
  aucun écran.

---

## 15. Session du 4 octobre (suite) — « ça ne marche pas »

### Le symptôme et sa vraie cause

« Je ne vois pas les fonctionnalités et il y a des bugs. » Aucun journal
d'erreur — ni serveur, ni navigateur. La cause : `/feed` **redirige vers
l'écran de connexion**, et le mode démo accepte n'importe quel mot de passe
sans jamais le dire. Le visiteur tombe sur un formulaire, sans indice, et
en conclut à une application vide. Tout le reste était déjà là et
fonctionnait.

La parade est un bouton **« Entrer comme @koffi »**, qui devient l'action
principale en mode démo, et une mention explicite sous le formulaire. Le
formulaire reste disponible pour qui veut changer de compte.

> `?demo=1` ouvre la session de démonstration. Un lien ne se vide pas
> entre deux essais, alors qu'une session ouverte à la main se perd au
> rechargement — et c'est aussi le seul moyen d'atteindre le fil sans
> navigateur, la session vivant dans le navigateur.

**Comment on a su.** Rendu headless de `/feed` : 23 Ko de coquille, zéro
`@koffi`. Un serveur qui répond 200 n'est pas une application qui
fonctionne — il faut regarder **après hydratation**. Chrome est disponible
dans cet environnement (`google-chrome --headless --dump-dom`) ; c'est le
seul contrôle qui parle de ce que l'utilisateur voit.

### Pagination — B9

`.limit(40)` en dur est remplacé par un **curseur** sur `created_at`
(`fetchFeedPage`). Pas un `offset` : publier pendant que le lecteur parcourt
la liste décalerait toutes les lignes d'un cran. Une ligne de plus que la
page est demandée, et sa présence dit s'il reste des publications — donc
« charger plus » n'est pas un bouton mort.

### Vague 3 — Découverte, livrée

| Brique | Fichier |
|---|---|
| Moteur démo : `lt`, `gt`, `or` (syntaxe PostgREST), `overlaps`, `is`, `not` | `lib/demo/query.ts` |
| Règle d'extraction, partagée base/démo | `lib/tags.ts` |
| Requêtes de recherche | `lib/search.ts` |
| Écran Personnes / Posts / Tags | `app/search/page.tsx` |
| Migration : `pg_trgm`, `tags text[]` + déclencheur, révocation d'écriture | `supabase/007_search.sql` |
| Filtre Abonnements sur le fil | `app/feed/page.tsx` |

**Règle d'un hashtag, écrite deux fois** (SQL et TypeScript) : le mot qui
suit `#` est capturé **en entier**, puis validé. `#référence` n'est pas un
hashtag — sans cela, on obtenait le tag « r », qui n'a aucun sens et se
retrouverait dans la recherche. De même `C#` et `#42` ne produisent rien.

Un hashtag écrit dans un post est **cliquable**. Écrire un mot qu'on ne
peut pas suivre serait une promesse non tenue.

### Le jeu de démo

Passé de 6 à 18 publications, avec hashtags, langages et auteurs variés. Sans
volume, ni la pagination ni la recherche n'ont rien à montrer — et une
fonctionnalité invisible ressemble à une fonctionnalité absente.

La clé de stockage passe en `v2` : sans elle, un navigateur déjà ouvert
continuerait de servir l'ancien jeu, et on en conclurait que tout est cassé.

### Le mouvement est désormais protégé par un test

`scripts/test-motion.ts` — 5 vérifications. Il refuse une classe
d'animation utilisée sans être définie (un mouvement muet, l'erreur la plus
silencieuse du projet), une durée écrite en dur dans un composant, le retour
de `animate-spin` de Tailwind, et tout mouvement continu oublié de
`prefers-reduced-motion`.

Il a trouvé une vraie durée en dur : `Sheet` faisait son retour au repos en
`.32s cubic-bezier(.16,1,.3,1)`. Remplacé par `--d-slow` (documenté «
mouvement de surface, sheet ») et `--ease-spring`, qui donne à la feuille
un léger dépassement — c'est ce qui lui donne son poids.

### Suite de tests

| Suite | Résultat |
|---|---|
| `test:demo` | 59 ✓ |
| `test:social` | 22 ✓ |
| `test:search` | 28 ✓ |
| `test:motion` | 5 ✓ |
| `test:highlight` | 62 ✓ |
| `test:gamification` | 159 ✓ |
| `test:foundation` | 176 ✓ |
| **Total** | **511 ✓** |

`tsc` propre, build OK, 13 routes.

---

## 16. Vague 4 — Projets et dépôt

Le moteur de dépôt produisait des sha identiques à ceux de `git`, mais
personne ne pouvait **produire un commit depuis l'interface**. C'est ce que
la vague livre.

### Le trou qu'il fallait boucher avant tout

Un commit ne porte que le nom de son arbre, pas le contenu des fichiers —
c'est le principe même de git. Donc **aucune table ne permettait de savoir
à quoi ressemblait un commit passé**, et deux choses cassaient :

- « ai-je des changements à enregistrer ? » répondait « tout a changé » ;
- le diff entre deux commits n'avait rien à comparer.

Le moteur le signalait lui-même dans sa documentation : sans l'état du
parent, un clic « Enregistrer » remplit l'historique d'entrées vides.

D'où `supabase/008_commit_files.sql` : l'état des fichiers **à chaque
commit**. On stocke le contenu dans l'instantané plutôt que de référencer
un magasin d'objets séparé — le doublonnage est réel mais borné, et il
supprime une table, une lecture et une indirection.

### L'ordre des écritures n'est pas indifférent

Instantané, puis commit, puis référence. Une coupure au milieu laisse un
instantané orphelin — invisible et inoffensif. L'inverse laisserait une
branche pointant sur un commit d'état inconnu, ce qui produit des diffs
faux, donc des commits faux.

### Un vrai bug de parité, trouvé par les tests

Le moteur de démonstration gérait `upsert` avec `onConflict` sur **une**
colonne. Sur `"project_id,path"`, il comparait `row["project_id,path"]` à
`incoming["project_id,path"]` — les deux `undefined`, donc la comparaison
réussissait sur la **première ligne du tableau**. Écrire un fichier dans le
dépôt remplaçait un fichier voisin, et l'arborescence perdait un fichier,
sans aucune erreur.

> Un sha correct ne prouve pas un dépôt correct : les sha restaient
> parfaitement justes pendant que le dépôt se comportait mal.

### Ce qui est livré

| Brique | Fichier |
|---|---|
| Couche données — projets, fichiers, révisions, diffs | `lib/repo.ts` |
| Instantanés par commit | `supabase/008_commit_files.sql` |
| Liste et création de projet | `app/projects/page.tsx` |
| Dépôt : arborescence, éditeur, enregistrement, historique | `app/projects/[id]/page.tsx` |
| 32 vérifications du parcours complet | `scripts/test-repo.ts` |

### Choix d'interface

- **L'arborescence n'est pas repliable.** Un dépôt de dix fichiers n'a rien
  à replier, et un arbre replié cache ce qu'il contient.
- **La boîte « enregistrer » n'apparaît que s'il y a des changements.** En
  permanence, elle ferait profession de se demander « ai-je oublié de
  valider ? » — et la réponse serait toujours non.
- **Les fichiers binaires ne s'ouvrent pas.** Les ouvrir dans un
  `<textarea>` afficherait des octets illisibles et inviterait à les
  sauvegarder, ce qui les corromprait.
- **Projets n'est pas dans la barre basse.** Six onglets sur un téléphone
  deviennent six cibles de 60 px, dont la moitié ne sert jamais. Le dépôt
  reste dans la barre latérale et sur le profil — là où il est à sa place.

### Suite de tests — 553 vérifications

`demo` 59 · `social` 22 · `search` 28 · `motion` 5 · **`repo` 42** ·
`highlight` 62 · `gamification` 159 · `foundation` 176. Build OK, 14 routes.

### Ce qui reste de la vague 4

- **Exécution** — `lib/execution/runtime.ts` est prêt, l'écran non. Pyodide
  et Sandpack sont chargés à la demande, donc cela ne coûte rien tant que
  personne ne les appelle.
- **Connexion GitHub** — OAuth via Supabase, puis `planSync`. Le jeton va
  dans Vault.
- **Divergence visible** — toujours volontairement non fait : personne ne
  peut encore créer un conflit, parce qu'il n'y a pas d'écriture concurrente
  à l'écran. Cela viendra avec la présence (`project_sessions`).

---

## 17. Rendre la vague 4 visible

Un dépôt dont personne ne voit l'existence n'est pas une fonctionnalité,
c'est un fichier mort. Les révisions s'écrivaient très bien — nulle part où
elles étaient consultables depuis une publication ou un profil. La couche
données était prête ; il manquait les trois points d'entrée qui font
exister un dépôt dans la vie d'un compte.

### Le lien post ↔ projet

`supabase/009_post_projects.sql` : une table de jonction, rien de plus.
`post_id`, `project_id`, PK **composite** — la paire, pas chaque colonne
seule, est la clé, parce que la question posée est « ce post parle-t-il de
ce projet », pas « ce post a un projet ».

Les RLS sont deux volets, pas un : écrire exige `can_write_project` sur le
projet **et** être l'auteur du post. Le projet appartient à quelqu'un, le
post aussi ; rattacher le sien au dépôt d'un autre n'est pas une écriture
sur le dépôt, c'est une écriture sur la publication — donc les deux
gardes, sinon un auteur peut déposer une puce de projet volée sur le
fil d'un tiers.

Cette PK composite a **réactivé le bug d'`upsert` décrit en section 16** :
le moteur de démonstration ne gérait `onConflict` que sur une colonne, et
l'écrire par défaut est précisément le cas « j'enregistre le même fichier
deux fois ». Écrit une fois, la table ne contenait qu'une ligne.

### L'ordre des révisions vient de la chaîne des parents

Bug d'affichage, pas de stockage. L'historique était trié par `created_at`.
Cela paraît équivalent et ne l'est pas : deux révisions committées dans la
même seconde — le cas ordinaire quand on enregistre un fichier puis qu'on
ajoute une ligne — sortent dans l'ordre d'un horodatage à la granularité
insuffisante. Le résultat est un historique qui se contredit.

La lecture remonte donc **depuis la tête de branche**, en suivant `parent_sha`
jusqu'à la racine. C'est la seule autorité sur l'ordre, et elle est déjà
exacte puisqu'elle a produit les sha.

### Ce qui est livré

| Brique | Fichier |
|---|---|
| Table de liaison + RLS à deux volets | `supabase/009_post_projects.sql` |
| Liaison en lecture et en écriture | `lib/repo.ts` |
| Carte projet (révision, publications, langage) | `components/ProjectCard.tsx` |
| Onglets Publications / Projets | `app/u/[pseudo]/page.tsx` |
| Puce projet sur une publication, sélecteur à la publication | `components/PostCard.tsx`, `app/feed/page.tsx` |
| Jeu de démonstration (`p-11`, `p-18` → `p-1`) | `lib/demo/social.ts` |

### Choix d'interface

- **Les projets ne sont chargés qu'à l'ouverture de l'onglet.** Un profil
  ouvert surtout pour lire ne paie pas une requête qu'il ne consume pas.
- **La puce projet est un bouton, pas une étiquette.** Elle navigue. Une
  étiquette non cliquable promet une destination qu'elle n'offre pas.
- **Elle n'apparaît que s'il existe un rattachement.** Un champ vide sur
  chaque publication serait du bruit ; l'absence se lit.
- **Les projets ne sont pas dans la barre basse**, pour la raison déjà
  donnée en section 16 : le dépôt se consulte depuis le fil et depuis le
  profil, qui sont les deux endroits où l'on cherche.

### Suite de tests — 553 vérifications

`demo` 59 · `social` 22 · `search` 28 · `motion` 5 · **`repo` 42** ·
`highlight` 62 · `gamification` 159 · `foundation` 176. `tsc --noEmit`
propre, build OK, 14 routes dont `/projects` et `/projects/[id]`.

Vérifié au navigateur après hydratation (session démo `/login?demo=1`) :
la puce projet s'affiche sur la publication liée dans `/feed`, les deux
onglets du profil sont présents avec `aria-selected`, et la page du dépôt
rend l'arborescence, l'éditeur et l'historique des révisions avec leurs
diff.

---

---

## 18. Session du 4 octobre (suite) — le dépôt s'ouvrait vide

Le serveur était arrêté, la session reprenait sur un `npm test` et un
`serve.sh`. Les 631 vérifications passaient, `tsc` était propre, les
routes répondaient 200 — et le parcours navigateur **échouait**. C'était
le seul contrôle qui en désactive tous les autres.

### Le dépôt s'ouvrait sur un tampon vide

`load()` faisait :

```ts
setOpen((current) =>
  current && nextFiles.some((f) => f.path === current) ? current : null,
);
```

Le commentaire au-dessus parlait du dépôt **sans** fichier. Le code, lui,
ne sélectionnait rien dans les deux cas : `p-1` contient trois fichiers et
s'ouvrait quand même sur « BUFFER VIDE / Aucun fichier ouvert ».

C'est exactement le symptôme de la section 15, sur l'axe différenciant du
produit : un dépôt plein présenté sur un tampon vide laisse croire que le
dépôt est vide. **Une fonctionnalité qu'on ne voit pas à l'ouverture est
une fonctionnalité absente.**

Corrigé par `firstOpenable()` : on parcourt l'**arbre** — pas la liste des
chemins — parce que ce qui est en haut de l'arborescence est ce que la
personne voit en premier. Les binaires sont écartés, puisque `openFile` les
refuse : ouvrir par défaut un fichier que l'écran refuse d'ouvrir
produirait un état que l'interface ne sait pas rendre.

Un effet a suivi : la sortie d'exécution appartient au fichier qui l'a
produite, donc elle s'efface sur changement de `open`. `openFile` le
faisait déjà pour un clic ; l'effet couvre le chemin du **chargement** —
changer de branche ouvre un autre fichier, et rien n'y touchait.

### Un test qui mesurait la mauvaise grandeur

Le parcours navigateur vérifiait la gouttière en lisant
`bounding_box()["height"]` du `<pre>`. Or ce `pre` est un enfant de
`flex` : il est **étiré** sur la hauteur du textarea (18 lignes) quoi
qu'il contienne. Ajouter une ligne à un fichier de dix lignes ne change
rien à sa boîte — la mesure ne pouvait donc jamais voir la gouttière
suivre le texte, et le test échouait sur une gouttière parfaitement
fonctionnelle.

> **Une boîte étirée ne mesure pas son contenu.** Une hauteur lue sur un
> élément `align-self: stretch` décrit la boîte du voisin, pas la sienne.
> Le test lit désormais les numéros affichés dans la gouttière.

### Un repli de sélecteur qui écrivait au mauvais endroit

La feuille « Nouveau fichier » se remplissait ainsi :

```python
sheet = page.get_by_role("textbox", name="Chemin du fichier")
if sheet.count() > 0:
    sheet.first.fill(js_path)
else:
    page.locator("input").first.fill(js_path)   # ← le piège
```

Le libellé du champ est un simple « chemin », donc le sélecteur nommé ne
trouvait rien et le repli prenait le relais. Or **juste avant**, le test
avait pressé `Ctrl+S` dans l'éditeur — qui enregistre le fichier, comme
prévu. Cet enregistrement fait apparaître la boîte « message de la
révision », dont le champ passe **avant** celui de la feuille. Le repli
écrivait donc `essai.js` dans le message de révision, et l'écran répondait
fidèlement « Créer » désactivé, puisque le chemin était vide.

> **Un repli de sélecteur ne peut pas être silencieux.** Il ne dit pas
> qu'il a dû être utilisé ; il écrit quelque part, et l'échec se voit
> ailleurs. C'est un test qui écrit dans le mauvais champ et accuse
> l'interface.

Deux corrections : le libellé est devenu « chemin du fichier », et le repli
a disparu — le test échoue bruyamment si le champ n'est pas trouvé.

### Suite de tests

| Suite | Résultat |
|---|---|
| `test:demo` | 59 ✓ |
| `test:social` | 30 ✓ |
| `test:search` | 28 ✓ |
| `test:motion` | 5 ✓ |
| `test:repo` | 42 ✓ |
| `test:reports` | 32 ✓ |
| `test:execution` | 38 ✓ |
| `test:highlight` | 62 ✓ |
| `test:gamification` | 159 ✓ |
| `test:foundation` | 176 ✓ |
| `test:navigateur` | **61 ✓** |
| **Total** | **701 ✓** |

`tsc --noEmit` propre, build OK, **19 routes**.

> Le total a connu deux angles morts. Le premier parce que la
> décompilation était faussée — le filtre de sortie capturait la ligne
> « 59 vérification(s) passée(s), 0 échec(s) » **et** la comptabilisait
> comme un échec. Le second parce que `social` est passé de 22 à 30
> vérifications sans que personne ne l'ait décidé. Une suite qui change
> de taille sans qu'on sache pourquoi est un test qui a été modifié
> deux fois ; on le note, on ne suppose pas.

### Ce qui reste ouvert

- **Exécution à l'écran** : l'éditeur est là, `Ctrl+S` écrit, la sortie
  s'affiche — mais le parcours navigateur ne vérifie encore que
  JavaScript. Python exige Pyodide, plusieurs mégaoctets depuis
  Internet : la démo ne peut pas le prouver hors ligne.
- **Connexion GitHub** : OAuth via Supabase, puis `planSync`, jeton dans
  Vault. Toujours pas d'écran.
- **Divergence visible** : toujours impossible à provoquer, faute
  d'écriture concurrente à l'écran. Viendra avec `project_sessions`.
- **Terminal / easter eggs** : rien. La DA est posée, le mode shell
  fonctionnel n'existe pas.

---

---

## 19. Lot 1 — les branches

`git_refs` existait depuis la migration 004 : le dépôt **avait** des
branches. `git_files` n'avait pas de colonne `branch` — l'état de travail
était commun à tout le projet. Une branche ne pouvait donc rien contenir
de différent d'une autre : « basculer » ne changeait que l'**étiquette**.

### Ce que cela rendait impossible, et pas seulement gênant

- **Une pull request n'a rien à comparer.** Deux branches aux fichiers
  identiques ont un écart vide.
- **Le travail parallèle n'existe pas.** Un commit écrit sur une branche
  apparaissait sur toutes les autres : ce n'est pas travailler en
  parallèle, c'est écrire ailleurs.

### Le choix de modèle, et pourquoi il s'écarte de git

Git a un seul arbre de travail : on « checkout » une branche et les
fichiers changent sur place. C'est juste pour un poste local, où personne
d'autre ne regarde. Ici, plusieurs personnes travaillent **en même
temps**, et chacune voit un écran, pas le disque d'un tiers.

Chaque branche a donc son propre jeu de fichiers. `git_files.branch` est
le contenu de la branche, pas un arbre de travail partagé. Prix : du
doublonnage entre branches. Bénéfice : une branche est lisible sans être
écrite.

`git_commit_files` n'est **pas** touché : un instantané appartient à un
commit, et un sha est unique dans tout le dépôt.

### Un sélecteur de branche qui n'a jamais fonctionné

`load` dépendait de `branch` — il relit fichiers et historique de la
branche courante — **et** réaffectait `branch` à la valeur par défaut.
Changer de branche relançait donc `load`, qui remettait le sélecteur sur
`main` : le changement était annulé immédiatement après avoir été fait,
sans aucune erreur.

Un bug de ce genre ne se voit pas sans un **aller-retour**. Le test
navigateur le vérifie maintenant dans les deux sens : on travaille sur une
branche, on revient sur `main`, et le travail doit avoir disparu de
l'écran — puis le revenir doit le faire réapparaître.

### Deux bugs trouvés en posant la migration

**Le `select` ne demandait pas `project_id`.** La copie des fichiers de la
branche reprenait `f.project_id`, donc `undefined`. Les lignes étaient
inscrites **sans projet** : présentes, mais n'appartenant à rien. Le mode
démo les acceptait en silence ; en PostgreSQL, `project_id` est `not null`
et la copie aurait échoué.

> C'est la règle de la section 14, appliquée à l'envers : la démo n'est
> pas plus permissive que la base par hasard, elle l'est parce que
> personne n'y a pensé. Une divergence qui **ne peut pas** se voir en démo
> se voit à la première ligne écrite en base.

**La clé de unicité devait passer à trois colonnes.** Avec
`(project_id, path)`, écrire le même chemin sur deux branches écrasait
l'une par l'autre : le dépôt perdait un fichier, sans erreur. Même famille
que le bug d'`upsert` de la section 16.

### Le filtre de caractères, écrit deux fois

Le motif de contrôle des noms de branche s'est d'abord écrit en classe
**négée** — `[^\x00-\x1f\x7f]` avec des octets littéraux — ce qui
refusait tous les noms contenant un tiret. `correction-2024` était
rejeté, en silence, sans qu'aucune erreur ne le dise.

Il est maintenant une **boucle sur les points de code**. Un motif de
contrôle s'écrit soit avec des octets bruts — et le fichier devient
binaire pour les outils — soit avec des échappements, et un motif mal
refermé devient une classe inversée. Une boucle ne peut pas tomber dans
l'un ou l'autre.

Le test garde le cas `correction-2024` **explicitement**, pour ce motif.

### Ce que la migration ne dit pas

La contrainte SQL sur `branch` est volontairement grossière : non vide,
pas d'espace en bord. Elle ne reprend pas les dix règles de
`lib/git/refs.ts`, et c'est délibéré — une contrainte SQL qui refuse ce que
l'écran vient d'accepter est pire qu'une contrainte absente : elle donne
une erreur que personne ne sait expliquer, dans un endroit où la règle
n'est pas écrite. Ici c'est un filet ; l'autorité est le TypeScript.

### Suite de tests

| Suite | Avant | Après |
|---|---|---|
| `test:repo` | 42 | **82** |
| `test:navigateur` | 61 | **81** |
| Total | 701 | **752** |

`tsc` propre, build OK, 19 routes.

---

---

## 20. Lot 2 — les issues, et deux bugs d'affichage

### Ce que les issues changent

Un dépôt sans issues n'est pas un dépôt, c'est un éditeur de texte avec
un historique. L'issue est l'autre moitié de l'outillage : elle dit ce
qui manque, se discute, et se ferme.

| Brique | Fichier |
|---|---|
| Issues et commentaires, RLS par capacité | `supabase/013_issues.sql` |
| Couche données | `lib/issues.ts` |
| Panneau (liste, discussion, fermeture, retrait) | `components/IssuePanel.tsx` |
| Onglet « Issues » sur le dépôt, discussions au chargement | `app/projects/[id]/page.tsx` |
| Jeu de démonstration | `lib/demo/issues.ts` |
| 31 vérifications | `scripts/test-issues.ts` |

Le numéro et la date de fermeture sont **calculés par la base**, jamais
écrits par le client — mêmes raisons que `target_type` et
`resolved_at` (migration 011). Le mode démo rejoue les deux
déclencheurs.

### Trois trous du moteur de démo, trouvés en posant la fonctionnalité

Aucun n'était visible : chacun produisait un état faux **sans erreur**.

**`count` et `head` n'étaient pas gérés.** `select("id", { count:
"exact", head: true })` renvoyait zéro. L'en-tête affichait « Issues 0 »
pendant que la liste en montrait trois. Implémentés : `count` est pris
sur les lignes filtrées, **avant** le `limit` — un compteur plafonné à
la taille de la page afficherait « 20 » sur un million de résultats.

**Les valeurs par défaut de colonne n'étaient pas appliquées.** Une
issue insérée sans `status` naissait avec `undefined` : ni ouverte ni
fermée, absente de tout compteur, affichée sans marque d'état. Postgres
lui aurait donné `open`. Elles passent maintenant par la table
`DERIVED_AFTER_INSERT`, qui existait déjà pour `reports` — il n'y a donc
pas de second mécanisme.

**`on delete cascade` n'était pas simulé.** Les commentaires d'une issue
supprimée restaient dans le store : invisibles, mais ils revenaient si
l'identifiant était réutilisé, et ils gonflaient la table.

> Chacun de ces trois est la règle de la section 14 appliquée à
> l'envers : la démo n'est pas plus permissive que la base par hasard,
> elle l'est parce que personne n'a pensé au cas. Le compte était le
> plus insidieux — il renvoyait **zéro**, un nombre plausible, pas une
> absence.

### `timeAgo` divisait par 864800 au lieu de 86400

`lib/utils.ts` : le palier des jours était décalé d'un facteur dix.
Conséquence : toute date entre un jour et sept jours s'affichait « il y
a 0 j », donc « à l'instant ».

Ce n'est pas un défaut d'un écran : c'est **le fil, les commentaires,
l'historique du dépôt, les notifications et les issues**. Une application
dont tout semble écrit à l'instant où l'on regarde paraît vide — et c'est
précisément le reproche fait sur ce produit.

Et « il y a 0 j » se lit très bien. Aucune relecture ne l'aurait vu, aucun
`tsc` ne l'aurait vu. Il a fallu ouvrir l'écran des issues et regarder
une issue de deux jours pour le remarquer.

> Un décalage dans une division ne se voit sur **aucune** autre valeur :
> les minutes et les heures étaient justes. Le test ne couvre donc pas
> une plage, il couvre **le palier** (`scripts/test-utils.ts`).

---

## 21. Ergonomie responsive

`--h-tap: 44px` est déclaré dans `globals.css` comme « cible tactile
minimale, **règle dure** ». Mesurée à 390 × 844, la règle n'était tenue
nulle part.

### Ce que le mobile révélait

Aucune des dix pages ne déborde horizontalement. En revanche, les
cibles tactiles mesurées sous 40 px étaient :

| Cible | Avant | Cause |
|---|---|---|
| Nouveau fichier | **12 px** | une icône seule, sans zone |
| Nouvelle branche, Supprimer la branche | **20 px** | `p-1` sur une icône |
| Sélecteur de branche | **16 px** | `<select>` nu dans une ligne de métadonnées |
| Boutons d'en-tête, tous les écrans | **34 px** | `size-[34px]` écrit en dur |
| Onglets (dépôt, notifications, fil) | 34 px | `py-2` sur du 11,5 px |
| Raccourcis d'écriture du composeur | 34 px | `py-2` |

`IconButton` — le composant du design system, utilisé par **tous** les
en-têtes — codait `size-[34px]` en dur. La règle dure était contournée
dans le composant qui est censé l'appliquer, et personne ne l'avait vue
parce que 34 px ne se remarque pas sur un écran de bureau.

> Une valeur écrite en dur dans un composant n'est pas une question de
> goût : c'est une **dérogation silencieuse** à un jeton. La même
> catastrophe que le `420ms` en dur trouvée par `test-motion`, dans une
> dimension que ce test ne surveillait pas.

### Corrigé

Boutons d'en-tête, sélecteur et actions de branche, bouton « Nouveau
fichier », onglets des trois écrans, raccourcis du composeur : tous
passent par `--h-tap`. La barre fait 56 px, donc un bouton de 44 px y
entre sans conflit.

### Mesuré, pas corrigé — et pourquoi

Restent sous 40 px des contrôles **à l'intérieur** des cartes :
mentions et hashtags (24 px), boutons de commentaire et de partage
(30–35 px), lignes d'arborescence (26 px), avatar de story (34 px).

Ce ne sont pas des cibles de navigation — on ne les utilise pas à chaque
écran — mais la règle du design system ne les exempte pas. Je les ai
**mesurés et laissés** plutôt que de les corriger à l'aveugle : les
porter à 44 px densifie une carte au point de changer sa lecture, et c'est
une décision de DA, pas un correctif. Le tableau est là pour qu'elle soit
prise avec des chiffres.

Il manque au passage une **vérification permanente** : le parcours
navigateur ne tourne qu'en 1280 × 900. Un écran peut donc casser sur
mobile sans qu'aucun test ne le voie. C'est le même manque que celui du
« composant monté », transposé à la taille de la fenêtre.

---

## 22. Le téléphone devient une vérification permanente

La section 21 a constaté le manque et l'a laissé en l'air : le parcours
navigateur tourne en 1280 × 900, donc un écran peut casser sur téléphone
sans qu'aucun test ne le voie. `scripts/parcours-mobile.py` le referme —
**73 vérifications**, lancées par `npm run test:mobile`, ou les deux
parcours ensemble par `npm run test:ecran`.

### Trois règles, dont deux qui échouent

**Aucun débordement horizontal.** Mesuré sur douze routes, après avoir
descendu jusqu'en bas de la page : les cartes du fil se montent en
différé, et un débordement en pied ne se voit que lorsque le pied existe.

**Navigation à 44 px.** La barre basse et la barre de titre sont la
navigation. La règle est appliquée à la **coque** et pas à tout `<nav>` :
l'arborescence du dépôt est elle aussi un `nav`, et ses lignes sont sous
la règle pour une raison décidée en connaissance de cause (section 21).
Confondre les deux, et le test devient incapable de distinguer une faute
d'un choix — c'est-à-dire inutile.

**Un plancher de 24 px.** Les contrôles dans les cartes restent sous
44 px : le script ne les corrige pas et ne les approuve pas, il **compte**
ceux qui sont sous la règle et signale toute hausse par rapport au relevé
de la section 21. Le plancher, en revanche, est surveillé comme un seuil
dur — et ce n'est pas un chiffre choisi ici : c'est le critère 2.5.8 du
WCAG 2.2 niveau AA. Les cibles sont en outre **pressées** avec un vrai
clic tactile : un bouton de 44 px qu'on ne peut pas atteindre n'est pas
de 44 px.

### Ce que le test a trouvé tout de suite

**La cloche était en 34 px, sur tous les écrans.** `IconButton` avait été
converti à `--h-tap` au lot précédent — mais la cloche n'est pas un
`IconButton` : c'est un composant séparé, dans un autre fichier, avec sa
propre taille écrite en dur. C'est le bouton le plus proche du pouce, le
seul présent sur tous les écrans, et il n'avait pas été corrigé parce
qu'on avait cherché la faute dans le composant qu'on venait de corriger.
La section 21 l'avait même sous-entendu en écrivant « boutons d'en-tête,
**tous les écrans** ».

**Deux boutons du centre de notifications étaient à 22 px** — « tout lire »
et « vider », posés par `label-micro px-2 py-1`. Sous le plancher, donc
hors règle. Ils ne sont pas de la navigation : ce sont des actions
secondaires de barre d'outils, et 44 px y feraient une barre aussi
haute qu'un panneau de modération. Nouveau jeton `--h-action: 32px` pour
cette catégorie — intermédiaire assumé, au-dessus du minimum normatif.

> Les deux cas sont la même erreur que le `IconButton`, à deux étages
> différents : une valeur de taille écrite en dur dans un composant, et
> une taille qui n'a de sens que dans son contexte. Le test n'a pas
> « trouvé un bug » — il a trouvé que la vérification manuelle de la
> section 21 portait sur ce qu'elle regardait.

### Le test a été mis en échec volontairement

Remettre la cloche à 34 px et relancer : **12 échecs**, un par route, plus
la cloche elle-même. Un test qui n'a jamais échoué ne prouve rien — il
faut l'avoir vu mordre au moins une fois avant de croire qu'il surveille
quelque chose.

Il a fallu aussi neutraliser le `<nextjs-portal>` de Next, qui se pose par
dessus la barre basse et capte les clics en 390 px. Ce n'est pas un
défaut du produit — il n'existe pas en production — mais il rendait le
parcours de navigation impossible. Le script le retire, et le dit.

---

*Mise à jour : session du 4 octobre — dépôt invisible, branches, issues,
deux bugs d'affichage globaux, ergonomie tactile, téléphone vérifié à
chaque lot.*

---

## 23. Session du 5 octobre — audit des bugs, wiki de dépôt, inclinaison 3D

### Un bug majeur : le bouton « Se connecter » ne connectait pas

`/login` définissait une fonction `submit`… et **aucune balise `<form>`**.
Le bouton portait `type="submit"` sans qu'un formulaire l'écoute : sur un
vrai backend, appuyer sur « Se connecter » ne faisait **rien**, sans
aucune erreur. Un `useEffect` redirige vers `/feed` dès qu'une session
existe, donc l'écran *semblait* fonctionner — mais uniquement parce que la
démo ouvre la session autrement. Le formulaire est maintenant un vrai
`<form onSubmit>`.

> C'est la règle de la section 15 retournée : un écran qui « marche » en
démo n'est pas un écran qui marche. Ici l'absence d'un `<form>` était
invisible tant que personne n'essayait un vrai compte.

### Deux bugs trouvés par le parcours navigateur

- **Le bouton d'une demande n'avait pas de nom accessible.** Le
  `aria-label` « Demande numéro N » était posé sur un `<span>`, où il est
  ignoré : un lecteur d'écran annonçait la concaténation de tout le
  contenu. Le nom est passé sur le `<button>`.
- **La vérification de l'animation de sortie mesurait au mauvais endroit.**
  Elle échantillonnait `isConnected` 30 ms après le clic depuis Python ;
  sous charge, l'aller-retour Playwright dépasse les 140 ms de `--d-fast`
  et le test accusait une interface correcte. La durée de vie du nœud est
  désormais horodatée **dans la page** par un `MutationObserver`.

### Ce qui était mort

Douze avertissements de lint étaient du **code mort** : `fetchPosts` (le
`.limit(40)` hérité, remplacé par le curseur), `submit` (le bug ci-dessus),
`CodeBlock` et `hashBlob` importés sans usage, un import de type jamais lu,
un paramètre jamais utilisé. Supprimés. La règle `set-state-in-effect`
(react-hooks v7) est passée en **avertissement documenté** : elle signale
tout `setState` atteignable depuis un effet, y compris après un `await` —
ce qui est le motif normal d'un écran qui interroge Supabase directement.

### Le wiki de dépôt — la part « Notion »

Un dépôt qui n'a que du code ne s'explique pas. `supabase/015_project_pages.sql`
crée les pages de dépôt : **un sommaire ordonné** (`position`), un corps en
texte, et `updated_at` écrit par un déclencheur — jamais par le client.

| Brique | Fichier |
|---|---|
| Table, RLS par capacité, déclencheur de date | `supabase/015_project_pages.sql` |
| Couche données | `lib/pages.ts` |
| Découpage d'un document en blocs (pur) | `lib/doc.ts` |
| Sommaire + lecture rendue + édition | `components/ProjectWikiPanel.tsx` |
| Onglet « Doc » du dépôt | `app/projects/[id]/page.tsx` |
| Parité du mode démo | `lib/demo/pages.ts`, `store.ts`, `query.ts` |
| 30 vérifications | `scripts/test-pages.ts` |
| Parcours navigateur (117 au total) | `scripts/parcours-navigateur.py` |

Trois décisions : la page appartient au **projet**, pas à une branche (une
note d'architecture survit aux branches de travail) ; l'ordre est
**explicite** (un sommaire se range, il ne se trie pas par date) ; le
corps est du **texte** à conventions légères, pas un schéma de blocs. Le
découpage vit dans `lib/doc.ts` et rien de ce qui n'est pas une règle connue
disparaît — tout devient un paragraphe.

### L'effet 3D

`<Tilt>` incline une carte vers le pointeur (±6°, seulement à la souris).
Il **ajoute un élément**, contre la règle « `Motion` n'ajoute aucun
élément » — et pour une raison précise : l'animation d'entrée possède déjà
le `transform` et, en `animation-fill-mode: both`, le conserverait : une
inclinaison posée sur le même élément ne bougerait jamais, sans erreur. Un
élément anime, l'autre incline. Sous `prefers-reduced-motion`, l'inclinaison
s'arrête (elle dépend du JavaScript, le CSS seul ne peut pas la couper).

### Suite de tests

| Suite | Résultat |
|---|---|
| Unitaire (`npm test`, 14 suites) | **810 ✓** |
| `test:navigateur` | **117 ✓** |
| `test:mobile` | **73 ✓** |
| `tsc --noEmit` | zéro erreur |
| `npm run lint` | zéro erreur (19 avertissements `set-state-in-effect`) |
| `npm run build` | OK, 19 routes |

---

## 24. Session du 5 octobre (suite) — « l'interface n'a pas changé »

### Le symptôme, et ce qui le causait vraiment

« Beaucoup de bugs d'affichage, je ne peux pas écrire, c'est vide. » Deux
causes, toutes deux réelles, aucune visible dans le code sans un navigateur :

**Les textes affichaient leurs entités HTML.** `PostCard` et `CommentsPanel`
rendaient `esc(segment.text)` — mais React échappe déjà. Le résultat était un
**double échappement** : « J&#39;ai passé », « &lt;div&gt; » en clair, et les
retours à la ligne transformés en `<br/>` visibles par `esc()`. Comme le
conteneur porte déjà `whitespace-pre-wrap`, le `<br/>` n'avait jamais eu de
raison d'être. Chaque publication du fil était corrompue — d'où l'impression
d'un produit cassé. Corrigé en rendant le texte tel quel ; le seul usage
légitime de `esc()` restait un `dangerouslySetInnerHTML` du profil, qui
pouvait de surcroît **couper une entité en deux** au bord de l'aperçu
(`.slice(0, 140)` après échappement) : lui aussi rend le texte brut.

**Le composeur n'était pas un champ.** Un faux bouton « Quoi de neuf ? »
ouvrait une feuille — un détour qui se lit comme une interdiction d'écrire.
Il est maintenant un vrai `<textarea>` sur le fil : on tape, « Publier »
apparaît, `Ctrl/⌘ + Entrée` publie. La feuille reste réservée au code,
qui a besoin de l'éditeur.

### Le diagnostic qui a servi

Rendu headless après hydratation, champ par champ : le fil affichait
`&#39;` en clair, aucun bouton nommé « Aimer », un composeur réduit à une
invite. Publier **fonctionnait** — le post apparaissait et survivait au
rechargement — mais rien ne le laissait croire.

> Un écran qui fonctionne et qui ne le montre pas produit exactement le
> même verdict qu'un écran cassé : « c'est vide ». La différence ne se
> lit pas dans le code, elle se voit sur la page.

### Vérifié après correction

Entités disparues, publication inline confirmée (post présent puis présent
après rechargement), like nommé et basculant (`aria-pressed`), panneau de
commentaires ouvrant son champ, MP et message de canal envoyés. Aucune
erreur de console sur aucun des parcours.

### À ne pas reprendre

`esc()` n'a plus d'usage légitime : React échappe, et un texte qui passe
par elle s'affiche corrompu. Le module `NetiDevly/` à la racine est un
**prototype statique** antérieur — ce n'est pas l'application, et il ne
doit pas servir de référence d'implémentation.

---

## 21 — Réactions, repost, partage, accusés de lecture (livré)

### Décisions

**Réactions dans leur propre table, pas dans `post_likes`.** Un like est
binaire ; une réaction choisit une valeur dans une liste fermée. Les
fusionner obligerait à distinguer « ligne vide = like » de « ligne icône =
réaction », donc à rendre une colonne nullable dont l'absence aurait deux
sens. Deux tables (`reactions`, `reposts`), deux clés `(post_id, user_id)`,
deux déclencheurs. Le jeu d'icônes est déclaré **à la fois** dans la
migration (contrainte `check`) et dans `lib/reactions.ts` : la base refuse
une valeur que l'écran ne sait pas afficher, et l'écran ne peut pas
proposer une valeur que la base refuse.

**Un repost n'a pas de colonne `text`.** Il dit « ce post est aussi dans
mon fil ». Dupliquer le texte créerait deux vérités à faire diverger.

**Le partage n'est pas une table.** C'est `navigator.share` avec repli sur
la copie du lien : c'est un geste vers l'extérieur, rien à persister. Le
compter en base supposerait qu'on sait qui a partagé — ce qu'on ne sait pas.

**`last_read_at` sur l'adhésion, pas sur le message.** Lire 200 messages
n'est pas 200 événements : c'est un état. Un drapeau par message ne
survit pas au changement d'appareil ; `last_read_at` se **recalcule** à la
lecture, donc il est juste partout. Conséquence assumée : pas d'état
« livré ». Un `✓✓` de livraison que le client poserait lui-même serait un
mensonge affiché comme une donnée — donc deux états honnêtes, « envoyé »
et « lu », et le second l'est vraiment.

**Un canal n'affiche pas de double tick.** Il affiche « Lu par 4/10 » :
un `✓✓` dans un groupe de dix signifierait « lu par quelqu'un », ce que
personne ne croit en le voyant.

**L'indicateur de frappe est un `broadcast`, pas une table.** « Je tape »
est volatil : personne ne veut savoir que quelqu'un a tapé il y a trois
heures. Aucun intérêt à le stocker, aucun risque à le perdre — c'est
exactement ce qu'un signal Realtime est. Le client démo implémente le même
`send` / `on("broadcast")`, donc la fonctionnalité s'affiche dans les deux
modes au lieu d'être morte à côté. Expiration à 6 s : un signal émis puis
oublié resterait « en train d'écrire » pour toujours.

### Bugs trouvés en route

- **`toggleRepost` ne pouvait pas retirer.** Supprimer puis insérer revient
  toujours à « republié ». Le bouton « marche » et ne dé-publie jamais —
  invisible à la relecture. Corrigé par une lecture préalable : le like se
  déduit de l'échec d'insertion, le retrait du repost n'a aucun échec à
  exploiter, il réussit toujours.
- **`Motion` acceptait `attrs` sans le rendre.** L'attribut était déclaré,
  documenté, et jeté — le code l'affirmait et rien ne se passait. Aucun
  test ne le voyait, parce que la classe d'animation existait par ailleurs.
- **`mo-sheet` en `fill-mode: both` aurait cassé le Sheet.** Une animation
  d'entrée garde sa valeur finale et l'emporte sur un `transform` écrit en
  ligne — le glissement vers le bas aurait été mort, le doigt tirant dans
  le vide. `backwards` rend la main à la ligne après l'animation.

### Profondeur

`depth-card` remplace les ombres plates : deux couches, une longue pour
l'écart au plan de travail, une courte pour le contact. Retirer l'une des
deux fait **flotter** la carte au lieu de la soulever — c'est la différence
entre du papier et du plastique. Le déplacement reste à −2 px : c'est
l'ombre qui porte la profondeur, le mouvement ne fait que l'accompagner.

### Vérifié

810 vérifications unitaires, `tsc` propre, lint sans erreur, build OK.
Parcours navigateur `scripts/parcours-reactions.py` : réaction posée,
éclatée, persistante au rechargement, retirée au second clic ; repost posé
puis **retiré** ; partage confirmé ; `✓` de lecture en MP ; aucun message
d'erreur JavaScript. Parcours mobile : 73 vérifications, et le relevé des
cibles tactiles est repassé sous le seuil — les trois actions principales
font 44 px sous `sm`, les secondaires 32 px.

---

## 22 — Audit « ça ne marche pas » : ce qui était vrai, et ce qui ne l'était pas

Signalement : pages vides, écriture impossible, commentaires illisibles,
bouton « signaler » cassé, interface incohérente. Réponse measurable :
cinq scripts de diagnostic ajoutés, 60 interactions exercées.

### Le seul vrai bug trouvé — et il est exactement « le bouton signaler »

**Signaler un commentaire ouvrait une fenêtre morte.**

La feuille du panneau de commentaires et celle du signalement sont deux
`position: fixed` au **même** `z-index`. La seconde se trouve dans le
DOM de la première, donc **avant** elle : à `z-index` égal, l'ordre du
document départage, et le voile du parent se peinte par-dessus celui de
l'enfant. Résultat : la fenêtre s'ouvre, est visible, et **intercepte les
clics à sa propre place**. Aucun message d'erreur — la feuille est là,
donc tout va bien, sauf qu'elle est inutilisable.

Deux causes à la fois, donc un seul correctif :

- *l'ordre d'empilement* — une modale appartient à la fin du document ;
- *le contexte de positionnement* — `position: fixed` est calculé par
  rapport à l'**ancêtre transformé**. Le panneau de commentaires est
  animé, donc transformé, donc la feuille qu'il contient était
  encastrée dedans et tronquée par son défilement.

`Sheet` rend désormais dans un portail `document.body`. Une modale est un
élément du document, pas du composant : elle n'a pas à hériter de la
hiérarchie visuelle de ce qui l'a ouverte.

### Un défaut d'accessibilité, dans la même zone

Les motifs de signalement étaient cinq **boutons à `aria-pressed`**. Un
motif est un choix **mutuellement exclusif** : c'est un `radiogroup`, pas
cinq bascules indépendantes. `aria-pressed` annonce « bouton, pressé » —
sans dire qu'une seule réponse est attendue, ni combien il y en a — et le
clavier ne pouvait pas changer d'avis sans tabuler cinq fois.

Corrigé en `role="radiogroup"` + `role="radio"` + `aria-checked`, avec
les flèches qui déplacent le choix **et le focus** (un focus qui ne suit
la sélection laisse l'utilisateur sans savoir où il est).

**Conséquence à noter** : le parcours navigateur cherchait ces motifs par
`get_by_role("button", …)` et a cassé. C'est la bonne nouvelle — la
sémantique avait réellement changé, et le test le prouve.

### Deux classes mortes retirées

`mo-sheen` et `--shadow-lift-1` étaient définis et jamais employés. Une
classe morte ne casse rien : elle ne fait rien, silencieusement, et
laisse croire qu'une grammaire est disponible. Le test de motion ne
vérifiait que le sens inverse (utilisée sans être définie) ; il vérifie
maintenant **les deux**. Une classe définie et inutilisée est aussi un
bug que le code masque.

### Ce qui n'a pas été reproduit

Écrire, commenter, lire les commentaires, signaler une publication ou un
commentaire, suivre, rechercher, modifier, supprimer, envoyer dans un
canal, les quatre onglets d'un dépôt, le wiki, les issues, les demandes
d'intégration, la pastille de non-lus, le brouillon abandonné : tout
fonctionne. Les 15 routes rendent du contenu sans lever une exception.

Trois hypothèses testées et **écartées** :

- *store localStorage d'ancienne version* (avant les réactions et les
  reposts) — le store fusionne avec le seed, les 10 routes rendent et
  poser une réaction fonctionne ;
- *store corrompu* (JSON invalide) — l'application démarre ;
- *store vide* — l'application démarre.

Donc « chez moi ça ne marche pas » n'est pas un problème de store périmé.
S'il persists, il faut l'URL exacte et l'action qui échoue : les cinq
scripts ci-dessous rendent des verdicts différents selon la page.

### Les scripts

`diagnostic-pages` (routes + boutons sans nom), `diagnostic-actions`
(publier, commenter, signaler), `diagnostic-limites` (commentaire
signaler, canal, mobile), `diagnostic-fonctionnel` (dépôt, suivi,
recherche, notifications, modification, suppression),
`diagnostic-store-ancien` (robustesse du store).

Deux d'entre eux ont d'abord échoué **à tort**, et c'est instructif :
l'un cherchait des `input[type=radio]` là où il y a des boutons, l'autre
affirmait que le composeur devait garder son texte après publication. Un
test qui échoue pour une mauvaise raison apprend à celui qui le lit à
douter du code — donc on corrige le test avant de toucher au code.

---

## Session du 6 octobre — la profondeur sociale (018) et l'écran GitHub

### Le point de départ

La session précédente avait posé `supabase/018_social_depth.sql` — signets,
réponses de commentaires, réactions/épingles de messages, stories — et
l'avait répliquée dans le mode démo. **Une seule des quatre familles avait
un écran** : les signets. Les trois autres étaient des tables que rien
n'affichait, et les stories étaient encore déduites des publications
(`buildStories`). Le pari de la fusion (WhatsApp + Instagram + Notion +
GitHub + Discord) tenait donc à des moteurs visibles nulle part.

Cette session livre les quatre écrans manquants.

### Réponses de commentaires — un seul niveau, mais aucune ligne perdue

`comments.parent_id` existe depuis la 018. L'écran imbrique la réponse
sous son parent, avec une **gouttière** (un filet vertical) plutôt qu'un
retrait : un décalage de 32 px vole un dixième de la largeur sur un
téléphone, une ligne de 2 px ne vole rien.

La règle « répondre à une réponse s'attache à la **racine** » est portée
par l'appelant (`addComment` ne fait que transporter `parent_id`).
Conséquence côté affichage : un commentaire dont le parent est lui-même une
réponse (la base l'autorise, elle ne refuse qu'un parent qui serait la
ligne elle-même) est **remonté à la racine de sa chaîne** au lieu de
disparaître. Rien ne se cache derrière un niveau qu'on ne dessine pas.

**Deux bugs du seed corrigés.** La table des parents était indexée par
auteur, globalement : la troisième réponse désignait un commentaire d'une
**autre** publication. En base la clé étrangère l'aurait accepté ; le fil
affichait une réponse sous un commentaire qu'elle ne répondait pas. Les
parents sont désormais nommés par identifiant et **vérifiés par
publication**. Le cas « réponse à une réponse » est présent exprès, pour
que l'interface ait quoi remonter.

### Réactions, épingles et réponses de messages

Une seule couche (`lib/messages.ts`) et un seul composant
(`components/MessageExtras.tsx`) pour le privé **et** les canaux.

- **Plusieurs emojis par personne et par message**, contrairement à une
  publication. Le schéma est la raison : `reactions` a une clé
  `(post_id, user_id)`, `message_reactions` n'a que son `id`. On s'aligne
  sur le schéma plutôt que de le contredire — appuyer sur 🔥 **et** 😂 sur
  un message est un geste ordinaire, et le refuser produirait un clic qui
  ne fait rien. Conséquence : la bascule **lit** avant d'écrire, parce
  qu'un doublon ne lève aucune erreur (pas de clé à violer).
- **Les épingles sont privées**, comme les signets (`auth.uid() = user_id`).
  La lecture en démo est restreinte via `OWNED_BY`, sans quoi l'écart ne
  se verrait à rien.
- **La citation d'une réponse** se cherche dans la fenêtre chargée. Plus
  ancienne, elle ne s'affiche pas plutôt que d'afficher un contenu
  inventé — une citation fausse est pire qu'une citation absente.
- La barre d'action (réagir/répondre/épingler) est visible au survol sur
grand écran et **toujours visible sur téléphone** : un mobile ne connaît
  pas `:hover`, donc une barre qui n'apparaîtrait qu'au survol serait
  inatteignable.

### Stories — la table, plus la déduction

Le rail ne déduit plus les stories du fil : il lit `stories`. C'est la
décision de fond — une story est un objet **éphémère** avec sa propre
échéance, pas « les publications récentes d'un auteur ». L'échéance est
appliquée par la base (`expires_at > now()`), jamais recalculée par le
client : la recalculer créerait une seconde vérité, et la divergence se
verrait le lendemain.

Un cercle par **auteur** (le rail regroupe, sinon quelqu'un qui publie
trois fois occupe trois places) ; le lecteur déroule la série de cette
personne. Publier une story vide est refusé par l'écran. Le média
(`media_url`) existe mais reste vide : une story sans média se lit, et
c'est le cas courant.

**Un rejeu manquait en démo :** `expires_at` par défaut (`now() + 24 h`)
n'était pas posé à l'insertion, donc une story publiée en démo naissait
périmée et **disparaissait à la seconde**, sans erreur. Le pire genre de
divergence : « publier ne fait rien ».

### GitHub — l'écran au-dessus du moteur

`lib/github/link.ts` analysait les URL et calculait un plan depuis des
mois ; **zéro référence dans `app/`**. Cette session ajoute
`lib/github/connect.ts` et `components/GithubPanel.tsx`, et un onglet
« GitHub » au dépôt.

- **Connecter**, c'est enregistrer une **identité** et une référence
  opaque vers le coffre. Le jeton n'est jamais écrit dans la table — même
  décision que la 004. `token_ref` n'est pas le jeton, c'est le nom sous
  lequel il est rangé.
- **Lier**, c'est `parseRepo` puis `canLink` : les mêmes règles que le
  moteur testé, donc les deux modes refusent la même chose. Le mode
  bidirectionnel exige que le dépôt soit le vôtre.
- **Le plan** (`localSyncPlan`) compare la tête locale au dernier sha
  *enregistré comme synchronisé* — on ne connaît pas le sha distant sans
  l'API. En mode bidirectionnel il est donc **optimiste**, et l'écran le
dit au lieu de le cacher.
- **« Enregistrer la synchro » ne transfère rien.** L'OAuth n'est pas
  branchée ; c'est écrit sous le bouton. Un écran qui prétendrait avoir
  poussé serait la seule faute possible ici.

Parité démo : `github_connections` entre dans `OWNED_BY` (`gh_self_read`
de la 004). Sans cela, le mode démo laissait lire la connexion d'un autre.

### Un seul écran, une seule source

Le fil lit les stories dans `stories`, la conversation lit ses réactions
dans `message_reactions` : plus aucune de ces fonctionnalités n'est
déduite d'une autre table. C'est ce qui permet de dire, devant un écran,
d'où vient chaque pixel.

### Suite de tests — 839 vérifications unitaires

`demo` 59 · `utils` 20 · `issues` 31 · `pages` 30 · `pull` 58 ·
`social` 30 · `search` 28 · `motion` 6 · `repo` 82 · `highlight` 62 ·
`gamification` 159 · `foundation` 176 · `reports` 32 · **`profond` 28** ·
`execution` 38.

`tsc --noEmit` propre, `lint` **zéro erreur** (26 avertissements
`set-state-in-effect`, le motif documenté), build OK, 19 routes.

Parcours navigateur : `navigateur` **118** · `mobile` **73** · le nouveau
`scripts/diagnostic-profond.py` **20** — il publie une story, répond à un
commentaire, réagit à un message et ouvre l'onglet GitHub, puis relit
l'écran. C'est le seul contrôle qui prouve que les composants sont
**montés**, et pas seulement écrits.

### Ce qui reste ouvert

- **OAuth GitHub** : le seul vrai transfert. Le reste de l'axe est là.
- **Divergence visible** : ~~toujours impossible à provoquer~~ **corrigé —
  voir la session suivante (019)**.
- **Média de story** : `media_url` attend un stockage — la colonne existe,
  l'upload non.

---

---

## Session du 6 octobre (suite) — la présence et la divergence (019)

### Le chantier était nommé, le modèle ne suivait pas

« Divergence visible » attendait depuis la vague 4 : elle devait venir avec
`project_sessions`, comme la section 16 l'avait écrit. En ouvrant la table,
la raison de l'attente a changé de nature — le blocage n'était pas
l'absence d'un écran, c'était **un modèle faux**.

La 004 déclarait `id text primary key` avec le commentaire
« project_id:chemin ». Une session appartenait donc à un **fichier**.
Conséquence : deux membres qui ouvrent `registre.py` se disputaient une
seule ligne, et le second effaçait la présence du premier. C'est-à-dire
exactement ce que la table existe pour montrer.

Personne ne pouvait le voir : la table n'avait aucun écran. C'est le motif
des sections 14 et 20, retourné une fois de plus — une règle qui n'a pas de
lecteur n'a pas d'erreur non plus.

> `019_presence.sql` corrige la clé : **une session est (projet, personne)**.
> `file_path` devient une colonne que l'on met à jour, plus une identité.
> La 004 laissait aussi `user_id` nullable avec `on delete set null` — une
> ligne sans personne resterait dans la table, invisible et comptée nulle
> part ; on préfère la cascade.

### La politique qui manquait

La 004 n'ouvrait que `select`, `insert` et `update`. On pouvait donc écrire
sa présence et la rafraîchir, mais **jamais la retirer** : quelqu'un qui
ferme son écran reste affiché jusqu'à expiration, et rien n'y peut rien.
Un droit de partir manquait. `sessions_delete` le donne, dans les mêmes
termes que les autres politiques d'appartenance.

### La divergence : une garde, pas un bandeau

Le vrai garde-fou est dans `saveRepoFile` : `expectedSha` exige que le
contenu enregistré soit **celui qu'on avait lu**, et refuse sinon.

Il est posé là, et pas dans le composant, pour une raison déjà rencontrée
en section 14 : **une règle qui ne vit que dans un écran n'est pas
vérifiable, et c'est l'écran qui l'oubliera en premier**. La couche données
est le seul endroit que les deux modes partagent et qu'un test pur peut
tenir. C'est le garde-fou d'un `git push` non forcé, avec la même
conséquence assumée : on ne fusionne rien, on demande de relire.

`expectedSha: null` veut dire « je crois que ce fichier n'existe pas » —
c'est le cas d'une création, qui doit échouer si la place est prise.
Omis, la garde est inactive : c'est ce qu'il faut pour la copie d'une
branche, qui vient précisément d'écrire.

### Deux chemins pour une même divergence, et pourquoi les deux

- **un bandeau** apparaît dès qu'une écriture touche le fichier ouvert
  (temps réel sur `git_files`) : la divergence se voit **avant** qu'on
  ait cliqué sur « écrire » ;
- **la garde** refuse l'écriture si le bandeau a été manqué — latence,
  onglet en arrière-plan, ou écrivain hors de la fenêtre chargée.

Le second est le filet du premier, comme le battement est le filet du
temps réel. Aucun des deux ne fusionne.

### La présence : trois règles

1. **Le battement écrit, le filet relit.** La présence se met à jour à
   chaque changement de fichier — pas seulement à intervalle : attendre
   trente secondes laisserait un curseur qui désigne le fichier d'avant,
   et c'est exactement le moment où quelqu'un regarde l'écran.
2. **La règle du temps vit en TypeScript**, pas dans la requête. Quand
   quelqu'un ferme son onglet, **aucun événement n'est émis** : il n'y a
   rien à observer. Une liste filtrée uniquement par la base garderait un
   fantôme jusqu'à la requête suivante. C'est pourquoi `isLive` reçoit
   `now` — et c'est ce qui la rend vérifiable sans horloge.
3. **Lecture puis écriture, jamais `upsert`.** La clé est composite, et la
   convention du projet est déjà arrêtée pour ce cas
   (`toggleMessageReaction`, `linkProject`) : un `onConflict` mal nommé sur
   plusieurs colonnes n'échoue pas, il écrit ailleurs. Ici, il créerait une
   seconde présence pour la même personne, en silence.

Parité démo : `project_sessions` entre dans `COMPOSITE_KEYS` — sans quoi le
moteur fabriquerait un `id` que le schéma n'a plus — et `seen_at` reçoit sa
valeur par défaut dans `DERIVED_AFTER_INSERT`, exactement comme
`stories.expires_at` en 018. Sans ce rejeu, une session inscrite sans
horodatage naîtrait **périmée à la seconde** : « je suis là » qui ne fait
rien. Le seed de présence, lui, est calculé par rapport à maintenant et non
par rapport à `t0` — une présence datée du 3 octobre n'est pas ancienne,
elle est morte, et le rail serait vide à chaque ouverture.

### Ce qu'on a dit non

- **Tirer un trait sur les sessions à la fermeture.** Le schéma dit lui-même
  que la table garde « la dernière position connue… même après une
  coupure ». On laisse la ligne vivre, et c'est le délai qui fait disparaître
  la présence — pas un événement de départ qu'aucun onglet ne peut
  garantir.
- **Réécrire `project_id`/`user_id` par un `revoke update`.** Le code ne les
  écrit jamais, et ajouter un revoke que la démo ne saurait pas rejouer
  créerait un écart entre les deux modes pour un cas qui n'existe pas.

### Suite de tests — 869 vérifications unitaires

`demo` 59 · `utils` 20 · `issues` 31 · `pages` 30 · `pull` 58 ·
`social` 30 · `search` 28 · `motion` 6 · `repo` 82 · `highlight` 62 ·
`gamification` 159 · `foundation` 176 · `reports` 32 · `profond` 28 ·
**`presence` 30** · `execution` 38.

`tsc --noEmit` propre, `lint` **zéro erreur** (26 avertissements
`set-state-in-effect`, le motif documenté), build OK, 19 routes.

Parcours navigateur : `navigateur` **118** · `mobile` **73** ·
`diagnostic-profond` **20** · le nouveau `scripts/diagnostic-presence.py`
**10**. Ce dernier est le seul contrôle qui prouve que le **battement a
réellement tourné** : il lit ma session dans le stockage local — par un
autre chemin que celui qui l'a écrite — puis change de fichier et vérifie
que la session a suivi.

### Ce qui reste ouvert

- **OAuth GitHub** : le seul vrai transfert. Le reste de l'axe est là.
- **Média de story** : `media_url` attend un stockage — la colonne existe,
  l'upload non.
- **La divergence entre deux navigateurs** : impossible à provoquer en
  démo, dont le temps réel est un bus en mémoire — un onglet. Le garde-fou
  est vérifié en pur (`scripts/test-presence.ts`) ; le bandeau l'est au
  navigateur depuis une présence du seed.

---

## 20. Session du 12 octobre — défis en notification, carte d'activité, profil

### Les défis du jour quittent le fil

Trois formes se sont succédé : un panneau posé dans le fil, puis une
cloche flottante avec son annonce. Les deux étaient **ancrées** à l'écran :
il fallait lire le fil pour tomber dessus, et elles restaient affichées en
permanence alors que les défis ne changent qu'une fois par jour. Ils
arrivent maintenant en **notification** (`components/ChallengeNotification.tsx`),
montée dans `layout.tsx` — donc globale, flottante (portail dans
`document.body`) et temporaire.

Le rythme est l'énoncé du produit : **un premier passage à 3,5 s**, puis
**un toutes les heures**, et l'annonce s'efface après 18 s. Le bouton
« Voir mes défis » ouvre `/profile?tab=progress` — ce qui a demandé de
gérer `?tab=` dans `app/profile/page.tsx`, qui ne lisait jusqu'ici que sa
valeur par défaut.

Le panneau complet (`ChallengePanel`) reste sur l'onglet Progrès : le fil
n'en porte plus aucune trace.

> Le test de mouvement refuse une classe d'animation **définie mais
> employée nulle part**. Retirer `mo-bell` du fil a donc fait échouer
> `test:motion` avant qu'on lui trouve un nouvel emploi — la sonnerie de
> la notification, exactement son sens d'origine.

### La carte d'activité ne se superpose plus

Symptôme : **des bulles de jours et des textes par-dessus**. La cause
n'était pas l'alignement des colonnes mais la **dérive cumulative** de
l'en-tête : les libellés de mois vivaient dans une rangée `flex` dont la
géométrie se désynchronisait de la grille à la première différence d'un
pixel, et un libellé insécable débordait de sa case.

Corrigé en donnant une **position absolue** à chaque libellé — `gauche =
colonne × 14` — bornée à la largeur de sa période. La vérification n'est
pas visuelle : elle mesure les rectangles des libellés et des cases et
refuse **toute intersection**. Mesure : `0` en-tête/cases, `0`
libellé/libellé.

### Profil : le score moyen n'attend plus un onglet

Il n'existait que dans le panneau Travail. Il est désormais dans
l'en-tête, lu **avec** le profil (`summarizeRepoScores` à côté de
`fetchProjectsByUser`) : un chiffre faux le temps d'un clic reste un
chiffre faux. La grille de synthèse passe à six tuiles, en 3×2.

### Succès et collection expliquent comment on les obtient

Les deux panneaux montraient déjà la pièce, mais l'entrée « Clique pour
comprendre » manquait, et l'explication ne disait pas la **règle**.
Chaque panneau porte maintenant une phrase d'invite, une ligne
`Objectif : …` et, pour les succès, l'échelle complète des trois paliers
(bronze/argent/or avec leur seuil, grisés tant qu'ils ne sont pas
atteints). `Achievement` expose désormais ses `tiers` — la fiche n'a plus
à relire le registre pour les retrouver.

### Vérification

`tsc --noEmit` propre, `npm run lint` **zéro erreur**, build OK (27
routes), `npm test` **0 échec**. Au navigateur, après hydratation : le fil
ne contient plus aucun libellé de défi, la notification apparaît au bout
de 3,5 s en haut à droite et son bouton ouvre l'onglet Progrès, les six
tuiles de l'en-tête du profil sont là dès l'ouverture, et le rapport de
chevauchement de la carte d'activité rend `0`.

## 21. Session du 12 octobre (suite) — les défis entrent dans la cloche

### Le problème

La notification horaire des défis était **le seul message de
l'application à ne laisser aucune trace**. On la rate en changeant
d'onglet, et il n'y a aucun endroit où la retrouver : la cloche ne
compte que les quatre événements de la table `notifications`, et les
défis n'en font pas partie.

### La décision : une entrée **dérivée**, pas un cinquième `kind`

Le réflexe serait d'ajouter `challenge` à `NotificationKind`. C'est
impossible sans mentir sur la base, et pour trois raisons cumulées :

1. `notifications.kind` a une contrainte `check` à quatre valeurs, et
   `notifications_shape` exige, pour chacune, la cible qu'elle doit
   porter — un défi n'a **ni publication ni conversation** ;
2. le client n'a **pas le droit d'insérer** (RLS) : une ligne de défi
   serait une ligne que seul un déclencheur pourrait poser, et il n'y a
   aucun fait déclencheur à écouter — le défi vient de la **date** ;
3. `NotificationKind` est le type de la base. Le gonfler à cinq ferait
   dire au type qu'une ligne peut exister là où la base la refuse.

Donc le centre affiche `NotificationKind | "challenge"`
(`NotificationKindKey`) et une ligne **affichée**
(`DisplayNotification`) — un type à part, qui dit la vérité sur ce qui
se stocke et ce qui se calcule. Le défi n'est pas une cinquième valeur
du type de la base : c'est la seule entrée du centre qui n'a pas de
ligne.

### Où vit l'état « lu »

Dans le navigateur, à côté de l'objectif de la semaine
(`lib/challengeAlert.ts`, clé `devnet:challenge-alert:<compte>`). Deux
détails qui ne sont pas des détails :

- **on enregistre le jour, pas un booléen.** Demain, la valeur d'hier ne
  vaut plus rien, donc l'alerte reparaît seule — sans minuterie de
  remise à zéro et sans écran qui se souvienne qu'il doit la nettoyer ;
- **une clé par compte.** Deux personnes sur le même navigateur ne
  partagent pas leur acquittement ; sinon, la cloche mentirait à l'une
  des deux.

### Ce qui garde le compteur honnête

La règle du projet est que la cloche et la liste comptent **la même
chose**, et que les onglets additionnés redonnent le total. L'alerte est
donc ajoutée **dans les deux fonctions** de `lib/notifications.ts`
(`fetchNotificationPage` et `fetchUnreadSummary`), et elle a son propre
compteur — d'où un cinquième filtre « Défis », qui ouvre la marche
puisque c'est la seule liste qui décrit ce qui **reste à faire**.

Quatre conséquences, toutes traitées :

- **« marquer lu » n'est pas un `read_at`** pour cette ligne : c'est un
  acquittement local, posé à l'ouverture comme au retrait, et aussi par
  « tout lire », « vider » et le bouton « Voir mes défis » de la
  notification horaire — on vient d'aller voir, la cloche n'a plus rien
  à annoncer ;
- **la ligne ne s'affiche que tant qu'elle est non lue.** Une
  notification persistée reste après lecture, parce qu'elle raconte un
  fait qu'on peut relire ; l'alerte, elle, désigne les défis **du jour**,
  qui changent à minuit — la garder donnerait une ligne par jour passé,
  toutes identiques et toutes périmées ;
- **pas d'avatar** : elle ne vient d'aucune personne. L'icône du défi
  (`target`) tient la place, à la même taille que les avatars, pour que
  la ligne garde l'alignement des autres ;
- **l'état vide du filtre dit la vérité** : « rien à annoncer » plutôt
  qu'« aucune défis », qui serait faux au genre *et* au fait — les défis
  existent, ils ont juste été vus.

### Vérification

`tsc --noEmit` propre, `npm run lint` **zéro erreur**, `npm test`
**0 échec** (27 suites), `test:motion` 6/6. Au navigateur, après
hydratation : la cloche porte une pastille non lue, le centre montre
l'entrée « Défis du jour » en tête avec son icône, le clic marque
l'alerte lue (le compteur retombe) et ouvre `/profile?tab=progress`,
l'onglet « Défis » la liste seul, et après acquittement le filtre se
vide sans faire tomber le compteur sous zéro.

---

## 22. Session du 18 octobre — le splash une fois par session, le chargement
## piloté par le réseau, l'inclinaison du héros

### Splash : une ouverture, pas un rechargement

La scène de lancement recapitulait pour **chaque chargement complet** — un
F5 au milieu d'un travail rejouait tout le récit. La scène est désormais
posée **une fois par ouverture de session** :

- la marque de passage vit dans `sessionStorage` (`devnet.splash.seen`) :
  elle survit au rechargement et meurt à la fermeture de l'onglet, donc
  la prochaine *ouverture* rejoue — exactement la frontière voulue ;
- `rearmSplash()` (exporté par `components/SplashScreen.tsx`) retire la
  marque ; elle est appelée **après le succès** — jamais dans un `finally`
  — de la connexion (`signIn` de `/login`), de l'inscription (si
  `signUp` ouvre une session) et du lien de confirmation
  (`/auth/confirmer`). Une connexion réussie est une vraie ouverture :
  le prochain chargement rejoue.
- le test se lit dans `useLayoutEffect`, pas `useEffect` : un visiteur
  déjà passé est retiré **avant le premier paint**, il ne voit jamais le
  voile — pas même une frame. C'est un `setState` dans un effet
  (averti par la nouvelle règle `react-hooks/set-state-in-effect`),
  désactivé **sur cette unique ligne** avec le motif : c'est le but
  même de l'effet, rien ne cascade pourtant qu'un rendu pré-paint.

Vérifié au navigateur (même contexte) : premier chargement → la scène se
joue ; rechargement → absente ; `?demo=1`/inscription puis rechargement
→ **rejoue**.

### Le chargement suit le vrai temps des requêtes

`lib/pending.ts` compte les requêtes en vol ; l'adaptateur `fetch`
branché sur le client navigateur (`global.fetch` dans
`lib/supabase/client.ts`) incrémente avant, décrémente en `finally` —
donc REST **et** auth, et rien d'autre : on ne touche pas au `fetch`
global de la page.

`components/Pending.tsx` lit ce compteur (useSyncExternalStore,
instantané serveur à zéro) et remplace la pastille « en ligne » de la
**barre d'état** (mobile) **et** la ligne d'état (sidebar desktop) par le
mini-logo quand le réseau travaille. Deux délais, tous deux lus dans
`--d-fast` — aucune durée écrite dans le composant :

- une requête plus rapide que le jeton n'affiche **rien** — un
  backends local qui répond en 20 ms ne doit pas faire clignoter la barre ;
- un silence plus court que le jeton ne **cache** rien — une rafale de
  requêtes chaînées reste une seule activité.

En mode démo (backend local), rien n'est fetché : la pastille ne bouge
pas, et c'est exact.

### L'inclinaison n'a plus un seul site d'emploi

`Tilt` (components/Motion.tsx, utilitaire `tilt-3d`) n'était employé que
sur les cartes projet. La carte du héros public — le panneau de
`/login` et les deux étapes de `/register` — s'incline maintenant à la
souris (4° maximum, jamais au doigt, coupé par `prefers-reduced-motion`),
trois surfaces, une seule règle.

### L'inertie du `Tilt` lit la vitesse du pointeur

Avec une durée de transition fixe, la carte répond « au même pas » à
un balayage rapide et à une micro-dérive — ni l'une ni l'autre sent son
poids. La vitesse du pointeur (moyenne mobile px/ms, bornée) choisit le
**jeton de poursuite** `--tilt-d` posé sur l'élément, consommé par
`tilt-3d` : dérive quasi immobile → `--d-fast` (collée), dérive normale
→ `--d-base` (demi-pas), balayage rapide → `--d-slow` (traîne et se
rattrape). Le retrait repose sur `--d-slow` : le retour est le mouvement
le plus lourd de tous.

Deux règles qui s'y attachent :

- **la vitesse ne touche jamais l'angle.** Le maximum reste 6° — le
  poids se sent dans le retard, pas dans l'amplitude ;
- **le composant ne pose aucune durée.** Les trois gestes passent par
  les jetons ; la seule grandeur sienne est le seuil de vitesse
  (~2 px/ms), sans unité — échappant donc à la règle « pas de durée en
  dur », que le test `test-motion` fait appliquer.

### Vérification

`tsc --noEmit` propre ; `eslint` (fichiers modifiés) 0 erreur, 0
avertissement ; `test:motion` 6/6 ; `test:pages` 30/30 ; au navigateur,
après hydratation : le cycle splash vu ci-dessus, et avec des requêtes
REST gratuitement ralenties (délai injecté), le mini-logo apparaît bien
à la ligne d'état pendant que la base travaille.

### Limite honnête

L'indicateur n'a pas pu être vu **sans** ralentissement : dans cet
environnement, le backend local répond plus vite que `--d-fast`, donc il
est absent — c'est le comportement voulu, mais la lecture visuelle
« réel » du temps réseau reste à confirmer sur un backend distant.

Inertie du `Tilt` vérifiée au navigateur (valeurs lues sur la carte) :
dérive lente → `transitionDuration 0.14s`, balayage rapide → `0.38s`,
retrait → `0.38s`, et la matrice finale revient à l'identité de
`perspective(720px)` — la carte repose exactement. Les 4 avertissements
`react-hooks/set-state-in-effect` de `Motion.tsx` (lignes 463, 502,
528 : `useInViewEffect`, `usePrefersReducedMotion`, `useCount`)
sont préexistants, hors de mes lignes.

## 23. Session du 22 octobre — le logo KICHUB refait sobre (sans mascotte)

Le client jugeait la mascotte « trop moche » et a demandé *« sobre,
bien fait, sans mascotte »*. La construction cel shading (dépouille,
arête de lumière, ombre du signet) a été jetée ; le logo devient un
**K monoline** — trait uniforme `SW=30`, embouts ronds, trois segments
(`scripts/kichub_geom.py` : `K_STEM`, `K_UP`, `K_DOWN`) — dont le coude
porte le seul accent : un **nœud magenta** `#E038D1`, le point de
connexion du réseau. Le wordmark **KICHUB** n'est plus dessiné à la
main : il est posé en **Inter Display SemiBold** puis vectorisé par
inkscape (`--export-text-to-path`), ce qui garantit des lettres
professionnelles et une seule source de vérité.

Sorties régénérées : `logo/kichub.svg` (clair), `logo/kichub-dark.svg`
(fond sombre, lettres blanches, nœud magenta), `kichub-preview.png`
(gabarit `fit_viewbox`, marge 30), et les deux Lottie :
**A — Le tracé** (hampe → jambes → nœud en ressort → mot qui s'élève,
one-shot 96 trames) et **B — Connecté** (lockup posé, nœud qui bat,
onde de connexion — anneau qui grandit et s'éteint — deux cycles
exactement dans 90 trames, boucle sans sursaut).

Vérifications réelles en fin de session : relecture ASCII du PNG de
contrôle (K propre, mot net, nœud à sa place) ; rendu des deux Lottie
dans lottie-web 5.13 headless (Playwright) **en frames correctes** —
`goToAndStop(t, true)` prend des *trames* et non des millisecondes,
les premières captures étaient donc illisibles à cause du harnais, pas
des données. Métriques au temps : hampe seule à la trame 7 (≈ 800 px
indigo), jambes à la trame 20 (≈ 3200), nœud magenta à partir de la
trame 30, mot posé à la trame 94 (≈ 3900) ; dans B, l'onde alterne
(276 px magenta aux trames 7 et 52, calme 230 aux trames 32 et 89).

Pièges notés pour la suite : les traits du K sont des lignes **ouvertes**
— ils se rendent au `st` (contour), jamais au `fl` (remplissage d'aire
nulle → invisible) ; et `scripts/build_lottie.py` lit le wordmark dans
`logo/kichub.svg`, donc reconstruire le SVG avant les animations.

## 24. Session du 26 octobre — RLS 038 plié et prouvé, la sonde de
## backend certifiée, l'éditeur sous course CDN, zéro bruit console

### La base : l'identité des politiques RLS ramenée à une seule forme

`038_rls_select_fold.sql` réécrit **toutes** les politiques dont la
sous-requête d'identité est écrite àsti, en la forme canonique pliée.
Deux bugs de conception corrigés en route :

1. `pg_get_expr` **canonise** l'expression (`( SELECT auth.uid() AS uid)`)
   : un remplacement textuel prétendu échouait sur cette forme, et des
   politiques pliées par 002/032 se sont retrouvées **doublement pliées**
   (13 identifiées). La migration dé-plie par regex **jusqu'à stabilité**
   avant de plier une fois, puis un contrôle d'idempotence **canonique**
   : les deux côtés sont abaissés en casse, *tous* les espaces serrés, et
   les alias retirés — dans cet ordre (le `lower()` **avant** la regex
   d'alias, sinon `AS uid` en majuscules échappe au retrait).
2. Le second passage rend « 0 changement » : point fixe prouvé. Aucun
   double pli résiduel, l'API REST répond 200. La copie CLI est
   synchronisée.

### La sonde de backend, enfin silencieuse et honnête

Deux corrections de fond dans la détection du mode démo :

- `lib/backend.ts` traitait **toute réponse HTTP** comme « en ligne » :
  quand Supabase est coupé, le proxy répondait 500, l'app se croyait en
  ligne, le mode démo ne s'affichait pas et le fil mourait en
  « Failed to fetch ». Un 5xx est maintenant un état hors ligne.
- La sonde **navigateur interrogeait `/rest/v1/posts`** : un 500 du proxy
  dans la console Chromium à chaque re-sonde — un bruit qui ne signale
  rien de cassé. La sonde passe maintenant par **`/api/backend-check`**
  (route serveur, GET, toujours 200 JSON `{state, reason}`), qui sonde
  la base elle-même avec la clé anon et un délai de 3 s. Le navigateur
  reçoit une **donnée**, jamais un échec.

### L'éditeur : la course CDN Monaco réglée par l'attente, pas par le choix

Monaco arrive du CDN tantôt en 3 s, tantôt après le délai de repli (6 s)
de l'application : le premier choix fait son éditeur au Hasard échouait
sur le moteur qui arrive quelques secondes plus tard. Le parcours
attend maintenant **l'un des deux moteurs** (`wait_editor` : 60 s, soit
Monaco soit le repli textarea « Contenu de ») puis opère constamment :
`focus_code`, `code_text`, `replace_code`, et le contrôles de branches
(`has_editor`) utilisent ce verdict. Délais `goto` des pages projet
montés à 90 s : `networkidle` peut n'arriver que fin de compilation.

### Le mobile : cibles tactiles ≥ 24 px

- `ProfileWorkPanel` : les trois liens GitHub (login, N dépôts,
  Déconnecter) passent à `h-6` hauteur de cible ; les puces de dépôt
  aussi (ancien `py-1` → boîte < 20 px).
- `app/u/[pseudo]` : le lien `@login` du bloc GitHub relié passe à
  `h-6` (19 px mesuré).

### Le bruit 401 en démo, éradiqué chez les trois appelants

En démonstration, la « connexion GitHub » est une ligne de boutique
locale : demander `/api/github/repos` revenait en 401 console (4 à la
passe mobile). Les trois appelants ne demandent plus en démo :
`ProfileWorkPanel` (les URLs listées sont des lignes du magasin démo),
`GithubPanel` et la page `/github` (décision de ne pas exécuter,
`"no-token"` assumé à l'écran).

### Vérifications de fin de session

- `supabase/038` : plié, idempotent (second passage = 0 changement),
  synchro CLI, REST 200.
- Parcours navigateur : **118 vérifications, 0 échec**. Parcours
  mobile : **72, 0 échec** (exit 0), cibles 24 px garanties.
- `tsc --noEmit` : 0. `npm run lint` : **0 erreur** (62 avertissements
  existants). `npm run test` : tout vert ( últim 47 d'admin).
- `npm run build` : réussi. Supabase relancé, `/api/backend-check`
  répond `online`, /feed et /login 200 en mode réel.

### Reste à faire (pas de cette session)

- Les 62 avertissements lint (aucune erreur).
- `/profile` garde 11 cibles sous 44 px (relevé de section 21) —
  acceptable pour de l'accessibilité de luxe, à densifier plus tard.
- L'audit `AUDIT.md` reste la référence des manques produit (SHA/PR
  E2E, stories Instagram, mode shell).
