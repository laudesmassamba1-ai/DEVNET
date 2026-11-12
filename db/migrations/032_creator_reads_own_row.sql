-- 032 — Le createur lit toujours la ligne qu'il vient d'inserer
--
-- Probleme : plusieurs flux de l'application font
--   insert(...).select(...).single()
-- c'est-a-dire `INSERT ... RETURNING`. Or une politique SELECT qui
-- re-interroge **la meme table** via une fonction `stable` ne voit pas la
-- ligne tout juste ecrite : au moment du RETURNING, la nouvelle ligne
-- n'est pas encore visible du sous-`SELECT`. Le `WITH CHECK` de l'insert
-- passe (`created_by = auth.uid()`), mais la **lecture** du RETURNING
-- echoue avec :
--   new row violates row-level security policy for table "<table>"
--
-- Concerne `projects` et `communities`, dont la politique de lecture
-- appelait `can_read_project(id)` / `can_read_community(id)`.
--
-- Correctif : on lit directement la colonne de la ligne courante
-- (`created_by = auth.uid()`) au lieu de la re-interroger. Les helpers
-- gagnent la meme clause pour les autres tables qui les utilisent.
--
-- Idempotent : `create or replace function` + `drop policy if exists`.

-- ---------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------

create or replace function public.can_read_project(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects pr
    where pr.id = p
      and (
        pr.created_by = auth.uid()
        or pr.visibility = 'public'
        or public.is_group_member(pr.group_id)
        or exists (select 1 from public.project_members m
                   where m.project_id = p and m.user_id = auth.uid())
      )
  );
$$;

-- Le createur peut forcement lire son projet : la colonne de la ligne
-- courante est lisible sans relecture, donc le RETURNING ne casse plus.
drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects
  for select using (
    created_by = auth.uid() or public.can_read_project(id)
  );

-- Bonus d'autorisation : `can_write_project` accordait l'ecriture a tout
-- projet `public`, y compris a un compte qui ne le possede pas. La branche
-- `visibility = 'public'` est retiree : seuls le proprietaire, le groupe
-- porteur et les membres a role d'edition ecrivent.
create or replace function public.can_write_project(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects pr
    where pr.id = p
      and (
        pr.created_by = auth.uid()
        or public.is_group_member(pr.group_id)
        or exists (select 1 from public.project_members m
                   where m.project_id = p and m.user_id = auth.uid()
                     and m.role in ('owner', 'maintainer', 'editor'))
      )
  );
$$;

-- ---------------------------------------------------------------------
-- Communities
-- ---------------------------------------------------------------------

create or replace function public.can_read_community(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.communities co
    where co.id = c
      and (
        co.created_by = auth.uid()
        or co.visibility in ('public', 'restricted')
        or exists (select 1 from public.community_members m
                   where m.community_id = c and m.user_id = auth.uid())
      )
  );
$$;

drop policy if exists communities_read on public.communities;
create policy communities_read on public.communities
  for select using (
    created_by = auth.uid() or public.can_read_community(id)
  );
