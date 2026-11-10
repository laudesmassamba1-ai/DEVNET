# Capacités de la base — mesures et état

- **Dernière mesure locale** : 2026-11-09 (PostgreSQL 18.3)
- **Dernière mesure distante** : 2026-11-09 (PostgreSQL 18.3, après migration)
- **Cible distante** : `postgres-dbaas-postgres-devnet-devnet.systalinkdatabases.com:33072`, base `devnet`, rôle `devnet_u`
- **Statut distant** : **52 migrations appliquées**, rôles RLS créés, `search_path` effectif, mot de passe renouvelé ; l'application n'est pas encore basculée sur cette base
- **Sauvegarde** : dump chiffré GPG du 2026-11-09 restauré en local (52/58/178/90/35/14, RLS et stories verts) ; clé encore locale, copie hors site à faire

## 1. Miroir local mesuré

| Élément | Valeur mesurée |
|---|---|
| Image | `postgres:18.3-alpine` |
| Version serveur | PostgreSQL **18.3** |
| Migrations | `000_compat.sql` + `001…051` = **52 entrées** dans `schema_migrations` |
| Tables `public` | **58** (dont `schema_migrations`) |
| Tables hors suivi | **57** |
| Politiques RLS | **178** |
| Fonctions `public` | **90** : **55** non-déclencheuses + **35** déclencheuses |
| Déclencheurs | **35** dans `public` + **1** sur `auth.users` = **36** |
| Tables publiées en temps réel | **14** |
| Schémas | `auth`, `extensions`, `public` |
| Extensions | `pgcrypto` 1.4 (`extensions`), `pg_trgm` 1.6 (`public`) |
| `search_path` du rôle | `public, extensions` |
| `is_admin()` sans identité | **faux** (migration 044) |
| Taille | ~14 MB |

### Pourquoi les chiffres dépassent la référence du skill

La référence du skill — 46 tables, 160 politiques, 52 fonctions, 32 déclencheurs,
14 tables publiées — décrit l'état après **39 migrations**, hors table de suivi.
Sur la base locale après **51 migrations** :

- **+12 tables** par rapport à la référence : `schema_migrations` (suivi),
  `plugin_state` (042), `event_outbox` et `event_deliveries` (043),
  `auth_sessions` (046), les tables d'interactions de stories et de stickers
  (047 à 051), etc. ;
- **+18 politiques RLS**, portées principalement par ces nouvelles tables ;
- **+38 fonctions `public`** : RPC, fonctions de déclenchement et helpers de
  stories/stickers ajoutés entre 040 et 051 ;
- **+3 déclencheurs** par rapport à la référence.

Les 14 tables de publication temps réel sont inchangées : les nouvelles tables
ne sont pas ajoutées à `supabase_realtime`, elles n'en ont pas besoin.

## 2. Cible distante — état après migration du 2026-11-09

Connexion en `sslmode=require`, certificat non vérifié, aucune écriture hors
migrations et rotation du mot de passe.

