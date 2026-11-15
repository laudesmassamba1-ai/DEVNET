# DevNet — état actuel et plan

> Mis à jour le 15 novembre 2026. Référence : commit `ec08ae9`, branche
> `feature/status-editor-liquid-glass`, production `devnet-brown.vercel.app`.
> Chaque affirmation ci-dessous renvoie à un fichier, un test ou une mesure
> reproductible. Les documents détaillés restent prioritaires sur ce résumé.

---

## 1. Verdict

DevNet est déployé et relié à PostgreSQL. Les fondations sociales, la
messagerie, la recherche, les projets, GitHub, les médias, les stories avec
audience et le Trust & Safety existent dans le code livré.

Le 15 novembre 2026, les validations locales suivantes passent :

- `npx tsc --noEmit` : 0 erreur ;
- `npm run build` : exit 0, 44 pages générées ;
- `npm run ux:check` : cliquet tenu, 489 valeurs arbitraires pour un plafond
  de 493 ;
- `npm run test:push-notify` : 34 vérifications.

Cela ne signifie pas que tout est prouvé en production. Les limites restantes
sont nommées au §3.

Le périmètre assume des refus : pas de feed algorithmique opaque, pas de
hashtags tendance, pas d'appels vocaux, pas de promesse d'IA non branchée.

---

## 2. Ce qui est livré

| Domaine | Contenu | Preuve principale |
|---|---|---|
| Graphe social | suivre, commenter, liker, profil public, notifications | `db/migrations/005_social.sql`, `app/u/[pseudo]`, `components/FollowButton.tsx` |
| Conversation | fils, réponses, réactions, messages privés, présence | `modules/messages`, `app/messages`, `lib/conversations.ts` |
| Découverte | recherche, tags, fil abonnements, recommandations explicables | `app/search`, `lib/search.ts`, `lib/recommendation.ts` |
| Projets et code | dépôt interne, exécution navigateur, preuves, notation | `app/ide/[project]`, `lib/git`, `lib/execution`, `lib/scoring` |
| GitHub | OAuth, import, lecture, pull, synchronisation | `lib/github`, `app/api/github`, `scripts/test-github-*` |
| Médias | images, pièces jointes, avatars, repli PostgreSQL | `lib/media-storage.ts`, `app/api/media`, `scripts/test-media-security.ts` |
| Stories | publication, média, audience, vues, réactions, réponses | `modules/stories`, `db/migrations/018`, `067`, `070` |
| Trust & Safety | signalements, sanctions, recours, audit, console admin | `modules/moderation`, migrations `075` à `079`, `scripts/test-trust-safety-http.ts` |
| Base de données | PostgreSQL 18.3, Neon en production, RLS | `db/migrations`, `docs/ops/failover.md` |
| Interface | quatre thèmes, Liquid Glass, rail mobile, réglages | `app/globals.css`, `components/StatusComposer.tsx`, `components/StoryViewerLive.tsx` |
| Notifications | in-app, email de réinitialisation, push Web si VAPID | `lib/push`, `app/api/push`, `scripts/test-push-notify.ts` |

Le détail des migrations et de l'exploitation est dans
[`docs-technique.md`](./docs-technique.md) et
[`docs/engineering/TRUST-SAFETY-STATUS.md`](./docs/engineering/TRUST-SAFETY-STATUS.md).

---

## 3. Ce qui reste, et dans quel ordre

### P1 — preuves et confidentialité

1. **Média des stories** : terminer l'audit des contrôles
   `media_files`/triggers, des comparaisons `LIKE` et des URL same-origin.
   Un test multi-comptes doit prouver qu'un tiers ne lit ni le média ni la
   story privée. Voir `docs/engineering/DEVNET_STORIES_SPEC.md` et
   `scripts/test-stories-audience.ts`.
2. **R2 réel** : les secrets `R2_ACCESS_KEY_ID` et `R2_SECRET_ACCESS_KEY`
   manquent dans l'environnement de test. Le repli PostgreSQL est prouvé, pas
   l'upload objet réel.
3. **OAuth GitHub de bout en bout** : le pull est prouvé ; l'aller-retour
   complet avec un fournisseur réel ne l'est pas.

### P2 — cohérence et dette

