-- ============================================================
--  DEVNET — migration v5 : graphe social, likes, commentaires
--  Supabase → SQL Editor → Run
--  (après 001_schema.sql et 002_accounts.sql)
--
--  Trois corrections de fond, pas trois tables de plus :
--
--   1. `posts_update` et `groups_update` disaient `auth.role()='authenticated'`.
--      Concrètement : n'importe quel utilisateur authentifié pouvait
--      modifier n'importe quel post, y compris `liked_by` et `likes`.
--      Le compteur de likes était donc une donnée que n'importe qui
--      pouvait écrire. On durcit, puis on retire la colonne du périmètre.
--
--   2. Le like passe sur une table de jonction `post_likes`. Un like
--      devient une ligne, donc il est unique, donc il ne peut plus être
--      compté deux fois ni forcé à 9999. La colonne `posts.likes` reste
--      un cache, maintained par un déclencheur — jamais écrite par le client.
--
--   3. Le suivi passe sur `follows`, l'adhésion à un groupe sur
--      `group_members`. Même raison : un tableau `uuid[]` dans une ligne
--      ne peut pas être protégé colonne par colonne, donc il ne peut pas
--      être protégé du tout.
-- ============================================================


-- ------------------------------------------------------------
--  1. LIKES
-- ------------------------------------------------------------

create table if not exists public.post_likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.users(id)  on delete cascade,
  created_at timestamptz default now(),
  primary key (post_id, user_id)
);

create index if not exists post_likes_user_idx on public.post_likes(user_id, created_at desc);

alter table public.post_likes enable row level security;

drop policy if exists "post_likes_read" on public.post_likes;
create policy "post_likes_read" on public.post_likes
  for select using (auth.role() = 'authenticated');

drop policy if exists "post_likes_insert" on public.post_likes;
create policy "post_likes_insert" on public.post_likes
  for insert with check (auth.uid() = user_id);

drop policy if exists "post_likes_delete" on public.post_likes;
create policy "post_likes_delete" on public.post_likes
  for delete using (auth.uid() = user_id);


-- ------------------------------------------------------------
--  2. COMMENTAIRES
-- ------------------------------------------------------------

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  author_id  uuid references public.users(id) on delete set null,
  text       text not null check (char_length(trim(text)) between 1 and 1000),
  created_at timestamptz default now()
);

create index if not exists comments_post_idx on public.comments(post_id, created_at asc);

alter table public.comments enable row level security;

drop policy if exists "comments_read" on public.comments;
create policy "comments_read" on public.comments
  for select using (auth.role() = 'authenticated');

drop policy if exists "comments_insert" on public.comments;
create policy "comments_insert" on public.comments
  for insert with check (auth.uid() = author_id);

-- On peut effacer son commentaire, ou effacer le post — ce qui efface
-- du même coup tous ses commentaires (cascade). Sans le second cas,
-- l'auteur d'un post ne pourrait pas cleansup sa publication.
drop policy if exists "comments_delete" on public.comments;
create policy "comments_delete" on public.comments
  for delete using (
    auth.uid() = author_id
    or exists (select 1 from public.posts p where p.id = comments.post_id and p.author_id = auth.uid())
  );

-- La lecture comme la modification restent interdites : on ne réécrit pas
-- un commentaire publié, on le supprime et on repost. C'est le même
-- principe que pour un message : l'historique ne se réécrit pas.
drop policy if exists "comments_update" on public.comments;


-- ------------------------------------------------------------
--  3. SUIVI
-- ------------------------------------------------------------

create table if not exists public.follows (
  follower_id uuid not null references public.users(id) on delete cascade,
  followee_id uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz default now(),
  primary key (follower_id, followee_id),
  -- On ne se suit pas soi-même : la contrainte est dans la base, pas
  -- seulement dans l'écran. Un client qui l'ignore ne doit pas pouvoir
  -- se suivre lui-même.
  constraint follows_no_self check (follower_id <> followee_id)
);

create index if not exists follows_followee_idx on public.follows(followee_id);

alter table public.follows enable row level security;

drop policy if exists "follows_read" on public.follows;
create policy "follows_read" on public.follows
  for select using (auth.role() = 'authenticated');

drop policy if exists "follows_insert" on public.follows;
create policy "follows_insert" on public.follows
  for insert with check (auth.uid() = follower_id);

