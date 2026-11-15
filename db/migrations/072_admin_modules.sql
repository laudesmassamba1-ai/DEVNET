-- ============================================================
--  DEVNET — migration 072 : les quatre modules manquants
--
--  La console d'administration déclarait trois modules
--  « indisponible » (incidents, communications, conformité) et un
--  module « partiel » dont le manque était le plus coûteux : Contenu.
--  Un administrateur voyait un signalement et ne pouvait rien faire,
--  parce que la migration 011 renvoie la suppression de contenu « aux
--  politiques habituelles, à l'auteur ». C'est ce trou que cette
--  migration ferme, avec les trois autres.
--
--  Quatre fonctions, toutes en `security definer`, toutes gardées par
--  `is_admin()` **avant** d'écrire, toutes journalisées dans
--  `admin_audit_log` avec l'identité réelle de l'acteur :
--
--    admin_delete_content   — supprime un post, un commentaire, une
--                             story ou un message de groupe signalé ;
--    open_incident          — ouvre un incident d'exploitation ;
--    resolve_incident       — le clôt avec sa résolution ;
--    publish_announcement   — publie une annonce lue par les comptes ;
--    retract_announcement   — la retire ;
--    submit_compliance_request — un compte demande ses données ou leur
--                             suppression ;
--    resolve_compliance_request — l'administration traite la demande.
--
--  Aucune politique d'écriture n'est créée sur les nouvelles tables :
--  les fonctions sont le seul chemin, et elles vérifient le rôle. La
--  lecture, elle, est ouverte là où elle doit l'être — une annonce
--  publiée est faite pour être lue.
--
--  Rollback : drop les quatre tables puis les sept fonctions ; la
--  migration est additive et ne touche aucune donnée existante.
-- ============================================================

-- ── 1. Modération : supprimer le contenu signalé ──────────────

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

  -- Le type est une liste blanche : `execute format(...)` sur un nom de
  -- table fourni par l'appelant serait une injection, même en
  -- `security definer`.
  if p_target_type not in ('post', 'comment', 'story', 'group_message') then
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

-- ── 2. Incidents d'exploitation ───────────────────────────────

create table if not exists public.platform_incidents (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) between 3 and 140),
  body        text not null default '',
  severity    text not null default 'minor'
                check (severity in ('minor', 'major', 'critical')),
  status      text not null default 'open'
                check (status in ('open', 'monitoring', 'resolved')),
  opened_by   uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint platform_incidents_resolved_coherent
    check ((status = 'resolved' and resolved_at is not null)
        or (status <> 'resolved' and resolved_at is null))
);

create index if not exists platform_incidents_status_idx
  on public.platform_incidents (status, created_at desc);

alter table public.platform_incidents enable row level security;

drop policy if exists platform_incidents_read on public.platform_incidents;
create policy platform_incidents_read
  on public.platform_incidents for select
  to authenticated
  using (true);

revoke insert, update, delete on public.platform_incidents from anon, authenticated;
grant select on public.platform_incidents to authenticated;

create or replace function public.open_incident(
  p_title    text,
  p_body     text default '',
  p_severity text default 'minor'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  new_id uuid;
begin
  if not public.is_admin() then
    raise exception 'réservé à l''administration' using errcode = '42501';
  end if;
  if p_severity not in ('minor', 'major', 'critical') then
    raise exception 'gravité inconnue' using errcode = '22023';
  end if;

  insert into public.platform_incidents (title, body, severity, opened_by)
  values (btrim(p_title), coalesce(p_body, ''), p_severity, actor)
  returning id into new_id;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (actor, 'incident.open', 'incident', new_id::text,
          jsonb_build_object('title', btrim(p_title), 'severity', p_severity));

  return new_id;
end;
$$;

create or replace function public.resolve_incident(
  p_id         uuid,
  p_status     text,
  p_resolution text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'réservé à l''administration' using errcode = '42501';
  end if;
  if p_status not in ('open', 'monitoring', 'resolved') then
    raise exception 'statut inconnu' using errcode = '22023';
  end if;

  update public.platform_incidents
     set status = p_status,
         resolved_at = case when p_status = 'resolved' then now() else null end,
         updated_at = now()
   where id = p_id;

  if not found then
    raise exception 'incident introuvable' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (actor, 'incident.status', 'incident', p_id::text,
          jsonb_build_object('status', p_status, 'resolution', p_resolution));
end;
$$;

revoke all on function public.open_incident(text, text, text) from public, anon;
revoke all on function public.resolve_incident(uuid, text, text) from public, anon;
grant execute on function public.open_incident(text, text, text) to authenticated;
grant execute on function public.resolve_incident(uuid, text, text) to authenticated;

-- ── 3. Communications : annonces ──────────────────────────────

create table if not exists public.platform_announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(btrim(title)) between 3 and 140),
  body       text not null check (length(btrim(body)) between 1 and 2000),
  level      text not null default 'info'
               check (level in ('info', 'warning', 'critical')),
  published  boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  retracted_at timestamptz
);

create index if not exists platform_announcements_live_idx
  on public.platform_announcements (created_at desc)
  where published and retracted_at is null;

