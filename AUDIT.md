# Audit — ce qui manque, état au 2026-10-15

> Réécrit le 2026-10-15. La version précédente datait du 2026-10-04 et
> listait comme « absent » la moitié de ce qui est aujourd'hui livré
> (réactions, signets, reposts, accusés de lecture, rôles de groupe dans la
> RLS, éditeur de fichiers, exécution de code, synchronisation GitHub,
> issues, pull requests, wiki, forks, communautés, extensions, thèmes…).
> **Ce document ne décrit que des manques actuels.**
>
> Chaque ligne porte une **preuve** — fichier, table, migration, ou
> absence — plutôt qu'une impression. Une affirmation sans preuve ici ne
> vaut rien. Les décisions restent dans `MEMO.md` ; un ⚠️ signale un
> élément qui rouvre une décision de `MEMO.md` §9.

---

## 1. Le résumé en une phrase

Le produit est **complet sur les cinq axes** — Twitter, Instagram (sauf
média), Discord, WhatsApp, GitHub — et tient ses promesses par des tests
(31 suites, **2028 vérifications**, 0 échec ; 27 routes ; 36 migrations).
Deux manques restent, et ils ne sont pas du produit :

1. **Aucun média n'est stocké.** Avatars et pièces jointes sont des jetons
   de couleur / zéro octet. C'est le seul chantier qui demande une
   infrastructure (Supabase Storage) et le seul qui rouvre §9.
2. **Rien n'est déployé.** L'application tourne contre un Supabase
   **local** ; le push GitHub et le retour OAuth ne sont pas validés de
   bout en bout ; le mode shell décrit en §7 de `MEMO.md` n'existe pas.

Le reste — langages exécutables, rôles, modération — sont des périmètres
choisis, pas des trous.

---

## 2. Par plateforme

### Twitter / X — livré

| Bascule | État | Preuve |
|---|---|---|
| Fil, temps réel, publication texte + code | fait | `app/feed`, `lib/social.ts` |
| Like, commentaire, suivi | fait | `post_likes`, `comments`, `follows` (`005_social.sql`) |
| Profil public, post détail, partage | fait | `app/u/[pseudo]`, `app/post/[id]`, `components/ShareSheet.tsx` |
| Réactions emoji | fait | `016_reactions.sql`, `022_emoji_reactions.sql`, `035_reaction_thumb.sql`, `components/ReactionPicker.tsx` |
| Signets | fait | `018_social_depth.sql`, `app/signets`, `lib/signets.ts` |
| Repost | fait | `016_reactions.sql` |
| Pagination | fait | curseur (`fetchFeedPage`) ; plus aucun `.limit()` en dur dans `lib/social.ts` |

Rien à faire. Les trois « trois tables absentes » de l'audit précédent
existent toutes.

### Instagram — le seul axe réellement incomplet

⚠️ **Rouvre `MEMO.md` §9.** Aucun octet média n'est stocké.

| Bascule | État | Preuve |
|---|---|---|
| Identité visuelle (la DA) | fait | `DESIGN.md`, glyphes maison, `components/Icon.tsx` |
| Stories | fait, **dérivées** | `components/StoryRail.tsx` — représentent un post existant, aucun média stocké |
| Explorer | absent **et refusé** | §9 |
| **Avatar image** | absent | `users.avatar_color` est un `text` (`001_schema.sql:24`) ; `users.avatar_url` est **typé** (`lib/types.ts:647`) mais **jamais rendu** ni alimenté |
| **Photos / pièces jointes** | absent | **aucun** `<input type="file">` dans `app/` ni `components/` ; `grep "storage.from"` ne renvoie rien |

Le coût réel n'est pas l'écran : c'est le bucket, les politiques RLS de
`storage`, la compression côté client, et une modération a posteriori.
**3 à 5 j**, plus un coût de stockage permanent. C'est le seul chantier du
document qui casse le budget et n'ajoute pas de preuve de travail.

### Discord — livré

