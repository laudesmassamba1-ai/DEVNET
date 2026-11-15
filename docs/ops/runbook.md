# Runbook base de données

> Aucune commande de ce document n'affiche ni ne demande un mot de passe dans
> l'URL. `psql` le demande lui-même. Ne collez jamais une URL complète dans un
> ticket, un journal ou une conversation.

## 1. Reconstruire le miroir local

Prérequis : Docker, Node 22, `npm ci` déjà exécuté. Le miroir local est PostgreSQL 18.3.

> Un volume créé par PostgreSQL 15 ne peut pas être ouvert par PostgreSQL 18.
> Le fichier Compose utilise donc `devnet-db-data-v18` ; l'ancien volume
> `devnet-db-data` est conservé pour un retour arrière manuel.

```bash
docker compose up -d db
# Si seul docker-compose v1 est installé et échoue, équivalent :
# docker run -d --name devnet-db \
#   -e POSTGRES_USER=devnet -e POSTGRES_PASSWORD=devnet -e POSTGRES_DB=devnet \
#   -p 5433:5432 -v devnet-db-data-v18:/var/lib/postgresql postgres:18.3-alpine

cp .env.example .env.local
chmod 600 .env.local
```

`.env.local` doit contenir au minimum :

```dotenv
DATABASE_URL=postgres://devnet:devnet@127.0.0.1:5433/devnet
DB_TARGET=local
```

Ces identifiants sont ceux du conteneur jetable, pas d'une base réelle.

## 2. Vérifier et appliquer les migrations

```bash
npm run db:guard                 # affiche hôte masqué + base + opération
npm run db:migrate               # simulation : ne touche à rien
npm run db:migrate -- --apply    # écrit réellement
npm run test:db-migrate          # garde-fous de l'exécuteur
npm run test:db-rls              # RLS, is_admin, withUser ; base locale requise
npm run test:feed-postgres       # adaptateur PostgreSQL du fil ; écrit puis nettoie
```

> **Emplacement des migrations.** L'exécuteur lit `supabase/` (racine), pas
> `supabase/migrations/` : c'est le chemin par défaut de `scripts/db/migrate.ts`.
> Une migration déposée dans `supabase/migrations/` est **silencieusement
> ignorée** — vérifier `npm run db:migrate` en simulation avant de croire qu'un
> fichier est pris en compte.

`db:reset` est strictement local et destructeur :

```bash
npm run db:reset -- --yes
```

Ne jamais lancer `db:reset` avec `DB_TARGET=remote`, ni avec une URL distante.
Le script refuse les deux cas.

## 3. Vérifier le socle applicatif

```bash
npm run test:boundaries
npm run test:db-migrate
npm run test:db-rls
npm run db:backup:remote   # lecture seule, dump chiffré local
npx tsc --noEmit
npm run lint
npm run build
```

Sondes HTTP :

- `GET /api/health` : `200` si le processus vit.
- `GET /api/ready` : `200` si `select 1` répond en moins de 2 s ; `503` avec
  `{ "status": "degraded", "database": "not_configured" | "timeout" | "unavailable" }`.

## 4. Phase 1 distante — état mesuré puis migré

La Phase 1 a été exécutée en **lecture seule** le 2026-11-08. La migration
distante a été appliquée le **2026-11-09**. Résultats détaillés :
[`db-capabilities.md`](./db-capabilities.md).

- hôte : `postgres-dbaas-postgres-devnet-devnet.systalinkdatabases.com`
- port : **33072** (5432 ne répond pas)
- base : `devnet`, rôle : `devnet_u`
- version : **PostgreSQL 18.3** (Percona Server 18.3.1)
- TLS : `ssl = on`, TLSv1.3 ; certificat auto-signé, donc `verify-full`
  échoue sans CA et `sslmode=require` est utilisé
- rôles `anon`, `authenticated`, `service_role` : **créés**, `NOLOGIN`,
  accordés à `devnet_u` ; `service_role` a `BYPASSRLS`
- `devnet_u` n'a **pas** `CREATEROLE` — c'est attendu ; la création des rôles a
  été faite par l'administrateur Systalink
- `devnet_u` n'est **pas propriétaire** de la base, mais `000_compat.sql` a posé
  `ALTER ROLE devnet_u SET search_path = public, extensions` ; le réglage est
  effectif sur une nouvelle session
