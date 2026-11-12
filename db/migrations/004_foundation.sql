-- ============================================================
--  DEVNET — 004_foundation.sql
--
--  Les fondations des trois axes : espace de groupe façon Discord,
--  projets collaboratifs avec git interne, raccordement GitHub.
--
--  Exécute dans Supabase → SQL Editor → Run.
--
--  Cette migration s'ajoute à 001, elle ne le remplace pas. Une seule
--  table existante est modifiée : `group_messages` gagne un canal. Encore
--  faut-il que ce canal soit facultatif — les messages déjà écrits n'ont
--  pas de canal, et une contrainte NOT NULL les ferait disparaître.
-- ============================================================

-- ── GROUPES : canaux ──────────────────────────────
-- Un groupe Discord n'a pas « une conversation » : il a des canaux. On
-- garde la table `groups` telle quelle et on lui ajoute un niveau dessous,
-- ce qui rend la migration réversible et le code lisible.
create table public.channels (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  slug       text not null,
  name       text not null default '',
  topic      text default '',
  position   int  default 0,
  is_private boolean default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now(),
  -- Le slug est unique *à l'intérieur* d'un groupe : deux groupes peuvent
  -- avoir chacun leur #général sans que ça entre en conflit.
  unique (group_id, slug)
);

create table public.channel_members (
  channel_id uuid references public.channels(id) on delete cascade,
  user_id    uuid references public.users(id) on delete cascade,
  role       text default 'member',   -- owner | moderator | member
  muted      boolean default false,
  joined_at  timestamptz default now(),
  primary key (channel_id, user_id)
);

-- Un message appartient désormais à un canal. Nullable par compatibilité :
-- les lignes existantes restent valides et sont lues comme « hors canal ».
alter table public.group_messages
  add column channel_id uuid references public.channels(id) on delete set null;

-- ── Rattachement des messages existants ─────────
--
--  Sans ce remplissage, tout l'historique d'un groupe déployé avant les
--  canaux se retrouverait orphelin : invisible dans tous les canaux, donc
--  perdu de vue. On rattache chaque message au premier canal de son groupe
--  — celui que `position = 0`, c'est-à-dire celui qu'ouvre l'interface
--  par défaut.
--
--  Ce n'est pas une approximation : avant les canaux, le groupe n'avait
--  qu'une seule conversation. Ce canal *est* cette conversation.
insert into public.channels (group_id, slug, name, topic, position, created_by, created_at)
select
  g.id,
  'general',
  'général',
  'Conversation principale du groupe.',
  0,
  g.created_by,
  g.created_at
from public.groups g
where not exists (
  select 1 from public.channels c where c.group_id = g.id
);

update public.group_messages m
set channel_id = c.id
from public.channels c
where c.group_id = m.group_id
  and c.position = 0
  and m.channel_id is null;

-- ── PROJETS ──────────────────────────────────────
-- Un projet est l'objet qui unit le groupe et le code : c'est lui qu'on
-- ouvre, qu'on lit, qu'on commit, qu'on synchronise avec GitHub.
create table public.projects (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid references public.groups(id) on delete cascade,
  created_by     uuid references public.users(id) on delete set null,
  name           text not null,
  slug           text not null,
  description    text default '',
  emoji          text default 'package',
  language       text default '',
  visibility     text default 'group',   -- public | group | private
  default_branch text default 'main',
  created_at     timestamptz default now(),
  unique (group_id, slug)
);

create table public.project_members (
  project_id uuid references public.projects(id) on delete cascade,
  user_id    uuid references public.users(id) on delete cascade,
  role       text default 'editor',      -- owner | maintainer | editor | viewer
  added_at   timestamptz default now(),
  primary key (project_id, user_id)
);

