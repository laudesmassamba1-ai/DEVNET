# DEVNET — journal des changements documentaires

> Dernière mise à jour : 2026-11-15.
> Chaque entrée indique la raison, la preuve consultée et la validation.
> Un commit n'est renseigné que s'il existe ; aucune entrée n'anticipe un
> commit ou un déploiement.

## 2026-11-15 — Lot 1 : vérités produit et base

| Fichier | Changement | Raison | Preuve | Validation |
|---|---|---|---|---|
| `README.md` | Base de production décrite comme Neon ; miroir local PostgreSQL 18.3 | La ligne citait Systalink comme cible | `.env.local` : hôtes Neon, sans secret ; `docker-compose.yml:15` | Liens locaux vérifiés |
| `README.md` | Push décrit comme existant mais conditionné à VAPID | Le README annonçait « pas de notifications push » | Routes push, réglages, `.env.example:127-138` | `test:push-notify` : 34/34 |
| `README.md` | Comptes de migrations corrigés : 79 fichiers, 81 entrées distantes | Le README annonçait 74 migrations et `001…074` | `db/migrations/` ; `TRUST-SAFETY-STATUS.md` | Lecture ; `db:migrate` en simulation à relancer |
| `README.md` | Suppression des instructions Supabase SQL Editor | Supabase n'est plus la cible | `docs-technique.md`, `lib/rest/client.ts` | Liens locaux vérifiés |
| `README.md` | `029_project_ratings.sql` remplacé par `031_project_ratings.sql` | Le fichier `029` n'existe pas | `db/migrations/031_project_ratings.sql` | Lecture |
| `README.md` | Stories décrites par leur vraie table, audience et média optionnel | Le README parlait de posts recyclés | `lib/stories.ts`, migrations `018` et `070` | Test d’audience encore dû (base locale arrêtée) |
| `README.md` | Fondations décrites comme partiellement exposées | Le README affirmait l'absence totale d'interface | `app/groups/[id]/page.tsx`, `app/projects/[id]/page.tsx`, `app/github/page.tsx` | Lecture ; audit visuel à faire |
| `.env.local.example` | PostgreSQL 18.3, URL locale réelle, renvoi vers `.env.example` | Le fichier citait PostgreSQL 17 et prétendait que l'application n'utilisait pas la base | `docker-compose.yml:15`, `app/api/rest/[...path]/route.ts` | Lecture |
| `app/settings/page.tsx` | Texte push corrigé : disponibilité selon VAPID | Le texte affirmait que le push n'était pas configuré | `app/api/push/subscription/route.ts`, `app/api/push/test/route.ts` | `ux:check` : cliquet tenu |
| `lib/stories.ts` | Commentaires remis à jour : média et audience existent | Les commentaires annonçaient un média futur et un texte seul | `publishStoryWithMedia`, migrations `018`/`070` | `tsc` : 0 erreur |
| `docs/ops/failover.md` | Statut Neon et 13 cas de test | Le statut décrivait Systalink comme secours actif ; le tableau annonçait 9 cas | `.env.local` (hôtes seulement), `scripts/test-failover.ts` | À exécuter : test failover si deux bases disponibles |
| `docs-technique.md` | Réécriture de la carte technique | Supabase, routes et variables d'environnement périmés | Routes et bibliothèques actuelles | Liens locaux vérifiés |
| `docs/maintenance/*` | Création des registres exigés | Le protocole documentaire les rend obligatoires | Skill de synchronisation documentaire | Inventaire et audit créés |

## Validation du lot 1

- `npx tsc --noEmit` : 0 erreur.
- `npm run ux:check` : cliquet tenu, 489 valeurs arbitraires pour un plafond
  de 493.
- `npm run test:push-notify` : 34 vérifications réussies.
- `npx eslint app/settings/page.tsx lib/stories.ts` : 0 erreur.
- `npm run build` : exit 0, 44 pages générées.
- Liens Markdown des fichiers touchés : 25 vérifiés, 0 manquant.
- Scripts `npm run` cités : tous présents dans `package.json`.
- Encore dus : `npm run test:stories-audience` sur `devnet_ci` (base locale
  arrêtée) et audit visuel de `/settings`.
- Aucun commit, push ou déploiement effectué.

## 2026-11-15 — Lot 2 : architecture, fondations, roadmap, Stories

| Fichier | Changement | Raison | Preuve | Validation |
|---|---|---|---|---|
| `docs/FONDATIONS.md` | Réécriture complète | Le document décrivait 36 pages, Supabase, 51 migrations et l’absence de push | `find app`, `find app/api`, `db/migrations`, routes push | Chiffres recomptés ; `tsc` et `build` verts |
| `docs/ARCHITECTURE.md` | Réécriture complète | Supabase, 52 migrations et Systalink étaient présentés comme l’état actuel | `lib/api`, `platform`, `modules`, `db/migrations` | Lecture confrontée aux fichiers |
| `ROADMAP.md` | Réécriture de l’état et des priorités | Le plan affirmait « rien n’est déployé » et « aucun média » | Déploiement `ec08ae9`, `story_media`, `media_files`, tests | Validations locales citées ; preuves externes non revendiquées |
| `docs/engineering/DEVNET_STORIES_SPEC.md` | Réécriture | L’audience était dite « non implémentée » alors que la migration `070` la porte | `070`, `051`, routes média, `postgres-stories-repository.ts` | Défaut P1 `/api/media` consigné, non corrigé |

### Constat P1 consigné

`media_file_is_private` reconnaît une story, mais `can_read_media_file`
autorise toute story vivante à une session authentifiée, sans vérifier
`audience`. Le chemin `/api/media/<path>` d’une story `followers` ou `private`
reste donc lisible par un tiers authentifié qui connaît le chemin. Les
comparaisons `LIKE` ne échappent pas non plus `%` et `_`. Aucun test
multi-comptes ne couvre encore ce chemin.

