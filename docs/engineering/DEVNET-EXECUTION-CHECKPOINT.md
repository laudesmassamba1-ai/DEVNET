# DEVNET — point de reprise

> **Statut : NON TERMINÉ — reprise nécessaire.**
>
> Dernière mise à jour : 2026-11-15.
> Référence Git : `012d7ec` sur `main` (modifications de cette passe non commitées).

## Ce qui est fait et prouvé (cumul)

- Statuts `VERIFIED` (voir section 10 du ledger, qui prévaut) : MEDIA-003, MEDIA-004,
  STORY-002, STORY-003, STORY-004, STORY-005, UI-001, UI-002, UI-004, UI-006, QA-003.
- SEC-004 est rétrogradé à `FIXED_UNVERIFIED` : aucune preuve en préproduction.
- UI-003 : textes < 12 px **0** ; valeurs arbitraires **494** (était 577), plafond
  `docs/ui/ratchet.json` abaissé à 494, cliquet tenu.
- Vérifications de cette passe : `tsc` 0 ; `npm run lint` 0 erreur (2 avertissements
  préexistants) ; `npm run ux:check` tenu ; `npm run test:media-security` 34/34 ;
  `npm run build` exit 0 ; `npm run test:layout` 6/6 au second passage.
- Point ouvert : un échec de `test:layout` à 360 px au premier passage, non reproduit.
- Test `npm run test:stories-audience` non exécuté : le script refuse hors base locale.

## Prochaine action exacte

1. **UI-003** : réduire les 494 valeurs arbitraires restantes, par écran (découvrir,
   profil, IDE, messages en priorité). Ne jamais remonter `docs/ui/ratchet.json`.
   Les `text-[Nrem]` et `max-w-[Npx]` ne sont pas traités par le script ; il faut les
   mapper sur les jetons existants en vérifiant le rendu.
2. **UI-007** : corriger les constats du scanner : 1 `button` sans `type`,
   2 gestionnaires de clic non sémantiques (`app/ide/[project]/page.tsx`,
   `components/StoryViewerLive.tsx`), 8 `autoFocus`, 2 couleurs en dur
   (`app/decouvrir/page.tsx`, `components/AnimatedLogo.tsx`).
3. **ARC-001** : poursuivre le découpage de `app/feed/page.tsx`, `app/messages/page.tsx`,
   `app/ide/[project]/page.tsx` avec tests avant/après.
4. Relancer `npm run test:stories-audience` sur la base locale `devnet_ci`.
5. Vérifier le job `database` de GitHub après push.

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