4. **Passe documentation/contenu** : l'inventaire est dans
   `docs/maintenance/DEVNET-DOCS-INVENTORY.md`. Les textes visibles sont
   audités page par page ; les pages restantes ne doivent pas annoncer une
   capacité non branchée.
5. **UI-003** : réduire les 489 valeurs Tailwind arbitraires par écran
   (`app/profile/page.tsx` 25, `app/decouvrir/page.tsx` 19,
   `components/GithubPanel.tsx` 19) sans remonter le cliquet.
6. **ARC-001** : découper les gros écrans (`app/feed/page.tsx`,
   `app/messages/page.tsx`, `app/ide/[project]/page.tsx`) avec tests
   avant/après. Neuf fichiers dépassent 800 lignes.
7. **Preuves navigateur** : vérifier visuellement `/settings`, l'éditeur de
   statut et la visionneuse de stories sur desktop et mobile, avec un compte
   de test.

### P3 — produit

8. **Mode shell et easter eggs** : prévu, jamais planifié.
9. **Langage WASI supplémentaire** : faisable dans le navigateur, sans
   promesse sur Go/Rust/Julia/Lean.
10. **Recherche GIF réelle** : l'UI doit rester honnête tant qu'aucune clé
    n'est configurée.

---

## 4. La question du mode démo — la décision tenue

Le mode démo est une fonctionnalité à part entière, pas un simple filet. Le
moteur `lib/demo/query.ts` implémente les opérateurs utilisés par
l'application (`.in()`, `.or()`, `.overlaps()`, `.is()`), et la parité est
testée (`test:demo`, `test:demo-plus`, `test:profond`, `test:foundation`).
Le bandeau dit honnêtement que les données sont fictives.

Le mode démo reste local au navigateur : son bus temps réel ne couvre pas
plusieurs onglets, et il ne prouve pas que toutes les fonctions serveur
tournent sans service externe.

---

## 5. Recommandation de séquencement

```text
1. Média Stories + test multi-comptes   (confidentialité)
        │
2. R2 réel et OAuth GitHub E2E          (preuves externes)
        │
3. Documentation et textes visibles     (cohérence)
        │
4. UI-003, ARC-001, preuves navigateur  (dette et finition)
        │
5. Mode shell / easter eggs             (démonstration)
```

Si une seule chose devait être faite avant une démonstration, ce serait la
preuve média/Stories : une story privée dont le média fuit est un défaut de
confidentialité, pas un détail de finition.

---

## 6. Récapitulatif de charge

| Chantier | Contenu | Charge | Risque |
|---|---|---|---|
| Média Stories | contrôles SQL, comparaisons, test multi-comptes | ~1 j | **élevé (confidentialité)** |
| R2 réel | secrets, upload, suppression, test d'intégration | ~0,5 j | moyen |
| OAuth GitHub E2E | aller-retour fournisseur réel | ~0,5 j | faible |
| Documentation/contenu | audit des documents et 37 pages | ~2 j | faible |
| UI-003 | réduction par écran | ~2 j | faible |
| ARC-001 | découpage des gros écrans | ~2 j | moyen |
| Mode shell | invite de commande, easter eggs | ~1 j | faible |

---

## 7. Ce que je ne recommande pas de faire

- **Feed algorithmique opaque.** `created_at desc` + filtre « Abonnements »
  suffit et reste explicable.
- **Hashtags tendance / page « Explorer ».** Découverte de contenu, pas de
  réseau professionnel.
- **DM de groupe, channels vocaux, appels.** WhatsApp le fait mieux.
- **Modération vidéo/audio par IA sans fournisseur.** Le produit doit dire
  « non configuré », pas simuler un moteur.
- **Promesse de langages non exécutables dans le navigateur.** Go, Rust,
  Julia et Lean ne sont pas des items de plan.

---

## 8. Documents de référence

- `README.md` — démarrage, stack, scripts.
- `docs-technique.md` — carte technique courte.
- `docs/ARCHITECTURE.md` — décisions et direction.
- `docs/FONDATIONS.md` — couches, fondements et structure.
- `docs/engineering/DEVNET-EXECUTION-LEDGER.md` — registre d'exécution.
- `docs/engineering/DEVNET-VALIDATION-MATRIX.md` — état des vérifications.
- `docs/maintenance/DEVNET-DOCS-INVENTORY.md` — audit documentaire en cours.
