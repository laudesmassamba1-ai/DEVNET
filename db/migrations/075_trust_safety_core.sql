-- ============================================================
--  DEVNET — migration 075 : socle Trust & Safety
--
--  Trois manques mesurés le 15/11/2026, et rien de plus :
--
--   1. **Aucun rôle de modération.** `is_admin` est un booléen : on
--      ne peut pas nommer un modérateur sans lui donner tous les
--      pouvoirs d'administration. `moderation_roles` ajoute owner,
--      admin, lead_moderator, moderator et analyst, sans retirer
--      `is_admin` (rétrocompatible : un admin reste admin).
--
--   2. **Aucune protection individuelle.** `user_blocks` et
--      `user_mutes` existent désormais ; l'application les applique
--      au fil. Écriture par RPC uniquement, lecture limitée au
--      propriétaire et à la modération.
--
--   3. **Aucune sanction ni recours.** Un signalement pouvait être
--      classé, jamais suivi d'effet. `user_sanctions` porte la
--      décision, sa durée et sa source ; `sanction_appeals` porte la
--      contestation. Un recours ne peut pas être révisé par l'auteur
--      de la sanction — contrainte en base, pas seulement à l'écran.
--
--  Ce que cette migration ne fait pas, volontairement : aucun
--  classifieur IA, aucune suppression automatique, aucun scan des
--  messages privés. Les moteurs et le Policy Engine viendront dans
--  des migrations séparées, avec leurs fournisseurs et leurs tests.
--
--  Rollback : drop des cinq tables, des triggers et des fonctions.
--  Aucune colonne existante n'est modifiée.
-- ============================================================

-- ── 1. Rôles de modération ───────────────────────────────────

create table if not exists public.moderation_roles (
  user_id    uuid primary key references public.users(id) on delete cascade,
  role       text not null
               check (role in ('owner', 'admin', 'lead_moderator', 'moderator', 'analyst')),
  granted_by uuid references public.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.moderation_roles enable row level security;

revoke insert, update, delete on public.moderation_roles from anon, authenticated;
grant select on public.moderation_roles to authenticated;

-- ── 2. Rôle effectif et permissions ──────────────────────────
--  `is_admin` reste la clé historique : un administrateur est au
--  moins « admin » même sans ligne dans la table. Les rôles ne
--  peuvent donc pas retirer un pouvoir existant.

create or replace function public.trust_safety_role(p_user uuid default null)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with target as (select coalesce(p_user, auth.uid()) as id)
  select case
    when t.id is null then null
    when exists (select 1 from public.users u where u.id = t.id and u.is_admin) then
      coalesce(
        (select r.role from public.moderation_roles r
          where r.user_id = t.id and r.role in ('owner', 'admin')),
        'admin'
      )
    else
      (select r.role from public.moderation_roles r where r.user_id = t.id)
  end
  from target t
$$;

create or replace function public.can_view_trust_safety()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.trust_safety_role() in
    ('owner', 'admin', 'lead_moderator', 'moderator', 'analyst'), false)
$$;

create or replace function public.can_moderate()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.trust_safety_role() in
    ('owner', 'admin', 'lead_moderator', 'moderator'), false)
$$;

create or replace function public.can_sanction()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.trust_safety_role() in ('owner', 'admin', 'lead_moderator'), false)
$$;

create or replace function public.can_manage_roles()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.trust_safety_role() in ('owner', 'admin'), false)
$$;

drop policy if exists moderation_roles_read on public.moderation_roles;
create policy moderation_roles_read
  on public.moderation_roles for select to authenticated
  using (user_id = auth.uid() or public.can_manage_roles());

revoke all on function public.trust_safety_role(uuid) from public, anon;
revoke all on function public.can_view_trust_safety() from public, anon;
revoke all on function public.can_moderate() from public, anon;
revoke all on function public.can_sanction() from public, anon;
revoke all on function public.can_manage_roles() from public, anon;
grant execute on function public.trust_safety_role(uuid) to authenticated;
grant execute on function public.can_view_trust_safety() to authenticated;
grant execute on function public.can_moderate() to authenticated;
grant execute on function public.can_sanction() to authenticated;
grant execute on function public.can_manage_roles() to authenticated;

-- ── 3. Blocage et sourdine ───────────────────────────────────
--  Deux relations distinctes, deux effets distincts :
--   · bloquer retire les interactions croisées ;
--   · mettre en sourdine masque les publications sans couper le
--     lien de suivi ni empêcher un message existant.
--  Un utilisateur ne peut ni se bloquer ni se mettre en sourdine.

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_target_idx
  on public.user_blocks (blocked_id);

