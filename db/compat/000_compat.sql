-- ============================================================
--  000_compat.sql — couche de compatibilité PostgreSQL direct
--
--  Les migrations 001…040 ont été écrites pour Supabase : elles
--  supposent des rôles (`anon`, `authenticated`, `service_role`),
--  un schéma `auth` avec `auth.uid()` / `auth.role()`, une
--  publication `supabase_realtime` et `digest()` dans `extensions`.
--
--  Ce fichier recrée **ces noms**, pas Supabase : aucune requête ne
--  sort de la base, aucune clé n'est nécessaire. Il est le seul
--  endroit où un nom propre à un hébergeur a le droit d'exister
--  (règle d'indépendance, skill §4).
--
--  Idempotent : peut être rejoué sur une base déjà préparée.
--  Exécuté par `npm run db:migrate`, avant les migrations, et suivi
--  dans `public.schema_migrations` comme n'importe quelle migration.
-- ============================================================

-- ── Rôles attendus par les politiques RLS ──────────────────
-- `nologin` : ces rôles ne servent qu'à porter des droits, la
-- connexion se fait par un autre rôle (voir ADR 0004 et §5.2).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- ── Extensions ─────────────────────────────────────────────
-- `pgcrypto` vit dans `extensions` : la migration 023 appelle
-- `extensions.digest(...)` en le qualifiant explicitement.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ── Schéma `auth` minimal ──────────────────────────────────
-- `auth.users` garde la forme lue par `handle_new_user()`
-- (colonnes `id`, `email`, `raw_user_meta_data`).
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null default '',
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Identité posée par requête, dans la transaction, jamais au niveau
-- session : `set_config(..., true)` est local à la transaction, donc
-- un pool ne peut pas faire fuir l'identité d'un utilisateur à
-- l'autre (piège mortel n°1 du skill §5.2).
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;

-- ── Publication temps réel ─────────────────────────────────
-- Les migrations font `alter publication supabase_realtime add table`.
-- Sans cette publication, elles échouent dès la 001. Elle ne sert à
-- rien en PostgreSQL direct (le temps réel passera par du polling,
-- skill §7) mais elle évite de réécrire l'historique.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;
end
$$;

-- ── Droits de base ─────────────────────────────────────────
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;

-- Les tables créées ensuite (par les migrations) doivent être
-- atteignables par les rôles RLS, sinon les politiques ne sont
-- jamais évaluées : `permission denied` au lieu d'un refus propre.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

-- ── `search_path` de la base ───────────────────────────────
-- Nouvelle sessions uniquement : `public` d'abord, puis `extensions`.
do $$
begin
  execute format('alter database %I set search_path = public, extensions', current_database());
end
$$;
