-- ============================================================
-- 044 — `is_admin()` exige une identité
--
-- La 037 laissait passer `auth.uid() is null` : toute connexion qui
-- n'avait pas posé d'identité — un script, un pool mal configuré, un
-- rôle trop large — était traitée comme administratrice. C'est le
-- contraire d'un contrôle d'accès : l'absence d'identité devenait le
-- plus haut privilège.
--
-- Désormais :
--   · `is_admin()` ne répond vrai que pour un compte marqué admin ;
--   · le contournement réservé aux migrations et au serveur se lit
--     sur `current_user = session_user`, c'est-à-dire une connexion
--     qui n'a pas endossé un rôle client (`SET LOCAL ROLE authenticated`).
--
-- `guard_account_roles()` reste `security invoker` : il ne lit aucune
-- table lui-même, il appelle `is_admin()` qui est `security definer`.
-- Ainsi `current_user` est bien le rôle de l'appelant, pas le
-- propriétaire de la fonction.
-- ============================================================

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and is_admin
  );
$$;

create or replace function public.guard_account_roles()
returns trigger
language plpgsql set search_path = public as $$
begin
  -- Connexion de service ou de migration : soit le rôle de session n'a
  -- pas été remplacé (`current_user = session_user`), soit le serveur a
  -- explicitement endossé `service_role`. Un client ne peut pas endosser
  -- ce rôle sans appartenance accordée par l'administrateur.
  if current_user = session_user or current_user = 'service_role' then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  if new.verified is distinct from old.verified then
    raise exception 'permission denied for column "verified" — seule l''administration vérifie un compte'
      using errcode = '42501';
  end if;

  if new.is_admin is distinct from old.is_admin then
    raise exception 'permission denied for column "is_admin" — seule l''administration nomme un administrateur'
      using errcode = '42501';
  end if;

  if new.verification_status is distinct from old.verification_status
     and new.verification_status not in ('none', 'attente') then
    raise exception 'permission denied for column "verification_status" — la décision revient à l''administration'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.is_admin() is
  'Vrai uniquement pour un compte administrateur identifié ; jamais pour une session sans identité.';
