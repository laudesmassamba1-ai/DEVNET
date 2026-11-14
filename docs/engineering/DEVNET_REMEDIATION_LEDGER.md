# DEVNET — registre de remédiation

> Dernière mise à jour : 2026-11-14. Branche `main`, commit de référence
> `d59e225` plus les modifications locales décrites ci-dessous.
> Chaque constat a été **reproduit dans le dépôt** avant d'être marqué
> confirmé. Les éléments qui exigent la production, la console Vercel/Neon ou
> une rotation de secrets restent marqués `bloqué` : ils ne sont pas corrigés
> par du code local.

## Statuts

| Statut | Sens |
|---|---|
| `corrigé` | Le code est modifié et un contrôle a été exécuté. |
| `confirmé` | Reproduit dans le dépôt, correctif non encore livré. |
| `bloqué` | Nécessite un accès, une autorisation ou une décision externe. |
| `hypothèse` | Signalé par un audit antérieur, non reproduit ici. |
| `non reproduit` | Vérifié, ne se produit pas dans l'état actuel. |

## Sécurité et base de données

| ID | Prio | Fichier / zone | Preuve observée | Correction | Test | Statut |
|---|---|---|---|---|---|---|
| SEC-001 | P0 | Secrets d'environnement, historique Git | Un mot de passe PostgreSQL a été signalé comme exposé puis réutilisé. Le dépôt ne contient pas `.env.local` (gitignoré) ; aucune valeur n'est recopiée ici. | Rotation par l'administrateur, révocation des sessions, mise à jour Vercel/CI. Aucune valeur écrite dans le dépôt. | `gitleaks` en CI ; vérifier `/api/ready` après rotation. | `bloqué` (ops) |
| SEC-002 | P0 | `db/bootstrap/roles.sql`, `db/compat/000_compat.sql` | `grant anon, authenticated, service_role to devnet_u` et `service_role … BYPASSRLS` : le rôle applicatif peut endosser un rôle qui contourne la RLS. | Séparer rôle de migration et rôle de runtime ; retirer `service_role` du rôle applicatif ; `NOINHERIT` conservé. | `scripts/test-db-rls.ts` + test négatif `SET ROLE service_role` refusé. | `confirmé` — correction distante requise |
| SEC-003 | P1 | `platform/infrastructure/postgres/tls.ts` | Une URL sans `sslmode` donne `mode=require` avec `rejectUnauthorized:false` : chiffré, mais certificat non vérifié. | `verify-full` avec `DATABASE_CA_CERT` (déjà implémenté) ; exiger le CA en production. | `npm run db:probe -- --env=remote` doit afficher `verified`. | `confirmé` — CA fournisseur requis |
| SEC-004 | P0 | `db/migrations/056_media_files.sql`, `app/api/media/[path]/route.ts` | `media_files_read using (true)` + cache public immuable : une photo de message privé restait lisible par quiconque avait l'URL, même après suppression du message. | Migration `067_media_privacy.sql` : fonctions `media_file_is_private` / `can_read_media_file`, policy par participant ; route lisant avec l'identité de session et `no-store` pour le privé. | `scripts/test-db-rls.ts` (à étendre en staging) ; contrôle manuel 404 pour un non-participant. | `corrigé` (migration à appliquer) |
| SEC-005 | P1 | `app/api/stories/[id]/media/route.ts` | `Cache-Control: private, max-age=86400` : le média survivait dans le cache après l'expiration de la story. | `private, no-store, max-age=0` + type MIME borné à `image/*`/`video/*`. | Inspection des en-têtes ; test d'expiration. | `corrigé` |
| SEC-006 | P1 | `app/api/stories/media/route.ts` | Toute URL `https` était acceptée comme média de story (pixel de suivi, domaine tiers, contenu affiché sous le nom DEVNET). | `lib/story-media-url.ts` : chemin interne possédé par l'auteur, stockage configuré, fournisseurs GIF autorisés ; `http:` limité au local. | `scripts/test-media-security.ts` (14 cas d'URL). | `corrigé` |
| SEC-007 | P1 | `app/api/media/route.ts` | Le type était déduit du `Content-Type` du navigateur ; `sharp` en échec renvoyait le fichier d'origine. | `lib/media-signature.ts` (signature binaire) + décodage `sharp` obligatoire + re-signature après réencodage. | `scripts/test-media-security.ts` ; envoi d'un HTML renommé doit répondre 415. | `corrigé` |
| SEC-008 | P2 | `.gitignore` | `*.md` global masquait tous les nouveaux documents d'ingénierie. | Remplacé par des exclusions ciblées (`/knowledge.md`, `/devnet_status.md`, `/docs-technique.md`). | `git check-ignore -v docs/engineering/…` doit ne rien retourner. | `corrigé` |
| SEC-009 | P2 | `next.config.ts` | Les réécritures `/rest/v1`, `/auth/v1`, `/storage/v1`, `/realtime/v1` visaient `127.0.0.1:54321` **aussi en production**. | Réécritures limitées à `NODE_ENV !== "production"` ; l'application utilise déjà `/api/rest/*`. | Build de production + `curl /rest/v1/` ne doit plus proxifier. | `corrigé` |
| SEC-010 | P3 | `next.config.ts` | Pas de HSTS. | `Strict-Transport-Security: max-age=63072000`. | En-têtes de réponse. | `corrigé` |
| SEC-011 | P1 | Routes API (ensemble) | Pas de limitation de débit applicative globale ; la protection dépend de la plateforme. | À implémenter par route sensible (auth, média, stories) avec un stockage partagé (KV/Redis), pas un compteur mémoire par instance. | Tests de rafale. | `confirmé` |
| SEC-012 | P1 | `app/api/media/multipart/route.ts` | La finalisation ne vérifie ni l'existence ni la signature de l'objet assemblé ; le type déclaré reste la seule preuve. | Vérification par lecture des 64 premiers octets de l'objet public (Range) + refus et nettoyage. | Test avec un faux `contentType` sur un objet HTML. | `confirmé` |

