# DEVNET — baseline d'audit

> Établie le 2026-11-14 avant les corrections de cette passe. Les résultats
> ci-dessous sont ceux réellement observés dans cet environnement ; aucune
> commande n'est reportée sans avoir été exécutée.

## 1. Environnement

| Élément | Valeur |
|---|---|
| Branche | `main` |
| Commit examiné | `d59e225` + modifications locales non commitées |
| Node | v22.23.2 |
| Gestionnaire | npm (`package-lock.json`) |
| Next.js | 16.3.8 (App Router) |
| React | 19.2.8 |
| Base locale | Supabase/PostgreSQL sur `127.0.0.1:54322` |
| Base de production | non interrogée pendant cette passe |
| CI | GitHub Actions, Node 22 |

Modifications locales présentes au départ (préservées) :
`components/StoryViewerLive.tsx`, `components/StatusComposer.tsx`,
`components/StoryRail.tsx`, `app/globals.css`, `.github/workflows/ci.yml`.

## 2. Commandes exécutées et résultats

| Commande | Résultat |
|---|---|
| `npx tsc --noEmit` | **0** — aucune erreur |
| `npm run lint` | **0** — 9 avertissements au départ, 4 après corrections |
| `npm run ui:lint` | **0** — aucune régression |
| `npx tsx scripts/test-media-security.ts` | **34 vérifications**, 0 échec (nouveau) |
| `npm run test:pwa` | **175 vérifications** PWA |
| `npm run test:boundaries` | **291 vérifications** de frontières |
| `npm run test:api-stories` | gestes de story validés |
| `npm run test:db-migrate` | **échec au départ** (attendait 62 migrations, 66 présentes) puis vert |
| `npm run build` | **0** — build de production complet |
| Défaut `media_url` relatif | **confirmé** : contrainte `23514` sur `/api/media/…` |
| Migrations sur base neuve | **68/68 appliquées** (schéma complet) |
| `npm run test:db-rls` sur base neuve | **17 vérifications** RLS |
| Test SQL 068 (anon / participant / tiers / story expirée) | **vert** après correction de la fixture |

## 3. Ce qui a été vérifié (et comment)

- **Secrets** : aucun `.env` suivi ; les noms seulement ont été inspectés.
  Aucune valeur affichée. Un secret PostgreSQL signalé comme exposé reste
  traité comme compromis : rotation non réalisable sans accès externe.
- **Rôles PostgreSQL** : `db/bootstrap/roles.sql` et `db/compat/000_compat.sql`
  accordent `anon, authenticated, service_role` à `devnet_u`, et
  `service_role` porte `BYPASSRLS`. Constat confirmé par lecture du SQL.
- **Médias** : `media_files` était lisible par `anon` sans condition
  (`using (true)`) et servi avec un cache immuable. Confirmé dans la 056 et
  la route `/api/media/[path]`.
- **MIME** : `/api/media` classait le fichier d'après `file.type` ; en cas
  d'échec de `sharp`, les octets d'origine étaient conservés. Confirmé.
- **URL de story** : `/api/stories/media` acceptait toute URL `https`.
  Confirmé.
- **ffmpeg** : `spawn` sans timeout ni plafond de journaux. Confirmé.
- **`*.md`** : `.gitignore` ignorait globalement les Markdown. Confirmé par
  `git status` (les nouveaux documents n'apparaissaient pas).
- **Réécritures Next** : `/rest/v1`, `/auth/v1`, `/storage/v1`,
  `/realtime/v1` pointaient vers `127.0.0.1:54321` en production aussi.
- **Média relatif** : le test SQL a reproduit `23514` sur
  `direct_messages.media_url = '/api/media/…'`.

## 4. Limites de la vérification

- **Pas d'iPhone ni d'Android physiques** : les mesures mobiles restent des
  émulations Chromium. Safari iOS réel non testé.
- **Pas de clés R2/Vercel Blob** dans cet environnement : les chemins
  d'upload direct et de multipart sont revus par lecture, pas exécutés.
- **Pas de fuzzing** des décodeurs média.
- **Playwright** n'a pas été relancé dans cette passe ; les tests navigateur
  restent ceux de la CI.
- **Base de production non touchée** : aucune migration distante, aucune
  rotation de secret, aucun déploiement.
- Les policies ont été validées sur une base **neuve** reconstruite depuis
  les migrations, pas sur un clone de production.

## 5. Captures de référence existantes

- `docs/design-captures/` : connexion/inscription 375, 768, 1440, clair/sombre.
- `docs/ui/audit/` : feed, messages, profil, projets, réglages, extensions,
  360 et 1440.

Aucune nouvelle capture n'a été produite : la passe porte sur la sécurité,
les médias et la base, pas sur une refonte visuelle.

## 6. Constats encore à vérifier

- Comportement réel de Safari iOS sur le lecteur de stories (gestes, autoplay,
  plein écran).
- Politique de sauvegarde et de rétention du fournisseur PostgreSQL.
- Qualité du transcodage ffmpeg sur l'environnement serverless cible.
- Contenu réel des objets R2 existants (signature, taille, propriétaire).
- Performance du fil à volume élevé (pagination, index).
