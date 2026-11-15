# DEVNET — registre central d’exécution

> Dernière mise à jour : 2026-11-15. Référence Git : `1916a48` sur
> `feature/status-editor-liquid-glass` ; code déployé `1916a48`.
> Déploiement de production : `devnet-289pyzuvu` sur
> `https://devnet-brown.vercel.app`. Les sections historiques peuvent citer
> des commits ou des fournisseurs qui ne sont plus la cible.
>
> Ce registre est la source de vérité de l’exécution. Une tâche n’est
> `VERIFIED` que si le code est présent **et** qu’un contrôle reproductible
> a été exécuté après la modification. Les éléments qui exigent un accès
> externe (production, console du fournisseur, secrets, iPhone physique)
> sont `BLOCKED_EXTERNAL` et ne sont jamais présentés comme terminés.
>
> Ne jamais recopier un secret dans ce fichier. Les valeurs d’environnement
> sont citées par leur nom uniquement.

## 1. Statuts

| Statut | Sens |
|---|---|
| `OPEN` | Constat reproductible, aucune correction commencée. |
| `IN_PROGRESS` | Correction commencée, non encore prouvée. |
| `FIXED_UNVERIFIED` | Code modifié, contrôle final pas encore exécuté. |
| `VERIFIED` | Code modifié et contrôle reproductible exécuté avec succès. |
| `BLOCKED_EXTERNAL` | Nécessite un accès, un secret, une décision ou un appareil hors de portée locale. |
| `WONT_FIX_JUSTIFIED` | Décision explicite de ne pas modifier, avec justification écrite et risque accepté. |

## 2. Décisions de gouvernance

| ID | Décision | Justification |
|---|---|---|
| DEC-001 | La direction artistique réelle du dépôt reste **Encre / Papier / Savane / Savane clair**. | Les quatre thèmes sont implémentés et testés dans `app/globals.css`. Le nom « Liquid Ivoire » de la skill est une intention de référence, pas une instruction de remplacer les thèmes existants. Le README décrit désormais la DA réelle. |
| DEC-002 | Aucun second système Stories n’est créé. | `modules/stories`, `lib/stories.ts`, `StoryViewerLive`, `StoryRail` et `StoryStudio` sont les frontières existantes. Toute correction passe par elles. |
| DEC-003 | Les migrations additives sont préférées aux réécritures. | Le dépôt est déjà migré en production ; une migration doit rester rejouable et documenter son rollback. |
| DEC-004 | Les secrets, la production et les consoles externes ne sont pas touchés. | Autorisation limitée aux modifications locales non destructives. |
| DEC-005 | Le cliquet UI reste un plafond, pas une permission d’ajouter des valeurs arbitraires. | La passe précédente a réduit 2315 → 1124 valeurs arbitraires et 206 → 115 textes < 12 px. Le seuil `docs/ui/ratchet.json` ne doit jamais remonter. |

## 3. Sécurité et base de données