-- ── GIT INTERNE ──────────────────────────────────
-- Le dépôt vit dans la base, avec le même modèle que git : des commits
-- pointent sur un arbre, des refs pointent sur un commit, et l'état
-- courant est la liste des fichiers. Les identifiants sont des sha calculés
-- par le moteur (lib/git), pas des uuid : un commitpushé sur GitHub doit
-- rester le même commit.

create table public.git_commits (
  sha            text primary key,
  project_id     uuid not null references public.projects(id) on delete cascade,
  parent_sha     text default '',
  author_id      uuid references public.users(id) on delete set null,
  author_name    text default '',
  message        text not null,
  tree           text default '',      -- sha de l'arbre de ce commit
  files_changed  int default 0,
  insertions     int default 0,
  deletions      int default 0,
  source         text default 'internal',  -- internal | github
  created_at     timestamptz default now()
);

create table public.git_refs (
  project_id uuid not null references public.projects(id) on delete cascade,
  name       text not null,            -- main, feat/ocr, v1.0
  kind       text default 'branch',    -- branch | tag
  sha        text default '',
  updated_at timestamptz default now(),
  primary key (project_id, name)
);

-- L'état courant du dépôt. On ne stocke pas un instantané par commit : à
-- chaque commit on écrase, ce qui transforme « l'historique » en une suite
-- de deltas. C'est le même compromis que git lui-même avec ses packs.
create table public.git_files (
  project_id uuid not null references public.projects(id) on delete cascade,
  path       text not null,
  content    text default '',
  blob_sha   text default '',
  size       int default 0,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz default now(),
  primary key (project_id, path)
);

-- ── GITHUB ───────────────────────────────────────
-- La connexion est *par utilisateur* : chacun donne son propre jeton, et
-- chacun reste maître de ce qu'il expose. On ne partage pas un compte
-- unique au groupe — c'est ce qui ferait fuiter l'accès de tout le monde
-- dès qu'une seule personne se fait révoquer.
create table public.github_connections (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  provider     text default 'github',
  login        text not null,
  external_id  text default '',
  avatar_url   text default '',
  scopes       text[] default '{}',
  -- Référence opaque vers un coffre (Supabase Vault). Le jeton d'accès n'a
  -- aucune raison d'être dans une table que l'application peut lire : une
  -- seule fuite de RLS et tous les comptes GitHub sont exposés.
  token_ref    text default '',
  connected_at timestamptz default now(),
  unique (user_id, provider)
);

-- Le lien entre un projet DevNet et un dépôt GitHub. Le projet reste la
-- source de vérité ; le dépôt est une destination, ce qui autorise une
-- synchronisation manuelle sans jamais transformer GitHub en base
-- primaire.
create table public.project_links (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  user_id        uuid not null references public.users(id) on delete cascade,
  owner          text not null,
  repo           text not null,
  default_branch text default 'main',
  sync_mode      text default 'manual',  -- manual | push | two-way
  last_push_sha  text default '',
  last_pull_sha  text default '',
  last_synced_at timestamptz,
  created_at     timestamptz default now(),
  unique (project_id)
);

-- ── PRÉSENCE ─────────────────────────────────────
-- La présence vivante ne transite pas par la base : elle voyage sur les
-- canaux Realtime, qui la diffusent sans l'écrire. Cette table ne garde que
-- la dernière position connue, pour qu'un membre qui se reconnecte puisse
-- voir qui était en train de coder — même après une coupure.
create table public.project_sessions (
  id         text primary key,          -- « project_id:chemin »
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid references public.users(id) on delete set null,
  file_path  text default '',
  cursor     jsonb default '{}'::jsonb,
  color      text default '',
  seen_at    timestamptz default now()
);

-- ── INDEX ────────────────────────────────────────
-- `git_commits` est lue par (projet, temps) à chaque ouverture d'historique ;
-- `git_files` par (projet, chemin) à chaque ouverture de fichier.
create index idx_channels_group        on public.channels (group_id, position);
create index idx_gm_channel            on public.group_messages (channel_id, created_at desc);
create index idx_projects_group        on public.projects (group_id, created_at desc);
create index idx_commits_project       on public.git_commits (project_id, created_at desc);
create index idx_refs_project          on public.git_refs (project_id);
create index idx_files_project         on public.git_files (project_id);
create index idx_sessions_project      on public.project_sessions (project_id, seen_at desc);

