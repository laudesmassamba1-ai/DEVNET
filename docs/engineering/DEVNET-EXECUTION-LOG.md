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