| ID | Prio | Exigence | Preuve / état | Prochaine action | Statut |
|---|---|---|---|---|---|
| SEC-001 | P0 | Faire tourner le mot de passe PostgreSQL exposé et révoquer les sessions. | Le secret n’est pas dans le dépôt ; aucune valeur affichée. La rotation exige la console du fournisseur. | Procédure ops dans le ledger de remédiation ; vérifier `/api/ready` après rotation. | `BLOCKED_EXTERNAL` |
| SEC-002 | P0 | `FIXED_UNVERIFIED`| `roles.sql` idempotent, `service_role` retiré du grant runtime ; bootstrap distant tenté et migrations 066-070 appliquées, mais `devnet_u` n’a pas `ADMIN OPTION` (`SET ROLE service_role` réussit encore).| Ticket fournisseur / rôle admin pour exécuter le `REVOKE` et prouver le refus de `SET ROLE`.| `FIXED_UNVERIFIED` |
| SEC-003 | P1 | TLS `verify-full` effectif vers la base distante. | `platform/infrastructure/postgres/tls.ts` implémente `verify-full` avec `DATABASE_CA_CERT`, mais le CA du fournisseur n’est pas disponible ici. | Renseigner le CA dans l’environnement, puis `npm run db:probe:remote` doit afficher `verified`. | `BLOCKED_EXTERNAL` |
| SEC-004 | P0 | Un média privé ne doit pas être lisible par un tiers. | Migration `067_media_privacy.sql` et route média avec identité ; la migration n’est pas appliquée à la production dans cette passe. | Appliquer la migration en préproduction, exécuter le test négatif participant/tiers. | `FIXED_UNVERIFIED` |
| SEC-005 | P1 | Le média d’une story expirée ne doit pas rester en cache. | En-têtes `private, no-store` dans la route story. | Contrôle d’en-têtes après déploiement. | `VERIFIED` |
| SEC-006 | P1 | Refuser les URLs de story non possédées ou non autorisées. | `lib/story-media-url.ts`, tests média. | Maintenir le test dans `test:media-security`. | `VERIFIED` |
| SEC-007 | P1 | Le type média doit venir des octets, pas du `Content-Type`. | `lib/media-signature.ts` + `sharp`. | Maintenir le test HTML renommé. | `VERIFIED` |
| SEC-008 | P2 | Les nouveaux documents d’ingénierie doivent être suivis. | `.gitignore` ciblé. | `git check-ignore` sur ce fichier doit être vide. | `VERIFIED` |
| SEC-009 | P2 | Pas de proxy local `127.0.0.1:54321` en production. | Réécritures conditionnées par `NODE_ENV`. | Contrôle build production. | `VERIFIED` |
| SEC-010 | P3 | HSTS présent. | `next.config.ts`. | Contrôle d’en-têtes. | `VERIFIED` |
| SEC-011 | P1 | Limitation de débit partagée entre instances. | Aucun stockage partagé (KV/Redis) n’est configuré. Un compteur mémoire serait faux en serverless. | Fournir un KV/Redis, puis brancher un limiteur sur auth, média et stories. | `BLOCKED_EXTERNAL` |
| SEC-012 | P1 | `FIXED_UNVERIFIED`| HEAD + Range vérifient taille/signature avant enregistrement ; objet refusé supprimé. Aucun test contre R2 réel (credentials absents).| Fournir R2/Blob et exécuter le parcours multipart réel.| `FIXED_UNVERIFIED` |
| SEC-013 | P1 | Les chemins média internes doivent être acceptés par les contraintes. | Migration `068_media_relative_urls.sql`. | Test SQL sur base neuve. | `VERIFIED` |
| SEC-014 | P1 | Un chemin média d’autrui ne doit pas être cité pour obtenir l’accès. | `enforce_media_owner()` et test négatif. | Maintenir le test SQL. | `VERIFIED` |
| SEC-015 | P1 | Le média de story doit respecter l’expiration et la session. | `media_file_is_private` étendue aux stories. | Test SQL anon/participant/expiré. | `VERIFIED` |

## 4. Médias et fiabilité

