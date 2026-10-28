-- 029 — Le registre d'extensions.
--
-- Une extension est un **paquet** qu'on publie et que d'autres installent :
-- un thème, un jeu de snippets, un support de langage, un outil, ou un
-- assistant IA. On ne livre pas du code exécutable — c'est un **manifeste**
-- (JSON) que l'IDE d'ici interprète : des snippets à compléter, des
-- commandes à exposer, des réglages à présenter. C'est la différence entre
-- étendre DevNet et exécuter n'importe quoi chez l'utilisateur.
--
-- On pose trois choses :
--  1. `extensions`, le catalogue public — tout le monde lit, seul l'auteur
--     écrit ;
--  2. `extension_installs`, l'installation **personnelle** d'une extension,
--     avec son `enabled` et ses `settings` — strictement privée ;
--  3. un compteur `extensions.installs` dérivé des adhésions, comme
--     `communities.member_count`, pour que le nombre affiché ne mente jamais.

-- ---------------------------------------------------------------------
-- 1. Les tables
-- ---------------------------------------------------------------------

create table if not exists public.extensions (
  id           uuid primary key default gen_random_uuid(),
  -- Le slug est l'adresse de l'extension dans la place de marché : il se
  -- dérive du nom à la création puis ne bouge plus.
  slug         text not null unique,
  name         text not null,
  description  text default '',
  version      text not null default '0.0.1',
  icon         text default 'package',
  category     text not null default 'other'
                 check (category in ('theme', 'snippets', 'language', 'tool', 'ai', 'other')),
  -- Le manifeste : snippets, commandes, réglages, thème. En `jsonb` et non
  -- en tables dédiées — un manifeste se lit toujours d'un bloc, on ne
  -- requête jamais « tous les snippets dont le préfixe… » à travers la place
  -- de marché. On valide sa **forme** côté application, pas ici : la base
  -- garantit qu'il est du JSON, l'écran garantit qu'il est utilisable.
  manifest     jsonb not null default '{}'::jsonb,
  owner_id     uuid references public.users(id) on delete set null,
  installs     int default 0,
  created_at   timestamptz default now()
);

create index if not exists extensions_category_idx on public.extensions (category);
create index if not exists extensions_slug_idx on public.extensions (slug);

-- L'installation d'une extension par une personne : une ligne par couple
-- (extension, utilisateur), plus son état — activée ou non — et ses réglages.
-- `enabled` existe séparément de la présence de la ligne : on désactive une
-- extension sans la désinstaller, exactement comme VSCode.
create table if not exists public.extension_installs (
  extension_id uuid not null references public.extensions(id) on delete cascade,
  user_id      uuid not null references public.users(id)      on delete cascade,
  enabled      boolean not null default true,
  settings     jsonb not null default '{}'::jsonb,
  installed_at timestamptz default now(),
  primary key (extension_id, user_id)
);

-- ---------------------------------------------------------------------
-- 2. Le compteur dérivé
-- ---------------------------------------------------------------------

-- `installs` est un cache : il se recalcule depuis `extension_installs`,
-- jamais depuis le client. Même déclencheur que `sync_community_members`
-- (028) — un compteur tenu à la main dérive au premier oubli.
create or replace function public.sync_extension_installs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.extensions e
     set installs = (select count(*) from public.extension_installs i where i.extension_id = e.id)
   where e.id = coalesce(new.extension_id, old.extension_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists on_extension_installs_change on public.extension_installs;
create trigger on_extension_installs_change
  after insert or delete on public.extension_installs
  for each row execute function public.sync_extension_installs();

comment on function public.sync_extension_installs() is
  'Recalcule extensions.installs a chaque installation ou desinstallation.';

-- ---------------------------------------------------------------------
-- 3. Les politiques
-- ---------------------------------------------------------------------

alter table public.extensions         enable row level security;
alter table public.extension_installs enable row level security;

-- La place de marché est publique : tout le monde voit l'ensemble des
-- extensions. On ne restreint pas la lecture au propriétaire — une
-- extension qu'on ne peut pas voir ne s'installe pas.
drop policy if exists extensions_read on public.extensions;
create policy extensions_read on public.extensions
  for select using (true);

drop policy if exists extensions_insert on public.extensions;
create policy extensions_insert on public.extensions
  for insert with check (auth.uid() = owner_id);

drop policy if exists extensions_update on public.extensions;
create policy extensions_update on public.extensions
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists extensions_delete on public.extensions;
create policy extensions_delete on public.extensions
  for delete using (auth.uid() = owner_id);

-- Une installation est strictement personnelle : ni lisible ni modifiable
-- par un autre. C'est la même portée que `gh_self_read` (004) — le fait
-- que quelqu'un ait activé telle extension ne regarde que lui.
drop policy if exists extension_installs_read on public.extension_installs;
create policy extension_installs_read on public.extension_installs
  for select using (auth.uid() = user_id);

drop policy if exists extension_installs_insert on public.extension_installs;
create policy extension_installs_insert on public.extension_installs
  for insert with check (auth.uid() = user_id);

drop policy if exists extension_installs_update on public.extension_installs;
create policy extension_installs_update on public.extension_installs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists extension_installs_delete on public.extension_installs;
create policy extension_installs_delete on public.extension_installs
  for delete using (auth.uid() = user_id);

-- Ni le compteur, ni le slug, ni le propriétaire d'une extension ne se
-- réécrivent : le `revoke update (...)` ferme ces colonnes, comme ailleurs.
revoke update (slug, owner_id, installs, created_at)
  on public.extensions from authenticated, anon;

-- Une installation ne se réattribue pas à quelqu'un d'autre, et ne change
-- pas de cible : seuls `enabled` et `settings` sont modifiables.
revoke update (extension_id, user_id, installed_at)
  on public.extension_installs from authenticated, anon;
