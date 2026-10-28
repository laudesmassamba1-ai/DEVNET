-- ============================================================
--  DEVNET — migration v37 : vérification des comptes
--  Supabase → SQL Editor → Run
--
--  Avant cette migration, `verified` n'était qu'un booléen posé à
--  l'inscription : rien ne pouvait le demander, rien ne pouvait
--  l'accorder, et n'importe quel titulaire pouvait l'écrire soi-même
--  (la politique `users_update` de la 001 ne dit rien des colonnes).
--
--  Trois décisions, dans cet ordre :
--   1. la **demande** vit sur la ligne du compte — pas de table à part,
--      parce qu'on ne veut jamais deux demandes en parallèle ;
--   2. le **droit** est porté par `is_admin` : un rôle de compte, pas un
--      rôle de conteneur (ce ne sont ni les groupes ni les communautés) ;
--   3. le **verrou** est un déclencheur, car la RLS raisonne en lignes
--      et ne protège pas une colonne.
-- ============================================================

-- ── Colonnes ────────────────────────────────────────────────

alter table public.users
  add column if not exists is_admin boolean not null default false;

alter table public.users
  add column if not exists verification_status text not null default 'none';

alter table public.users
  add column if not exists verification_note text not null default '';

alter table public.users
  drop constraint if exists users_verification_status_check;

alter table public.users
  add constraint users_verification_status_check
  check (verification_status in ('none', 'attente', 'acceptee', 'refusee'));

-- La file d'attente est `where verification_status = 'attente'` :
-- sans index, elle se relit à chaque visite de la page d'administration.
create index if not exists users_verification_queue_idx
  on public.users (verification_status, created_at)
  where verification_status = 'attente';

-- ── Le rôle ─────────────────────────────────────────────────

/**
 * Ce compte est-il l'administration du site ?
 *
 * `security definer` et `stable` : la fonction est appelée depuis des
 * politiques et depuis le déclencheur ci-dessous. Sans élévation, elle
 * lirait `users` avec les droits de l'appelant — donc, depuis une
 * politique sur `users`, elle se relirait elle-même.
 *
 * `auth.uid() is null` = appel hors session : migration, seed, service
 * role. C'est par là que le schéma se sert lui-même.
 */
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is null
      or exists (select 1 from public.users where id = auth.uid() and is_admin);
$$;

-- ── Le verrou : qui peut écrire `verified` et `is_admin` ────

/**
 * Refuse l'auto-vérification.
 *
 * La RLS, ici, ne suffit pas : `users_update` autorise la ligne de soi,
 * et « la mienne » contient `verified`. On ne peut donc pas protéger une
 * colonne avec une politique de ligne — d'où ce déclencheur, qui regarde
 * **le changement**, pas la ligne.
 *
 * `auth.uid() is null` laisse passer le schéma (migration, seed) et le
 * service role : sans cette branche, le premier `insert` de `seed.sql`
 * échouerait, `auth.uid()` y étant nul et `verified` modifié.
 */
create or replace function public.guard_account_roles()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.verified is distinct from old.verified then
    raise exception 'permission denied for column "verified" (42501) — seule l''administration vérifie un compte';
  end if;

  if new.is_admin is distinct from old.is_admin then
    raise exception 'permission denied for column "is_admin" (42501) — seule l''administration nomme un administrateur';
  end if;

  -- Une demande s'envoie et se retire, mais ne se « valide » pas :
  -- passer `attente` à `acceptee` soi-même reviendrait à s'auto-vérifier.
  -- Et un refus ne se prononce pas non plus : on retire, on attend.
  if new.verification_status is distinct from old.verification_status
     and new.verification_status not in ('none', 'attente') then
    raise exception 'permission denied for column "verification_status" (42501) — la décision revient à l''administration';
  end if;

  return new;
end;
$$;

drop trigger if exists users_guard_account_roles on public.users;
create trigger users_guard_account_roles
  before update on public.users
  for each row execute function public.guard_account_roles();

-- ── Les politiques de mise à jour ───────────────────────────

-- `users_update` (001) ne disait ni `with check` ni frontière de colonne.
-- On la referme sur la ligne de soi, et on ouvre une seconde pour
-- l'administration : c'est elle qui porte les décisions.
drop policy if exists "users_update" on public.users;
create policy "users_update" on public.users
  for update
  using  (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "users_admin_update" on public.users;
create policy "users_admin_update" on public.users
  for update
  using  (public.is_admin())
  with check (public.is_admin());
