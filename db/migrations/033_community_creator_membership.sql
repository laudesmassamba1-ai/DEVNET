-- 033 — Le createur d'une communaute peut s'inscrire `owner`
--
-- Probleme : `createCommunity` (lib/communities.ts) insere la communaute,
-- puis une adhésion `owner` pour son createur. Or `community_members_insert`
-- (028) n'autorisait l'auto-adhesion qu'au role `member`, ou via
-- `community_role(community_id)` — qui vaut NULL pour un createur qui n'est
-- pas encore membre. La seconde ecriture echouait donc :
--   new row violates row-level security policy for table "community_members"
-- et la communaute restait sans proprietaire, donc inadministrable.
--
-- Correctif : le createur de la communaute peut poser **sa** ligne `owner`.
-- L'auto-promotion reste impossible ailleurs : la condition exige
-- `created_by = auth.uid()` sur la communaute concernee.
--
-- Idempotent.

create or replace function public.is_community_creator(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.communities
    where id = c and created_by = auth.uid()
  )
$$;

comment on function public.is_community_creator(uuid) is
  'L''appelant a-t-il cree cette communaute ? (bootstrap de l''adhesion owner)';

drop policy if exists "community_members_insert" on public.community_members;
create policy "community_members_insert" on public.community_members
  for insert with check (
    (auth.uid() = user_id and role = 'member')
    or public.community_role(community_id) in ('owner', 'moderator')
    or (auth.uid() = user_id and role = 'owner' and public.is_community_creator(community_id))
  );
