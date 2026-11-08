# DevNet — état actuel et plan

> Mis à jour le 2026-10-15. La version précédente était un **diagnostic
> d'avant-code** : elle proposait six vagues (graphe social, conversation,
> découverte, projets, polish WhatsApp, média) sur un dépôt où, disait-elle,
> « aucun code applicatif n'a été écrit ». Les six vagues sont livrées. Ce
> document dit donc **ce qui existe, ce qui reste, et dans quel ordre** —
> chaque manque est décrit ci-dessous avec sa preuve.

---

## 1. Verdict

DevNet n'est plus un plan : c'est un produit qui tourne. Les fondations que
l'ancien document appelait « disqualifiantes » (suivre, commenter, profil
public, notifications, recherche) sont en place et testées. **31 suites,
2028 vérifications, 0 échec** ; `tsc --noEmit` propre ; `npm run lint`
zéro erreur ; 27 routes.

Ce qui reste tient en deux lignes :

- **rien n'est déployé** (Supabase local, pas d'hébergement) ;
- **aucun média n'est stocké** (avatars et pièces jointes = zéro octet).

Tout le reste est un périmètre choisi : langages exécutables (8, contrainte
navigateur), modération (auto-modération, pas de file d'admin), explorer
(refusé).

---

## 2. Les six vagues — livrées

| Vague | Contenu | État | Preuve |
|---|---|---|---|
| 1 | Graphe social + profil public | livrée | `follows` (`005_social.sql`), `app/u/[pseudo]`, `components/FollowButton.tsx` |
| 2 | Conversation + notifications | livrée | `comments`, `post_likes` (`005`), `010_notifications.sql`, `app/post/[id]` |
| 3 | Découverte (recherche, tags, fil abonnements) | livrée | `007_search.sql`, `app/search`, onglet « Abonnements » |
| 4 | Projets / axe GitHub | livrée | `004_foundation.sql`, `lib/git/*`, `app/projects/[id]` |
| 5 | Polish WhatsApp | livrée | `017_read_receipts.sql`, `TypingDots`, pastille non lus |
| 6 | Média / bannière | **non faite** | aucun octet média n'est stocké |

Les vagues 1 à 5 sont allées plus loin que le plan : s'y sont ajoutés les
issues (`013`), les pull requests (`014`), le wiki (`015`), les réactions et
reposts (`016`/`022`/`035`), la profondeur sociale (`018`), la présence
(`019`), les rôles de groupe dans la RLS (`020`/`021`), les preuves (`023`),
la géographie (`024`), les forks (`025`), les liens de profil (`026`), les
réglages de projet (`027`), les communautés (`028`), les extensions
(`029`), les connexions (`030`), les notes de projet (`031`), les thèmes
(`034`) et la synchronisation GitHub « live » (`036`).

### L'angle DevNet — tenu

Le positionnement de l'ancien document — « un réseau où la *preuve de
travail* et la *réputation* sont le même objet » — n'a pas bougé, et c'est
désormais **mesuré** : score /1000 dérivé (`lib/scoring/*`), dépôt conforme à
git vérifié contre `git` 2.43 (`scripts/test-foundation.ts`), exécution de
code dans le navigateur (`lib/execution/*`). Aucun des quatre sites copiés ne
traite cette douleur ; c'est toujours le différenciateur.

---

## 3. Ce qui reste, et dans quel ordre

Recommandation :

1. **Valider le push GitHub + OAuth E2E** — ~0,5 j. Le code existe
   (`lib/github/push.ts`, `oauth.ts`) et le *pull* est déjà prouvé ; il ne
   manque que la preuve que le *push* et l'aller-retour OAuth fonctionnent
   sur un vrai dépôt. C'est de la vérification, pas du développement.
2. **Déployer** — ~1 j. Provisionner Supabase, appliquer les 36 migrations,
   poser les variables, héberger. **Roter au préalable** le client secret
   GitHub et la clé de chiffrement de dev présents dans `.env.local`.
3. **Mode shell + easter eggs** — ~1 j. Prévu, jamais
   planifié ; fort en démonstration si bien placé.
4. **Médias** — 3-5 j, ⚠️ **ouvre `MEMO.md` §9**. À faire seulement si le
   temps le permet : c'est de la surface, et c'est le seul chantier qui
   ajoute un coût permanent (stockage).

> Une note sur les **langages** : ajouter Go/Rust/Julia/Lean n'est pas un
> item de plan, c'est une impossibilité du modèle navigateur (voir
> `AUDIT.md` §5). Un langage **faisable** (Lua, Scheme, ou l'exécution d'un
> `.wasm` fourni) coûterait ~0,5 j et n'ouvre aucune décision.

---

## 4. La question du mode démo — la décision tenue

L'ancien document posait un arbitrage : « le mode démo est-il une
fonctionnalité à part entière (×2 sur tout le travail) ou un filet figé
(×1) ? » La réponse appliquée a été la **première** — et elle a payé : le
moteur de démo (`lib/demo/query.ts`) implémente les opérateurs dont
l'ancien document s'inquiétait (`.in()`, `.or()`, `.overlaps()`, `.is()`),
et la parité est **testée** (`test:demo`, `test:demo-plus`, `test:profond`,
`test:foundation`…). Ce n'est pas un luxe : c'est ce qui sauve une
démonstration si le réseau tombe, et le bandeau dit honnêtement que les
données sont fictives.

---

## 5. Recommandation de séquencement

```
1. Push GitHub + OAuth E2E   (vérification)
        │
2. Déploiement               (exploitation)
        │
3. Mode shell / easter eggs  (démonstration)
        │
4. Médias                    (seulement si le temps le permet, ⚠️ §9)
```

Si **une seule** chose devait être faite avant une démonstration : **le
déploiement**. Un jury juge une application morte si elle n'a pas d'adresse ;
tout le reste est déjà visible en local.

---

## 6. Récapitulatif de charge

| Chantier | Contenu | Charge | Risque |
|---|---|---|---|
| Push GitHub + OAuth E2E | valider le push et le retour OAuth | ~0,5 j | faible |
| Déploiement | Supabase prod + hébergement + rotation des secrets | ~1 j | moyen |
| Mode shell | invite de commande, easter eggs | ~1 j | faible |
| Langage WASI | un interpréteur de plus | ~0,5 j/langage | faible |
| Média | bucket, RLS storage, upload, avatar image | 3-5 j | **moyen (⚠️ §9)** |
| **Total (hors média)** | | **~3 j** | |

---

## 7. Ce que je ne recommande pas de faire

Toujours valable depuis l'ancien document, et confirmé par l'état du code :

- **Stories / reels / vidéo.** Les **stories** existent déjà et ne stockent
  aucun média (elles représentent un post existant, `StoryRail.tsx`) ; le
  reste demande stockage, transcodage et modération vidéo — hors axe.
- **Hashtags tendance / page « Explorer ».** Découverte de contenu, pas de
  réseau professionnel. Refusé (§9).
- **DM de groupe / channels vocaux / appels.** WhatsApp le fait mieux.
- **Feed algorithmique.** `created_at desc` + filtre « Abonnements » suffit,
  et reste explicite.

---

## 8. Documents de référence

- `MEMO.md` — décisions, direction, journal des sessions (autorité).
- `AUDIT.md` — ce qui manque, avec preuves.
- `DESIGN.md` — système de design.
- `README.md` — démarrage, stack, scripts.
