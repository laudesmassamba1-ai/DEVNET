# Trust & Safety — état d’avancement et reste à faire

**Date** : 15 novembre 2026, milieu de journée  
**Branche** : `feature/status-editor-liquid-glass`  
**Dernier commit déployé avant cette reprise** : `ec08ae9`  
**Production actuelle** : https://devnet-brown.vercel.app

Ce document remplace les affirmations optimistes. Il distingue ce qui est
prouvé, ce qui est en cours et ce qui reste bloqué. Aucune ligne « fait »
ne doit être lue sans la preuve correspondante.

---

## 1. Point de départ

La livraison Trust & Safety précédente était déjà en production :

- dossiers de modération, sanctions, recours, protection du compte ;
- signalements story et message privé ;
- migrations 075 à 079 appliquées sur Neon ;
- `/api/ready` à 200, base `ok` ;
- 34 vérifications HTTP passantes.

Les limites annoncées étaient : revue visuelle absente, notifications non
testées, intégrations externes absentes, TLS/schema de secours non prouvés,
dette UI, et `.env.remote` obsolète.

---

## 2. Ce qui a été fait depuis

### 2.1 Protection — doublon supprimé

`components/ProtectionPanel.tsx` rendait **deux fois** le même
`<SafetySettingsForm />`. Cela produisait deux formulaires identiques et
deux fois l’identifiant `safety-settings`. Le doublon est supprimé.

Preuve restante à produire : le test navigateur doit compter exactement un
`#safety-settings` sur `/settings/protection`.

### 2.2 TLS `verify-full`

- `platform/infrastructure/postgres/tls.ts` accepte maintenant
  `DATABASE_TLS_MODE=verify-full`, qui force la vérification pour tout hôte
  distant, même si l’URL dit `sslmode=require`.
- La primaire Neon et le pooler Neon ont été testés avec `verify-full` :
  connexion réussie, certificat vérifié.
- `DATABASE_TLS_MODE=verify-full` a été ajouté aux variables Vercel de
  production.
- `DATABASE_CA_CERT` vide/inutile a été retiré de Vercel pour ne pas
  remplacer le magasin de CA système de Neon.

**Attention** : ces variables ne prennent effet qu’au prochain déploiement.
La production actuelle tourne encore sur l’ancien code et l’ancienne
configuration.

### 2.3 Base de secours

- L’ancienne secours Systalink échoue toujours :
  `08P01 server login has been failing`.
- Le pooler Neon `ep-summer-firefly-…-pooler…` répond en `verify-full`,
  avec 80 migrations au moment du test.
- `DATABASE_URL_STANDBY` a été remplacé dans Vercel par ce pooler Neon.
- `.env.local` local utilise désormais :
  - primaire Neon directe en `verify-full` ;
  - secours pooler Neon en `verify-full`.

**Limite honnête** : le pooler pointe vers la **même base Neon**, pas vers
une copie indépendante. Il protège d’une panne d’endpoint, pas d’une perte
de données. Une vraie secours indépendante reste à créer et à répliquer.

Le pooler Neon refuse les paramètres de démarrage `options` utilisés pour
poser `statement_timeout`. Le pool omet désormais ces paramètres quand
l’hôte contient `-pooler.` ; c’est ce qui permet enfin de lire l’empreinte
de schéma de la secours et d’obtenir `schemaMatches: true`.

### 2.4 Rôle `service_role`

Le rôle Supabase `service_role` existait encore avec :

- 567 privilèges de table dans `public` ;
- 99 privilèges de fonction ;
- `rolbypassrls = true` ;
- `neondb_owner` membre de ce rôle.

La migration `db/migrations/080_revoke_service_role.sql` :

- révoque tables, séquences, fonctions et schéma ;
- retire toutes les appartenances ;
- passe `service_role` en `nologin` ;
- vérifie qu’il ne reste aucun privilège de table.

Appliquée et vérifiée sur la base locale `ts-a` :

- 0 privilège de table ;
- 0 privilège de routine ;
- 0 appartenance avec droit de `SET` ; une ligne d’appartenance sans `SET` subsiste, elle ne permet pas de revêtir le rôle.
- `can_login = false`.

Appliquée sur Neon `neondb` : 80 entrées `schema_migrations` (dont
l’orpheline historique `029_extensions.sql`).

La migration a ensuite été rendue sûre pour l’émulateur Supabase local, qui
réserve `service_role` et `supabase_realtime_admin` : elle s’y ignore
proprement. L’effet Neon est inchangé. La somme de contrôle de la ligne 080
sur Neon a été réconciliée une fois, sans réappliquer la migration.

### 2.5 Notifications `moderation` / `appeal`

Le parcours HTTP contient désormais cinq vérifications nouvelles, toutes
passantes :

- l’auteur sanctionné voit la notification `moderation` via
  `/api/rest/notifications` ;
- un autre compte ne la voit pas (RLS) ;
- l’auteur dépose un recours par `/api/sanctions/appeal` ;
- le recours est visible par un modérateur distinct ;
- le recours est lisible par son auteur.

La revue du recours et la notification `appeal` sont désormais exécutées
par le même parcours : un second administrateur révise, puis l'auteur lit la
notification. Le test complet passe **75/75**.

### 2.6 Éditeur de politique

`/admin/policy` permet enfin de faire évoluer la politique sans migration :
gravité et décision automatique par catégorie, seuils de revue et de retenue,
note de version. Publier désactive l'ancienne version et insère la nouvelle
dans une seule transaction ; l'audit `moderation.policy.publish` est écrit et
le cache serveur invalidé.

Deux limites sont tenues par le code, pas par la discipline : `autoRemove` et
`autoBan` restent `false` même si la requête tente de les activer. La lecture
est ouverte aux rôles de modération, la publication aux rôles owner/admin.