create table if not exists public.user_mutes (
  muter_id uuid not null references public.users(id) on delete cascade,
  muted_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint user_mutes_not_self check (muter_id <> muted_id)
);

create index if not exists user_mutes_target_idx
  on public.user_mutes (muted_id);

alter table public.user_blocks enable row level security;
alter table public.user_mutes enable row level security;

drop policy if exists user_blocks_read on public.user_blocks;
create policy user_blocks_read
  on public.user_blocks for select to authenticated
  using (blocker_id = auth.uid() or public.can_view_trust_safety());

drop policy if exists user_mutes_read on public.user_mutes;
create policy user_mutes_read
  on public.user_mutes for select to authenticated
  using (muter_id = auth.uid() or public.can_view_trust_safety());

revoke insert, update, delete on public.user_blocks from anon, authenticated;
revoke insert, update, delete on public.user_mutes from anon, authenticated;
grant select on public.user_blocks to authenticated;
grant select on public.user_mutes to authenticated;

create or replace function public.block_user(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'session requise' using errcode = '42501';
  end if;
  if p_target is null or p_target = actor then
    raise exception 'cible invalide' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users where id = p_target) then
    raise exception 'compte introuvable' using errcode = 'P0002';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id)
  values (actor, p_target)
  on conflict do nothing;
end;
$$;

create or replace function public.unblock_user(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'session requise' using errcode = '42501';
  end if;
  delete from public.user_blocks
   where blocker_id = actor and blocked_id = p_target;
end;
$$;

create or replace function public.mute_user(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'session requise' using errcode = '42501';
  end if;
  if p_target is null or p_target = actor then
    raise exception 'cible invalide' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users where id = p_target) then
    raise exception 'compte introuvable' using errcode = 'P0002';
  end if;

  insert into public.user_mutes (muter_id, muted_id)
  values (actor, p_target)
  on conflict do nothing;
end;
$$;

create or replace function public.unmute_user(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'session requise' using errcode = '42501';
  end if;
  delete from public.user_mutes
   where muter_id = actor and muted_id = p_target;
end;
$$;

revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
revoke all on function public.mute_user(uuid) from public, anon;
revoke all on function public.unmute_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.mute_user(uuid) to authenticated;
grant execute on function public.unmute_user(uuid) to authenticated;

-- ── 4. Sanctions ─────────────────────────────────────────────
--  `warning` n'a pas de fin ; `suspend` en exige une ; `ban` n'en a
--  pas. Un statut `lifted` porte toujours son auteur et sa date :
--  une levée sans trace n'est pas une levée, c'est un effacement.

create table if not exists public.user_sanctions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  kind         text not null
                 check (kind in ('warning', 'restrict', 'suspend', 'ban')),
  reason_code  text not null
                 check (reason_code in (
                   'harassment', 'hate', 'threats', 'sexual', 'minor_safety',
                   'self_harm', 'spam', 'scam', 'doxxing', 'malware_secret',
                   'impersonation', 'other'
                 )),
  note         text not null default '' check (char_length(note) <= 2000),
  source_flag  uuid references public.moderation_flags(id) on delete set null,
  issued_by    uuid references public.users(id) on delete set null,
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz,
  status       text not null default 'active'
                 check (status in ('active', 'lifted', 'expired')),
  lifted_by    uuid references public.users(id) on delete set null,
  lifted_at    timestamptz,
  created_at   timestamptz not null default now(),

  constraint user_sanctions_duration
    check (
      (kind = 'suspend' and ends_at is not null and ends_at > starts_at)
      or (kind in ('warning', 'ban') and ends_at is null)
      or (kind = 'restrict')
    ),
  constraint user_sanctions_lift_coherent
    check (
      (status = 'active' and lifted_at is null and lifted_by is null)
      or (status = 'lifted' and lifted_at is not null and lifted_by is not null)
      or (status = 'expired' and ends_at is not null)
    )
);

create index if not exists user_sanctions_user_idx
  on public.user_sanctions (user_id, created_at desc);
create index if not exists user_sanctions_active_idx
  on public.user_sanctions (status, ends_at)
  where status = 'active';

alter table public.user_sanctions enable row level security;

drop policy if exists user_sanctions_read on public.user_sanctions;
create policy user_sanctions_read
  on public.user_sanctions for select to authenticated
  using (user_id = auth.uid() or public.can_view_trust_safety());

revoke insert, update, delete on public.user_sanctions from anon, authenticated;
grant select on public.user_sanctions to authenticated;

-- ── 5. Recours ───────────────────────────────────────────────

create table if not exists public.sanction_appeals (
  id            uuid primary key default gen_random_uuid(),
  sanction_id   uuid not null references public.user_sanctions(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  message       text not null check (char_length(message) between 10 and 2000),
  status        text not null default 'pending'
                  check (status in ('pending', 'upheld', 'overturned')),
  reviewed_by   uuid references public.users(id) on delete set null,
  reviewed_at   timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 2000),
  created_at    timestamptz not null default now(),

  constraint sanction_appeals_decision_coherent
    check (
      (status = 'pending' and reviewed_by is null and reviewed_at is null)
      or (status <> 'pending' and reviewed_at is not null)
    )
);

create index if not exists sanction_appeals_pending_idx
  on public.sanction_appeals (status, created_at)
  where status = 'pending';
create unique index if not exists sanction_appeals_one_pending
  on public.sanction_appeals (sanction_id)
  where status = 'pending';

alter table public.sanction_appeals enable row level security;

drop policy if exists sanction_appeals_read on public.sanction_appeals;
create policy sanction_appeals_read
  on public.sanction_appeals for select to authenticated
  using (user_id = auth.uid() or public.can_view_trust_safety());

revoke insert, update, delete on public.sanction_appeals from anon, authenticated;
grant select on public.sanction_appeals to authenticated;

-- Le réviseur ne peut pas être l'auteur de la sanction. La contrainte
-- vit en base : un écran peut oublier, un appel direct à la fonction
-- ne le peut pas.
create or replace function public.sanction_appeal_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  issuer uuid;
begin
  if new.status <> 'pending' then
    if new.reviewed_at is null then
      raise exception 'une décision de recours porte sa date' using errcode = '23514';
    end if;
    select issued_by into issuer
      from public.user_sanctions where id = new.sanction_id;
    if issuer is not null and new.reviewed_by = issuer then
      raise exception 'un recours ne peut pas être révisé par l''auteur de la sanction'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sanction_appeals_guard on public.sanction_appeals;
create trigger sanction_appeals_guard
  before insert or update on public.sanction_appeals
  for each row execute function public.sanction_appeal_guard();

-- ── 6. Application des sanctions ─────────────────────────────
--  Une suspension ou un bannissement actif refuse les nouvelles
--  publications. Les avertissements et restrictions ne bloquent pas
--  la publication : leur portée reste à instrumenter (phase 2).

create or replace function public.enforce_active_sanction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
      from public.user_sanctions s
     where s.user_id = new.author_id
       and s.status = 'active'
       and s.kind in ('suspend', 'ban')
       and (s.ends_at is null or s.ends_at > now())
  ) then
    raise exception 'compte suspendu ou banni : publication refusée'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_sanction_posts on public.posts;