| ID | Prio | Exigence | Preuve / état | Prochaine action | Statut |
|---|---|---|---|---|---|
| MEDIA-001 | P1 | Sortir les octets média de PostgreSQL/BYTEA. | Architecture cible documentée ; le stockage objet est optionnel et les clés R2 ne sont pas disponibles. | Configurer R2, exécuter le chemin multipart réel, migrer les lignes existantes par lots. | `BLOCKED_EXTERNAL` |
| MEDIA-002 | P1 | ffmpeg borné (timeout, logs, SIGKILL, nettoyage). | Implémenté dans `story-media.ts`. | Maintenir le test média. | `VERIFIED` |
| MEDIA-003 | P1 | `VERIFIED`| Migration 069, route cron `CRON_SECRET`, script `purge-media` ; test SQL distant/local `purge_expired_stories(24)` 1 puis 0.| Maintenir le job planifié en production.| `VERIFIED` |
| MEDIA-004 | P2 | `VERIFIED`| `lib/metrics.ts` émet `[metric]` JSON ; `app/api/media/route.ts` compte `media.storage.fallback_total` (unconfigured/provider_error) et `lib/media-storage.ts` compte `media.storage.provider_total` (r2/vercel_blob). `tsc`/build verts.| Brancher un log drain/collecteur pour alerter sur les replis.| `VERIFIED` |
| MEDIA-005 | P2 | Un média interne doit rester publiable sans R2. | Chemin résolu et contrôlé. | Maintenir `test:media-security`. | `VERIFIED` |

## 5. Stories

| ID | Prio | Exigence | Preuve / état | Prochaine action | Statut |
|---|---|---|---|---|---|
| STORY-001 | P1 | Durée réelle, pause onglet caché, `aria-live`, avatars réels, clavier/stickers. | Corrections présentes dans `StoryViewerLive.tsx`. | Étendre `tests/e2e/stories.spec.ts`. | `VERIFIED` |
| STORY-002 | P2 | `VERIFIED`| `lib/story-playback.ts` (machine `loading/ready/unavailable`, `paused`, `hidden`) intégrée à `StoryViewerLive` ; `scripts/test-story-playback.ts` 8 transitions vertes, `test:story-playback` en CI.| Étendre si de nouveaux états lecteur apparaissent.| `VERIFIED` |
| STORY-003 | P0 | `VERIFIED`| Migration 070 appliquée (local/distant), policies audience, API média, sélecteur `StatusComposer`/`StoryStudio` ; `test:stories-audience` 12/12, e2e audience vert.| Maintenir les tests négatifs à chaque évolution.| `VERIFIED` |
| STORY-004 | P2 | `VERIFIED`| `fetchLiveStories` rend `null` sur erreur ; appelants gèrent la panne. `tsc` 0.| —| `VERIFIED` |
| STORY-005 | P2 | `VERIFIED`| Curseur `(created_at,id)` dépôt/API ; test 61 stories, 2 pages, 0 doublon.| —| `VERIFIED` |
| STORY-006 | P1 | `FIXED_UNVERIFIED` | Plafond de transcodages vidéo simultanés (2 par instance, refus immédiat) dans `story-media.ts`. `test:story-transcode` 2/2, `tsc` 0. Pas de charge réelle ffmpeg.| Mesurer sous charge sur déploiement de test.| `FIXED_UNVERIFIED` |
| STORY-007 | P2 | `FIXED_UNVERIFIED` | Visionneuse : appui maintenu sur les zones latérales met en pause ; `onPointerCancel` ; pas de menu d'enregistrement iOS sur le média (`.story-stage` `touch-callout: none`). Commit `745903f` : la `<video>` s'arrête aussi (appui, réponse, vues, plateau, onglet masqué), ce qui n'était pas le cas avant. `tsc`, eslint, `ux:check` tenu. Pas de compte de test : pas de rendu navigateur.| Vérifier sur Chromium émulé avec compte de test, puis iPhone réel.| `FIXED_UNVERIFIED` |
| STORY-008 | P1 | `VERIFIED` | Migration `081` : `can_read_media_file` applique l'audience, l'expiration et l'auteur du média ; `media_path_of` extrait le chemin exact sans joker ; trigger `enforce_media_owner_stories`. Preuves : `test:stories-audience` 26/26, `test:media-security` 36/36, `test:stories-postgres` 47/47, contrat de schéma et `/api/ready` verts. Appliquée en local et sur Neon. | Test HTTP multi-comptes des deux routes de média ; bucket privé pour les URL objet publiques. | `VERIFIED` |

## 6. UI/UX, accessibilité et PWA