| Bascule | État | Preuve |
|---|---|---|
| Groupes, canaux, composition par canal | fait | `app/groups/[id]`, `lib/groups/channels.ts` |
| Rôles en base | fait | `group_members.role`, contrainte `check` (`005_social.sql`) |
| **Rôles dans la RLS** | **fait** | `020_group_roles.sql` : fonction `group_role(gid)` lue par les politiques |
| UI de modération | fait | `021_group_membership_truth.sql`, retrait de membre par `owner`/`moderator` |
| Signalements | fait | `011_reports.sql`, `app/moderation`, `components/ReportButton.tsx` |

Le point de blocage de l'audit précédent — « un `moderator` ne peut rien » —
est corrigé : la RLS lit désormais le rôle, et l'UI suit.

### WhatsApp — livré

| Bascule | État | Preuve |
|---|---|---|
| Privés, groupes, recherche destinataire | fait | `lib/messages.ts`, `app/messages` |
| Temps réel | fait | realtime sur `direct_messages` |
| Pastille non lus | fait | `app/messages/page.tsx`, `lib/notifications.ts` |
| **« En train d'écrire »** | **fait** | `components/TypingDots.tsx`, hook `useTyping`, canal `broadcast` dédié `dm-typing-<conv>` |
| **Accusés de lecture** | **fait** | `017_read_receipts.sql`, `components/Receipt.tsx`, `markConversationRead` |

Les deux « premium » de l'audit précédent sont livrés.

### GitHub — livré, sauf la **preuve E2E du push**

| Bascule | État | Preuve |
|---|---|---|
| Dépôt conforme à git | fait | `lib/git/*`, vecteurs de référence git 2.43 (`scripts/test-foundation.ts`) |
| Commit depuis l'interface | fait | `app/projects/[id]/page.tsx` |
| Branches, diff, historique | fait | `012_branches.sql`, `lib/git/history.ts` |
| Présence sur le dépôt | fait | `019_presence.sql`, `project_sessions` |
| Éditeur de fichiers | **fait** | `components/ProjectCodeView.tsx` |
| Exécution de code | **fait** | `lib/execution/*`, **8 langages** (voir §5) |
| Issues, pull requests, wiki, forks, étoiles/notes | fait | `013`, `014`, `015`, `025`, `031` ; `IssuePanel`, `PullRequestPanel`, `ProjectWikiPanel`, `ForkTreePanel`, `ProjectRatingPanel` |
| OAuth GitHub | **code fait, non validé E2E** | `lib/github/oauth.ts`, `app/api/github/authorize|callback` — le retour OAuth n'a pas été testé (contourné par le cookie `devnet_gh`) |
| **Push vers GitHub** | **code fait, non validé E2E** | `lib/github/push.ts`, `lib/github/connect.ts`, `app/api/github/sync` — le **pull** est vérifié de bout en bout, pas le **push** |
| **Divergence visible** | **fait côté moteur** | `lib/github/live.ts` refuse (`kind: "diverged"`), `lib/github/sync.ts` |

Il reste donc **une seule chose** sur cet axe : prouver le push vers un vrai
dépôt GitHub et un aller-retour OAuth complet — c'est de la vérification,
pas du développement.

---

## 3. Transverse

### Animations — livrées

L'infrastructure de motion est complète et déployée : `mo-exit`, `mo-press`,
`tab-underline`, `mo-scan` ont rejoint les classes actives, et la classe
morte `.press` a été retirée. `scripts/test-motion.ts` refuse une classe
définie mais employée nulle part et une classe employée mais non définie.

### Mode shell et easter eggs — absents

`MEMO.md` §7 les décrit ; **zéro référence** dans le code (`grep -rn
"ShellMode|easter|terminalCommand"` ne renvoie rien). Un invite dans la
barre de statut, une commande `/git commit` : **~1 j**, très fort en
démonstration, mais risque de distracteur si mal placé. **Non planifié.**

### Pagination — faite

`fetchFeedPage` est passé au curseur, et il ne reste **aucun** `.limit()`
en dur dans `lib/social.ts`.

---

## 4. Mise en ligne — le vrai manque aujourd'hui

Ce n'est pas une fonctionnalité, c'est l'écart entre « ça tourne chez moi »
et « c'est en production ».