-- ============================================================
--  FONCTIONS D'AUTORISATION
--
--  L'app n'a pas de couche de permissions : elle écrit avec le compte de
--  l'utilisateur et la RLS décide. Ces fonctions encapsulent donc les
--  seules règles qui sont trop longues pour une ligne de politique.
--
--  `security definer` parce que la politique s'exécute avec les droits de
--  l'utilisateur : sans élévation, lire `groups.members` — que la politique
--  interdit d'écrire mais pas de lire — depuis une politique d'insertion
--  créerait une boucle de récursion sur RLS.
-- ============================================================

/** L'utilisateur est-il membre du groupe ? */
create or replace function public.is_group_member(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.groups
    where id = g and auth.uid() = any (members)
  );
$$;

/** Peut-on voir ce projet ? public, ou groupe dont on est membre, ou membre du projet. */
create or replace function public.can_read_project(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects pr
    where pr.id = p
      and (
        pr.visibility = 'public'
        or public.is_group_member(pr.group_id)
        or exists (select 1 from public.project_members m
                   where m.project_id = p and m.user_id = auth.uid())
      )
  );
$$;

/** Peut-on écrire dans ce projet ? Rôle editor et au-dessus. */
create or replace function public.can_write_project(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects pr
    where pr.id = p
      and (
        pr.visibility = 'public'
        or public.is_group_member(pr.group_id)
        or exists (select 1 from public.project_members m
                   where m.project_id = p and m.user_id = auth.uid()
                     and m.role in ('owner', 'maintainer', 'editor'))
      )
  );
$$;

-- ============================================================
--  RLS
-- ============================================================
alter table public.channels           enable row level security;
alter table public.channel_members    enable row level security;
alter table public.projects           enable row level security;
alter table public.project_members    enable row level security;
alter table public.git_commits        enable row level security;
alter table public.git_refs           enable row level security;
alter table public.git_files          enable row level security;
alter table public.github_connections enable row level security;
alter table public.project_links      enable row level security;
alter table public.project_sessions   enable row level security;

-- ── Canaux ──
create policy "channels_read" on public.channels for select
  using (public.is_group_member(group_id) or not is_private);

create policy "channels_insert" on public.channels for insert
  with check (created_by = auth.uid() and public.is_group_member(group_id));

create policy "channels_update" on public.channels for update
  using (created_by = auth.uid() or public.is_group_member(group_id));

create policy "channels_delete" on public.channels for delete
  using (created_by = auth.uid());

create policy "cm_read" on public.channel_members for select
  using (exists (select 1 from public.channels c
                 where c.id = channel_id and public.is_group_member(c.group_id)));

create policy "cm_self" on public.channel_members for insert
  with check (user_id = auth.uid());

create policy "cm_update" on public.channel_members for update
  using (user_id = auth.uid());

-- ── Messages ──
-- 001 déclarait « tout message lisible par tout utilisateur connecté ».
-- Avec les canaux, cette règle devient trop large : n'importe quel membre
-- de la plateforme lirait les messages privés d'un groupe. On retire donc
-- les anciennes politiques au lieu d'en ajouter — les politiques d'une même
-- table s'appliquent en OU, et une politique forgotten continuerait
-- d'ouvrir l'accès qu'on croyait refermer.
drop policy if exists "gm_read"   on public.group_messages;
drop policy if exists "gm_insert" on public.group_messages;

-- Un message se lit si son canal se lit, ou s'il n'a pas de canal mais
-- que son groupe est visible.
create policy "gm_read" on public.group_messages for select
  using (
    (channel_id is null and auth.role() = 'authenticated')
    or exists (select 1 from public.channels c
               where c.id = channel_id and public.is_group_member(c.group_id))
  );