| ID | Prio | Exigence | Preuve / état | Prochaine action | Statut |
|---|---|---|---|---|---|
| UI-001 | P2 | `VERIFIED`| Avertissements `StoryViewerLive` supprimés ; lint global à 0 erreur / 2 avertissements préexistants hors périmètre.| —| `VERIFIED` |
| UI-002 | P3 | `VERIFIED`| `eslint-disable` de fichier retiré de `lib/rest/client.ts` ; dérogation `DynamicRow` isolée/documentée, `RealtimePayload`/handlers typés, callbacks realtime/broadcast ajustés (`useTyping`). `tsc` 0, build vert.| Réduire `DynamicRow` par écrans typés quand le schéma est stabilisé.| `VERIFIED` |
| UI-003 | P2 | `IN_PROGRESS`| Textes < 12 px 108→0, valeurs arbitraires 1113→491, `ux:scan`/`ux:check` et cliquet mis à jour. Restent 491 arbitraires (découvrir/profil/IDE en priorité).| Continuer la réduction par écran sans remonter le cliquet.| `IN_PROGRESS` |
| UI-004 | P1 | `VERIFIED`| 5 destinations mobiles, Découvrir dans la feuille Plus ; `test:navigation` 173/173, layout 6/6.| —| `VERIFIED` |
| UI-005 | P1 | Clavier iOS : champs visibles, pas de zoom involontaire, safe areas. | `test:pwa` couvre 175 vérifications ; pas d’iPhone physique. | Maintenir le test et vérifier sur appareil réel quand disponible. | `VERIFIED` (émulation) |
| UI-006 | P1 | `VERIFIED`| Playwright 320/360/390/430/768/1024 × 12 écrans : 6/6.| —| `VERIFIED` |
| UI-007 | P1 | Accessibilité : focus, contrastes, cibles 44 px, labels. | Corrections précédentes sur groupes/communautés/projet. Lot 2026-11-15 : bouton sans type, clics non sémantiques (IDE, story), 8 autoFocus, 1 couleur en dur ; cliquet abaissé à 0/0/0/0/1. | Audit clavier sur les écrans prioritaires ; couleur restante = logo (artwork). | `FIXED_UNVERIFIED` |
| UI-008 | P2 | Mouvement réduit et performance perçue. | `ui:motion` et `test:motion` verts. | Maintenir ; pas de nouvelle animation non justifiée. | `VERIFIED` |
| UI-009 | P2 | Thème Liquid Glass activable (`data-liquid="true"`, clé `devnet:liquid-glass`), par-dessus les quatre thèmes, sans refonte. Interrupteur dans Réglages. | Code dans `ac818b9` (poussé) : `app/globals.css` bloc « THÈME LIQUID GLASS », `lib/ui-preferences.ts`, `app/layout.tsx`, `components/LiquidGlassToggle.tsx`, `app/settings/page.tsx`. `test:liquid-glass` 4/4 (`39b2f5a`), `tsc` 0, build 0. Note : le message de `ac818b9` ne décrit pas ce thème ; `f0ea251` mentionne « Liquid-tokens », libellé erroné. | Vérifier le rendu dans un navigateur (les quatre thèmes, interrupteur on/off, `prefers-reduced-transparency`) avec compte de test. | `FIXED_UNVERIFIED` |

## 7. Architecture, QA et documentation