---

## 3. Revue navigateur : passée

Le test `scripts/test-trust-safety-http.ts` ouvre réellement les quatre écrans
avec une session admin et le compte sanctionné :

- `/admin/cases`, `/admin/policy`, `/admin/sanctions`, `/settings/protection` ;
- visite guidée fermée par compte pour ne pas intercepter les clics ;
- filtre « tous » puis ouverture du dossier de test ;
- absence de débordement horizontal en 1440 px et 390 px ;
- axe WCAG 2 A/AA, aucune violation critique ou sérieuse ;
- un seul formulaire `#safety-settings` ;
- captures dans `docs/engineering/evidence/trust-safety/`.

Les huit captures ont été relues : hiérarchie, densité, navigation mobile et
états vides sont cohérents. Le test se termine par **75 vérifications
réussies**.

## 4. Production : déployée et vérifiée

Le déploiement `devnet-289pyzuvu` (code `1916a48`) sert `https://devnet-brown.vercel.app`.
Contrôles après déploiement :

- `/api/ready` → `200`, `database: ok`, `active: primary` ;
- `activeSchema: ok`, `schemaMissingCount: 0` ;
- `standbyConfigured: true`, `schemaMatches: true` ;
- `/settings/protection` → `200` ;
- `/api/admin/cases` et `/api/admin/policy` sans session → `401` attendu ;
- `/admin/sanctions` et `/admin/policy` sans session → redirection de connexion.

`DATABASE_TLS_MODE=verify-full` est présent dans l’environnement Vercel de
production. L’audit direct `db:tls-audit:remote` confirme `verify-full` et
le refus de `SET ROLE service_role`.

---

## 5. Reste à faire, dans l’ordre

### Bloquant pour clore Trust & Safety

- [x] Corriger le test visuel et ouvrir réellement le dossier.
- [x] Faire passer les quatre écrans en desktop et mobile, sans débordement.
- [x] Obtenir 0 violation axe critique/sérieuse.
- [x] Produire et relire les captures.
- [x] Exécuter la revue du recours et vérifier la notification `appeal`.
- [x] Relancer `tsc`, lint, tests T&S, build.
- [x] Déployer et vérifier `/api/ready` avec `activeSchema: ok` et
      `schemaMatches: true`.
- [x] Vérifier TLS `verify-full` et `service_role` non assumable.

### Sécurité et exploitation

- [x] Neutraliser `.env.remote` : archive `.env.remote.disabled-20261115`,
      cible distante dans `.env.local`, vérifiée par `npm run assurance`.
- [ ] Décider si le pooler Neon suffit comme secours ou créer une vraie
      base indépendante avec réplication.
- [x] Vérifier la migration 080 : elle s’applique sur Neon et s’ignore
      proprement sur l’émulateur Supabase local qui réserve `service_role`.
- [ ] Documenter la rotation des identifiants Systalink.

### Dette UI

- [ ] 491 valeurs Tailwind arbitraires (plafond 493).
- [ ] 8 fichiers de plus de 800 lignes.
- [ ] Le cliquet UI est tenu, mais la dette n’est pas résorbée.

### Intégrations externes

Non configurées et non simulées :

- [x] push réel : abonnement FCM et événement `push` observés dans le service worker (Chrome desktop persistant) ; pas d'appareil physique.
- [ ] fournisseur IA image/audio ;
- [ ] email de notification T&S (l'email de réinitialisation existe déjà) ;
- [ ] MFA ;
- [ ] `ffmpeg` / worker vidéo.

Ces points exigent des comptes, des clés et des choix de fournisseur. Ils ne
doivent pas être présentés comme terminés.

---

## 6. Commandes de reprise

```bash
# revue HTTP + navigateur (locale, écrit puis nettoie)
npm run test:trust-safety-http

# assurance légère : environnements, capacités, dette UI
npm run assurance

# contrat de schéma actif et audit TLS/rôles
npm run db:schema-contract:remote
npm run db:tls-audit:remote

# typage et lint
npx tsc --noEmit
npm run lint

# migrations locales
DB_TARGET=local npx tsx scripts/db/migrate.ts \
  --database-url='postgresql://postgres:test@localhost:55443/devnet' --apply

# migrations Neon (confirmation explicite)
CONFIRM_REMOTE=neondb DB_TARGET=remote npx tsx scripts/db/migrate.ts --apply

# production
vercel --prod --yes
curl -sS https://devnet-brown.vercel.app/api/ready
```

---

## 7. Fichiers touchés dans cette reprise

- `components/ProtectionPanel.tsx` — doublon supprimé.
- `platform/infrastructure/postgres/tls.ts` — mode TLS forcé.
- `db/migrations/080_revoke_service_role.sql` — révocation `service_role`.
- `scripts/test-trust-safety-http.ts` — notifications REST, éditeur de
  politique et revue navigateur, 75 vérifications.
- `platform/infrastructure/postgres/schema-contract.ts` — contrat actif.
- `scripts/db/schema-contract.ts`, `scripts/db/tls-audit.ts`.
- `scripts/assurance/local.ts` — inventaire capacités et dette UI.
- `.env.local` — primaire et secours Neon en `verify-full` (non versionné).
- Variables Vercel `DATABASE_URL_STANDBY`, `DATABASE_TLS_MODE` (non
  versionnées).

---

## 8. Conclusion

Le socle Trust & Safety est prouvé jusqu’à la notification de recours, la
revue navigateur desktop/mobile est passée, et la production est déployée
avec `activeSchema: ok` et `schemaMatches: true`. Le test compte 59
vérifications. La secours pooler reste une protection d’endpoint, pas une
copie indépendante : c’est la limite de données à ne pas masquer.