## Médias et fiabilité

| ID | Prio | Fichier / zone | Preuve observée | Correction | Test | Statut |
|---|---|---|---|---|---|---|
| MEDIA-001 | P1 | `db/migrations/051_story_media.sql`, `lib/stories.ts`, `modules/stories/infrastructure/media/story-media.ts` | Médias stockés en `BYTEA`/base64 : corps JSON, limite 4,5 Mo, mémoire serveur, pas de reprise. | Architecture cible documentée (`DEVNET_MEDIA_ARCHITECTURE.md`) : upload direct, finalisation, lecture signée. Migration additive par étapes. | Test de publication vidéo > ancienne limite. | `confirmé` — refonte |
| MEDIA-002 | P1 | `modules/stories/infrastructure/media/story-media.ts` | `spawn("ffmpeg")` sans délai, sans plafond de journaux, sans arrêt du processus. | `STORY_TRANSCODE_TIMEOUT_MS` (90 s), `SIGKILL`, journaux bornés à 8 000 caractères, `-nostdin`, nettoyage `finally`. | `ffprobe`/`ffmpeg` indisponible → erreur métier claire ; vidéo qui patine → « transcodage trop long ». | `corrigé` |
| MEDIA-003 | P1 | `app/api/stories/[id]/media/route.ts` | Média de story servi depuis la base, sans purge : la ligne existe encore après 24 h. | Route refuse déjà l'expiré via la policy ; ajout d'un job de purge idempotent à planifier. | Test d'expiration + purge. | `confirmé` |
| MEDIA-004 | P2 | `app/api/media/route.ts` | Repli silencieux vers la base quand R2/Blob échoue. | Le repli reste explicite et journalisé, mais un média de 4 Mo peut encore atterrir en base sans alerte. | Métrique `media_storage_fallback_total`. | `confirmé` |
| MEDIA-005 | P2 | `lib/stories.ts` | Sans R2, `uploadMedia` rend `/api/media/<chemin>` puis le client exigait `https:` : la publication vidéo échouait. | La route accepte désormais le chemin interne après contrôle de propriété et le résout en URL absolue. | `scripts/test-media-security.ts` + publication de démonstration. | `corrigé` |