| ID | Prio | Exigence | Preuve / état | Prochaine action | Statut |
|---|---|---|---|---|---|
| ARC-001 | P2 | Découper les gros composants (feed, messages, lecteur). | Extractions `lib/feed-composer.ts`, `lib/feed-posts.ts`, `lib/conversations.ts`, `lib/story-viewer.ts`, `components/StoryStickerFace.tsx` ; imports ajustés. `tsc` 0, build/lint/e2e ciblés verts. | Poursuivre le découpage par responsabilités (état/rendu/actions) avec tests avant/après. | `IN_PROGRESS` |
| QA-001 | P1 | CI : types, lint, build, tests média/UI. | `ci.yml` exécute `tsc`, média, UI, lint, build. | maintenir. | `VERIFIED` |
| QA-002 | P1 | CI avec PostgreSQL de service pour RLS/migrations/stories. | Job PostgreSQL en CI ; validations locales/base de test exécutées (migrations, RLS, Stories, audience, playback). Le job GitHub n’a pas tourné dans cette passe. | Vérifier le job `database` vert sur GitHub après push. | `FIXED_UNVERIFIED` |
| QA-003 | P2 | Parcours Playwright éditeur/lecteur. | `tests/e2e/stories.spec.ts` (rail/lecture/vues/GIF/audience/clavier) et `tests/e2e/editor.spec.ts` verts sur port dédié ; layout 6/6. | Ajouter d’autres parcours éditeur/lecteur si besoin. | `VERIFIED` |
| QA-004 | P2 | Le test de migrations ne fige pas le nombre de fichiers. | Corrigé dans `scripts/db/test-migrate.ts`. | Maintenir. | `VERIFIED` |
| QA-005 | P2 | Le scanner UI ne porte pas de variables mortes. | Corrigé. | Maintenir. | `VERIFIED` |
| DOC-001 | P2 | Documents d’ingénierie présents et suivis. | Baseline, remédiation, sécurité, média, stories, QA, release. | Maintenir ce registre et la matrice. | `VERIFIED` |
| DOC-002 | P1 | README, textes visibles et documents de référence conformes au code livré. | Base Neon/migrations, push, réglages, `docs-technique.md`, `FONDATIONS.md`, `ARCHITECTURE.md`, `ROADMAP.md` et spécification Stories corrigés ; audit des 37 pages encore partiel. | Poursuivre via `docs/maintenance/DEVNET-CONTENT-AUDIT.md`. | `IN_PROGRESS` |
| DOC-003 | P1 | Inventaire, audit, changelog et point de reprise documentaires persistants. | Quatre fichiers créés sous `docs/maintenance/`. | Maintenir à chaque lot. | `IN_PROGRESS` |
| DOC-004 | P2 | Aucun nom de fournisseur actif erroné dans les documents de référence. | `README.md`, `.env.local.example`, `docs-technique.md` et `docs/ops/failover.md` corrigés pour Neon ; autres documents à auditer. | Auditer les ADR, ops et extensibilité. | `IN_PROGRESS` |

## 8. Blocages externes précis

1. **SEC-001** : rotation du secret PostgreSQL et révocation des sessions — console du fournisseur.
2. **SEC-011** : stockage partagé de compteurs (KV/Redis) — choix et credentials externes.
3. **MEDIA-001** : credentials R2/Blob et migration des octets existants — console de stockage.
4. **MEDIA-002** : bucket privé + URL signées pour les URL objet publiques des stories et messages.
5. **iPhone/Safari physique** : aucun appareil dans cet environnement ; les tests restent en Chromium émulé.

## 9. Règle de clôture

La mission n’est pas terminée tant qu’une ligne est `OPEN`, `IN_PROGRESS` ou
`FIXED_UNVERIFIED`, sauf si elle est requalifiée en `BLOCKED_EXTERNAL` avec
une preuve d’impossibilité locale, ou en `WONT_FIX_JUSTIFIED` avec une
justification écrite. `BLOCKED_EXTERNAL` n’est jamais un succès : c’est une
dette explicite qui doit rester visible.

## 10. État après reprise du 2026-11-14 (cette passe)

> Cette section prévaut sur les statuts des sections 3 à 7 lorsqu’ils
> diffèrent. Chaque ligne doit rester cohérente avec
> `DEVNET-VALIDATION-MATRIX.md`.

