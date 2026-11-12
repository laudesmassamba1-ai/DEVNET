-- ============================================================
--  DEVNET — migration v2 : comptes étudiant / professionnel
--  Supabase → SQL Editor → Run
--  (après avoir exécuté schema.sql)
-- ============================================================

alter table public.users
  add column if not exists account_type text not null default 'student';

alter table public.users
  add column if not exists verified boolean not null default false;

alter table public.users
  drop constraint if exists users_account_type_check;

alter table public.users
  add constraint users_account_type_check
  check (account_type in ('student', 'professional'));

-- ------------------------------------------------------------
--  Échelle de confiance
--  Un compte étudiant se crée en 30 s : on borne ses capacités
--  pour que le spam n'ait aucun intérêt. Le compte professionnel
--  est vérifiable, donc il débloque la portée maximale.
-- ------------------------------------------------------------

-- Un étudiant ne peut pas démarrer une conversation avec un pro.
create or replace function public.can_message(sender uuid, recipient uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = recipient and account_type = 'professional'
  ) is not true
  or exists (
    select 1 from public.users where id = sender and account_type = 'professional'
  );
$$;

-- Les professionnels sont seuls visibles par un recruteur.
create or replace function public.is_visible_to_recruiters(uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = uid and account_type = 'professional'
  );
$$;

-- ------------------------------------------------------------
--  SÉCURITÉ : les DM n'étaient lisibles que par filtrage client.
--  On passe par une table de jonction et des politiques strictes.
-- ------------------------------------------------------------

create table if not exists public.conversation_members (
  conversation_id text not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_idx
  on public.conversation_members(user_id);

alter table public.conversation_members enable row level security;

drop policy if exists "cm_read" on public.conversation_members;
create policy "cm_read" on public.conversation_members
  for select using (auth.uid() = user_id);

drop policy if exists "cm_insert" on public.conversation_members;
create policy "cm_insert" on public.conversation_members
  for insert with check (auth.uid() = user_id);

-- Remplit la table de jonction à partir du tableau participants existant.
insert into public.conversation_members (conversation_id, user_id)
select c.id, unnest(c.participants)
from public.conversations c
on conflict do nothing;

-- On retire l'ancienne politique trop permissive.
drop policy if exists "dm_read" on public.direct_messages;

create policy "dm_read" on public.direct_messages
  for select using (
    exists (
      select 1 from public.conversation_members m
      where m.conversation_id = direct_messages.conversation_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "gm_read" on public.group_messages;

create policy "gm_read" on public.group_messages
  for select using (
    exists (
      select 1 from public.groups g
      where g.id = group_messages.group_id
        and auth.uid() = any(g.members)
    )
  );

-- Étiquetage des posts pour la recherche par type de compte.
alter table public.posts
  add column if not exists author_type text not null default 'student';

create index if not exists posts_created_idx on public.posts(created_at desc);