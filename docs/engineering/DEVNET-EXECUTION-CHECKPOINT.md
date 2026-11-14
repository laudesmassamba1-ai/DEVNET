# DEVNET — point de reprise

> **Statut : EN COURS — reprise au point « Prochaine action exacte ».**
>
> Dernière mise à jour : 2026-11-15.
> Référence Git : `2e7bc21` sur `main` (local ; `b49aeb2` déployé). Toutes les
> modifications ci-dessous sont non commitées.

## Ce qui est fait et prouvé (cumul)

- Statuts `VERIFIED` (voir section 10 du ledger, qui prévaut) : MEDIA-003, MEDIA-004,
  STORY-002, STORY-003, STORY-004, STORY-005, UI-001, UI-002, UI-004, UI-006, QA-003.
- SEC-004 reste `FIXED_UNVERIFIED` : aucune preuve en préproduction.
- UI-003 : valeurs arbitraires **493** (était 577), plafond `docs/ui/ratchet.json`
  abaissé à 493, cliquet tenu.
- UI-007 : `type="button"`, onglet IDE et surface de sticker rendus accessibles,
  8 `autoFocus` remplacés par `focusOnMount`, couleur en dur de `decouvrir` remplacée
  par `--color-moss`. Cliquet : 0 / 0 / 0 ; reste 1 couleur en dur (SVG
  `AnimatedLogo`, volontairement non touché).
- Focus de la réponse aux stories (`2e7bc21`) : **corrigé localement, absent de la
  production** tant que `2e7bc21` n'est pas déployé sur instruction explicite.
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
  `tests/e2e/layout.spec.ts:88`). `test:stories-audience` non exécuté (refuse hors
  base locale `devnet_ci`).

## Prochaine action exacte

1. **Visionneuse des stories** : durée réelle depuis la vidéo (`timeupdate`/`ended`) au
   lieu des 7 s fixes ; appui long sur le contenu ; pause sur `visibilitychange` ; zones
   de tap ; navigation entre auteurs.
2. **Navigation de l'éditeur** : brancher `StatusComposer` sur le feed et vérifier dans
   un navigateur (Playwright) : ajout de texte, tracé, sticker, recadrage, publication.
3. **UI-003** : réduire les 493 valeurs restantes par écran (`app/profile/page.tsx` 25,
   `app/decouvrir/page.tsx` 19, `components/GithubPanel.tsx` 19). Ne jamais remonter
   `docs/ui/ratchet.json`.
4. **ARC-001** : découper `app/feed/page.tsx`, `app/messages/page.tsx`,
   `app/ide/[project]/page.tsx` avec tests avant/après.
5. Relancer `npm run test:stories-audience` sur `devnet_ci` ; vérifier le job `database`
   après push.

## Validations externes (non réalisables localement)

- SEC-001 : rotation du mot de passe PostgreSQL et révocation des sessions (console fournisseur).
- SEC-002 : `REVOKE service_role` avec un rôle admin fournisseur ; preuve que `SET ROLE` est refusé.
- SEC-003 : `DATABASE_CA_CERT` puis `npm run db:probe:remote` en `verify-full`.
- SEC-011 : KV/Redis pour un limiteur partagé.
- SEC-012 / MEDIA-001 : credentials R2/Blob et parcours multipart réel.
- QA-002 : job GitHub `database` vert après push.
- iPhone/Safari et Android Chrome physiques : hors de portée de cet environnement.

## Règle de reprise

Ne pas conclure « terminé » tant que la section 10 du ledger contient `OPEN`,
`IN_PROGRESS` ou `FIXED_UNVERIFIED`. Reprendre au premier élément réalisable et
mettre à jour ledger, journal, checkpoint et matrice après chaque unité.

## Statuts : état au 2026-11-15

- Déployé : `devnet-brown.vercel.app` (commit 31d805d).
- Fait et vérifié par checks : plafond de transcodage ; audience contrôlée en RLS ; purge présente ; durée réelle et pause onglet.
- Fait, non vérifié navigateur : appui maintenu / zones de la visionneuse (STORY-007), éditeur et export.
- Décision utilisateur : retirer ou garder `components/StoryStudio.tsx` (DEC-002).