### Validation du lot 2

- Liens Markdown des documents du lot 2 : vérifiés, 0 manquant (25 au total avec le lot 1).
- `npx tsc --noEmit` et `npm run build` : verts après les changements.
- Le défaut P1 n’est pas corrigé ; aucun test de confidentialité n’est
  revendiqué.

## 2026-11-15 — Lot 3 : média, sécurité et release

| Fichier | Changement | Raison | Preuve | Validation |
|---|---|---|---|---|
| `docs/engineering/DEVNET_STORIES_SPEC.md` | Défaut P1 remplacé par l'état corrigé ; chemins, trigger et limites R2 décrits | Le document annonçait encore une audience non prouvée | `081_story_media_audience.sql`, `lib/story-media-url.ts` | `test:stories-audience` 26/26 ; `test:media-security` 36/36 |
| `docs/engineering/DEVNET_MEDIA_ARCHITECTURE.md` | Audience objet, normalisation same-origin, preuves 26/36/47, limite bucket public | Le tableau média décrivait `story_media` mais pas la branche `stories.media_url` corrigée | Migration `081`, `app/api/media/[path]/route.ts` | Lecture du code + tests locaux |
| `docs/engineering/DEVNET_SECURITY_MODEL.md` | `service_role` fermé, TLS `verify-full` confirmé, RLS CI fermée, audience média ajoutée | Les blocages 1 et 2 étaient périmés depuis `080` et l'audit TLS | `db:tls-audit:remote`, `080_revoke_service_role.sql`, `ci.yml` | Audit distant du 2026-11-15 ; contrat de schéma et `/api/ready` verts |
| `docs/engineering/DEVNET_RELEASE_CHECKLIST.md` | Cases TLS/`service_role`/CI cochées ; commandes Stories ajoutées ; bucket et RLS cible restent ouverts | La checklist ne reflétait pas l'état déployé `cca3a58` | `203fd1a`, migration `081` | Revue des commandes dans `package.json` |

### Validation du lot 3

- `npm run test:stories-audience` : 26 vérifications, base locale migrée `081`.
- `npm run test:stories-postgres` : 47 vérifications.
- `npm run test:media-security` : 36 vérifications.
- `npx tsc --noEmit` : 0 erreur après le correctif.
- `db:schema-contract:remote` : contrat respecté ; `/api/ready` 200,
  `schemaMatches=true`.
- `db:tls-audit:remote` : `verify-full`, `SET ROLE service_role` refusé.
- Aucun commit, push ou déploiement effectué dans ce lot documentaire ; le code
  média est déjà dans `bab3010`, déployé par `cca3a58`.

## 2026-11-15 — Lot 4 : politique T&S, hors-ligne et charge

| Fichier | Changement | Raison | Preuve | Validation |
|---|---|---|---|---|
| `components/AdminPolicy.tsx`, `app/api/admin/policy/route.ts` | Éditeur de politique versionnée : lecture modération, publication owner/admin, transaction unique, audit, cache invalidé | La politique ne changeait que par migration, alors que la console la lisait déjà | `/admin/policy`, `moderation_policy_versions` | `test:trust-safety-http` 75/75 ; axe desktop 1440 et mobile 390 ; `test:admin-modules` 19/19 |
| `lib/offline-queue.ts`, `components/OfflineBanner.tsx` | File IndexedDB, rejeu idempotent, `23505` traité comme succès, rejeu au retour réseau et toutes les 30 s | Les écritures hors-ligne échouaient sans reprise | IndexedDB `devnet-offline-writes`, `OFFLINE_MUTATION_SENT_EVENT` | Lecture du code ; limite : pas de `fake-indexeddb` |
| `public/sw.js`, `components/OfflineVideoButton.tsx` | Téléchargement vidéo explicite, réponse `Range` depuis le cache (206/416), TTL de 7 jours | Les vidéos n'étaient pas consultables hors-ligne et les lectures pouvaient rester indéfiniment périmées | `devnet-pwa-v7`, `OFFLINE_DATA_TTL_MS` | `test:pwa` 215 ; `node --check public/sw.js` |
| `app/api/ready/route.ts` | Sonde base mutualisée 15 s, sonde de secours planifiée par `after()` | 1 000 requêtes concurrentes saturaient le pool et le health check payait 1,5 s | `READINESS_TTL_MS`, `after` | `test:load` 1 000 req/100, 0 échec ; `/api/ready` p95 541 à 634 ms à chaud |
| `scripts/test-load.ts`, `package.json` | Test de charge mesuré (p50/p95/p99, débit, échecs) | Aucune mesure reproductible de charge n'existait | `npm run test:load` | `/login` p95 1 965 ms ; `/api/ready` p95 541 à 634 ms ; première rafale à froid ~3,4 s |

### Validation du lot 4

- `npm run test:trust-safety-http` : **75/75**.
- `npm run test:admin-modules` : **19/19**.
- `npm run test:boundaries` : **349/349** ; `npm run test:pages` : 30/30.
- `npm run test:pwa` : **215** ; `npm run verify:ui` : cliquet tenu, 491 valeurs arbitraires pour un plafond de 493.
- `npx tsc --noEmit` et `npm run build` : verts.
- Production : `85c01de`, déploiement `devnet-e8gw42pan` ; `/api/ready` 200,
  `schemaMatches=true` après la sonde de secours, `/api/admin/policy` sans
  session → 401.

## À ne pas oublier

- Ne pas consigner les valeurs de `DATABASE_URL`, même masquées, dans ce
  journal.
- Ne pas marquer une correction `VERIFIED` sur la seule lecture du code.
