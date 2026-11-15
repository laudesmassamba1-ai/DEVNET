# DEVNET — checklist de release

> À exécuter avant chaque mise en production. Une case non cochée est un
> blocage, pas une formalité.

## 1. Blocages de sécurité (ne pas déployer sans)

- [ ] Secrets exposés **révoqués et tournés** (base, CI, hébergeur). Aucune
      valeur dans Git, les logs ou ce document.
- [x] `devnet_u` ne peut plus endosser `service_role` / `BYPASSRLS` :
      migration `080`, audit distant du 2026-11-15, `SET ROLE` refusé.
- [x] TLS PostgreSQL en `verify-full` avec le CA du fournisseur :
      `db:tls-audit:remote` le 2026-11-15, chiffrement client confirmé.
      Le rôle de runtime reste à séparer du propriétaire des tables.
- [ ] Test négatif RLS exécuté sur la base cible : A ne lit pas les données
      privées de B, un anonyme ne lit rien de privé.
- [ ] Bucket média privé + URLs signées pour les messages privés, ou décision
      écrite d'accepter la limite actuelle.

## 2. Contrôles locaux

```bash
npm ci
npx tsc --noEmit
npm run lint
npm run test:media-security
npm run test:stories-postgres    # base locale migrée
npm run test:stories-audience    # base locale migrée, écrit puis nettoie
npm run verify:ui
npm run test:pwa
npm run build
```

- [ ] Toutes les commandes sortent en code 0.
- [ ] `npm run lint` : aucune **erreur** ; les avertissements sont listés et
      assumés.
- [ ] `git diff` relu : aucun secret, aucun `.env`, aucun binaire de test.
- [ ] `git check-ignore -v docs/engineering/DEVNET_RELEASE_CHECKLIST.md` ne
      retourne rien (les documents doivent être versionnés).

## 3. Base de données

- [ ] Migrations additives uniquement ; relire chaque `alter`/`drop`.
- [ ] `067_media_privacy.sql`, `068_media_relative_urls.sql` et
      `081_story_media_audience.sql` appliquées ; la policy
      `media_files_read` appelle `can_read_media_file` et l'audience de story
      est contrôlée.
- [x] `081` appliquée en production le 2026-11-15 ; code `cca3a58` déployé
      (`devnet-pynx4s6yu`) ; contrat de schéma et `/api/ready` verts.
- [ ] Sauvegarde chiffrée **avant** migration (`npm run db:backup:remote`).
- [ ] Plan de rollback écrit pour chaque migration (voir le registre).
- [ ] Aucune suppression de colonne ou de ligne sans sauvegarde et
      autorisation.

## 4. Variables d'environnement (noms seuls)

Serveur : `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `DATABASE_CA_CERT`,
`DEVNET_SESSION_SECRET`, `NEXT_PUBLIC_SITE_URL`, `R2_*` ou
`BLOB_READ_WRITE_TOKEN`, `TENOR_API_KEY`/`GIPHY_API_KEY`, `GITHUB_*`,
`VAPID_*`.

- [ ] Présentes sur l'environnement cible, jamais dans le dépôt.
- [ ] Aucune variable requise manquante : `/api/ready` répond 200.
- [ ] Les valeurs de test ne pointent pas vers la production.

## 5. Après déploiement

- [ ] `/api/ready`, `/login`, `/feed`, `/messages`, `/settings` → 200.
- [ ] Connexion réelle, publication texte, publication photo, lecture d'une
      story, réponse privée.
- [ ] En-têtes : HSTS, `X-Content-Type-Options`, `Permissions-Policy`.
- [ ] Un média privé n'est pas lisible par un compte non participant (404).
- [ ] Un média de story `followers`/`private` n'est pas lisible par un tiers
      authentifié (404) ; le test SQL local couvre la décision, le test HTTP
      reste à faire.
- [ ] Un HTML renommé en `.png` est refusé (415).
- [ ] Journaux : aucun secret, aucune erreur 5xx nouvelle.
- [ ] Sauvegarde post-déploiement planifiée et vérifiée.

## 6. À faire après la release

- [x] CI PostgreSQL 18 (RLS, migrations, stories) : `test:db-rls`,
      `test:stories-postgres`.
- [ ] Limitation de débit partagée (auth, média, stories).
- [ ] Vérification des objets multipart à la finalisation.
- [ ] Purge des stories et médias expirés/orphelins.
- [x] Audience des stories côté SQL et trigger (`081`, 26 vérifications).
- [ ] Test HTTP multi-comptes des deux routes de média de story.
- [ ] Tests sur iPhone Safari et Android Chrome réels.
