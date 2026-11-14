-- ============================================================
--  DEVNET — migration 68 : médias sans stockage objet
--
--  La migration 56 exigeait une URL absolue (`https://…` ou
--  `http://localhost…`) pour `posts.media_url`, `direct_messages.media_url`
--  et `group_messages.media_url`. Or, sans R2 ni Vercel Blob, `/api/media`
--  rend justement un chemin **relatif** `/api/media/<uuid>` : l'insertion
--  échouait donc avec `23514`, et l'envoi d'une photo échouait sans que
--  l'écran puisse l'expliquer. C'était le seul chemin de repli documenté.
--
--  Deux changements, tous les deux additifs :
--
--   1. la contrainte accepte `/api/media/<chemin>` en plus des URL
--      absolues (le rendu `<img src="/api/media/…">` fonctionne tel quel) ;
--   2. un déclencheur vérifie que l'auteur du message **possède** le
--      fichier référencé. Sans lui, un utilisateur pouvait citer le chemin
--      privé d'un autre dans sa propre conversation et obtenir, par la
--      policy `can_read_media_file`, l'accès au fichier d'autrui. Le chemin
--      UUID n'est pas une autorisation.
--
--  Rollback : `drop trigger` des trois déclencheurs, `drop function
--  enforce_media_owner()`, puis restaurer les contraintes de la 056.
--  Aucune donnée existante n'est modifiée.
-- ============================================================

alter table public.posts drop constraint if exists posts_media_url_https;
alter table public.posts
  add constraint posts_media_url_https
  check (media_url = '' or media_url ~ '^(https://|http://localhost|http://127\.0\.0\.1|/api/media/)[^[:space:]]*$');

alter table public.direct_messages drop constraint if exists direct_messages_media_url_https;
alter table public.direct_messages
  add constraint direct_messages_media_url_https
  check (media_url = '' or media_url ~ '^(https://|http://localhost|http://127\.0\.0\.1|/api/media/)[^[:space:]]*$');

alter table public.group_messages drop constraint if exists group_messages_media_url_https;
alter table public.group_messages
  add constraint group_messages_media_url_https
  check (media_url = '' or media_url ~ '^(https://|http://localhost|http://127\.0\.0\.1|/api/media/)[^[:space:]]*$');

-- Une story dont le média est servi par `/api/media/<chemin>` doit aussi
-- compter comme privée : sans cette branche, la policy de `media_files`
-- répondait « public » et un anonyme lisait la vidéo d'une story, y compris
-- après son expiration. La lecture exige une session et une story vivante ;
-- l'auteur garde l'accès par la branche `owner_id` de `can_read_media_file`.
create or replace function public.media_file_is_private(target_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1 from public.direct_messages dm
            where dm.media_url like '%/api/media/' || target_path
         )
      or exists (
           select 1 from public.group_messages gm
            where gm.media_url like '%/api/media/' || target_path
         )
      or exists (
           select 1 from public.stories s
            where s.media_url like '%/api/media/' || target_path
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
           select 1 from public.stories s
            where s.media_url like '%/api/media/' || target_path
              and s.expires_at > now()
              and auth.uid() is not null
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
            where dm.media_url like '%/api/media/' || target_path
              and auth.uid() = any(c.participants)
         )
      or exists (
           select 1
             from public.group_messages gm
             join public.group_members m on m.group_id = gm.group_id
            where gm.media_url like '%/api/media/' || target_path
              and m.user_id = auth.uid()
         );
$$;

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

  if new.media_url like '/api/media/%' then
    target_path := substring(new.media_url from '^/api/media/([A-Za-z0-9][A-Za-z0-9._-]{0,119})$');
    if target_path is null then
      raise exception 'chemin de média invalide' using errcode = '23514';
    end if;

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

drop trigger if exists enforce_media_owner_posts on public.posts;
create trigger enforce_media_owner_posts
  before insert or update of media_url on public.posts
  for each row execute function public.enforce_media_owner();

drop trigger if exists enforce_media_owner_dm on public.direct_messages;
create trigger enforce_media_owner_dm
  before insert or update of media_url on public.direct_messages
  for each row execute function public.enforce_media_owner();

drop trigger if exists enforce_media_owner_gm on public.group_messages;
create trigger enforce_media_owner_gm
  before insert or update of media_url on public.group_messages
  for each row execute function public.enforce_media_owner();

comment on function public.enforce_media_owner() is
  'Refuse un média /api/media/<chemin> qui n''appartient pas à l''auteur de la ligne.';