drop policy if exists "follows_delete" on public.follows;
create policy "follows_delete" on public.follows
  for delete using (auth.uid() = follower_id);


-- ------------------------------------------------------------
--  4. ADHÉSION AUX GROUPES
-- ------------------------------------------------------------

create table if not exists public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references public.users(id)  on delete cascade,
  role      text not null default 'member'
              check (role in ('owner', 'moderator', 'member')),
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on public.group_members(user_id);

alter table public.group_members enable row level security;

drop policy if exists "gm_read" on public.group_members;
create policy "group_members_read" on public.group_members
  for select using (auth.role() = 'authenticated');

-- On peut rejoindre un groupe, ou en sortir : dans les deux cas la
-- ligne porte son propre `user_id`, donc le client ne peut écrire que
-- sa propre adhésion.
--
-- Le rôle se règle ICI et pas dans un CHECK : une contrainte CHECK ne
-- voit que la ligne, pas l'appelant, et `check (role in ('member',
-- 'moderator') or role = 'owner')` autoriserait les trois — elle
-- ressemblerait à une protection sans rien interdire. Ici, le client
-- ne peut s'inscrire que comme `member` ; seul le créateur du groupe
-- se réinscrit comme `owner`, et lui seul peut nommer un modérateur.
drop policy if exists "group_members_insert" on public.group_members;
create policy "group_members_insert" on public.group_members
  for insert with check (
    auth.uid() = user_id
    and (
      role = 'member'
      or exists (select 1 from public.groups g
                  where g.id = group_members.group_id
                    and g.created_by = auth.uid())
    )
  );

drop policy if exists "group_members_delete" on public.group_members;
create policy "group_members_delete" on public.group_members
  for delete using (
    auth.uid() = user_id
    or exists (select 1 from public.groups g where g.id = group_members.group_id and g.created_by = auth.uid())
  );

-- Changer le rôle d'un membre : réservé au créateur du groupe.
drop policy if exists "group_members_update" on public.group_members;
create policy "group_members_update" on public.group_members
  for update using (
    exists (select 1 from public.groups g where g.id = group_members.group_id and g.created_by = auth.uid())
  );


-- ------------------------------------------------------------
--  5. COMPTEURS : un déclencheur, une source de vérité
-- ------------------------------------------------------------
--
--  `posts.likes`, `posts.comments`, `users.followers`, `users.following`
--  et `groups.member_count` sont des **caches**. Ils se recalculent à
--  partir des tables de jonction, jamais à partir de ce qu'un client
--  dit avoir écrit. Un cache mal maintenu se voit ; un cache que le
--  client écrit ne se voit jamais, et c'est exactement le bug qu'on
--  vient de corriger.
-- ------------------------------------------------------------

create or replace function public.sync_post_likes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.posts p
     set likes = (select count(*) from public.post_likes l where l.post_id = p.id)
   where p.id = coalesce(new.post_id, old.post_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists on_post_likes_change on public.post_likes;
create trigger on_post_likes_change
  after insert or delete on public.post_likes
  for each row execute function public.sync_post_likes();


create or replace function public.sync_post_comments()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.posts p
     set comments = (select count(*) from public.comments c where c.post_id = p.id)
   where p.id = coalesce(new.post_id, old.post_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists on_comments_change on public.comments;
create trigger on_comments_change
  after insert or delete on public.comments
  for each row execute function public.sync_post_comments();


create or replace function public.sync_follows()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a uuid := coalesce(new.follower_id, old.follower_id);
  b uuid := coalesce(new.followee_id, old.followee_id);
begin
  update public.users u set following = (select count(*) from public.follows f where f.follower_id = u.id)
   where u.id = a;
  update public.users u set followers = (select count(*) from public.follows f where f.followee_id = u.id)
   where u.id = b;
  return coalesce(new, old);
end;
$$;

drop trigger if exists on_follows_change on public.follows;
create trigger on_follows_change
  after insert or delete on public.follows
  for each row execute function public.sync_follows();


create or replace function public.sync_group_members()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.groups g
     set member_count = (select count(*) from public.group_members m where m.group_id = g.id)
   where g.id = coalesce(new.group_id, old.group_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists on_group_members_change on public.group_members;
create trigger on_group_members_change
  after insert or delete on public.group_members
  for each row execute function public.sync_group_members();


-- ------------------------------------------------------------
--  6. RLS : les deux politiques qui laissaient tout passer
-- ------------------------------------------------------------

-- AVANT : `using (auth.role()='authenticated')` — n'importe qui pouvait
-- réécrire le texte, le code, ou les compteurs de n'importe quel post.
drop policy if exists "posts_update" on public.posts;
create policy "posts_update" on public.posts
  for update using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

drop policy if exists "groups_update" on public.groups;
create policy "groups_update" on public.groups
  for update using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- Politiques qui manquaient : sans elles, la suppression est ouverte
-- à qui a le droit d'écrire (donc à personne ici), et la lecture des
-- messages de groupe ne dépendait que de l'appartenance au groupe.
drop policy if exists "gm_delete" on public.group_messages;
create policy "gm_delete" on public.group_messages
  for delete using (
    auth.uid() = author_id
    or exists (select 1 from public.groups g where g.id = group_messages.group_id and g.created_by = auth.uid())
  );

drop policy if exists "dm_update" on public.direct_messages;
create policy "dm_update" on public.direct_messages
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);

drop policy if exists "dm_delete" on public.direct_messages;
create policy "dm_delete" on public.direct_messages
  for delete using (auth.uid() = author_id);

drop policy if exists "groups_delete" on public.groups;
create policy "groups_delete" on public.groups
  for delete using (auth.uid() = created_by);


-- ------------------------------------------------------------
--  7. Les compteurs ne sont plus écrivables
-- ------------------------------------------------------------
--
--  La RLS dit *quelles lignes* on peut toucher, jamais *quelles
--  colonnes*. Même avec `posts_update` corrigée, l'auteur d'un post
--  pourrait encore s'écrire `likes = 9999` sur son propre post. Il faut
--  donc retirer ces colonnes du droit de mise à jour — c'est une autre
--  couche, et c'est la seule qui ferme vraiment le trou.
-- ------------------------------------------------------------

revoke update (likes, liked_by, comments) on public.posts from authenticated;
revoke update (followers, following)          on public.users from authenticated;
revoke update (member_count)                   on public.groups from authenticated;

-- `liked_by` n'a plus de raison d'exister : le like est une ligne dans
-- `post_likes`. La colonne reste pour que le SELECT `*` des anciens
-- clients ne casse pas, mais elle n'est plus alimentée et n'est plus
-- lue par l'interface.
comment on column public.posts.liked_by is
  'Obsolète — le like est une ligne dans post_likes. Conservée pour compatibilité de sélection.';


-- ------------------------------------------------------------
--  8. Report des données existantes
-- ------------------------------------------------------------
--
--  Les `liked_by` déjà posés deviennent des lignes, pour que personne
--  ne perde un like en passant à la nouvelle version.
-- ------------------------------------------------------------

insert into public.post_likes (post_id, user_id)
select p.id, unnest(p.liked_by)
  from public.posts p
 where p.liked_by is not null
   and array_length(p.liked_by, 1) > 0
on conflict do nothing;

insert into public.group_members (group_id, user_id, role)
select g.id, m.user_id,
       case when g.created_by = m.user_id then 'owner' else 'member' end
  from public.groups g
  cross join lateral unnest(g.members) as m(user_id)
 where g.members is not null
   and array_length(g.members, 1) > 0
on conflict do nothing;

-- Un premier recalcul : les déclencheurs ne se déclenchent que sur les
-- lignes inserées ci-dessus, donc ils suffisent. On repasse quand même
-- un coup de trigger sur chaque table pour aligner les caches, au cas
-- où des lignes préexistaient déjà dans les tables de jonction.
update public.posts p
   set likes    = (select count(*) from public.post_likes l where l.post_id = p.id),
       comments = (select count(*) from public.comments c where c.post_id = p.id);

update public.users u
   set followers = (select count(*) from public.follows f where f.followee_id = u.id),
       following = (select count(*) from public.follows f where f.follower_id = u.id);

update public.groups g
   set member_count = (select count(*) from public.group_members m where m.group_id = g.id);


-- ------------------------------------------------------------
--  REALTIME
-- ------------------------------------------------------------
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.post_likes;