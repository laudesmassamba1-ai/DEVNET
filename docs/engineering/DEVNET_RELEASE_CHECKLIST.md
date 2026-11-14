# DEVNET — checklist de release

> À exécuter avant chaque mise en production. Une case non cochée est un
> blocage, pas une formalité.

## 1. Blocages de sécurité (ne pas déployer sans)

- [ ] Secrets exposés **révoqués et tournés** (base, CI, hébergeur). Aucune
      valeur dans Git, les logs ou ce document.
- [ ] `devnet_u` ne peut plus endosser `service_role` / `BYPASSRLS` ; le rôle
      de runtime est distinct du propriétaire des tables.
- [ ] TLS PostgreSQL en `verify-full` avec le CA du fournisseur ;
      `/api/ready` le confirme.
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
- [ ] `067_media_privacy.sql` appliquée ; la policy `media_files_read` appelle
      `can_read_media_file`.
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
- [ ] Un HTML renommé en `.png` est refusé (415).
- [ ] Journaux : aucun secret, aucune erreur 5xx nouvelle.
- [ ] Sauvegarde post-déploiement planifiée et vérifiée.

## 6. À faire après la release

- [ ] CI PostgreSQL 18 (RLS, migrations, stories).
- [ ] Limitation de débit partagée (auth, média, stories).
- [ ] Vérification des objets multipart à la finalisation.
- [ ] Purge des stories et médias expirés/orphelins.
- [ ] Audience des stories (SQL d'abord, UI ensuite).
- [ ] Tests sur iPhone Safari et Android Chrome réels.
