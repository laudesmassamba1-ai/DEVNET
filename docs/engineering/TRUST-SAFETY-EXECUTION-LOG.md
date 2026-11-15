# Trust & Safety — registre d'exécution

Date : 2026-11-15  
Branche : `feature/status-editor-liquid-glass`  
Périmètre : intégration réelle du Trust & Safety dans DevNet, sans doublon, avec preuves.

## 1. Audit initial

| Élément | État constaté | Décision |
| --- | --- | --- |
| `lib/moderation/text.ts`, `image.ts` | Moteurs texte et image existants | Conservés, réutilisés par la couche politique |
| File de modération 073, `/admin/moderation`, `/api/admin/reports` | Existaient déjà | Non dupliqués ; les dossiers 076 s'y rattachent par la cible |
| `db/migrations/075_trust_safety_core.sql` | Socle rôles, blocages, sourdines, sanctions, recours | Conservé et appliqué |
| `db/migrations/076_trust_safety_policy_cases.sql` | Policy Engine, dossiers, constats, preuves, paramètres, notifications | Audité, appliqué, connecté |
| `lib/trust-safety/policy.ts` | Décision versionnée, aucun auto-ban / auto-remove | Conservé |
| `lib/trust-safety/engine.ts` | Orchestrateur texte, liens, secrets, comportement, média | Branché aux écritures |
| `lib/trust-safety/cases.ts` | Backend du centre humain (liste, détail, décision, note) | Exposé par API et écran |
| `lib/trust-safety.ts` (fichier plat) | Doublon exact de `core.ts` | Supprimé ; imports pointés vers `core.ts` |

## 2. Livré et connecté

### Socle et comptes

- Migration 075 : `moderation_roles`, `user_blocks`, `user_mutes`, `user_sanctions`, `sanction_appeals`, RPC, RLS, triggers, séparation du réviseur.
- Façade serveur unique `lib/trust-safety/core.ts` ; toutes les actions utilisateur passent par `withUser`.
- Blocage et sourdine filtrés dans le fil (`postgres-feed-repository.ts`), y compris « pour toi ».
- Sanctions graduées, levée, recours et révision par un autre modérateur.

### Centre de décision humaine

- `app/api/admin/cases/route.ts` : overview (politique active, compteurs, moteurs, dossiers récents) et liste filtrée.
- `app/api/admin/cases/[id]/route.ts` : détail, décision motivée, suppression optionnelle avec preuve, assignation, note.
- `components/AdminCases.tsx` et module admin `Dossiers` (`/admin/cases`, 18 modules au total).
- Aucun contenu complet n'est affiché : moteur, catégorie, gravité, score, règle, preuves conservées.

### Paramètres de protection

- `GET/PATCH /api/protection/settings` et `components/SafetySettingsForm.tsx`.
- Qui peut écrire / commenter / mentionner (`everyone`, `followers`, `nobody`), filtre offensant, médias sensibles, 100 mots masqués maximum.
- Lien depuis `Réglages → Sécurité` vers `/settings/protection`.

### Signalement des stories et messages privés

- Le lecteur de story expose `Signaler cette story` (`StoryViewerLive.tsx`), avec l'auteur réel pour empêcher l'auto-signalement.
- La bulle de message privé expose `Signaler ce message privé` (`app/messages/page.tsx` via `MessageExtras`).
- La 076 accepte les deux colonnes, déduit `target_type` et ouvre un dossier par trigger. Le test HTTP insère réellement les deux signalements sous la RLS et vérifie le dossier et son auteur.

### Branchement des moteurs

- REST (`lib/rest/query.ts`) : après insertion d'un post, commentaire ou story, l'analyse politique s'exécute même sans `Prefer: return=representation` ; l'identifiant et l'auteur sont demandés uniquement pour ces tables, jamais rendus au client sans demande.
- Média (`app/api/media/route.ts`) : après stockage, `analyzeMedia` ouvre un dossier à partir de l'empreinte, de l'heuristique et du réencodage ; aucune suppression ni sanction automatique.
- Moteurs effectifs : texte (règles existantes), vision (heuristique image), vidéo (empreinte/vignette/réencodage, pas de classification de contenu), liens, secrets, comportement (volume, ancienneté, signalements).
- Aucune requête sortante pour « vérifier » une URL : le moteur de liens juge la forme et une liste de domaines bloqués (pas de SSRF).