## Stories : lecteur et données

| ID | Prio | Fichier / zone | Preuve observée | Correction | Test | Statut |
|---|---|---|---|---|---|---|
| STORY-001 | P1 | `components/StoryViewerLive.tsx` | Durée fixe de 7 s y compris pour une vidéo ; pas de pause sur onglet caché ; pas d'annonce `aria-live` ; avatars sans `avatar_url`. | Durée réelle via `loadedmetadata` + `ended`, pause `visibilitychange`, `aria-live`, garde-fous clavier/stickers, avatars réels. | `tests/e2e/stories.spec.ts` (à étendre) ; vérification manuelle. | `corrigé` (diff local) |
| STORY-002 | P2 | `components/StoryViewerLive.tsx` | Lecteur piloté par plusieurs `useState`/effets, sans machine d'état explicite. | Découper en orchestration / lecture / gestes / rendu média ; états `loading/playing/paused/error`. | Tests de transitions. | `confirmé` — refonte |
| STORY-003 | P0 | `stories` (RLS), `modules/stories` | Aucune politique d'audience (public/abonnés/liste). Toute story vivante est lisible par tout compte authentifié. | Concevoir `audience_policy` côté serveur **et** policies SQL, puis seulement l'UI. Ne pas exposer une UI privée avant. | Tests négatifs A/B/anon. | `confirmé` — bloquant fonctionnalité privée |
| STORY-004 | P2 | `lib/stories.ts` | `fetchLiveStories` avale l'erreur et rend `[]` : une panne ressemble à « aucune story ». | Distinguer `null` (indisponible) de `[]` (vide) dans le contrat. | Test de panne réseau. | `confirmé` |
| STORY-005 | P2 | `modules/stories/infrastructure/postgres/postgres-stories-repository.ts` | Croissance non paginée du fil de stories. | Pagination par curseur (`created_at`, `id`). | Test de 200 stories. | `confirmé` |

## UI/UX, accessibilité, architecture, QA

| ID | Prio | Fichier / zone | Preuve observée | Correction | Test | Statut |
|---|---|---|---|---|---|---|
| UI-001 | P2 | `components/StoryViewerLive.tsx`, `app/settings/page.tsx`, `scripts/ux-scan.mjs` | `npm run lint` : 9 avertissements au départ. | Variables mortes du scanner supprimées, lecture des permissions déplacée dans le callback asynchrone, `liveRegionRef` retiré. | `npm run lint` : **4 avertissements restants**, 0 erreur. | `corrigé partiel` |
| UI-002 | P3 | `scripts/ui-lint.mjs` | 3 contournements `eslint-disable` (client REST). | Justifier ou supprimer chaque dérogation. | `npm run ui:lint`. | `confirmé` |
| UI-003 | P2 | `lib/rest/client.ts`, styles | Tailles de police < 12 px et valeurs arbitraires répétées signalées par les audits précédents. | Inventaire puis tokens ; ne pas remplacer les valeurs de scène média. | `npm run ux:check`, captures 320/390/430. | `confirmé` |
| ARC-001 | P2 | `app/feed/page.tsx` (1 405 l.), `app/messages/page.tsx` (1 426 l.), `components/StoryViewerLive.tsx` (1 332 l.) | Composants à plusieurs responsabilités. | Découper par frontières réelles, avec tests avant/après. | Build + tests existants. | `confirmé` |
| QA-001 | P1 | `.github/workflows/ci.yml` | La CI ne lançait ni `tsc`, ni tests unitaires, ni tests base/RLS. | Ajout de `npx tsc --noEmit` et `npm run test:media-security`. | CI verte sur `main`. | `corrigé` (partiel) |
| QA-002 | P1 | `.github/workflows/ci.yml` | Aucun PostgreSQL de service en CI : RLS, migrations et stories ne sont pas testés. | Ajouter un service `postgres:18` et les scripts `test:db-rls`, `test:stories-postgres`, `test:db-migrate`. | Job CI dédié. | `confirmé` |
| QA-003 | P2 | `playwright.config.ts`, `tests/e2e/` | Couverture limitée ; pas de captures de référence pour l'éditeur et le lecteur. | Ajouter les parcours et captures listés dans `DEVNET_UI_QA.md`. | `npm run verify:ui:browser`. | `confirmé` |
| DOC-001 | P2 | `docs/engineering/` | Documents d'ingénierie exigés absents. | Baseline, registre, modèle de sécurité, architecture média, spec stories, QA UI, checklist de release. | Relecture + `git check-ignore`. | `corrigé` |

