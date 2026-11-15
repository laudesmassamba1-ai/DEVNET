-- ============================================================
-- 059 — Journal d'audit de l'administration
--
-- Les décisions sensibles sont déjà protégées par `guard_account_roles`
-- (037/044). Il manquait la trace : qui a nommé un administrateur, qui a
-- vérifié un compte, qui a classé un signalement.
--
-- Le journal est **append-only** : aucune politique d'update ou de delete
-- n'est créée. Le trigger s'exécute en `security definer` pour pouvoir
-- écrire alors que la table est fermée aux écritures clientes.
-- ============================================================

create table if not exists public.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.users(id) on delete set null,
  action      text not null,
  target_type text not null,
  target_id   text not null,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;

drop policy if exists admin_audit_read on public.admin_audit_log;
create policy admin_audit_read
  on public.admin_audit_log
  for select
  using (public.is_admin());

revoke insert, update, delete on public.admin_audit_log from anon, authenticated;
grant select on public.admin_audit_log to authenticated;

create or replace function public.log_admin_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if tg_table_name = 'users' then
    if new.is_admin is distinct from old.is_admin then
      insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
      values (
        actor, 'admin.role', 'user', new.id::text,
        jsonb_build_object('before', old.is_admin, 'after', new.is_admin)
      );
    end if;

    if new.verified is distinct from old.verified then
      insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
      values (
        actor, 'admin.verified', 'user', new.id::text,
        jsonb_build_object('before', old.verified, 'after', new.verified)
      );
    end if;

    if new.verification_status is distinct from old.verification_status then
      insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
      values (
        actor, 'admin.verification_status', 'user', new.id::text,
        jsonb_build_object('before', old.verification_status, 'after', new.verification_status)
      );
    end if;
  elsif tg_table_name = 'reports' then
    if new.status is distinct from old.status then
      insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
      values (
        actor, 'moderation.report', new.target_type, new.id::text,
        jsonb_build_object('before', old.status, 'after', new.status, 'reason', new.reason)
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists admin_audit_users on public.users;
create trigger admin_audit_users
  after update of is_admin, verified, verification_status on public.users
  for each row execute function public.log_admin_changes();

drop trigger if exists admin_audit_reports on public.reports;
create trigger admin_audit_reports
  after update of status on public.reports
  for each row execute function public.log_admin_changes();

comment on table public.admin_audit_log is
  'Journal append-only des décisions d''administration ; lecture réservée aux administrateurs.';