create trigger enforce_sanction_posts
  before insert on public.posts
  for each row execute function public.enforce_active_sanction();

drop trigger if exists enforce_sanction_comments on public.comments;
create trigger enforce_sanction_comments
  before insert on public.comments
  for each row execute function public.enforce_active_sanction();

drop trigger if exists enforce_sanction_stories on public.stories;
create trigger enforce_sanction_stories
  before insert on public.stories
  for each row execute function public.enforce_active_sanction();

drop trigger if exists enforce_sanction_group_messages on public.group_messages;
create trigger enforce_sanction_group_messages
  before insert on public.group_messages
  for each row execute function public.enforce_active_sanction();

-- ── 7. Fonctions de décision ─────────────────────────────────

create or replace function public.issue_sanction(
  p_user        uuid,
  p_kind        text,
  p_reason_code text,
  p_note        text default '',
  p_days        integer default null,
  p_source_flag uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  new_id uuid;
  ends_at timestamptz;
begin
  if not public.can_sanction() then
    raise exception 'réservé à la modération habilitée' using errcode = '42501';
  end if;
  if p_user = actor then
    raise exception 'on ne se sanctionne pas soi-même' using errcode = '22023';
  end if;
  if p_kind not in ('warning', 'restrict', 'suspend', 'ban') then
    raise exception 'type de sanction inconnu' using errcode = '22023';
  end if;

  ends_at := case
    when p_kind = 'suspend' then
      case when p_days is null or p_days < 1 or p_days > 3650
        then now() + interval '7 days'
        else now() + make_interval(days => p_days)
      end
    when p_kind = 'restrict' and p_days is not null and p_days > 0
      then now() + make_interval(days => p_days)
    else null
  end;

  insert into public.user_sanctions
    (user_id, kind, reason_code, note, source_flag, issued_by, ends_at)
  values
    (p_user, p_kind, p_reason_code, left(coalesce(p_note, ''), 2000),
     p_source_flag, actor, ends_at)
  returning id into new_id;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (
    actor, 'sanction.issue', 'user', p_user::text,
    jsonb_build_object(
      'sanction_id', new_id,
      'kind', p_kind,
      'reason', p_reason_code,
      'ends_at', ends_at
    )
  );

  return new_id;
end;
$$;

create or replace function public.lift_sanction(p_id uuid, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if not public.can_sanction() then
    raise exception 'réservé à la modération habilitée' using errcode = '42501';
  end if;

  update public.user_sanctions
     set status = 'lifted',
         lifted_by = actor,
         lifted_at = now(),
         note = left(note || case when coalesce(p_note, '') = '' then '' else E'\n' || p_note end, 2000)
   where id = p_id and status = 'active';

  if not found then
    raise exception 'sanction introuvable ou déjà levée' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (actor, 'sanction.lift', 'sanction', p_id::text,
          jsonb_build_object('note', left(coalesce(p_note, ''), 500)));
end;
$$;

create or replace function public.submit_appeal(p_sanction uuid, p_message text)
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
  if not exists (
    select 1 from public.user_sanctions
     where id = p_sanction and user_id = actor and status = 'active'
  ) then
    raise exception 'sanction introuvable ou déjà levée' using errcode = 'P0002';
  end if;

  insert into public.sanction_appeals (sanction_id, user_id, message)
  values (p_sanction, actor, btrim(p_message))
  returning id into new_id;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (actor, 'sanction.appeal', 'sanction', p_sanction::text,
          jsonb_build_object('appeal_id', new_id));

  return new_id;
end;
$$;

create or replace function public.review_appeal(
  p_id       uuid,
  p_decision text,
  p_note     text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  target_sanction uuid;
begin
  if not public.can_sanction() then
    raise exception 'réservé à la modération habilitée' using errcode = '42501';
  end if;
  if p_decision not in ('upheld', 'overturned') then
    raise exception 'décision inconnue' using errcode = '22023';
  end if;

  update public.sanction_appeals
     set status = p_decision,
         reviewed_by = actor,
         reviewed_at = now(),
         decision_note = left(coalesce(p_note, ''), 2000)
   where id = p_id and status = 'pending'
   returning sanction_id into target_sanction;

  if target_sanction is null then
    raise exception 'recours introuvable ou déjà traité' using errcode = 'P0002';
  end if;

  if p_decision = 'overturned' then
    update public.user_sanctions
       set status = 'lifted', lifted_by = actor, lifted_at = now()
     where id = target_sanction and status = 'active';
  end if;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (actor, 'sanction.appeal.review', 'appeal', p_id::text,
          jsonb_build_object('decision', p_decision, 'sanction_id', target_sanction));
end;
$$;

create or replace function public.set_moderation_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if not public.can_manage_roles() then
    raise exception 'réservé à l''administration' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'admin', 'lead_moderator', 'moderator', 'analyst') then
    raise exception 'rôle inconnu' using errcode = '22023';
  end if;

  insert into public.moderation_roles (user_id, role, granted_by)
  values (p_user, p_role, actor)
  on conflict (user_id) do update
    set role = excluded.role, granted_by = actor, updated_at = now();

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (actor, 'moderation.role.set', 'user', p_user::text,
          jsonb_build_object('role', p_role));
end;
$$;

revoke all on function public.issue_sanction(uuid, text, text, text, integer, uuid) from public, anon;
revoke all on function public.lift_sanction(uuid, text) from public, anon;
revoke all on function public.submit_appeal(uuid, text) from public, anon;
revoke all on function public.review_appeal(uuid, text, text) from public, anon;
revoke all on function public.set_moderation_role(uuid, text) from public, anon;
grant execute on function public.issue_sanction(uuid, text, text, text, integer, uuid) to authenticated;
grant execute on function public.lift_sanction(uuid, text) to authenticated;
grant execute on function public.submit_appeal(uuid, text) to authenticated;
grant execute on function public.review_appeal(uuid, text, text) to authenticated;
grant execute on function public.set_moderation_role(uuid, text) to authenticated;

comment on table public.user_sanctions is
  'Sanctions graduées : avertissement, restriction, suspension, bannissement. Levée tracée.';
comment on table public.sanction_appeals is
  'Recours : un réviseur différent de l''auteur de la sanction, contrainte en base.';
comment on function public.enforce_active_sanction() is
  'Refuse les publications d''un compte suspendu ou banni ; les avertissements ne bloquent rien.';