- **52 migrations appliquées** (`000_compat.sql` + `001…051`) ; compteurs
  distants : 58 tables, 178 politiques, 92 fonctions `public`, 35 déclencheurs,
  14 tables temps réel
- mot de passe de `devnet_u` **renouvelé** ; l'ancien est invalide

Connexion de contrôle, sans mot de passe dans l'URL :

```bash
read -r DB_HOST
read -r DB_USER
read -r DB_NAME
read -r DB_PORT

nc -vz -w 8 "$DB_HOST" "$DB_PORT"
psql "host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER sslmode=require"
```

`psql` demande le mot de passe. Ne jamais le mettre dans l'URL ni dans un
argument de commande.

Dans `psql`, vérifier la connexion réelle :

```sql
select version();
select ssl, version, cipher from pg_stat_ssl where pid = pg_backend_pid();
select current_user, session_user, current_database();
show max_connections;
select pg_size_pretty(pg_database_size(current_database()));
select rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin
  from pg_roles where rolname = current_user;
select name, default_version, installed_version
  from pg_available_extensions where name in ('pgcrypto', 'pg_trgm');
select has_schema_privilege(current_user, 'public', 'CREATE') as can_create_public,
       has_schema_privilege(current_user, 'public', 'USAGE')  as can_use_public;
```

Si `verify-full` échoue à cause d'un certificat auto-signé, ne pas passer en
`disable` : utiliser `require` et ouvrir un ticket pour obtenir le CA. Un
`disable` accepté est un risque à consigner, pas une solution.

## 4.1 Rôles RLS — fait le 2026-11-09

Fichier de référence : [`db/bootstrap/roles.sql`](../../db/bootstrap/roles.sql)
(console « Explorer »/SQL, `systalink psql <id>`, ou support). Courriel type si
la console est inaccessible :
[`ticket-systalink-roles.md`](./ticket-systalink-roles.md). Les rôles ont été
créés par un rôle `CREATEROLE`/superutilisateur **avant** les migrations :

```sql
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant anon, authenticated, service_role to devnet_u;
```

Vérifications exécutées : les trois rôles existent, sont `NOLOGIN`, et sont
membres de `devnet_u`. Ne pas rejouer cette opération sans nécessité ; elle est
idempotente mais doit rester une action d'administration.

`alter database devnet set search_path = public, extensions;` est facultatif :
`devnet_u` n'étant pas propriétaire, `000_compat.sql` a posé le `search_path`
au niveau du rôle. Une nouvelle session hérite bien de
`public, extensions`.

## 4.2 Se connecter en une commande (`npm run db:probe`)

Aucun identifiant à taper, aucun mot de passe à afficher. La cible distante est
dans `.env.remote` (exclu de Git par `.env*`, permissions `600`), chargé par le
script lui-même :

```bash
npm run db:probe:remote   # lecture seule, sortie masquée
```

Équivalent manuel, si vous préférez passer par le shell — **la barre oblique
compte** : `zsh` ne cherche pas le répertoire courant pour `. fichier`, d'où un
« aucun fichier ou dossier de ce nom » alors que le fichier existe.

```bash
set -a; . ./.env.remote; set +a
npm run db:probe
```

La sonde affiche : version, TLS réellement négocié, droits du rôle,
`wal_level`, tables présentes, extensions, puis exécute **dans une transaction
annulée** la création d'un schéma, d'un rôle, d'une extension et d'une
publication. Elle termine par la latence médiane. Rien n'est écrit sur la base.

Codes de sortie : `0` connexion chiffrée, `1` TLS non négocié, `2` connexion
impossible (message seul, sans URL ni mot de passe).

> **Piège connu.** `pg-connection-string` 2.14 traite `sslmode=require` comme
> `verify-full` : avec le certificat auto-signé Systalink, `new Pool({ connectionString })`
> échoue en `SELF_SIGNED_CERT_IN_CHAIN` alors que `psql` se connecte. Le niveau
> TLS est donc résolu par `platform/infrastructure/postgres/tls.ts`, partagé par
> l'application et les scripts. Ne revenez pas à `sslmode=disable` : le module
> le refuse vers un hôte distant. Quand Systalink fournit son CA, posez
> `DATABASE_CA_CERT` (contenu PEM ou chemin) avec `?sslmode=verify-full`.

## 5. Migration distante — ordre obligatoire

**État au 2026-11-09** : les 52 migrations sont déjà appliquées. La procédure
ci-dessous sert aux prochaines migrations. Ne pas rejouer `--apply` sans
simulation et sans nouvelle confirmation.

