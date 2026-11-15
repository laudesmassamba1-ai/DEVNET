# DEVNET — point de reprise

> **Statut : EN COURS — reprise au point « Prochaine action exacte ».**
>
> Dernière mise à jour : 2026-11-15.
> Référence Git : `1916a48` sur `feature/status-editor-liquid-glass`.
> Code déployé : `1916a48`, déploiement `devnet-289pyzuvu` sur
> `devnet-brown.vercel.app`. Les sections qui citent `745903f`, `31d805d`,
> `ec08ae9`, `37ff007`, `devnet-ic1p7z95f`, `4cee27e` ou `203fd1a` comme code
> déployé sont historiques.

## Ce qui est fait et prouvé (cumul)

- Statuts `VERIFIED` (voir section 10 du ledger, qui prévaut) : MEDIA-003, MEDIA-004,
  STORY-002, STORY-003, STORY-004, STORY-005, UI-001, UI-002, UI-004, UI-006, QA-003.
- SEC-004 reste `FIXED_UNVERIFIED` : aucune preuve en préproduction.
- UI-003 : valeurs arbitraires **491** (plafond `docs/ui/ratchet.json` 493),
  cliquet tenu ; 8 fichiers > 800 lignes.
- UI-007 : `type="button"`, onglet IDE et surface de sticker rendus accessibles,
  8 `autoFocus` remplacés par `focusOnMount`, couleur en dur de `decouvrir` remplacée
  par `--color-moss`. Cliquet : 0 / 0 / 0 ; reste 1 couleur en dur (SVG
  `AnimatedLogo`, volontairement non touché).
- Focus de la réponse aux stories (`2e7bc21`) : présent dans `cca3a58` et dans
  le déploiement `devnet-pynx4s6yu`.
- Éditeur de statut (non commité) : modèle, rendu canvas, export, hook, composant
  découpé en trois fichiers. Les stickers n'utilisent plus de ✨ ni d'icônes générées
  (jeu de stickers : 🌿 à la place).