## 3. Preuves exécutées

| Commande | Résultat |
| --- | --- |
| `npm run test:trust-safety-engines` | **13/13** — politique, liens, secrets, aucun auto-ban |
| `npm run test:trust-safety-http` | **75/75** — dont éditeur de politique : lecture, refus 401/403, version invalide, seuils incohérents, publication, audit, `autoRemove`/`autoBan` faux |
| `TS_DATABASE_URL=… npm run test:trust-safety` | **31/31** — PostgreSQL réel, RLS, sanctions, recours, audit |
| `npx tsc --noEmit` | **0 erreur** |
| `npx eslint` (fichiers Trust & Safety) | **0 erreur**, 1 avertissement `set-state-in-effect` dans `AdminCases` (même motif que les écrans admin existants) |
| `npm run test:boundaries` | **342 vérifications** |
| `npm run test:admin-modules` | **18 modules** avec route et statut |
| `npm run test:moderation` | **29 vérifications** |
| `npm run test:api-feed` | Route du fil vérifiée après modification REST |
| `npm run test:media-security` | Signatures et adresses de médias cohérentes |
| `npm run test:auth-oauth` | **31 vérifications** après correction du droit au recours |
| `npm run test:trust-safety-http` | **59/59** — Next réel, sessions, 401/403, paramètres, dossiers, décision, story, message privé, notifications, navigateur desktop/mobile et axe |

Contrôles SQL sur PostgreSQL 15 local (`ts-a`, 79 migrations) :

```text
policies=1
policy_active=2026.11.1
cases=0
settings=13
issue_sanction: (uuid, text, text, text, integer, uuid, text[])
```

RPC `set_safety_settings` avec identité réelle :

```text
before=everyone:everyone:true:
after=followers:false:spoiler
persisted=followers:false:spoiler
```

## 4. Décisions de sécurité et de confidentialité

- Une machine ne supprime pas et ne bannit pas : `autoRemove` et `autoBan` sont forcés à `false` même si une politique malformée les active.
- Un constat `hold` empêche la publication et ouvre un dossier ; un `review` publie et ouvre un dossier. Un humain décide.
- Les secrets ne sont jamais recopiés : seule la famille et la longueur sont conservées.
- Les preuves de contenu supprimé sont des copies avec empreinte SHA-256, jamais exposées dans la liste.
- La RLS et `withUser` restent les seules voies des actions utilisateur ; les écritures de modération vérifient le rôle en base avant d'utiliser le pool propriétaire.
- Un recours ne peut pas être révisé par l'auteur de la sanction (contrainte base).
- **Blocage de connexion volontairement non appliqué à l'authentification** : `is_login_blocked()` existe et la session n'est plus invalidée sur sanction. Un compte suspendu peut se connecter pour déposer un recours, mais les triggers refusent toute publication. Le blocage total reste réservé à une future session restreinte (lecture + recours uniquement).

## 5. Dépendances externes réellement manquantes

| Dépendance | Conséquence | État |
| --- | --- | --- |
| Fournisseur IA texte/image | Pas de classification sémantique au-delà des règles locales | Non configuré, aucun faux moteur créé |
| `ffmpeg` / worker vidéo | Pas de transcodage serveur ni d'analyse audio/vidéo | Absent sur Vercel ; repli client existant |
| OCR / ASR | Pas d'analyse du texte incrusté ou de la parole | Non configuré |
| Fournisseur email/push transactionnel | Notifications de sanction/recours uniquement en base | Non configuré |
| MFA / 2FA | Comptes protégés par mot de passe et limites de tentatives seulement | Non implémenté |
| Application des migrations en production | 075 à 079 appliquées sur `devnet_migtest` et sur Neon `neondb` | **Vérifié le 2026-11-15** |

## 6. Non fait / limites assumées

- Éditeur de politique livré (`/admin/policy`) : publication par les rôles owner/admin, nouvelle version à chaque changement, audit et invalidation du cache. `autoRemove` et `autoBan` restent forcés à `false`.
- Les routes `cases`, `settings` et `policy` ont un test HTTP réel (`test:trust-safety-http`) ; la revue visuelle navigateur couvre les quatre écrans.
- Les cibles `story` et `direct_message` sont exposées dans le lecteur de story et la bulle de message privé ; leur ingestion est prouvée jusqu'au dossier.
- Les notifications `moderation` et `appeal` ont un libellé, une icône et un lien vers la protection ; aucun test HTTP dédié aux notifications n'existe encore.
- La classification vidéo se limite à l'empreinte et au réencodage, sans analyse du contenu.
- Les métriques de délai et de taux de recours sont calculées, mais leur historique n'est pas encore représenté graphiquement.

