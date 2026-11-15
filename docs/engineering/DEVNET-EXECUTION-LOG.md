# DEVNET — journal d’exécution

> Journal chronologique des actions réellement exécutées. Ce fichier ne
> remplace pas le registre : il raconte ce qui a été fait, dans quel ordre,
> et avec quel résultat. Les commandes sont citées avec leur code de sortie
> lorsqu’il a été observé.

## 2026-11-14 — ouverture de la passe d’exécution intégrale

### 1. Lecture et cadrage

- Lecture intégrale des trois skills :
  - `docs/engineering/DEVNET-ULTIMATE-SKILL.md` (1 260 lignes) ;
  - `docs/engineering/DEVNET-NATIVE-CRAFT-UIUX-SKILL.md` (935 lignes) ;
  - `docs/engineering/DEVNET-CONTINUOUS-EXECUTION-MASTER-SKILL.md` (798 lignes).
- Lecture de `DEVNET_REMEDIATION_LEDGER.md` et `DEVNET_AUDIT_BASELINE.md`.
- Décision : la skill maître orchestre ; en cas de contradiction, l’option
  la plus sûre et la plus cohérente avec l’architecture réelle gagne
  (DEC-001 à DEC-005 du registre).

### 2. État Git et premiers constats

- `git status --short --branch` : `## main...origin/main`, arbre propre au
  début de la passe, commit de référence `380e3f2`.
- `db/bootstrap/roles.sql` : `grant anon, authenticated, service_role to
  devnet_u` — le rôle runtime peut endosser `BYPASSRLS`.
- `app/api/media/multipart/route.ts` : la finalisation insère le média sans
  vérifier l’objet assemblé.
- `db/migrations/018_social_depth.sql` : `stories_read` ne dépend que de
  `expires_at > now()`, sans audience.
- `lib/stories.ts` : `fetchLiveStories` rend `[]` en cas d’erreur.
- `components/BottomNav.tsx` : 6 contrôles mobiles (4 liens + Créer + Plus),
  au-delà de la limite de 5 de la skill UI/UX.
- `.github/workflows/ci.yml` : pas de service PostgreSQL.
- `npm run lint` : 0 erreur, 4 avertissements `react-hooks/set-state-in-effect`
  dans `components/StoryViewerLive.tsx`.

### 3. Registres

- Création de `DEVNET-EXECUTION-LEDGER.md`, `DEVNET-EXECUTION-LOG.md`,
  `DEVNET-EXECUTION-CHECKPOINT.md` et `DEVNET-VALIDATION-MATRIX.md`.
- Les statuts sont volontairement conservateurs : une correction non
  exécutée sur une base réelle reste `FIXED_UNVERIFIED`.

## 2026-11-14 — lot 1 : sécurité runtime, multipart, purge, stories, navigation

### 4. Corrections en cours

- `db/bootstrap/roles.sql` : retrait de l’accord `service_role` au rôle
  runtime, ajout d’un `revoke` idempotent.
- `lib/media-storage.ts` + route multipart : lecture de l’objet assemblé,
  comparaison de taille et de signature binaire, suppression en cas de refus.
- Purge idempotente des stories expirées : route cron protégée + script.
- `lib/stories.ts` : contrat `null` (indisponible) vs `[]` (vide).
- `components/BottomNav.tsx` : cinq destinations mobiles, Découvrir déplacé
  dans la feuille « Plus ».

Les preuves de ces modifications sont consignées dans
`DEVNET-VALIDATION-MATRIX.md` au fur et à mesure des commandes.

### 5. Résultats du lot 1

- `npx tsc --noEmit` : **0**.
- `npm run lint` : **0 erreur**, 2 avertissements préexistants.
- `npm run test:media-security` : **34/34**.
- `npm run test:pwa` : **175/175**.
- `npm run test:navigation` : **173/173**.
- `npm run ui:lint` : aucune régression.
- `npm run ux:check` : cliquet tenu, **108** textes < 12 px et **1 113**
  valeurs arbitraires (amélioration depuis 115/1 124).