| ID | Statut final | Preuve / limite |
|---|---|---|
| SEC-002 | `FIXED_UNVERIFIED` | `roles.sql` idempotent ; bootstrap + migrations 066-070 appliqués sur Systalink, mais `devnet_u` sans `ADMIN OPTION` : `REVOKE/GRANT service_role` refusés, `SET ROLE service_role` réussit encore. |
| SEC-012 | `FIXED_UNVERIFIED` | Multipart vérifié (taille/signature, suppression objet refusé). Pas de test R2 réel. |
| MEDIA-003 | `VERIFIED` | Cron + script + `CRON_SECRET` ; purge idempotente 1→0 prouvée. |
| MEDIA-004 | `VERIFIED` | Métriques structurées `[metric]` : fournisseur choisi et replis PostgreSQL (`unconfigured`/`provider_error`). |
| STORY-002 | `VERIFIED` | Machine d’état lecteur extraite et testée (8 transitions), intégrée, en CI. |
| STORY-003 | `VERIFIED` | Audience public/abonnés/moi côté SQL/API/UI ; e2e audience vert. |
| STORY-004 | `VERIFIED` | Panne distinguée de l’absence (`null`). |
| STORY-005 | `VERIFIED` | Pagination curseur `(created_at,id)`. |
| UI-001 | `VERIFIED` | Lint : 0 erreur, 2 avertissements préexistants hors périmètre. |
| UI-002 | `VERIFIED` | `eslint-disable` fichier retiré ; typage resserré (`DynamicRow` isolé, realtime/broadcast), `tsc` 0. |
| UI-003 | `IN_PROGRESS` | Tiny 0, arbitraires 491 mesurés, plafond 493 (cliquet tenu ; cohérent avec TS-008). Réduction restante à poursuivre. |
| UI-004 | `VERIFIED` | Barre mobile 5 destinations. |
| UI-006 | `VERIFIED` | Matrice responsive 320→1024 (Playwright). |
| ARC-001 | `IN_PROGRESS` | Frontières extraites (feed-composer/posts, conversations + filtre messages, story-viewer/StickerFace) ; refactor structurel plus profond restant. |
| QA-002 | `FIXED_UNVERIFIED` | Job CI ajouté et validations locales équivalentes ; exécution GitHub à confirmer après push. |
| QA-003 | `VERIFIED` | Parcours Playwright lecteur et éditeur verts. |

### Sauvegardes et base distante

- Backup pré-écritures : `devnet-remote-20261114T013251Z.dump.gpg` (SHA `869135…c4402`).
- Backup frais : `devnet-remote-20261114T015347Z.dump.gpg` (68 766 octets, SHA `c85fd28a…c312311`).
- Systalink (historique) : migrations 066-070 appliquées ; bootstrap exécuté.
- Neon `neondb` (cible actuelle, 2026-11-15) : migrations `001` à `081`
  appliquées (81 entrées, aucune en attente hors `081` vérifiée) ; contrat de
  schéma respecté ; `SET ROLE service_role` refusé après `080`.

## 11. Trust & Safety intégré (2026-11-15)

> Cette section prévaut sur les états antérieurs pour les lignes T&S. Elle
> décrit uniquement ce qui est relié à l'application et rejouable.