## 7. Rejeu et nettoyage

```bash
# moteurs et politique (sans base)
npm run test:trust-safety-engines

# intégration PostgreSQL (base jetable ts-a, port 55443)
TS_DATABASE_URL=postgresql://postgres:test@localhost:55443/devnet npm run test:trust-safety

# parcours HTTP réel (démarre Next sur un distDir isolé)
npm run test:trust-safety-http

# vérifications statiques et frontières
npx tsc --noEmit
npm run test:boundaries
npm run test:admin-modules
```

Le conteneur `ts-a` est laissé en place pour rejouer les preuves ; `docker rm -f ts-a` après validation.

## 8. Clôture vérifiée du 2026-11-15

Cette section corrige les états provisoires des sections 3 et 5.

- Migrations **075, 076, 077, 078 et 079** appliquées sur
  `devnet_migtest` et sur Neon `neondb`. La 079 ajoute `actor_ref` et
  recalcule la chaîne une fois : l'ancienne règle hachait `actor_id`,
  qu'une suppression de compte pouvait mettre à `null`.
- `test:trust-safety` : **31/31**. `test:trust-safety-engines` :
  **13/13**. `test:trust-safety-http` : **59/59**.
- Autres preuves : auth 35/35, passerelle 51/51, admin 18/18,
  frontières 342/342, signalements 32/32, modération 29/29, médias 34/34.
- `npx tsc --noEmit`, `npm run build`, `npm run verify:ui` propres.
  Cliquet : 489 valeurs arbitraires, 9 fichiers > 800 lignes.
- La connexion n'est pas bloquée par une sanction : le compte peut lire
  et déposer un recours, les triggers refusent l'écriture. Le signal
  `is_login_blocked()` reste disponible pour la console.
- Le filtre de médias sensibles est relié à la lecture : un compte qui a
  activé `hide_sensitive_media` reçoit un visuel de remplacement, pas les
  octets. Les autres comptes ne sont pas affectés.
- Revue visuelle navigateur des trois écrans T&S : faite, puis étendue à `/admin/policy`.
  Restent bloqués : fournisseur IA image/audio, email/push, Systalink.

### Livraison production

- Code poussé sur `feature/status-editor-liquid-glass` : `ab39d33`, puis
  `79aeda8` pour le cron. Déploiement Vercel de production aliasé sur
  `https://devnet-brown.vercel.app`.
- `/api/ready` : **200**, `database=ok`, latence **101 ms** ; `/login`,
  `/feed` et `/settings/protection` : **200**. Les routes
  `/api/protection/settings`, `/api/admin/cases` et `/api/admin/sanctions`
  répondent **401** sans session.
- Base servie (Neon `neondb`) : **80** entrées `schema_migrations`,
  **8** tables Trust & Safety, politique active `2026.11.1`,
  43 lignes de paramètres. Aucune migration en attente.
- Contrainte Vercel Hobby : la sentinelle ne peut pas tourner toutes les
  30 minutes. Elle est planifiée **quotidiennement à 03:30** (`79aeda8`),
  après la purge média ; une cadence de 30 minutes exigerait un plan
  supérieur ou un ordonnanceur externe.

## 9. Assurance légère et contrats

- `npm run assurance` déclare les capacités sans simuler de fournisseur :
  texte, image, liens, secrets et comportement en local ; notifications
  in-app ; audio, MFA et IA externe absents ; l'email reste limité à la
  réinitialisation de mot de passe. `ffmpeg` est signalé
  serveur quand il est présent, sinon le transcodage client reste le repli.
- `db:schema-contract` vérifie la base active, sans attendre la secours :
  `/api/ready` peut donc répondre `activeSchema: ok` même quand
  `schemaMatches` vaut `null`.
- `db:tls-audit:remote` force `verify-full` et tente `SET LOCAL ROLE
  service_role`. Résultat : TLS vérifié, rôle non assumable.
- Le test HTTP est passé à **59/59** : notifications REST, révocation par un
  second administrateur, captures desktop/mobile et axe.
