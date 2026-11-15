-- 027 — Réglages et membres d'un projet.
--
-- Un dépôt n'est pas figé à sa création : il change de nom, de description,
-- de visibilité ; on y fait entrer des gens, on règle leur rôle, on en
-- retire. Trois politiques manquaient pour que ces gestes soient possibles
-- **et** bornés :
--
--  · `pm_delete` n'existait pas — on ne pouvait pas retirer un membre ;
--  · `pm_self` n'autorisait à insérer que **sa propre** ligne — un
--    propriétaire ne pouvait pas inviter quelqu'un ;
--  · `pm_update` laissait un simple *editor* régler les rôles — un droit
--    d'écriture confondu avec un droit d'administration.
--
-- On nomme d'abord le rôle de l'appelant dans un projet, puis on s'en sert
-- pour les deux politiques d'administration. Le propriétaire du projet et
-- ses mainteneurs administrent ; un editor écrit du code, il n'admet
-- personne — c'est la distinction que portait déjà 020 côté groupes.

create or replace function public.project_role(p uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.project_members
  where project_id = p and user_id = auth.uid()
$$;

comment on function public.project_role(uuid) is
  'Rôle de l''appelant dans un projet : owner | maintainer | editor | viewer.';

-- Un rôle erroné ne doit pas pouvoir être écrit : l'application compare des
-- chaînes exactes pour décider de qui administre.
alter table public.project_members
  drop constraint if exists project_members_role_check;
alter table public.project_members
  add constraint project_members_role_check
  check (role in ('owner', 'maintainer', 'editor', 'viewer'));

-- Rejoindre (sa propre ligne) — inchangé, `pm_self` (004). Inviter
-- quelqu'un : réservé au propriétaire et aux mainteneurs.
drop policy if exists "pm_manage_insert" on public.project_members;
create policy "pm_manage_insert" on public.project_members for insert
  with check (public.project_role(project_id) in ('owner', 'maintainer'));

-- Régler un rôle : même autorité. On **remplace** la politique de 004 au
-- lieu d'en ajouter une seconde — deux politiques `update` permissives
-- seraient combinées en `or`, et l'ancienne, plus large, l'emporterait.
drop policy if exists "pm_update" on public.project_members;
create policy "pm_update" on public.project_members for update
  using (public.project_role(project_id) in ('owner', 'maintainer'))
  with check (public.project_role(project_id) in ('owner', 'maintainer'));

-- Retirer un membre : quitter soi-même, ou être propriétaire / mainteneur.
drop policy if exists "pm_delete" on public.project_members;
create policy "pm_delete" on public.project_members for delete
  using (user_id = auth.uid() or public.project_role(project_id) in ('owner', 'maintainer'));
