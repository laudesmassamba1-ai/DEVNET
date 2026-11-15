-- 028 — Communautés : des fils publics, distincts des groupes.
--
-- Un **groupe** est une salle : des canaux, des messages en temps réel,
-- une porte d'entrée. Une **communauté** est un fil : on y publie des
-- posts, on s'y abonne pour suivre un thème, on en lit le règlement. Les
-- deux ne se remplacent pas — c'est pourquoi un post ne rejoint pas un
-- groupe.
--
-- On pose trois choses :
--  1. `communities` et `community_members`, miroir des tables de groupe
--     (`owner | moderator | member`), plus une `visibility` que les
--     groupes n'ont pas ;
--  2. une colonne `posts.community_id` — un post appartient au plus à une
--     communauté, et une communauté supprimée ne doit pas emporter le
--     post (`on delete set null`) : un texte public reste public ;
--  3. les politiques qui bornent l'écriture, et une politique
--     **restrictive** à l'insertion d'un post pour qu'une communauté
--     `private` ne se remplisse que de ses membres.

-- ---------------------------------------------------------------------
-- 1. Les tables
-- ---------------------------------------------------------------------

create table if not exists public.communities (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  description  text default '',
  -- Le règlement n'est pas une donnée de présentation : c'est ce que la
  -- modération s'appuie pour trancher. Il vit en base, dans une colonne,
  -- pour rester retrouvable après un changement d'écran.
  rules        text default '',
  icon         text default 'globe',
  visibility   text not null default 'public'
                 check (visibility in ('public', 'restricted', 'private')),
  created_by   uuid references public.users(id) on delete set null,
  member_count int  default 0,
  created_at   timestamptz default now()
);

create index if not exists communities_slug_idx on public.communities (slug);

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references public.users(id)       on delete cascade,
  role         text not null default 'member'
                 check (role in ('owner', 'moderator', 'member')),
  joined_at    timestamptz default now(),
  primary key (community_id, user_id)
);

-- ---------------------------------------------------------------------
-- 2. Le rattachement d'un post
-- ---------------------------------------------------------------------

-- `set null` et non `cascade` : supprimer une communauté retire le
-- **classement** d'un post, jamais le post lui-même. Un texte écrit pour
-- être lu publiquement ne disparaît pas parce que son rayon a fermé.
alter table public.posts
  add column if not exists community_id uuid references public.communities(id) on delete set null;

-- Le fil d'une communauté est la requête la plus fréquente : on indexe la
-- colonne, avec un index partiel (la plupart des posts n'ont pas de
-- communauté, et une ligne `null` n'a rien à faire dans l'index).
create index if not exists posts_community_idx
  on public.posts (community_id, created_at desc)
  where community_id is not null;

-- ---------------------------------------------------------------------
-- 2. Lire qui est qui
-- ---------------------------------------------------------------------

