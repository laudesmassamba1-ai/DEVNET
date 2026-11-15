# Plan de sortie — changer de PostgreSQL en moins d'une journée

Objectif : quitter Systalink (ou tout hébergeur PostgreSQL) sans réécrire
l'application. Le seul point de bascule est `DATABASE_URL` et, si le fournisseur
change, la restauration des données.

## 1. Inventaire avant le départ

```sql
select version();
select current_database(), current_user, pg_size_pretty(pg_database_size(current_database()));
select rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin
  from pg_roles
 where rolname not like 'pg\_%';
select name, default_version, installed_version
  from pg_available_extensions
 where installed_version is not null;
select n.nspname, count(*) as objets
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'auth', 'extensions')
 group by n.nspname;
```

Consigner dans `docs/ops/db-capabilities.md` : version, taille, rôles,
extensions, `search_path`, `max_connections`, TLS.

## 2. Préparer la cible

Sur le nouveau PostgreSQL :

1. créer les rôles logiques `anon`, `authenticated`, `service_role` (`NOLOGIN`) ;
2. créer le rôle applicatif non propriétaire (`devnet_app`) avec `LOGIN` ;
3. créer les schémas `auth` et `extensions` ;
4. vérifier la disponibilité de `pgcrypto` et `pg_trgm` ;
5. exécuter `000_compat.sql` puis les migrations avec `db:migrate --apply` ;
6. ne jamais restaurer un dump par-dessus un schéma déjà migré sans avoir vidé
   la cible et vérifié la sauvegarde.

## 3. Répétition à blanc

Sur une base jetable du nouveau fournisseur :

```bash
pg_restore --dbname=<base_de_test> --no-owner backup.dump
psql <base_de_test> -c "select count(*) from public.schema_migrations;"
psql <base_de_test> -c "select count(*) from public.users;"
psql <base_de_test> -c "select count(*) from public.posts;"
```

Conserver les `GRANT` : ils portent la RLS. Créer au besoin les rôles porteurs
d'ACL (`devnet_u`, `postgres`) en `NOLOGIN`, et exclure de la restauration
portable les objets fournisseur `pgaudit` et `pgbouncer`.

Puis `test:db-rls` et un parcours synthétique : inscription, connexion,
publication, message privé, drainage d'un événement.

## 4. Bascule

1. Annoncer une fenêtre courte et geler les écritures si possible.
2. Sauvegarde finale chiffrée + somme de contrôle.
3. Restauration sur la nouvelle base.
4. Vérifier les comptes d'objets, `schema_migrations`, RLS et `/api/ready`.
5. Changer `DATABASE_URL` dans Vercel (preview d'abord, production ensuite).
6. Déployer sans changement de code, puis tester les parcours critiques.
7. Garder l'ancienne base en lecture seule au moins 7 jours.

## 5. Retour arrière

- Remettre l'ancienne `DATABASE_URL` et redéployer la version précédente.
- L'ancienne base n'a pas été supprimée : c'est la condition du retour arrière.
- Ne jamais faire de `db:reset` sur l'une ou l'autre base.

## 6. Ce qui rend le plan réellement exécutable

- Toutes les migrations sont dans le dépôt et rejouables depuis zéro.
- `db/compat/000_compat.sql` isole les noms propres à Supabase.
- Aucun secret n'est dans le dépôt ; les variables se remplacent dans Vercel.
- Le pool et `withUser` ne dépendent pas du fournisseur.
- Les sauvegardes sont chiffrées et restaurées régulièrement, pas seulement copiées.