| ID | Statut | Preuve |
|---|---|---|
| TS-001 | `VERIFIED` | Migrations 075 à 079 appliquées sur `devnet_migtest` et sur Neon `neondb`. |
| TS-002 | `VERIFIED` | `test:trust-safety` 31/31 : rôles, blocage, sourdine, sanction, recours, chaîne d'audit, dossier, retrait, preuve, réglages. |
| TS-003 | `VERIFIED` | `test:trust-safety-engines` 13/13 : politique, insultes, liens, secrets, domaines, peau. |
| TS-004 | `VERIFIED` | `test:trust-safety-http` 75/75 : rôles 401/403/200, réglages, dossier, décision, sanction, signalements story et message privé, notifications, éditeur de politique, navigateur desktop/mobile et axe. |
| TS-005 | `VERIFIED` | `test:auth-postgres` 35/35 et `test:rest-gateway` 51/51 après branchement du filtre entrant. |
| TS-006 | `VERIFIED` | `test:admin-modules` 19/19 : les nouveaux écrans, dont `/admin/policy`, ont une route et un statut. |
| TS-007 | `VERIFIED` | `test:boundaries` 349/349, `test:reports` 32/32, `test:moderation` 29/29, `test:media-security` 36/36. |
| TS-008 | `VERIFIED` | `npx tsc --noEmit`, `npm run build`, `npm run verify:ui` sans erreur ; cliquet 491, 8 fichiers > 800. |
| TS-009 | `VERIFIED` | Revue navigateur desktop 1440 px et mobile 390 px : `axe` sans violation sérieuse, pas de débordement, 75/75. Captures relues, dont `/admin/policy`. |
| TS-010 | `BLOCKED_EXTERNAL` | Analyse sémantique image/audio et email T&S : aucun fournisseur configuré, aucun faux moteur ajouté. Le push Web Push est configuré et un envoi réel a été observé (voir §12) ; il ne remplace pas un email T&S. |
| TS-011 | `BLOCKED_EXTERNAL` | Systalink refuse encore les identifiants (`08P01`) ; la secours Neon pooler protège d'une panne d'endpoint, pas d'une perte de données. |
| TS-012 | `VERIFIED` | `db:tls-audit:remote` : `verify-full` vérifié, `SET ROLE service_role` refusé. |
| TS-013 | `VERIFIED` | `db:schema-contract` local et Neon : tables, colonnes et fonctions T&S complets. |
| TS-014 | `VERIFIED` | `npm run assurance` : `.env.remote` neutralisé, cible distante distincte de la secours, cliquet UI tenu. |
| TS-015 | `VERIFIED` | Capacités déclarées : moteurs locaux, notifications in-app, email limité à la réinitialisation, absence d'IA audio et de MFA non simulée. |
| TS-016 | `VERIFIED` | `test:trust-safety-http` 75/75, `tsc`, `build`, `verify:ui` et `assurance` verts. |
| TS-017 | `VERIFIED` | Éditeur de politique `/admin/policy` : lecture réservée à la modération, publication owner/admin, transaction unique (désactivation + insertion), audit `moderation.policy.publish`, cache invalidé, `autoRemove`/`autoBan` inactivables. `test:admin-modules` 19/19. |

### Correction d'audit 079

La chaîne d'audit hachait `actor_id`, dont la clé étrangère est
`on delete set null`. Supprimer un compte modifiait donc une ligne déjà
hachée et cassait la vérification sans falsification. La 079 fige
`actor_ref` au moment de l'insertion, hache cette copie, puis recalcule
une fois les lignes existantes. Vérification distante : `ok`, 14 lignes.


## 12. PWA, caches et correction média 081 (2026-11-15)

