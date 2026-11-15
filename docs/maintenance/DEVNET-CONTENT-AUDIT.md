# DEVNET — audit du contenu visible

> Dernière mise à jour : 2026-11-15.
> Périmètre : textes rendus par les pages `app/**/page.tsx`, les composants
> partagés et les messages d'erreur. Cet audit ne contient aucune donnée
> privée ni aucun secret.
>
> Statuts : `À AUDITER`, `CORRIGÉ`, `OK`, `CONTREDIT`, `MANQUANT`, `N/A`.
> Une page n'est `OK` qu'après lecture de son rendu et comparaison avec le
> comportement réel, pas seulement parce qu'elle compile.

## 1. Constats globaux

| ID | Constat | Preuve | Statut |
|---|---|---|---|
| COPY-001 | Les réglages annonçaient que les notifications push n'étaient pas configurées alors que le parcours d'abonnement et le test existent. | `app/settings/page.tsx:517-518`, `app/api/push/subscription/route.ts`, `app/api/push/test/route.ts` | CORRIGÉ |
| COPY-002 | Le README annonçait l'absence de notifications push. | `README.md`, routes push et interface de réglages | CORRIGÉ |
| COPY-003 | Le README décrivait une story comme un post publié, alors qu'elle vit dans `stories`. | `lib/stories.ts:23-48`, `db/migrations/018_social_depth.sql:174` | CORRIGÉ |
| COPY-004 | Le README affirmait qu'il n'y avait aucune interface de fondation alors que groupes, projets et GitHub ont des écrans. | `app/groups/[id]/page.tsx`, `app/projects/[id]/page.tsx`, `app/github/page.tsx` | CORRIGÉ |
| COPY-005 | La documentation technique citait encore Supabase, `/extensions` et des variables d'environnement disparues. | `docs-technique.md` avant réécriture | CORRIGÉ |
| COPY-006 | Les nombres de migrations et les instructions d'éditeur SQL étaient périmés. | `README.md`, `db/migrations/` (80 fichiers, `001` à `081` sans `029`) | CORRIGÉ |
| COPY-007 | Le statut de failover décrivait encore Systalink comme base de production/secours. | `.env.local` (hôtes Neon sans secret), `TRUST-SAFETY-STATUS.md`, `docs/ops/failover.md` | CORRIGÉ |
| COPY-008 | Le README et les réglages doivent distinguer « clé absente » de « fonctionnalité absente ». | Audit des libellés push | CORRIGÉ dans les réglages ; à généraliser |
| COPY-009 | L’interface peut laisser croire qu’une story `followers` ou `private` protège aussi son média objet. | `DEVNET_STORIES_SPEC.md` §3 ; migration `081`, `can_read_media_file` | CORRIGÉ — audience, expiration et auteur vérifiés ; 26 tests SQL. Réserve : un média objet à URL publique reste lisible par cette URL. |

## 2. Pages