- Vérifications de cette passe (sur l'état courant) :
  - `npx tsc --noEmit` : 0 erreur.
  - `npx eslint` sur les fichiers de l'éditeur : 0 erreur.
  - `npm run test:status-editor` : 25/25 (19 modèle + 6 rendu sur faux contexte 2D).
  - `npm run build` : exit 0.
  - `npm run ux:check` : cliquet tenu (18 indicateurs).
- Non vérifié pour l'éditeur : rendu réel dans un navigateur, glisser-déposer sur
  mobile, export d'une vraie photo. Ne pas marquer VERIFIED sans ces preuves.
- Points ouverts antérieurs : `test:layout` à 360 px a échoué une fois (non reproduit,
  `tests/e2e/layout.spec.ts:88`). `test:stories-audience` : 26/26 sur base locale
  migrée, migration 081 comprise ; `test:stories-postgres` 47/47 et
  `test:media-security` 36/36 le 2026-11-15.

- Liquid Glass (UI-009) : thème activable par-dessus les quatre thèmes, interrupteur
  dans Réglages. Commits `ac818b9` (code, poussé ; message sans rapport), `39b2f5a`
  (test + journal). `test:liquid-glass` 4/4. Visuel non vérifié.
- Visionneuse : la `<video>` s'arrête avec la story (`745903f`). Appui, zones de tap et
  `visibilitychange` vérifiés par lecture du code ; rendu non vérifié.
- Correction d'historique : `f0ea251` a un message « Liquid-tokens » erroné. Non réécrit.

## Prochaine action exacte

1. **Passe documentation/contenu** : `DEVNET_MEDIA_ARCHITECTURE.md`,
   `DEVNET_SECURITY_MODEL.md`, `DEVNET_RELEASE_CHECKLIST.md` et
   `DEVNET_STORIES_SPEC.md` sont corrigés le 2026-11-15. Poursuivre l'audit des
   37 pages et des routes dans `docs/maintenance/DEVNET-CONTENT-AUDIT.md`.
2. **Visionneuse des stories** : fait par lecture du code (voir ci-dessus). Reste la
   vérification navigateur avec compte de test. Ne pas rouvrir sans nouvel écart.
3. **Navigation de l'éditeur** : brancher `StatusComposer` sur le feed et vérifier dans
   un navigateur (Playwright) : ajout de texte, tracé, sticker, recadrage, publication.
4. **UI-003** : réduire les 491 valeurs restantes par écran (`app/profile/page.tsx` 25,
   `app/decouvrir/page.tsx` 19, `components/GithubPanel.tsx` 19). Ne jamais remonter
   `docs/ui/ratchet.json`.
5. **ARC-001** : découper `app/feed/page.tsx`, `app/messages/page.tsx`,
   `app/ide/[project]/page.tsx` avec tests avant/après.
6. Vérifier le job `database` sur GitHub après push (RLS, migrations, Stories) ;
   ajouter un test HTTP multi-comptes des deux routes de média de story.

## Validations externes (non réalisables localement)

- SEC-001 : rotation du mot de passe PostgreSQL et révocation des sessions (console fournisseur).
- SEC-002 : **résolu** — migration `080`, `SET ROLE service_role` refusé sur Neon.
- SEC-003 : **résolu** — `DATABASE_CA_CERT` présent, `db:tls-audit:remote` en
  `verify-full` le 2026-11-15.
- SEC-011 : KV/Redis pour un limiteur partagé.
- SEC-012 / MEDIA-001 : credentials R2/Blob et parcours multipart réel.
- QA-002 : job GitHub `database` vert après push.
- iPhone/Safari et Android Chrome physiques : hors de portée de cet environnement.

## Règle de reprise

Ne pas conclure « terminé » tant que la section 10 du ledger contient `OPEN`,
`IN_PROGRESS` ou `FIXED_UNVERIFIED`. Reprendre au premier élément réalisable et
mettre à jour ledger, journal, checkpoint et matrice après chaque unité.

## Statuts : état au 2026-11-15

- Déployé : `devnet-brown.vercel.app`, déploiement `devnet-289pyzuvu`
  (commit `1916a48`).
- Fait et vérifié par checks : plafond de transcodage ; audience contrôlée en RLS ; purge présente ; durée réelle et pause onglet.
- Fait, non vérifié navigateur : appui maintenu / zones de la visionneuse (STORY-007), éditeur et export.
- Décision utilisateur : retirer ou garder `components/StoryStudio.tsx` (DEC-002).

## Clôture Trust & Safety (2026-11-15)

- 075 à 079 appliquées en local et sur Neon ; chaîne d'audit réparée par
  `actor_ref` et vérifiée (`ok`, 14 lignes).
- Toutes les preuves T&S sont vertes : 31/31 base, 13/13 moteurs,
  75/75 HTTP, plus auth, passerelle, admin, frontières, signalements,
  modération et médias. `tsc`, `build`, `verify:ui` propres.
- La connexion d'un compte sanctionné reste ouverte pour permettre le
  recours ; l'écriture est refusée par les triggers.
- Revue visuelle navigateur de `/admin/cases`, `/admin/policy`,
  `/admin/sanctions` et `/settings/protection` : faite (75/75, axe
  desktop/mobile).
- Notifications `moderation`/`appeal` de bout en bout : testées.
- Éditeur de politique livré : `/admin/policy`, publication owner/admin, audit, `autoRemove`/`autoBan` inactivables. Test HTTP 75/75, captures desktop/mobile et axe.
- Systalink reste bloqué en `08P01` : rotation ou redémarrage console
  requis avant toute réconciliation.


## Clôture PWA et média 081 (2026-11-15)

- `RouteWarmup` se réinitialise sur `OFFLINE_CACHE_PURGED_EVENT` : la reconnexion
  du même compte réchauffe de nouveau les destinations au lieu de rester muette.
- Cache initial du profil, des groupes, des projets et de la recherche ; retour
  sans squelette. `prefetch={false}` sur la navigation : 25 requêtes RSC mesurées
  au lieu de 42.
- `/setup` montre l'usage réel du cache et ne libère que les données reconstructibles.
- `Inter` n'est plus préchargée : build sans avertissement de police.
- Push réel observé sur Chrome persistant (FCM, événement `push` dans le service
  worker). La bannière de notification apparaît seulement quand le canal existe.
  Limite honnête : pas de téléphone physique dans cet environnement.
- Migration 081 appliquée sur une base neuve (81/81) et sur Neon (81/81) ;
  `test:stories-audience` 26/26, `test:media-security` 36/36.
- Production `devnet-289pyzuvu` : `/api/ready` `activeSchema=ok`,
  `schemaMatches=true`, `/api/push/subscription` configuré, `/setup` sert le
  panneau de cache.
- Hors-ligne étendu : file d'écriture IndexedDB avec rejeu idempotent,
  téléchargement vidéo explicite servi en `Range`, précache des pages récentes,
  TTL de 7 jours visible dans `/setup`.
- Charge locale : 1 000 requêtes à concurrence 100, 0 échec ; `/login` p95
  1 965 ms, `/api/ready` p95 541 à 634 ms à chaud après mutualisation de la
  sonde. La première rafale à froid reste à ~3,4 s et n'est pas masquée.
- Éditeur de politique : `/admin/policy`, publication owner/admin, audit,
  `autoRemove`/`autoBan` inactivables ; test HTTP 75/75.