- `npm run test:layout` : **6/6** (320, 360, 390, 430, 768, 1024 × 12 écrans).
- `npm run build` : **0**.

### 6. Base neuve et tests PostgreSQL

- Base locale `devnet_ci` recréée sur 54322, **69 migrations** appliquées,
  puis **070_story_audience.sql** : 70/70.
- `npm run test:db-rls` : **17/17**.
- `npm run test:stories-postgres` : **47/47**.
- `npm run test:stories-audience` : **12/12** (public, followers, private,
  anonyme, deux pages de 61 stories sans doublon).
- Test SQL de purge : `purge_expired_stories(24)` supprime 1 story expirée,
  puis 0 au second appel, 0 ligne restante.

### 7. Backup Systalink

- Exécuté avec `npm run db:backup:remote` : cible distante `devnet`,
  lecture seule, host masqué.
- Archive : `devnet-remote-20261114T013251Z.dump.gpg`, 68 765 octets,
  chiffrement GPG AES-256, SHA-256 consigné dans le registre.
- Aucune écriture distante, aucune migration distante, aucun secret affiché.

### 8. Corrections supplémentaires

- Audience des stories : migration 070, policy `stories_read`, fonction
  `story_is_live` étendue aux médias/interactions, UI studio, API média.
- Pagination : curseur `(created_at, id)`, 61e ligne comme preuve de page
  suivante, API `?before=&beforeId=`.
- Barre mobile : 5 destinations ; Découvrir dans la feuille « Plus ».
- Textes < 12 px corrigés dans les états vides, notifications, pied de page,
  notes de Découvrir et barre latérale.
- Lecteur : reset des viewers au clic et de la durée dans `next`/`prev`,
  ce qui supprime les 4 avertissements React.

### 9. Ce qui reste ouvert

Voir `DEVNET-EXECUTION-CHECKPOINT.md` : STORY-002, ARC-001, UI-002,
MEDIA-004, QA-003, UI-003, et les validations externes SEC-002/SEC-003/
SEC-011/MEDIA-001/SEC-012.

## Reprise 2026-11-14 (session de clôture)
- UI-002 : `lib/rest/client.ts` typé sans `eslint-disable` de fichier (dérogation `DynamicRow` isolée), `RealtimePayload` générique, broadcast/pg_changes et `hooks/useTyping.ts` alignés ; `npx tsc --noEmit` 0.
- MEDIA-004 : `lib/metrics.ts` ajouté ; événements `[metric]` pour fournisseur objet (`r2`/`vercel_blob`) et replis PostgreSQL (`unconfigured`/`provider_error`) dans `lib/media-storage.ts` et `app/api/media/route.ts`.
- UI-003 : jetons `text-13/14/15` dans `app/globals.css`, remplacement massif `text-[9..16px]`→jetons/tailwind standard ; `ux:scan` tiny 108→0, arbitraires 1113→593, `docs/ui/ratchet.json` resserré, `ux:check` vert.
- Vérifications : `npm run lint` 0 erreur (2 avertissements préexistants), `npm run build` vert, `npx tsc --noEmit` vert, `npm run test:story-playback`/`test:media-security`/`verify:ui` verts dans la passe, Playwright ciblé `stories/editor/layout` 12/12 vert (`PLAYWRIGHT_PORT=3600`).
- Registres mis à jour (ledger/checkpoint section 10 prevaut) : STORY-002/003/004/005, UI-001/002/004/006, MEDIA-003/004, QA-003 vérifiés ; ARC-001 et UI-003 en cours ; SEC-002/012/QA-002 fixés non vérifiés/externes.