alter table public.platform_announcements enable row level security;

-- Une annonce publiée est faite pour être lue : la lecture est ouverte à
-- tout compte authentifié, y compris pour celles qui sont retirées (elles
-- restent dans l'historique, marquées). L'écriture est fermée.
drop policy if exists platform_announcements_read on public.platform_announcements;
create policy platform_announcements_read
  on public.platform_announcements for select
  to authenticated
  using (true);

revoke insert, update, delete on public.platform_announcements from anon, authenticated;
grant select on public.platform_announcements to authenticated;

create or replace function public.publish_announcement(
  p_title text,
  p_body  text,
  p_level text default 'info'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  new_id uuid;
begin
  if not public.is_admin() then
    raise exception 'réservé à l''administration' using errcode = '42501';
  end if;
  if p_level not in ('info', 'warning', 'critical') then
    raise exception 'niveau inconnu' using errcode = '22023';
  end if;

  insert into public.platform_announcements (title, body, level, created_by)
  values (btrim(p_title), btrim(p_body), p_level, actor)
  returning id into new_id;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (actor, 'announcement.publish', 'announcement', new_id::text,
          jsonb_build_object('title', btrim(p_title), 'level', p_level));

  return new_id;
end;
$$;

create or replace function public.retract_announcement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'réservé à l''administration' using errcode = '42501';
  end if;

  update public.platform_announcements
     set published = false, retracted_at = now()
   where id = p_id and retracted_at is null;

  if not found then
    raise exception 'annonce introuvable ou déjà retirée' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (actor, 'announcement.retract', 'announcement', p_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.publish_announcement(text, text, text) from public, anon;
revoke all on function public.retract_announcement(uuid) from public, anon;
grant execute on function public.publish_announcement(text, text, text) to authenticated;
grant execute on function public.retract_announcement(uuid) to authenticated;

-- ── 4. Conformité : demandes de données ───────────────────────

create table if not exists public.compliance_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  kind        text not null check (kind in ('export', 'deletion')),
  note        text not null default '' check (length(note) <= 500),
  status      text not null default 'pending'
                check (status in ('pending', 'in_progress', 'done', 'refused')),
  handled_by  uuid references public.users(id) on delete set null,
  resolution  text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists compliance_requests_status_idx
  on public.compliance_requests (status, created_at desc);

alter table public.compliance_requests enable row level security;

-- Un compte voit ses propres demandes ; l'administration voit tout.
drop policy if exists compliance_requests_read on public.compliance_requests;
create policy compliance_requests_read
  on public.compliance_requests for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke insert, update, delete on public.compliance_requests from anon, authenticated;
grant select on public.compliance_requests to authenticated;

create or replace function public.submit_compliance_request(
  p_kind text,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  new_id uuid;
begin
  if actor is null then
    raise exception 'session requise' using errcode = '42501';
  end if;
  if p_kind not in ('export', 'deletion') then
    raise exception 'type de demande inconnu' using errcode = '22023';
  end if;

  -- Une seule demande en attente par compte et par type : sans cela, un
  -- clic répété remplirait la file et rendrait le traitement illisible.
  if exists (
    select 1 from public.compliance_requests
     where user_id = actor and kind = p_kind and status in ('pending', 'in_progress')
  ) then
    raise exception 'une demande est déjà en cours' using errcode = '23505';
  end if;

  insert into public.compliance_requests (user_id, kind, note)
  values (actor, p_kind, coalesce(p_note, ''))
  returning id into new_id;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (actor, 'compliance.request', 'compliance', new_id::text,
          jsonb_build_object('kind', p_kind));

  return new_id;
end;
$$;

create or replace function public.resolve_compliance_request(
  p_id         uuid,
  p_status     text,
  p_resolution text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'réservé à l''administration' using errcode = '42501';
  end if;
  if p_status not in ('in_progress', 'done', 'refused') then
    raise exception 'statut inconnu' using errcode = '22023';
  end if;

  update public.compliance_requests
     set status = p_status,
         handled_by = actor,
         resolution = p_resolution,
         resolved_at = case when p_status in ('done', 'refused') then now() else null end
   where id = p_id;

  if not found then
    raise exception 'demande introuvable' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (actor, 'compliance.status', 'compliance', p_id::text,
          jsonb_build_object('status', p_status, 'resolution', p_resolution));
end;
$$;

revoke all on function public.submit_compliance_request(text, text) from public, anon;
revoke all on function public.resolve_compliance_request(uuid, text, text) from public, anon;
grant execute on function public.submit_compliance_request(text, text) to authenticated;
grant execute on function public.resolve_compliance_request(uuid, text, text) to authenticated;

comment on function public.admin_delete_content(text, uuid, text) is
  'Supprime un contenu signalé ; réservé aux administrateurs, journalisé.';
comment on table public.platform_incidents is
  'Registre des incidents d''exploitation ; écriture par fonction seulement.';
comment on table public.platform_announcements is
  'Annonces publiées par l''administration ; lecture ouverte aux comptes.';
comment on table public.compliance_requests is
  'Demandes de données (export, suppression) ; un compte voit les siennes.';
