# DEVNET — point de reprise

> **Statut : NON TERMINÉ — reprise nécessaire.**
>
> Dernière mise à jour : 2026-11-14 (passe de clôture).
> Commit de référence avant cette passe : `380e3f2` sur `main`.

## Ce qui est fait et prouvé (cumul)

- SEC-002 (code), SEC-012 (code), MEDIA-003, MEDIA-004, STORY-002,
  STORY-003, STORY-004, STORY-005, UI-001, UI-002, UI-004, UI-006,
  QA-003 sont corrigés/vérifiés selon la portée locale (voir section 10 du
  ledger et la matrice).
- Systalink : backups GPG chiffrés (`…013251Z`, `…015347Z`), migrations
  066–070 appliquées (70/70). Bootstrap tenté mais retrait `service_role`
  bloqué (`devnet_u` sans `ADMIN OPTION`, `SET ROLE service_role` réussit).
- UI-003 : textes < 12 px **0**, valeurs arbitraires **577** (cliquet tenu,
  `ux:check` vert). ARC-001 : premières extractions de frontières
  (`feed-composer/posts`, `conversations`, `story-viewer/StickerFace`).
- Vérifications locales de cette passe : `tsc` 0, `npm run lint` 0 erreur
  (2 avertissements préexistants), `npm run build` vert, `test:media-security`,
  `test:story-playback`, `verify:ui`, Playwright ciblé `stories`/`editor`/
  `layout` (12/12, port dédié).

## Prochaine action exacte

1. Lire `DEVNET-EXECUTION-LEDGER.md` section 10.
2. Traiter les tâches locales restantes :
   - **ARC-001** : poursuivre le découpage par responsabilités des gros
     composants (feed/messages/lecteur), avec tests avant/après.
   - **UI-003** : continuer la réduction des 577 valeurs arbitraires
     (découvrir/profil/IDE en priorité), sans remonter le cliquet.
3. Validations externes à demander / confirmer :
   - **SEC-002** : exécuter le `REVOKE service_role` avec un rôle admin
     fournisseur et prouver que `SET ROLE service_role` est refusé pour
     `devnet_u`.
   - **SEC-003** : fournir `DATABASE_CA_CERT` et vérifier `db:probe:remote`
     en `verify-full`.
   - **SEC-011** : fournir KV/Redis pour un limiteur partagé.
   - **SEC-012 / MEDIA-001** : fournir credentials R2/Blob et tester le
     parcours multipart/objet réel.
   - **QA-002** : vérifier que le job GitHub `database` est vert après push.
   - **iPhone/Safari physique** : validation hors de portée locale.

## Règle de reprise

Ne pas conclure « terminé » tant que la section 10 du registre contient
`OPEN`, `IN_PROGRESS` ou `FIXED_UNVERIFIED`. Reprendre au premier élément
réalisable, mettre à jour ledger/log/checkpoint/matrice après chaque unité.
