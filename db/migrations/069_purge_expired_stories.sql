-- ============================================================
--  DEVNET — migration 069 : purge des stories expirées
--
--  Une story expirée n'est plus lisible (policy `stories_read`), mais sa
--  ligne et son média restent en base. La suppression est confiée à une
--  fonction `security definer` : le job d'exploitation n'a pas besoin
--  d'un rôle qui contourne la RLS pour supprimer des lignes dont la seule
--  condition est l'horloge.
--
--  La fonction est idempotente : la rappeler ne supprime que ce qui reste.
--  `story_media`, likes, vues et réponses suivent la clé étrangère
--  `on delete cascade` de la story.
--
--  Rollback : `drop function public.purge_expired_stories(integer);`
--  Aucune donnée n'est modifiée par la migration elle-même.
-- ============================================================

create or replace function public.purge_expired_stories(retention_hours integer default 24)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  -- Une rétention négative n'a pas de sens ; la borne haute évite qu'un
  -- appel mal formé supprime des stories encore vivantes.
  if retention_hours is null then
    retention_hours := 24;
  end if;
  retention_hours := least(greatest(retention_hours, 0), 168);

  delete from public.stories
   where expires_at < now() - make_interval(hours => retention_hours);

  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_expired_stories(integer) from public;

do $$
begin
  if to_regrole('devnet_u') is not null then
    execute 'grant execute on function public.purge_expired_stories(integer) to devnet_u';
  end if;
  if to_regrole('devnet') is not null then
    execute 'grant execute on function public.purge_expired_stories(integer) to devnet';
  end if;
end
$$;

comment on function public.purge_expired_stories(integer) is
  'Supprime les stories expirées depuis plus de N heures (0-168) et leurs médias ; retourne le nombre de lignes supprimées.';
