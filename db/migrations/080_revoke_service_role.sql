-- 080 — Retirer le rôle de service hérité de Supabase
--
-- Le schéma initial a été créé pour Supabase. Le rôle `service_role` y
-- contourne la RLS (`rolbypassrls = true`) et porte 567 privilèges de
-- table + 99 privilèges de fonction dans `public`. L'application ne
-- l'utilise nulle part : elle se connecte directement à PostgreSQL et
-- emprunte `authenticated` / `anon` pour les requêtes utilisateur.
--
-- Pire, le propriétaire de la base (`neondb_owner`) était membre de
-- `service_role`. Une connexion d'administration pouvait donc conserver
-- le contournement RLS par héritage, même après avoir posé `set role
-- authenticated`. Ce n'est pas un rôle de lecture : c'est une porte
-- dérobée.
--
-- La migration est idempotente et ne fait rien sur une installation qui
-- n'a jamais connu Supabase. Elle ne supprime pas le rôle : des scripts
-- externes ou une restauration peuvent encore le référencer ; elle lui
-- retire tout pouvoir et interdit sa connexion.

do $$
declare
  member_name text;
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    return;
  end if;

  /* Sur l'émulateur Supabase local, `service_role` et ses rôles réservés
     appartiennent à la plateforme : un rôle non superutilisateur ne peut
     pas les modifier. La production Neon n'a pas ces rôles, donc la
     migration reste effective là où elle compte. */
  if exists (select 1 from pg_roles where rolname = 'supabase_realtime_admin') then
    raise warning 'installation Supabase locale : service_role est géré par la plateforme, migration ignorée';
    return;
  end if;

  execute 'revoke all privileges on all tables in schema public from service_role';
  execute 'revoke all privileges on all sequences in schema public from service_role';
  execute 'revoke all privileges on all functions in schema public from service_role';
  execute 'revoke all privileges on schema public from service_role';

  /* Les rôles réservés de l'émulateur Supabase local ne peuvent pas être
     modifiés par un rôle non superutilisateur. Ils ne servent pas
     l'application ; on les laisse au gestionnaire local, et la preuve
     finale ci-dessous exclut leur appartenance. */
  for member_name in
    select m.rolname
      from pg_auth_members a
      join pg_roles r on r.oid = a.roleid
      join pg_roles m on m.oid = a.member
     where r.rolname = 'service_role'
       and m.rolname not like 'supabase\_%' escape '\'
  loop
    execute format('revoke service_role from %I', member_name);
  end loop;

  execute 'alter role service_role nologin';
end
$$;

comment on role service_role is
  'Rôle de service hérité de Supabase, neutralisé par la migration 080 : aucun privilège public, aucune connexion, aucune appartenance.';

-- Preuve consultable par l'exploitation : plus aucune table publique ne
-- doit être accessible à service_role.
do $$
declare
  remaining integer;
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    return;
  end if;

  if exists (select 1 from pg_roles where rolname = 'supabase_realtime_admin') then
    return;
  end if;

  select count(*) into remaining
    from information_schema.role_table_grants
   where grantee = 'service_role'
     and table_schema = 'public';

  if remaining <> 0 then
    raise exception 'service_role conserve encore % privilège(s) de table', remaining;
  end if;

  /* Une appartenance sans `set_option` ne permet pas de revêtir le rôle.
     C'est le droit effectif qui compte, pas la simple ligne d'appartenance.
     Les rôles réservés locaux sont hors du périmètre de cette migration. */
  select count(*) into remaining
    from pg_auth_members a
    join pg_roles r on r.oid = a.roleid
    join pg_roles m on m.oid = a.member
   where r.rolname = 'service_role'
     and a.set_option
     and m.rolname not like 'supabase\_%' escape '\';

  if remaining <> 0 then
    raise exception 'service_role conserve encore % appartenance(s) avec SET', remaining;
  end if;
end
$$;