| ID | Statut | Preuve |
|---|---|---|
| PWA-001 | `VERIFIED` | `RouteWarmup` écoute `OFFLINE_CACHE_PURGED_EVENT` et remet à zéro `warmedUsers` + `warmedFor` ; une reconnexion du même compte relance les 12 destinations, pas seulement la purge des caches. |
| PWA-002 | `VERIFIED` | Préchargement centralisé : `prefetch={false}` sur les liens de navigation, pages d'information en liens document. Mesure locale après connexion : **25 requêtes RSC** au lieu de 42, 12 chemins distincts. |
| PWA-003 | `VERIFIED` | Cache initial branché sur le profil, les groupes, les projets et la recherche (`peekCachedQuery` + `cachedQuery`, 60 s). Retour sur ces écrans sans squelette ni « Ouverture de la session » (Playwright, 1280×900). |
| PWA-004 | `VERIFIED` | `/setup` expose la gestion du cache : estimation navigateur, entrées par cache, espace libre, bouton qui supprime uniquement `*-data`, `*-media`, `*-rsc` et conserve pages/coque. |
| PWA-005 | `VERIFIED` | `Inter` passe en `preload: false` ; l'avertissement Next de police préchargée inutilisée a disparu du build. |
| PWA-006 | `VERIFIED` | Push réel : Chrome persistant, permission accordée, abonnement FCM enregistré, `POST /api/push/test` accepté, événement `push` reçu dans le service worker avec le payload `test-push`, 0 erreur de page. Bannière « Activer les notifications » observée après 9 s avec permission accordée et sans abonnement. Limite : pas d'iPhone/Safari physique dans cet environnement. |
| MEDIA-005 | `VERIFIED` | Migration `081_story_media_audience.sql` : audience de story appliquée à `can_read_media_file`, extraction exacte `media_path_of`, déclencheur `enforce_media_owner_stories`. Base neuve : 81/81 appliquées. Neon : 81/81. `test:stories-audience` 26/26, `test:media-security` 36/36. |
| UI-010 | `VERIFIED` | `components/GithubPanel.tsx` passe de 1038 à 785 lignes : `ConnectionsSection`, `StatusChip` et `ModeChoice` vivent dans `components/GithubConnections.tsx` (265 lignes). Cliquet UI abaissé de 9 à **8** fichiers > 800 ; `test:boundaries` 345, `test:pages` 30, `test:github-crypto` 9, `test:github-authorize` 4. |
| PWA-007 | `VERIFIED` | `tsc`, `build`, `test:pwa` 215, `test:boundaries` 345, `test:pages` 30, `test:experience` 57, `test:push-notify` 34, `test:trust-safety-http` 59, `assurance`, `verify:ui` verts. Production : `/api/ready` `activeSchema=ok`, `schemaMatches=true`, `/setup` 200 avec panneau cache, `/api/push/subscription` configuré. |

## 13. Hors-ligne, médias et charge (2026-11-15)

| ID | Statut | Preuve |
|---|---|---|
| PWA-008 | `VERIFIED` | File d'écriture IndexedDB (`lib/offline-queue.ts`) : clés déterministes par geste, états absolus, rejeu chronologique sérialisé, `23505` traité comme succès idempotent, erreurs réseau/5xx seules rejouées. Messages, likes et signets s'y branchent ; `OfflineBanner` rejoue au retour réseau et toutes les 30 s. Limite : pas de `fake-indexeddb`, donc pas de test automatisé du navigateur hors-ligne. |
| PWA-009 | `VERIFIED` | Téléchargement explicite d'une vidéo interne (`OfflineVideoButton`) via `MessagePort`. Preuve navigateur : 24 octets mis en cache, puis hors-ligne `Range: bytes=0-3` → **206**, `Content-Range: bytes 0-3/24`, 4 octets lus, 0 erreur de page. Aucun téléchargement tiers. |
| PWA-010 | `VERIFIED` | `/api/offline/routes` renvoie jusqu'à 16 chemins récents sous RLS ; `RouteWarmup` les précharge après 2,8 s, jamais hors-ligne, en économie de données ou en 2G lente. |
| PWA-011 | `VERIFIED` | Les lectures API hors-ligne expirent après 7 jours (`OFFLINE_DATA_TTL_MS`) ; le service worker refuse une entrée plus vieille et `/setup` affiche la date limite des caches `-data`. |
| LOAD-001 | `VERIFIED` | `npm run test:load` : 1 000 requêtes, concurrence 100, 0 échec. `/login` p95 **1 965 ms**, `/api/ready` p95 **541 à 634 ms** à chaud. `/api/ready` mutualise la sonde base 15 s et planifie la sonde de secours avec `after()`, jusqu'au budget complet de 7 s pour que l'empreinte soit réellement écrite. Limite honnête : la première rafale sur une instance froide atteint p95 ~3,4 s. |