## Reprise 2026-11-14 (poursuite locale)
- ARC-001 : `filterMessagesByText` extrait dans `lib/conversations.ts` et utilisé par `app/messages/page.tsx` (séparation affichage/état de conversation). Frontières feed/messages/lecteur toujours à approfondir.
- UI-003 : token `text-26` et remplacements sûrs (découvrir `text-26`, profil `h-2.5`, IDE `h-8`, messages `h-7.5`/`size-5`) ; arbitraires 577, tiny 0, cliquet/`ux:check` verts.
- Vérifications : `npx tsc --noEmit`, `npm run lint` (0 erreur), `npm run ux:scan`/`ux:check`, `npm run test:story-playback` verts.

## 2026-11-15 — reprise « fais tout » : UI-003, réconciliation, baseline

- Baseline : `git status` propre sur `main` (HEAD `012d7ec`) ; `npx tsc --noEmit` **0** ; `npm run lint` **0 erreur**, 2 avertissements préexistants ; `npm run ux:check` tenu.
- `npm run test:media-security` : **34/34**.
- `npm run test:stories-audience` : refusé par le script (écrit des lignes, base locale seulement) — non exécuté, à relancer sur `devnet_ci`.
- UI-003 : script `/tmp/px2spacing.mjs` (hors dépôt) convertit `size|w|h|min-h|max-h-[Npx]` en `espacement N/4` lorsque N est pair (équivalence de rendu, `--spacing` non surchargé). **107 remplacements dans 45 fichiers**, arbitraires **577 → 494**. Plafond `docs/ui/ratchet.json` abaissé à 494.
- Vérifications après conversion : `tsc` 0 ; `npm run lint` 0 erreur ; `npm run ux:check` tenu ; `npm run build` exit 0 ; `npm run test:layout` 6/6 au second passage (un échec à 360 px au premier passage, non reproduit).
- Réconciliation des registres : statuts des sections 3–7 de `DEVNET-EXECUTION-LEDGER.md` alignés sur la section 10 (12 lignes). Un premier script avait écrit dans la colonne « Preuve » de la section 10 ; corrigé en reconstruisant depuis `HEAD`, section 10 intacte.
- Matrice : STORY-002 `VERIFIED` (test playback), SEC-004 rétrogradé à `FIXED_UNVERIFIED` (pas de preuve préprod).

## 2026-11-15 — UI-007 : boutons, clics, autoFocus, couleur

- `app/admin/page.tsx` : `type="button"` ajouté à l'onglet (seul bouton sans type réel ; `preview-code` est une chaîne de code).
- `app/ide/[project]/page.tsx` : onglet scindé en `div` avec deux vrais `<button>` (ouvrir / fermer `aria-label="Fermer {p}"`), le `<span onClick>` imbriqué supprimé.
- `components/StoryViewerLive.tsx` : `div onClick` de placement remplacé par un bouton plein cadre `aria-label="Placer …"`, rendu seulement en mode placement ; `autoFocus` retiré du champ de réponse.
- 8 `autoFocus` remplacés par `ref={focusOnMount}` (`lib/focus-on-mount.ts`) : search, projects, projects/[id] ×2, messages, GifPicker, IssuePanel.
- `app/decouvrir/page.tsx` : `rgba(143,175,78,.34)` → `color-mix(var(--color-moss) 34%)`, token `--color-moss: #8FAF4E` ajouté dans `app/globals.css` (même valeur, rendu identique).
- `docs/ui/ratchet.json` abaissé : buttonsWithoutType 1→0, nonSemanticClickHandlers 2→0, autoFocusUses 8→0, hardcodedColors 2→1 (reste le logo `AnimatedLogo`, artwork non modifié).

Vérifications : `tsc` 0 ; `lint` 0 erreur (2 avertissements préexistants) ; `build` 0 ; `ux:check` cliquet tenu (18) ; `test:media-security` OK ; `test:navigation` 173 OK ; `test:layout` 6/6.
Incident : une première exécution de `test:layout` a échoué sur conflit de port 4123 (`next-server` orphelin de ma session, arrêté). Relancé : 6/6.