## Migrations ajoutées

| Migration | Objet | Rollback |
|---|---|---|
| `067_media_privacy.sql` | Fonctions `media_file_is_private`, `can_read_media_file` ; policy `media_files_read` | `drop policy "media_files_read"` puis recréer `using (true)` ; `drop function` des deux fonctions. Aucune donnée modifiée. |
| `068_media_relative_urls.sql` | `media_url` relatif `/api/media/…` accepté ; déclencheur `enforce_media_owner` ; fonctions média étendues aux stories | Redéfinir les deux fonctions sans la branche `stories`, `drop trigger` des trois déclencheurs, `drop function enforce_media_owner()`, restaurer les contraintes de la 056. Aucune donnée modifiée. |

## Deuxième passe — constats révélés par les tests

| ID | Prio | Fichier / zone | Preuve observée | Correction | Test | Statut |
|---|---|---|---|---|---|---|
| SEC-013 | P1 | `db/migrations/056_media_files.sql` | La contrainte `media_url_https` refusait `/api/media/<chemin>` ; sans R2, l'envoi d'une photo/message échouait en `23514` alors que c'est le repli documenté. | Migration 068 : contraintes acceptant le chemin interne, sur `posts`, `direct_messages`, `group_messages`. | Test SQL sur base neuve : insertion relative acceptée. | `corrigé` |
| SEC-014 | P1 | `media_files`, messages | Un utilisateur pouvait citer `/api/media/<chemin-privé-d'autrui>` dans sa conversation et obtenir l'accès par la policy média (le chemin UUID n'est pas une autorisation). | `enforce_media_owner()` : refus `42501` si le fichier n'appartient pas à l'auteur de la ligne. | Test SQL négatif : C cite le fichier de A → refus. | `corrigé` |
| SEC-015 | P1 | `stories.media_url` + `media_files` | Un média de story servi via `/api/media` était classé public : lisible sans session et après expiration. | `media_file_is_private` inclut les stories ; `can_read_media_file` exige une session et `expires_at > now()`, l'auteur garde l'accès. | Test SQL : anon refusé, participant accepté, expiré refusé, auteur accepté. | `corrigé` |
| QA-004 | P2 | `scripts/db/test-migrate.ts` | Le test attendait « 62 migrations » et la dernière « 062 » alors que le dossier en contient 68 : `test:db-migrate` échouait à chaque ajout. | Assertions sur la sélection, l'ordre et la première migration ; plus de total figé. | `npm run test:db-migrate` vert. | `corrigé` |
| QA-005 | P2 | `scripts/ux-scan.mjs` | `textOf`, `TINY`, `CSS_COLOR` inutilisés. | Supprimés (les variantes globales restent utilisées). | `npm run lint` : avertissements ramenés de 9 à 4. | `corrigé` |

## Ce qui reste bloquant pour la production

1. Rotation effective des secrets exposés et retrait de `service_role` du rôle applicatif (SEC-001/SEC-002).
2. `verify-full` effectif avec le CA du fournisseur (SEC-003).
3. Audience des stories côté serveur **et** RLS avant toute UI privée (STORY-003).
4. Sortie des octets média de PostgreSQL et purge/expiration (MEDIA-001/MEDIA-003).
5. Limitation de débit partagée entre instances (SEC-011) et vérification des objets multipart (SEC-012).