1. **Sauvegarde récente** vérifiée : `npm run db:backup:remote`, empreinte
   SHA-256 et restauration de contrôle (§ [`backups.md`](./backups.md)).
2. `DB_TARGET=remote` et `CONFIRM_REMOTE=<nom_de_la_base>` dans l'environnement
   de la session, jamais en CI.
3. Simulation : `npm run db:migrate:remote` (lecture seule, aucune confirmation
   nécessaire).
4. Lire le plan à voix haute : nombre de migrations, première, dernière.
5. Confirmation écrite de Laudes.
6. Application : `CONFIRM_REMOTE=devnet npm run db:migrate:remote -- --apply`.
7. Vérifier `schema_migrations`, les comptes d'objets et `/api/ready`.
8. Tester la RLS en lecture seule sur la production, ou sur une base de test si
   des données réelles sont présentes.

## 6. Variables Vercel

| Variable | Preview | Production | Remarque |
|---|---|---|---|
| `DATABASE_URL` | base de test/synthétique | base de production | jamais `NEXT_PUBLIC_` |
| `DB_TARGET` | `local` ou absent | `remote` | pas en CI |
| `CONFIRM_REMOTE` | vide | nom exact de la base | uniquement pendant l'exploitation |
| `EVENTS_DRAIN_SECRET` | secret distinct | secret distinct | jamais dans le client |
| `PLUGINS_DISABLED` | `false` | `false` | coupe-circuit |
| `DATABASE_CA_CERT` | certificat Systalink | certificat Systalink | contenu PEM ou chemin ; requis pour `verify-full` |

La prévisualisation ne doit pas partager la base de production. Si une seule
base existe, les aperçus tournent en démonstration ou sur une base locale.

### 6.1 Brancher l'application — pas d'API séparée

Le navigateur ne parle **jamais** à PostgreSQL. Il appelle les routes de
`app/api/` (ou une page rendue côté serveur), et c'est ce processus Next.js qui
ouvre la connexion avec `pg` :

```text
navigateur → app/api/… (runtime nodejs) → getPostgresPool() → TLS → devnet_u
requête utilisateur → withUser(userId, …) → SET LOCAL ROLE authenticated + claim sub
```

Une API tierce (Express, service séparé, PostgREST auto-hébergé) n'apporte rien
ici : elle doublerait la latence vers Dakar et ajouterait un service à
surveiller. Les routes Next.js **sont** l'API du navigateur.

Brancher une cible :

1. Ajouter `DATABASE_URL` (et `DATABASE_CA_CERT` si disponible) dans
   **Vercel → Settings → Environment Variables**, environnement par
   environnement. Jamais de préfixe `NEXT_PUBLIC_` : cette variable ne doit pas
   exister dans le bundle client.
2. Redéployer — les variables ne sont pas relues par un déploiement existant.
3. Vérifier `GET /api/ready` : `200` + `latencyMs`, ou `503` avec un motif
   (`not_configured`, `timeout`, `unavailable`).
4. Vérifier côté base que l'application se présente :
   `select usename, application_name, state from pg_stat_activity where application_name = 'devnet-web';`
5. Région des fonctions : mesurer, ne pas supposer. `max = 2` par instance ;
   20 instances chaudes = 40 connexions, sous les 100 mesurées, marge gardée.
   La base est à Dakar : comparer les régions candidates sur la latence de
   `/api/ready` avant de figer le choix.

Maintenant que les migrations sont appliquées, `/api/ready` prouve à la fois la
connexion et un schéma présent. La sonde ne remplace pas un test applicatif :
les données et la bascule Supabase → PostgreSQL direct restent à faire.

## 7. Retour arrière

- **Application** : promouvoir le déploiement Vercel précédent.
- **Schéma** : une migration appliquée ne se réécrit pas. Rétablir une sauvegarde
  ou appliquer une migration compensatoire rétro-compatible.
- **Base** : ne jamais supprimer la base précédente avant la fin de la fenêtre
  de vérification (7 jours proposés).

## 8. Arrêt d'urgence

- Erreur de base sur une route : réponse générique, détail dans les journaux
  serveur, sans secret ni donnée personnelle.
- Base indisponible : `/api/ready` renvoie 503 ; l'application bascule sur le
  mode démonstration existant si le backend est injoignable.
- Plugin fautif : `PLUGINS_DISABLED=true` ou quarantaine, sans redéploiement.