## 2026-11-15 — commit et déploiement production (autorisés explicitement)

- Commit local `b49aeb2` (UI-003 + UI-007 + registres). Pas de push.
- `vercel --prod --yes` : Ready, alias https://devnet-brown.vercel.app.

## 2026-11-15 — éditeur de statut (groundwork, non commité)

- Remplacement de `components/StatusComposer.tsx` ; découpage en `StatusComposerStage`, `StatusComposerTools`, `StatusComposerControls`, hook `lib/use-status-composer.ts`, modèle pur `lib/status-editor-model.ts`, rendu `lib/status-render.ts`, export `lib/status-export.ts`.
- Corrections de types : `run(async …)` pour `onUseGif`, `open` sur `GifPicker`, `updateLayer` limité aux champs texte.
- Stickers : ✨ retiré (remplacé par 🌿), décision utilisateur : pas d'icônes au rendu « IA ».
- `ratchet.json` arbitraryValues 494 → 493 (scan 493).
- `scripts/test-status-render.ts` : 6 tests sur faux contexte 2D ; chaîné dans `npm run test:status-editor` (25/25).

Vérifications : `tsc` 0 ; `eslint` 0 erreur sur les fichiers de l'éditeur ; `build` 0 ; `ux:check` cliquet tenu (18). Non vérifié : rendu navigateur, mobile, export d'une photo réelle.

## 2026-11-15 — iPhone X, débordement horizontal (diagnostic partiel)

- Sonde `scripts/probe-mobile-overflow.mjs` (Chromium émulé iPhone X, 375 px) : `/login`, `/register`, `/`, `/aide`, `/a-propos`, `/cgu` ont scrollWidth 375, scrollX 0, aucun élément hors viewport.
- WebKit (`webkit-2311`) installé mais non lançable ici (`libavif.so.16` absent). Pages connectées non mesurées : aucun compte de test dans `tests/`.
- Changement : `app/globals.css`, `html { overflow-x: clip; }` (le pan horizontal iOS passe par `<html>`). `npm run build` exit 0.
- Statut : NON VERIFIED sur iPhone X réel ni sur WebKit ; cause précise non identifiée.

## 2026-11-15 — commit f0ea251 (local), déploiement Vercel non effectué

- Cliquet UI : `arbitraryValues` 494 → 493 (`leading-[15px]` retiré de `NotificationBell.tsx`, `tracking-[-0.03em]` → `tracking-tight` dans `LevelCelebration.tsx`). Plafond inchangé.
- Vérifications : `tsc` 0, `test:status-editor` 25/25, `build` 0, `ux:check` tenu (18), `verify:ui` 0 régression.
- Commit `f0ea251` local, non poussé. `.ux-details-tmp.json` (artefact de diagnostic) et `dbg10.mjs` (non identifié) exclus du commit ; à supprimer ou examiner à la main.
- Déploiement `vercel --prod --yes` refusé par le mode auto : à lancer manuellement (`!vercel --prod --yes`). Statut production : NON VERIFIED tant que ce déploiement n'a pas été fait.

## 2026-11-15 — statuts : plafond de transcodage vidéo

