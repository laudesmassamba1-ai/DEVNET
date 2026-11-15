-- ============================================================
--  DEVNET — migration 077 : garde-fous de décision
--
--  Deux corrections mesurées après la 076 :
--
--   1. **Le bannissement définitif** ne doit pas être prononcé par un
--      `lead_moderator`. L'écran le refuse déjà, mais un appel direct à
--      `issue_sanction` pouvait le contourner. Le verrou est en base.
--
--   2. **La suppression d'un message privé** manquait dans
--      `admin_delete_content`. Un signalement sur un message privé
--      pouvait donc être lu, puis rester sans moyen d'agir. La fonction
--      accepte désormais `direct_message`.
--
--  Aucune table nouvelle. Rollback : recréer la version 072 de
--  `admin_delete_content` et supprimer le trigger de garde.
-- ============================================================

-- ── 1. Un bannissement demande un administrateur ─────────────

create or replace function public.guard_ban_authority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'ban'
     and auth.uid() is not null
     and public.trust_safety_role() not in ('owner', 'admin') then
    raise exception 'un bannissement définitif demande un administrateur'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_ban_authority on public.user_sanctions;
create trigger guard_ban_authority
  before insert on public.user_sanctions
  for each row execute function public.guard_ban_authority();

-- ── 2. Suppression d'un message privé ───────────────────────

create or replace function public.admin_delete_content(
  p_target_type text,
  p_target_id   uuid,
  p_reason      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor   uuid := auth.uid();
  removed integer := 0;
  preview text;
  author  uuid;
begin
  if not public.is_admin() then
    raise exception 'réservé à l''administration' using errcode = '42501';
  end if;

  if p_target_type not in ('post', 'comment', 'story', 'group_message', 'direct_message') then
    raise exception 'type de contenu inconnu' using errcode = '22023';
  end if;

  if p_target_type = 'post' then
    select left(coalesce(text, ''), 120), author_id into preview, author
      from public.posts where id = p_target_id;
    delete from public.posts where id = p_target_id;
    get diagnostics removed = row_count;
  elsif p_target_type = 'comment' then
    select left(coalesce(text, ''), 120), author_id into preview, author
      from public.comments where id = p_target_id;
    delete from public.comments where id = p_target_id;
    get diagnostics removed = row_count;
  elsif p_target_type = 'story' then
    select left(coalesce(caption, ''), 120), author_id into preview, author
      from public.stories where id = p_target_id;
    delete from public.stories where id = p_target_id;
    get diagnostics removed = row_count;
  elsif p_target_type = 'direct_message' then
    select left(coalesce(text, ''), 120), author_id into preview, author
      from public.direct_messages where id = p_target_id;
    delete from public.direct_messages where id = p_target_id;
    get diagnostics removed = row_count;
  else
    select left(coalesce(text, ''), 120), author_id into preview, author
      from public.group_messages where id = p_target_id;
    delete from public.group_messages where id = p_target_id;
    get diagnostics removed = row_count;
  end if;

  if removed = 0 then
    raise exception 'contenu introuvable' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (
    actor, 'moderation.delete', p_target_type, p_target_id::text,
    jsonb_build_object('reason', p_reason, 'author_id', author, 'preview', preview)
  );

  return jsonb_build_object('deleted', true, 'target_type', p_target_type, 'target_id', p_target_id);
end;
$$;

revoke all on function public.admin_delete_content(text, uuid, text) from public, anon;
grant execute on function public.admin_delete_content(text, uuid, text) to authenticated;
