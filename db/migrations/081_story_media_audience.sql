-- ============================================================
--  DEVNET — migration 081 : audience du média de story
--
--  La migration 068 classait bien un média de story comme privé, mais la
--  branche « story » de `can_read_media_file` ne vérifiait que l'existence
--  et l'expiration : toute story vivante était lisible par n'importe quel
--  compte authentifié, même si son audience valait `followers` ou `private`.
--
--  Deux autres défauts sont fermés ici :
--
--   1. les recherches `like '%/api/media/' || target_path` laissaient `%` et
--      `_` agir comme jokers et ne reconnaissaient pas de façon fiable une
--      URL absolue de même origine ; `media_path_of()` extrait désormais le
--      chemin exact en fin d'adresse ;
--   2. une story pouvait citer le média interne d'un autre compte via une
--      URL absolue, car le déclencheur ne regardait que les chemins relatifs.
--      Le déclencheur est étendu aux stories et reconnaît les deux formes.
--
--  La règle de lecture devient : le média d'une story est lisible par
--  l'audience de la story (public, abonnés, auteur), par son propriétaire,
--  et seulement tant que la story est vivante. L'auteur conserve l'accès
--  après expiration par la branche `owner_id`.
--
--  Rollback : restaurer les fonctions de la migration 068, supprimer
--  `media_path_of`, le déclencheur `enforce_media_owner_stories`, puis
--  restaurer `enforce_media_owner` sans l'extraction absolue. Aucune donnée
--  n'est modifiée.
-- ============================================================

/*
 * Extrait le chemin d'un média interne, uniquement quand il termine
 * l'adresse. Une URL `https://devnet.example/api/media/<chemin>` et un
 * chemin relatif `/api/media/<chemin>` donnent le même résultat. Les jokers
 * SQL ne sont jamais interprétés : le résultat est comparé par égalité.
 */
create or replace function public.media_path_of(raw text)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select substring(raw from '/api/media/([A-Za-z0-9][A-Za-z0-9._-]{0,119})$');
$$;

revoke all on function public.media_path_of(text) from public;
grant execute on function public.media_path_of(text) to anon, authenticated, service_role;

create or replace function public.media_file_is_private(target_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1 from public.direct_messages dm
            where public.media_path_of(dm.media_url) = target_path
         )
      or exists (
           select 1 from public.group_messages gm
            where public.media_path_of(gm.media_url) = target_path
         )
      or exists (
           select 1 from public.stories s
            where public.media_path_of(s.media_url) = target_path
         );
$$;

create or replace function public.can_read_media_file(target_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1
             from public.stories s
             join public.media_files mf
               on mf.path = target_path
              and mf.owner_id = s.author_id
            where public.media_path_of(s.media_url) = target_path
              and s.expires_at > now()
              and (
                s.audience = 'public'
                or s.author_id = auth.uid()
                or (
                  s.audience = 'followers'
                  and exists (
                    select 1
                      from public.follows f
                     where f.followee_id = s.author_id
                       and f.follower_id = auth.uid()
                  )
                )
              )
         )
      or not public.media_file_is_private(target_path)
      or exists (
           select 1 from public.media_files mf
            where mf.path = target_path
              and mf.owner_id = auth.uid()
         )
      or exists (
           select 1
             from public.direct_messages dm
             join public.conversations c on c.id = dm.conversation_id
            where public.media_path_of(dm.media_url) = target_path
              and auth.uid() = any(c.participants)
         )
      or exists (
           select 1
             from public.group_messages gm
             join public.group_members m on m.group_id = gm.group_id
            where public.media_path_of(gm.media_url) = target_path
              and m.user_id = auth.uid()
         );
$$;

revoke all on function public.media_file_is_private(text) from public;
revoke all on function public.can_read_media_file(text) from public;
grant execute on function public.media_file_is_private(text) to anon, authenticated, service_role;
grant execute on function public.can_read_media_file(text) to anon, authenticated, service_role;

create or replace function public.enforce_media_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_path text;
begin
  if new.media_url is null or new.media_url = '' then
    return new;
  end if;

  target_path := public.media_path_of(new.media_url);

  if new.media_url like '/api/media/%' and target_path is null then
    raise exception 'chemin de média invalide' using errcode = '23514';
  end if;

  if target_path is not null then
    if not exists (
      select 1 from public.media_files mf
       where mf.path = target_path
         and mf.owner_id = new.author_id
    ) then
      raise exception 'média non possédé par l''auteur' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_media_owner() from public;

drop trigger if exists enforce_media_owner_stories on public.stories;
create trigger enforce_media_owner_stories
  before insert or update of media_url on public.stories
  for each row execute function public.enforce_media_owner();

comment on function public.media_path_of(text) is
  'Extrait le chemin exact d''un média interne terminant l''adresse, ou null.';
comment on function public.media_file_is_private(text) is
  'Vrai si le média est référencé par un message privé, de groupe ou une story.';
comment on function public.can_read_media_file(text) is
  'Décide la lecture d''un média : public, auteur, participant, membre ou audience de story vivante.';
comment on trigger enforce_media_owner_stories on public.stories is
  'Une story ne peut citer qu''un média interne possédé par son auteur.';