| Point | État | Preuve |
|---|---|---|
| Backend Supabase | **local uniquement** | `.env.local` → `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` |
| Déploiement Next.js | **absent** | pas de `vercel.json`, pas de `Dockerfile`, pas de CI de déploiement |
| Mode démo | présent, honnête | `lib/backend.ts` bascule en local (`lib/demo/`) si l'API REST ne répond pas |
| Secrets | locaux, gitignorés | `.env*` est dans `.gitignore:34` — mais `.env.local` contient un **client secret GitHub** et une **clé de chiffrement** de dev : à **roter avant toute production** |

Le produit ne « manque » pas ici : il lui manque une adresse. Le travail est
surtout de l'exploitation (provisionner Supabase, appliquer les 36
migrations, poser les variables d'environnement, déployer).

---

## 5. Langages exécutables — 8, contrainte assumée

L'exécution est **100 % navigateur** (aucun serveur). Le registre
(`lib/execution/runtime.ts`) route par extension :

| Langage | Moteur | Extensions |
|---|---|---|
| Python | Pyodide | `py`, `python` |
| JavaScript | Sandpack | `js`, `jsx`, `mjs`, `cjs` |
| TypeScript | Sandpack + compilateur TS | `ts`, `tsx` |
| C | WASI `clang` | `c`, `h` |
| C++ | WASI `clangpp` | `cpp`, `cxx`, `cc`, `c++`, `hpp`, `hxx`, `hh` |
| Ruby | WASI `ruby` | `rb` |
| PHP | WASI `php-cgi` | `php` |
| SQL | WASI `sqlite` | `sql`, `sqlite` |

**Go, Rust, Julia, Lean n'y sont pas, par contrainte, pas par oubli.** Il
faudrait un interpréteur/compilateur **compilé en WASM/WASI**, assez petit
pour un téléchargement navigateur : Pyodide ≈ 10 Mo, clang ≈ 31 Mo. Le
toolchain Go fait des centaines de Mo, Julia > 300 Mo, Lean embarque un JIT
LLVM. Rust (`wasm32-wasip1`) et Go (`GOOS=wasip1`) **compilent vers** le
WASM mais leur **compilateur** n'existe pas en WASM navigateur : on pourrait
*exécuter* un `.wasm` précompilé, pas écrire-et-lancer la source. Ajouter
l'un de ces langages imposerait soit des centaines de Mo à télécharger, soit
un serveur — ce que le projet refuse par conception.

Ce qui serait **faisable** sans casser le modèle : des interpréteurs légers
déjà portés en WASM (Lua, Scheme), ou l'exécution d'un webassembly fourni.
Une entrée dans `RUNTIMES` et un binaire suffiraient.

> Les tests WASI « réels » (`npm run test:wasi-live`) téléchargent les
> binaires depuis le CDN : ils dépendent du **réseau**, donc ils sont
> **hors** de `npm test`. La suite hors-ligne (`test:execution`, 131
> vérifications) couvre la logique pure.

---

## 6. Coûts, par ordre de rapport effort/valeur

| # | Chantier | Coût | Rouvre §9 ? |
|---|---|---|---|
| 1 | Valider le **push GitHub** + OAuth E2E | 0,5 j | non |
| 2 | Déployer (Supabase prod + hébergement) | 1 j | non |
| 3 | Mode shell + easter eggs | 1 j | non |
| 4 | Langage WASI supplémentaire (Lua, Scheme) | 0,5 j/langage | non |
| 5 | **Médias / upload** | **3-5 j** | **⚠️ oui** |

Les quatre premiers totalisent ~3 j et n'ouvrent aucune décision refusée.
Le cinquième est le seul qui casse le budget du projet, et il n'apporte pas
la preuve de travail — il ajoute le stockage.

---

## 7. Ce que cet audit ne dit pas

Il ne dit pas que le produit est incomplet. `MEMO.md` §2 pose que la preuve
de travail **est** la réputation, et c'est l'axe le plus avancé du code :
dépôt conforme à git, exécution multi-langages, preuves, score /1000,
notifications dérivées. Le déficit n'est plus dans les écrans — il est dans
**le déploiement** et, pour un seul axe, dans **le stockage média**. C'est
une bonne nouvelle : les deux manques restants sont respectivement de
l'exploitation et une décision à assumer, pas des fonctionnalités à
inventer.
