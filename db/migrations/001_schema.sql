-- ============================================================
--  DEVNET — schema.sql  VERSION FINALE
--  Exécute dans Supabase → SQL Editor → Run
-- ============================================================

-- Nettoyage
drop table if exists public.direct_messages  cascade;
drop table if exists public.conversations    cascade;
drop table if exists public.group_messages   cascade;
drop table if exists public.posts            cascade;
drop table if exists public.groups           cascade;
drop table if exists public.users            cascade;
drop function if exists public.handle_new_user() cascade;

-- ── USERS ──
create table public.users (
  id           uuid references auth.users(id) on delete cascade primary key,
  prenom       text not null default '',
  pseudo       text unique not null default '',
  email        text not null default '',
  filiere      text default '',
  niveau       text default '',
  langages     text[] default '{}',
  avatar_color text default 'av-sage',
  bio          text default '',
  followers    int  default 0,
  following    int  default 0,
  created_at   timestamptz default now()
);

-- ── POSTS ──
create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid references public.users(id) on delete cascade,
  author_name   text default '',
  author_pseudo text default '',
  author_color  text default 'av-sage',
  filiere       text default '',
  niveau        text default '',
  text          text not null,
  has_code      boolean default false,
  code          text default '',
  lang          text default '',
  likes         int  default 0,
  liked_by      uuid[] default '{}',
  comments      int  default 0,
  created_at    timestamptz default now()
);

-- ── GROUPS ──
create table public.groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text default '',
  category     text default 'Groupe',
  emoji        text default 'code',
  created_by   uuid references public.users(id),
  members      uuid[] default '{}',
  member_count int  default 1,
  created_at   timestamptz default now()
);

-- ── GROUP MESSAGES ──
create table public.group_messages (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid references public.groups(id) on delete cascade,
  author_id    uuid references public.users(id),
  author_name  text default '',
  author_color text default 'av-sage',
  text         text not null,
  is_code      boolean default false,
  created_at   timestamptz default now()
);

-- ── CONVERSATIONS ──
create table public.conversations (
  id              text primary key,
  participants    uuid[] not null,
  last_message    text default '',
  last_message_at timestamptz default now()
);

-- ── DIRECT MESSAGES ──
create table public.direct_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id text references public.conversations(id) on delete cascade,
  author_id       uuid references public.users(id),
  author_name     text default '',
  text            text not null,
  created_at      timestamptz default now()
);

-- ── TRIGGER : création profil automatique ──
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_prenom text;
  v_pseudo text;
  v_base   text;
  v_count  int := 0;
begin
  v_prenom := coalesce(
    nullif(trim(new.raw_user_meta_data->>'prenom'), ''),
    split_part(coalesce(new.raw_user_meta_data->>'full_name', ''), ' ', 1),
    split_part(new.email, '@', 1)
  );
  v_base := lower(regexp_replace(
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'pseudo'), ''),
      split_part(new.email, '@', 1)
    ),
    '[^a-z0-9_]', '', 'g'
  ));
  v_pseudo := v_base;

  loop
    exit when not exists (select 1 from public.users where pseudo = v_pseudo);
    v_count := v_count + 1;
    v_pseudo := v_base || v_count::text;
  end loop;

  insert into public.users (id, prenom, pseudo, email, filiere, niveau, langages, avatar_color, bio)
  values (
    new.id, v_prenom, v_pseudo, new.email,
    coalesce(new.raw_user_meta_data->>'filiere', ''),
    coalesce(new.raw_user_meta_data->>'niveau', ''),
    coalesce(array(select jsonb_array_elements_text(new.raw_user_meta_data->'langages')), '{}'),
    (array['av-lime','av-sage','av-pink','av-orange','av-violet'])[floor(random()*5+1)::int],
    ''
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── RLS ──
alter table public.users           enable row level security;
alter table public.posts           enable row level security;
alter table public.groups          enable row level security;
alter table public.group_messages  enable row level security;
alter table public.conversations   enable row level security;
alter table public.direct_messages enable row level security;

create policy "users_read"   on public.users for select using (auth.role()='authenticated');
create policy "users_insert" on public.users for insert with check (auth.uid()=id);
create policy "users_update" on public.users for update using (auth.uid()=id);

create policy "posts_read"   on public.posts for select using (auth.role()='authenticated');
create policy "posts_insert" on public.posts for insert with check (auth.uid()=author_id);
create policy "posts_update" on public.posts for update using (auth.role()='authenticated');
create policy "posts_delete" on public.posts for delete using (auth.uid()=author_id);

create policy "groups_read"   on public.groups for select using (auth.role()='authenticated');
create policy "groups_insert" on public.groups for insert with check (auth.role()='authenticated');
create policy "groups_update" on public.groups for update using (auth.role()='authenticated');

create policy "gm_read"   on public.group_messages for select using (auth.role()='authenticated');
create policy "gm_insert" on public.group_messages for insert with check (auth.uid()=author_id);

create policy "conv_read"   on public.conversations for select using (auth.uid()=any(participants));
create policy "conv_insert" on public.conversations for insert with check (auth.uid()=any(participants));
create policy "conv_update" on public.conversations for update using (auth.uid()=any(participants));

create policy "dm_read"   on public.direct_messages for select using (auth.role()='authenticated');
create policy "dm_insert" on public.direct_messages for insert with check (auth.uid()=author_id);

-- ── REALTIME ──
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.group_messages;
alter publication supabase_realtime add table public.direct_messages;
alter publication supabase_realtime add table public.conversations;