create policy "gm_insert" on public.group_messages for insert
  with check (
    auth.uid() = author_id
    and (
      channel_id is null
      or exists (select 1 from public.channels c
                 where c.id = channel_id and public.is_group_member(c.group_id))
    )
  );

-- ── Projets ──
create policy "projects_read" on public.projects for select
  using (public.can_read_project(id));

create policy "projects_insert" on public.projects for insert
  with check (created_by = auth.uid());

create policy "projects_update" on public.projects for update
  using (public.can_write_project(id));

create policy "projects_delete" on public.projects for delete
  using (created_by = auth.uid());

create policy "pm_read" on public.project_members for select
  using (public.can_read_project(project_id));

create policy "pm_self" on public.project_members for insert
  with check (user_id = auth.uid());

create policy "pm_update" on public.project_members for update
  using (public.can_write_project(project_id));

-- ── Git ──
create policy "commits_read" on public.git_commits for select
  using (public.can_read_project(project_id));

create policy "commits_insert" on public.git_commits for insert
  with check (auth.uid() = author_id and public.can_write_project(project_id));

create policy "refs_read" on public.git_refs for select
  using (public.can_read_project(project_id));

create policy "refs_insert" on public.git_refs for insert
  with check (public.can_write_project(project_id));

create policy "refs_update" on public.git_refs for update
  using (public.can_write_project(project_id));

create policy "files_read" on public.git_files for select
  using (public.can_read_project(project_id));

create policy "files_insert" on public.git_files for insert
  with check (public.can_write_project(project_id));

create policy "files_update" on public.git_files for update
  using (public.can_write_project(project_id));

create policy "files_delete" on public.git_files for delete
  using (public.can_write_project(project_id));

-- ── GitHub ──
-- La connexion est strictement personnelle : ni lisible ni modifiable par
-- un autre, même membre du même projet. C'est la seule politique de ce
-- fichier qui n'ouvre rien à personne d'autre.
create policy "gh_self_read" on public.github_connections for select
  using (user_id = auth.uid());

create policy "gh_self_write" on public.github_connections for insert
  with check (user_id = auth.uid());

create policy "gh_self_update" on public.github_connections for update
  using (user_id = auth.uid());

create policy "gh_self_delete" on public.github_connections for delete
  using (user_id = auth.uid());

create policy "links_read" on public.project_links for select
  using (public.can_read_project(project_id));

create policy "links_insert" on public.project_links for insert
  with check (user_id = auth.uid() and public.can_write_project(project_id));

create policy "links_update" on public.project_links for update
  using (user_id = auth.uid());

create policy "links_delete" on public.project_links for delete
  using (user_id = auth.uid());

-- ── Présence ──
create policy "sessions_read" on public.project_sessions for select
  using (public.can_read_project(project_id));

create policy "sessions_write" on public.project_sessions for insert
  with check (user_id = auth.uid());

create policy "sessions_update" on public.project_sessions for update
  using (user_id = auth.uid());

-- ============================================================
--  REALTIME
--
--  L'éditeur collaboratif doit voir arriver deux choses en direct : les
--  fichiers modifiés et la présence. `git_commits` en est absent
--  volontairement — un commit est un événement rare, déjà reflété par les
--  fichiers qu'il touche.
--
--  `add table` échoue si la table est déjà dans la publication, et ce script
--  doit pouvoir être rejoué : on retire d'abord, en absorbant l'erreur du
--  cas « pas encore dans la publication ».
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array['group_messages', 'git_files', 'project_sessions'] loop
    begin
      execute format('alter publication supabase_realtime drop table public.%I', t);
    exception when undefined_object then null;
    end;
  end loop;
end $$;

alter publication supabase_realtime add table public.group_messages;
alter publication supabase_realtime add table public.git_files;
alter publication supabase_realtime add table public.project_sessions;