-- Comme `group_role()` (020) et `project_role()` (027) : une fonction
-- `security definer` pour lire le rôle **sans** repasser par les
-- politiques de `community_members`. Une politique qui se lirait
-- elle-même produirait une récursion infinie.
create or replace function public.community_role(c uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.community_members
  where community_id = c and user_id = auth.uid()
$$;

comment on function public.community_role(uuid) is
  'Rôle de l''appelant dans une communauté : owner | moderator | member | null.';

-- Peut-on **publier** dans la communauté ? Plus strict que la lecture :
-- une communauté `restricted` se lit partout, mais on n'y publie qu'une
-- fois membre ; `private` non plus. Seule `public` ouvre l'écriture à
-- tous. C'est la règle qui donne un sens au mot « restreint ».
create or replace function public.can_post_community(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.communities
    where id = c
      and (visibility = 'public'
           or exists (
             select 1 from public.community_members
             where community_id = c and user_id = auth.uid()
           ))
  )
$$;

comment on function public.can_post_community(uuid) is
  'Peut-on publier dans la communauté : publique, ou dont l''appelant est membre.';

-- Une communauté est lisible si elle est publique ou restreinte, ou si
-- l'appelant en est membre. `private` disparaît pour tout le reste.
create or replace function public.can_read_community(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.communities
    where id = c
      and (visibility in ('public', 'restricted')
           or exists (
             select 1 from public.community_members
             where community_id = c and user_id = auth.uid()
           ))
  )
$$;

comment on function public.can_read_community(uuid) is
  'La communauté est-elle visible par l''appelant (publique, restreinte, ou dont il est membre) ?';

-- `member_count` est un cache : il se recalcule depuis les adhésions,
-- jamais depuis le client (la politique de mise a jour le retire des
-- colonnes modifiables). Meme declencheur que `sync_group_members` (005) :
-- un compteur tenu a la main derive au premier retrait oublie.
create or replace function public.sync_community_members()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.communities c
     set member_count = (select count(*) from public.community_members m where m.community_id = c.id)
   where c.id = coalesce(new.community_id, old.community_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists on_community_members_change on public.community_members;
create trigger on_community_members_change
  after insert or delete on public.community_members
  for each row execute function public.sync_community_members();

comment on function public.sync_community_members() is
  'Recalcule communities.member_count a chaque changement d''adhesion.';

-- Un rôle erroné ne doit pas être écrit : l'application compare des
-- chaînes exactes pour décider de qui modère.
alter table public.community_members
  drop constraint if exists community_members_role_check;
alter table public.community_members
  add constraint community_members_role_check
  check (role in ('owner', 'moderator', 'member'));

-- ---------------------------------------------------------------------
-- 3. Les politiques
-- ---------------------------------------------------------------------

alter table public.communities      enable row level security;
alter table public.community_members enable row level security;

drop policy if exists communities_read   on public.communities;
create policy communities_read on public.communities
  for select using (public.can_read_community(id));

drop policy if exists communities_insert on public.communities;
create policy communities_insert on public.communities
  for insert with check (auth.uid() = created_by);

drop policy if exists communities_update on public.communities;
create policy communities_update on public.communities
  for update using (public.community_role(id) in ('owner', 'moderator'))
  with check (public.community_role(id) in ('owner', 'moderator'));

drop policy if exists communities_delete on public.communities;
create policy communities_delete on public.communities
  for delete using (auth.uid() = created_by);

-- L'adhésion se lit quand la communauté se lit : compter ses membres n'est
-- pas plus secret que le fil.
drop policy if exists "community_members_read" on public.community_members;
create policy "community_members_read" on public.community_members
  for select using (public.can_read_community(community_id));

-- On rejoint une communauté **soi-même** (rôle `member`), ou un
-- modérateur/propriétaire ajoute quelqu'un. On ne s'auto-promeut pas : la
-- ligne de soi n'existe pas encore, donc le premier `join` pose `member`.
drop policy if exists "community_members_insert" on public.community_members;
create policy "community_members_insert" on public.community_members
  for insert with check (
    (auth.uid() = user_id and role = 'member')
    or public.community_role(community_id) in ('owner', 'moderator')
  );

drop policy if exists "community_members_update" on public.community_members;
create policy "community_members_update" on public.community_members
  for update using (public.community_role(community_id) in ('owner', 'moderator'));

-- Partir soi-même, ou être retiré par l'équipe. Comme `group_members` :
-- le `role = 'member'` protège les modérateurs et le propriétaire.
drop policy if exists "community_members_delete" on public.community_members;
create policy "community_members_delete" on public.community_members
  for delete using (
    auth.uid() = user_id
    or public.community_role(community_id) in ('owner', 'moderator')
  );

-- Un post ne peut être rattaché qu'à une communauté où l'on peut
-- **publier** : publique pour tous, restreinte ou privée pour ses membres.
-- Le règlement est donc respecté par la base, pas par l'écran.
--
-- C'est une politique **restrictive** : elle se cumule aux politiques
-- permissives existantes de `posts` (001) au lieu de les remplacer. Les
-- posts sans communauté (`community_id is null`) ne sont pas concernés.
drop policy if exists "posts_community_scope" on public.posts;
create policy "posts_community_scope" on public.posts
  as restrictive
  for insert with check (
    community_id is null or public.can_post_community(community_id)
  );

-- Un posteur ne doit pas pouvoir **déplacer** son post vers une communauté
-- qu'il ne peut pas lire, un `update` contournerait la règle ci-dessus.
-- La RLS raisonne en lignes, pas en colonnes : on ferme donc l'écriture de
-- `community_id` après création, comme `revoke update` le fait ailleurs.
revoke update (community_id) on public.posts from authenticated, anon;