| Capacité | Valeur mesurée |
|---|---|
| Version | **PostgreSQL 18.3**, Percona Server for PostgreSQL 18.3.1 |
| Port | **33072** (le port 5432 ne répond pas) |
| `max_connections` | **100** |
| `wal_level` | **logical** |
| Taille de la base | **12 MB** |
| Rôle applicatif | `devnet_u` — **pas** superutilisateur, **pas** `CREATEROLE`, **pas** `BYPASSRLS` |
| Rôles RLS | `anon`, `authenticated`, `service_role` **présents**, `NOLOGIN` ; `service_role` a `BYPASSRLS` |
| Adhésions | `anon`, `authenticated`, `service_role` sont membres de `devnet_u` |
| Schémas | `auth`, `extensions`, `public`, `pgbouncer` (fournisseur) |
| Extensions | `pgcrypto` 1.4 (`extensions`), `pg_trgm` 1.6 (`public`), `pgaudit` 18.0 (`public`, fourni par Systalink) |
| `search_path` de `devnet_u` | **`public, extensions`** (`rolconfig` et `current_setting()` vérifiés) |
| Migrations | **52** dans `schema_migrations`, simulation « Rien à appliquer » |
| Tables `public` | **58** |
| Politiques RLS | **178** |
| Fonctions `public` | **92** (les 2 de plus qu'en local viennent de `pgaudit`) |
| Déclencheurs `public` | **35** |
| Tables temps réel | **14** |
| TLS serveur | `ssl = on`, TLSv1.3, `TLS_AES_256_GCM_SHA384` |
| Certificat | chaîne auto-signée (`pool-postgres-15-ca`) ; `verify-full` échoue sans `root.crt` |
| Chiffrement retenu | `sslmode=require` — chiffré, **sans vérification du certificat**. Côté `pg`, `sslmode=require` est traité comme `verify-full` : voir `platform/infrastructure/postgres/tls.ts` |
| Mot de passe | `scram-sha-256`, **renouvelé le 2026-11-09** |
| Latence | **~211 ms** médiane après rotation (mesures antérieures : 162–175 ms) |
| Données applicatives | **aucune** : le schéma est en place, les données réelles restent à migrer |

Joignabilité re-testée depuis le poste de développement : `getent hosts` →
`102.203.220.31`, `nc -vz <hôte> 33072` → **succeeded**. La console affiche
encore « — », ne pas s'y fier.

### Vérifications de la RLS distante

Test en lecture seule, transaction annulée, rôle `authenticated`, identité
synthétique sans données :

| Table | Lignes visibles |
|---|---|
| `users`, `posts`, `stories`, `story_media`, `direct_messages`, `notifications`, `communities` | 0 |
| `stickers` | 8 (catalogue de base public) |
| `is_admin()` sans identité | `false` |

Aucune erreur de permission : les `GRANT` et les politiques sont cohérents.

### Sonde reproductible — `npm run db:probe:remote`

```bash
npm run db:probe:remote   # lecture seule, sortie masquée
```

La sonde affiche : version, TLS réellement négocié, droits du rôle,
`wal_level`, tables présentes, extensions, puis exécute **dans une transaction
annulée** la création d'un schéma, d'un rôle, d'une extension et d'une
publication. Elle termine par la latence médiane. Rien n'est écrit sur la base.

- `create role` reste refusé (`42501`) : c'est attendu, `devnet_u` n'a pas
  `CREATEROLE` et ne doit pas l'avoir.
- La simulation `npm run db:migrate:remote` répond désormais « Rien à
  appliquer » ; `CONFIRM_REMOTE=devnet npm run db:migrate:remote -- --apply`
  a appliqué les 52 migrations le 2026-11-09.

### Conséquences immédiates

- La migration distante est faite ; le seul blocage restant n'est plus
  `CREATE ROLE` mais la **bascule applicative** et la **sauvegarde chiffrée**.
- `withUser()` fait `SET LOCAL ROLE authenticated` : les adhésions de
  `devnet_u` aux trois rôles sont vérifiées, la RLS peut être exercée.
- `000_compat.sql` pose `ALTER ROLE devnet_u SET search_path = public,
  extensions` ; une nouvelle session distante hérite bien de ce chemin. Des
  sessions PgBouncer déjà ouvertes peuvent conserver l'ancien `search_path`
  jusqu'à leur recyclage.
- `sslmode=require` protège le transport mais ne prouve pas l'identité du
  serveur. Obtenir le certificat CA Systalink pour passer à `verify-full` reste
  un ticket à ouvrir ; `disable` reste interdit.
- La latence de ~200 ms impose de borner les requêtes et d'éviter les N+1.
- `pgaudit` est installé dans `public` par le fournisseur ; il ne fait pas
  partie des migrations DevNet. Le schéma `pgbouncer` et sa fonction
  `get_auth(text)` sont également gérés par le fournisseur. Ne pas les
  déplacer ni les désinstaller sans accord ; une restauration portable les
  exclut (voir `backups.md`).

### Sécurité

- Le mot de passe du rôle `devnet_u` a été exposé dans une conversation le
  2026-11-08 ; il a été **renouvelé le 2026-11-09**. L'ancien mot de passe est
  invalide. La nouvelle valeur n'existe que dans `.env.remote`, ignoré par Git
  et en permissions `600`. Aucune valeur de secret n'est écrite dans ce
  document.
- `verify-full` nécessite le CA Systalink ; en attendant, `require` est le
  maximum disponible. `disable` reste interdit.
- Les rôles `anon`, `authenticated`, `service_role` sont créés et accordés ;
  ils ne doivent pas devenir `LOGIN` pour autant.
- La base reste accessible depuis `0.0.0.0/0` : aucune donnée réelle
  d'utilisateur ne doit y être déposée avant la revue de ce point.

Les commandes complètes sont dans [`runbook.md`](./runbook.md), sans mot de passe.

## 3. Stratégie de rôles

**Stratégie A — retenue et appliquée.** `000_compat.sql` crée les rôles logiques
`anon`, `authenticated`, `service_role` (`NOLOGIN`) et le schéma `auth`.
L'application atteint ces rôles par `SET LOCAL ROLE` dans `withUser()`.

**Stratégie B — repli.** Si Systalink interdit un jour la création des rôles,
l'application se connecte avec un rôle applicatif non propriétaire,
`FORCE ROW LEVEL SECURITY` est appliqué là où c'est nécessaire, et le risque est
consigné. Aucune décision distante n'est prise avant la mesure des privilèges.

## 4. Décision de disponibilité

- `/api/health` : vivacité du processus, sans base.
- `/api/ready` : `select 1` borné à 2 s, réponse 503 générique si la base manque.
- Mode dégradé applicatif : le mode démonstration existant reste le repli visible.
- `db:migrate` est en **simulation par défaut** ; `--apply` est obligatoire pour écrire.
- `DB_TARGET=remote` exige `CONFIRM_REMOTE=<nom_de_la_base>` ; `db:reset` est refusé.