| Fait | Page | Écran | Statut | Preuve / écart | Prochaine action |
|---|---|---|---|---|---|
| [ ] | `app/page.tsx` | Accueil | À AUDITER | Non comparé au produit | Audit visuel et textuel |
| [ ] | `app/feed/page.tsx` | Fil | À AUDITER | Non comparé | Vérifier compositeur, états vides, erreurs |
| [ ] | `app/decouvrir/page.tsx` | Découverte | À AUDITER | Non comparé | Vérifier promesses et filtres |
| [ ] | `app/search/page.tsx` | Recherche | À AUDITER | Non comparé | Vérifier résultats vides et erreurs |
| [ ] | `app/signets/page.tsx` | Signets | À AUDITER | Non comparé | Vérifier l'état vide |
| [ ] | `app/notifications/page.tsx` | Notifications | À AUDITER | Non comparé | Vérifier le vocabulaire push/email |
| [ ] | `app/communities/page.tsx` | Communautés | À AUDITER | Non comparé | Vérifier les libellés |
| [ ] | `app/communities/[slug]/page.tsx` | Communauté | À AUDITER | Non comparé | Vérifier les permissions affichées |
| [ ] | `app/groups/page.tsx` | Groupes | À AUDITER | Non comparé | Vérifier les états vides |
| [ ] | `app/groups/[id]/page.tsx` | Groupe et canaux | À AUDITER | Interface réelle confirmée | Vérifier textes et accessibilité |
| [ ] | `app/messages/page.tsx` | Messages | À AUDITER | Non comparé | Vérifier confidentialité et erreurs |
| [ ] | `app/post/[id]/page.tsx` | Publication | À AUDITER | Non comparé | Vérifier média et réponses |
| [ ] | `app/u/[pseudo]/page.tsx` | Profil public | À AUDITER | Non comparé | Vérifier données et états privés |
| [ ] | `app/u/[pseudo]/followers/page.tsx` | Abonnés | À AUDITER | Non comparé | Vérifier l'état vide |
| [ ] | `app/profile/page.tsx` | Profil personnel | À AUDITER | Non comparé | Vérifier édition et erreurs |
| [ ] | `app/projects/page.tsx` | Projets | À AUDITER | Non comparé | Vérifier les filtres |
| [ ] | `app/projects/[id]/page.tsx` | Projet | À AUDITER | Non comparé | Vérifier dépôt, notation, fork |
| [ ] | `app/ide/[project]/page.tsx` | IDE | À AUDITER | Non comparé | Vérifier les limites d'exécution |
| [ ] | `app/github/page.tsx` | GitHub | À AUDITER | Route et panneau existent | Vérifier la distinction liaison/import |
| [ ] | `app/github/[owner]/[repo]/page.tsx` | Dépôt GitHub | À AUDITER | Non comparé | Vérifier les états de synchronisation |
| [ ] | `app/preview-code/page.tsx` | Prévisualisation | À AUDITER | Non comparé | Vérifier les avertissements |
| [ ] | `app/stickers/page.tsx` | Stickers | À AUDITER | Non comparé | Vérifier la bibliothèque et les droits |
| [ ] | `app/settings/page.tsx` | Réglages | CORRIGÉ PARTIEL | Texte push corrigé ; reste l'audit complet | Poursuivre section par section |
| [ ] | `app/settings/protection/page.tsx` | Protection | À AUDITER | Trust & Safety récent | Vérifier sanctions, blocages, recours |
| [ ] | `app/admin/page.tsx` | Console admin | À AUDITER | Non comparé | Vérifier les statuts affichés |
| [ ] | `app/admin/[section]/page.tsx` | Sections admin | À AUDITER | Non comparé | Vérifier chaque section |
| [ ] | `app/moderation/page.tsx` | Modération | À AUDITER | Non comparé | Vérifier les files et décisions |
| [ ] | `app/login/page.tsx` | Connexion | À AUDITER | OAuth présent | Vérifier les messages de panne |
| [ ] | `app/register/page.tsx` | Inscription | À AUDITER | Non comparé | Vérifier les règles de mot de passe |
| [ ] | `app/auth/confirmer/page.tsx` | Confirmation | À AUDITER | Non comparé | Vérifier les états expirés |
| [ ] | `app/mot-de-passe-oublie/page.tsx` | Mot de passe oublié | À AUDITER | Non comparé | Vérifier le message sans fournisseur email |
| [ ] | `app/reinitialiser-mot-de-passe/page.tsx` | Réinitialisation | À AUDITER | Non comparé | Vérifier l'expiration du lien |
| [ ] | `app/setup/page.tsx` | Installation | À AUDITER | Non comparé | Vérifier les instructions PostgreSQL |
| [ ] | `app/aide/page.tsx` | Aide | À AUDITER | Non comparé | Vérifier les liens et promesses |
| [ ] | `app/a-propos/page.tsx` | À propos | À AUDITER | Non comparé | Vérifier la description du produit |
| [ ] | `app/cgu/page.tsx` | CGU | À AUDITER | Texte juridique | Ne pas modifier sans décision |
| [ ] | `app/confidentialite/page.tsx` | Confidentialité | À AUDITER | Texte juridique | Vérifier seulement les faits techniques |

## 3. Textes partagés prioritaires

| Fait | Zone | Statut | Prochaine action |
|---|---|---|---|
| [ ] | `components/PwaInstallSection.tsx` et invitation PWA | À AUDITER | Vérifier les promesses d'installation |
| [ ] | `components/NotificationBell.tsx` et centre de notifications | À AUDITER | Vérifier push, email et alertes intégrées |
| [ ] | `components/StoryRail.tsx`, `StoryViewerLive.tsx`, `StoryStudio.tsx` | À AUDITER | Vérifier audience, expiration et média |
| [ ] | `components/StatusComposer.tsx` | À AUDITER | Vérifier la publication réelle |
| [ ] | `components/PostCard.tsx`, `CommentsPanel.tsx` | À AUDITER | Vérifier les actions visibles |
| [ ] | `components/GithubPanel.tsx` | À AUDITER | Vérifier les états de synchronisation |
| [ ] | `components/ProtectionPanel.tsx` | À AUDITER | Vérifier les libellés de sanction |
| [ ] | `components/AppShell.tsx`, `BottomNav.tsx` | À AUDITER | Vérifier la navigation mobile |
| [ ] | Messages d'erreur des routes `/api/**` | À AUDITER | Vérifier qu'aucun secret ni détail SQL ne fuit |

## 4. Règles de correction

1. Une fonctionnalité conditionnée par une variable d'environnement doit être
   annoncée comme « disponible si configurée », jamais comme absente.
2. Un état vide, une panne et un refus de permission doivent avoir trois
   textes distincts.
3. Ne pas promettre une fonctionnalité à venir dans une page produit.
4. Ne pas modifier un texte juridique sans décision explicite.
5. Toute correction de texte doit être reliée à une preuve de code ou à un
   test, et consignée dans le changelog.