- Constat (code lu) : cache média déjà `no-store` (`app/api/stories/[id]/media`) ; durée média réelle déjà utilisée (`StoryViewerLive`) ; `visibilitychange` déjà écouté ; purge des expirés déjà présente (`app/api/cron/purge-media`, `lib/media-purge.ts`) ; délai ffmpeg 90 s déjà en place. Le `limit 60` trouvé concerne les stickers, pas le flux (le flux est `limit 61`, 60 + 1 pour savoir s'il reste une suite).
- Manque comblé : aucune limite de concurrence sur ffmpeg. Ajout dans `modules/stories/infrastructure/media/story-media.ts` : `STORY_TRANSCODE_SLOTS = 2` par instance, refus immédiat au-delà (message « transcodage vidéo déjà en cours »).
- Test : `scripts/test-story-transcode-slots.ts`, script `npm run test:story-transcode` (2/2).
- Vérifications : `tsc` 0 ; `test:status-editor` 6/6 rendu ; `test:story-transcode` 2/2.
- Non fait : `components/StoryStudio.tsx` n'a plus aucun import mais DEC-002 le cite comme frontière existante ; suppression soumise à décision. Non fait : envoi base64 pour les images jusqu'à 3 Mo (la voie URL couvre vidéos et gros fichiers). Non vérifié : rendu navigateur de l'éditeur, export d'une photo réelle, transcodage ffmpeg réel sous charge.

## 2026-11-15 — mise en production et visionneuse

- Déploiement `vercel --prod --yes` (demandé par l'utilisateur) : build OK, alias `https://devnet-brown.vercel.app` mis à jour (déploiement `devnet-q79vvgh5n`). Contrôle : `/api/health` 200, `/feed` 200.
- Audience : vérifiée par lecture. `story_media_read` (migration 070) passe par `story_is_live`, qui intègre l'audience ; `fetchStoryMedia` passe par la session du lecteur. Pas de changement.
- Visionneuse (`components/StoryViewerLive.tsx`, `app/globals.css`) :
  - appui maintenu sur les zones latérales (`data-tap-zone`) met en pause, comme sur le centre ; `onPointerCancel` remet la lecture ;
  - `.story-stage` : `-webkit-touch-callout: none` et `user-select: none` (champs de saisie exclus). Le `data-no-select` existant ne couvrait que le mode PWA.
- Vérifications : `tsc` 0 ; eslint 0 sur le fichier ; `verify:ui` 0 (cliquet 493 inchangé) ; `build` 0.
- Non vérifié : rendu navigateur de la visionneuse (pas de compte de test) ; iPhone réel.
- Retrait de `components/StoryStudio.tsx` : non fait. Plus aucun import, mais DEC-002 le désigne comme frontière existante. À trancher par l'utilisateur.

## Liquid Glass — thème activable (sans refonte)

- Principe : un interrupteur indépendant de la palette (`devnet:liquid-glass`, attribut `data-liquid="true"` sur `<html>`). Les quatre thèmes (Encre, Papier, Savane, Savane clair) restent intacts ; désactivé = rendu plat d'origine.
- Fichiers : `app/globals.css` (bloc `:root[data-liquid="true"]` en fin de fichier : jetons `--glass-*`, `--color-edge`, `--shadow-drop`, `--overlay-blur`, `--page-wash` ; repli `prefers-reduced-transparency`) ; `lib/ui-preferences.ts` (clé, `normalizeLiquidGlass`, `applyLiquidGlass`) ; `app/layout.tsx` (pose de l'attribut avant le premier rendu) ; `components/LiquidGlassToggle.tsx` (interrupteur, inséré dans Paramètres > Apparence).
- Test : `scripts/test-liquid-glass-preference.ts` (4/4), lecture et normalisation de la préférence, branché sur `npm run test:liquid-glass`.
- Constat d'historique : le code Liquid Glass est déjà dans `ac818b9` (poussé sur `origin/main`), commit au message « Pipeline de build… » sans lien avec ce thème. Il n'a pas été réécrit ; ce commit-ci ne fait que consigner le test et le journal.
- Vérifications : `tsc` 0 ; eslint 0 sur les fichiers touchés ; `build` 0 ; `ux:check` tenu (arbitraryValues 493, filesOver800Lines 9).
- Non vérifié visuellement : aucun rendu navigateur du thème (pas de compte de test pour Paramètres ; pas de capture faite). Statut : NON VERIFIED visuellement.
- Point ouvert : le verre n'est pas encore appliqué à toutes les surfaces ; seules les classes `glass-*` et les jetons qu'elles lisent changent.

## Visionneuse — la vidéo s'arrête avec la story

- Constat (code lu) : la barre de progression se met en pause (`animationPlayState`), mais l'élément `<video>` ne l'était jamais. Son et image continuaient pendant un appui maintenu, une réponse ouverte, la liste des vues, le plateau de stickers ou onglet masqué.
- Correctif `components/StoryViewerLive.tsx` : ref sur le conteneur `story-stage` ; constante `halted` (pause, appui, réponse, plateau, vues, onglet masqué) ; effet qui pause ou relance les `<video>` ; `onPlay` sur les deux `<video>` qui repause si `halted` (vidéo montée tardivement).
- Vérifications : `tsc` 0 ; eslint 0 ; `ux:check` tenu (493 / 9) ; `ui:lint` sans régression.
- Non vérifié : comportement dans un navigateur (pas de compte de test). Statut : NON VERIFIED visuellement et à l'exécution.

### 10. Incident : Systalink down, repli production sur Neon (2026-11-14)

- Symptôme : `/api/backend-check` → offline, `/api/ready` → `database: timeout` ;
  sonde locale → `08P01 server login has been failing, cached error: connect failed
  (server_login_retry)` — le pooler Systalink ne joignait plus son backend (compute
  arrêté ou panne plateforme). Porte 33072 ouverte, backend mort.
- Sauvegarde de secours : `devnet-remote-20261114T120325Z.dump.gpg` (12:03, chiffrée,
  passphrase fichier standard) restaurée dans **Neon** via docker
  `postgres:18.3-alpine pg_restore --clean --no-owner` (pg_restore local trop vieux
  pour le format 1.16). Seules erreurs ignorées : extension `pgaudit` (propre à
  Systalink, 2 occurrences).
- Bascule production : `DATABASE_URL` + `DATABASE_URL_UNPOOLED` → Neon (pooler +
  direct), redeploiement. `/api/ready` → `ready, database: ok, schemaMatches: true`.
- État des données : le backup 12:03 reflétait la vérité Systalink (les 5 posts
  d'échantillon avaient été retirés via `removeSamplePosts`, 1 post réel restant,
  43 users, 14 stories).
- À faire : redémarrer le compute Systalink depuis la console (action humaine),
  puis réconcilier les écritures Neon → Systalink (import incrémental) avant une
  nouvelle bascule. Aucun secret affiché.


## 2026-11-15 — Trust & Safety relié, pas simulé

- Audit d'abord : les briques 073 (signalements, file, chaîne) et le
  modérateur existant sont réutilisés ; aucun second système parallèle.
- Migrations 075 à 079 : rôles, blocages, sourdines, sanctions, recours,
  politique versionnée, dossiers, constats, preuves, moteurs, domaines,
  réglages de protection, lecture modérateur, garde de bannissement,
  puis `actor_ref` pour une chaîne d'audit résistante à l'effacement.
- Application : `lib/rest` refuse un secret ou un lien critique avant
  écriture, ouvre un dossier après écriture ; messages privés, commentaires
  et mentions passent par le filtre entrant ; la route média marque les
  images à revoir ; les réglages de protection masquent un média sensible
  seulement pour le compte qui l'a demandé.
- Interface : `/admin/cases`, `/admin/sanctions`, `/settings/protection`,
  boutons de signalement story, message privé et message de groupe.
- Preuves : 31/31, 13/13, 34/34, 35/35, 51/51, 18/18, 341/341, 32/32,
  29/29, 34/34 ; `tsc`, `build`, `verify:ui` propres ; cliquet 489 et
  9 fichiers > 800.
- Limites : pas de revue visuelle navigateur, pas de fournisseur IA
  image/audio ou email/push, Systalink toujours en `08P01`.

## 2026-11-15 — assurance maison légère

- `npm run assurance` : environnements, capacités et dette UI en une passe
  sans base ni Next. `.env.remote` est neutralisé, la cible distante vient de
  `.env.local` et reste distincte de la secours.
- `db:schema-contract` : contrat actif des tables, colonnes et fonctions
  Trust & Safety, local et Neon. `/api/ready` expose `activeSchema: ok`
  indépendamment de la secours illisible.
- `db:tls-audit:remote` : `verify-full` vérifié, `SET ROLE service_role`
  refusé. Le rôle garde une appartenance sans droit de SET, ce qui n'est pas
  une capacité d'administration.
- `test:trust-safety-http` : 59/59, notifications `moderation` et `appeal`
  par REST, revue navigateur desktop/mobile, axe sans violation sérieuse.
- Les six captures ont été relues. Le doublon de formulaire de protection
  est supprimé.
- Dette UI inchangée : 489 valeurs, 9 fichiers > 800 ; les premiers postes
  sont affichés par l'assurance pour être traités par petits lots.

## 2026-11-15 — pooler Neon et readiness

- Le pooler Neon refuse les `options` de démarrage (`statement_timeout`).
  Le pool les omet pour un hôte `-pooler.` ; `/api/ready` peut enfin lire
  l'empreinte de secours.
- Une instance serverless gelait la sonde détachée. `primeInactive(1 500)`
  attend juste assez pour écrire l'empreinte, sans bloquer sept secondes.
- Production `devnet-abyp8q4vb` : `activeSchema: ok`,
  `schemaMatches: true`, `standbyConfigured: true`.
- Migration 080 rendue idempotente pour Supabase local, effet Neon inchangé,
  somme de contrôle Neon réconciliée sans réapplication.

## 2026-11-15 — mise en production de la reprise (37ff007)

- Commit `37ff007` poussé sur `origin/feature/status-editor-liquid-glass`.
- Déploiement `devnet-ic1p7z95f` : alias `https://devnet-brown.vercel.app`
  mis à jour (statut Ready).
- Contrôles après déploiement :
  - `/api/health` → `200`, `status: ok` ;
  - `/api/ready` → `200`, `database: ok`, `latencyMs` ~95,
    `active: primary`, `activeSchema: ok`, `schemaMissingCount: 0`,
    `standbyConfigured: true`, `schemaMatches: true` ;
  - `/`, `/feed`, `/notifications`, `/settings/protection` → `200` ;
  - `/api/admin/cases` sans session → `401` attendu ;
  - `/sw.js` → `200` avec `Cache-Control: public, max-age=0,
    must-revalidate` et `Service-Worker-Allowed: /` ; `/offline.html` et
    `/manifest.webmanifest` → `200`.
- Première réponse de `/api/ready` juste après le déploiement :
  `schemaMatches: null` avec `schemaNote` expliquant que la sonde détachée
  n'avait pas encore lu la secours. Après préchauffage : `true`. Le `null`
  n'est pas une régression, c'est l'état déclaré du champ.
- Vérifications locales avant envoi : `tsc --noEmit`, `lint`, `build`,
  `assurance`, `test:boundaries` (343), `test:pwa` (193),
  `test:status-editor` (6), `test:liquid-glass` (4),
  `test:trust-safety-engines` (13), `test:media-security` (34),
  `test:story-playback` (8), `verify:ui` (cliquet tenu).
- Aucune migration distante supplémentaire : `db:schema-contract:remote`
  répond `ok` et `db:tls-audit:remote` refuse toujours
  `SET ROLE service_role`.

## 2026-11-15 — caches, navigation et hors-ligne complet (ef24ba6)

- Session partagée par un fournisseur racine : une seule requête
  `/api/auth/session` pour toute l'application, y compris après plusieurs
  changements d'onglet. Mesure locale sur le build de production :
  quatre onglets, **1 chargement de document et 1 requête de session**,
  aucun écran « Ouverture de la session ».
- Navigation à chaud : Notifications 273 ms, Messages 320 ms, Profil
  388 ms, Paramètres 555 ms sur la machine de test.
- Service worker v6 : payloads RSC en réseau d'abord avec cache de secours,
  pages HTML et RSC séparées, médias séparés des données, 500 entrées
  statiques, purge des trois caches à la déconnexion. La version
  « cache d'abord » créait une boucle de 606 requêtes `/feed?_rsc` en 8 s ;
  la version réseau d'abord retombe à 42 préchargements utiles.
- Préchauffage après ouverture : 13 destinations, RSC via le routeur,
  HTML via un message `WARM_ROUTES`, session `/api/auth/session` mise en
  cache pour le lancement à froid. Les pages publiques sont précachées dès
  l'installation du service worker.
- Validation hors-ligne sur le build de production local, compte de test :
  les 9 destinations principales s'ouvrent sans page d'erreur ; un
  lancement à froid sur `/notifications` affiche le contenu, pas le repli
  hors-ligne ; zéro erreur JavaScript de page.
- Validation production publique : `/login` se recharge hors-ligne avec
  son formulaire, `/aide` reste lisible hors-ligne, sans repli.
- Invites système : installation après 6 s, notifications push après 9 s
  sur un appareil éligible, refus mémorisé 30 jours. L'invite de
  notifications n'apparaît pas si VAPID est absent ou si la permission
  est refusée : elle ne promet pas un canal inexistant.
- Commit `ef24ba6` poussé. Déploiement `devnet-owzfmq6ga` : alias
  `https://devnet-brown.vercel.app` mis à jour. `/api/ready` → `ready`,
  `activeSchema: ok`, `standbyConfigured: true`, `schemaMatches: true` ;
  `/sw.js` porte `Cache-Control: max-age=0, must-revalidate` et
  `Service-Worker-Allowed: /`.

## 2026-11-15 — redéploiement production sur `93878a4`

- `git push` : rien à envoyer, `origin/feature/status-editor-liquid-glass`
  était déjà à `93878a4`. Le redéploiement a été fait depuis un worktree
  propre sur ce commit, pour ne pas embarquer le travail en cours du
  worktree principal (média de story, migration 081 non appliquée).
- Déploiement `devnet-oqugmxngi` : alias `https://devnet-brown.vercel.app`
  mis à jour.
- Contrôles : `/api/health` 200 ; `/api/ready` → `ready`, `database: ok`,
  `active: primary`, `activeSchema: ok`, `schemaMissingCount: 0`,
  `standbyConfigured: true`, `schemaMatches: true` ; `/`, `/feed`,
  `/notifications`, `/settings/protection` → 200 ; `/sw.js` porte
  `Cache-Control: max-age=0, must-revalidate` et
  `Service-Worker-Allowed: /` (11 000 octets, précache des pages
  publiques).

## 2026-11-15 — réconciliation média, sécurité et release (`203fd1a`)

- Documentation alignée sur le code `bab3010` déployé par `cca3a58` :
  `DEVNET_STORIES_SPEC.md`, `DEVNET_MEDIA_ARCHITECTURE.md`,
  `DEVNET_SECURITY_MODEL.md`, `DEVNET_RELEASE_CHECKLIST.md`.
- P1 média/story fermé : migration `081` appliquée en local et sur Neon ;
  `can_read_media_file` vérifie audience, expiration et auteur, sans joker
  SQL. Preuves : `test:stories-audience` 26/26,
  `test:stories-postgres` 47/47, `test:media-security` 36/36.
- `db:schema-contract:remote` : contrat respecté. `GET /api/ready` : 200,
  `database: ok`, `activeSchema: ok`, `schemaMatches: true`.
- `db:tls-audit:remote` : `verify-full`, chiffrement client confirmé,
  `SET ROLE service_role` refusé (migration `080`).
- Restent ouverts : bucket média privé, test HTTP multi-comptes des deux
  routes de story, RLS négative sur la base cible, rotation des secrets.
- Aucun commit, push ou déploiement effectué dans cette passe documentaire.
