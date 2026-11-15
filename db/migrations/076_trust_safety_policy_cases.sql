-- ============================================================
--  DEVNET — migration 076 : Policy Engine, dossiers et moteurs
--
--  La 075 a posé les rôles, les blocages, les sanctions et les
--  recours. Elle s'arrêtait volontairement avant les moteurs : un
--  signalement pouvait produire une sanction, mais rien ne reliait
--  encore un signal à une décision, un moteur à une preuve, ou une
--  politique à une version.
--
--  Cette migration ajoute ce chaînon, et seulement lui :
--
--   1. une **version de politique** active, lue par le serveur ;
--   2. des **dossiers** (`moderation_cases`) qui regroupent les
--      signaux d'une même cible, quel que soit le chemin qui les a
--      produits (signalement, texte, image, lien, comportement) ;
--   3. des **constats** (`moderation_findings`) et des **preuves**
--      (`moderation_evidence`) séparés : un constat est une
--      observation, une preuve est une copie conservée avant toute
--      suppression ;
--   4. des **paramètres de protection** utilisateur ;
--   5. deux cibles de signalement supplémentaires (story et message
--      privé) sans casser les quatre colonnes existantes ;
--   6. l'application des restrictions par capacité et le blocage de
--      connexion pour les comptes suspendus ou bannis.
--
--  Ce que cette migration ne fait pas : aucun classifieur externe,
--  aucune suppression automatique, aucun scan des messages privés.
--  Une heuristique ne condamne pas ; elle ouvre un dossier.
--
--  Rollback : les tables ajoutées et les colonnes ajoutées à
--  `reports` / `notifications` / `user_sanctions`. Les politiques et
--  triggers existants sont remplacés, jamais supprimés sans remise.
-- ============================================================


-- ── 1. Politique versionnée ──────────────────────────────────

create table if not exists public.moderation_policy_versions (
  version      text primary key,
  active       boolean not null default false,
  categories   jsonb not null default '{}'::jsonb,
  thresholds   jsonb not null default '{}'::jsonb,
  notes        text not null default '' check (char_length(notes) <= 4000),
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  activated_at timestamptz
);

create unique index if not exists moderation_policy_one_active
  on public.moderation_policy_versions ((active))
  where active;

alter table public.moderation_policy_versions enable row level security;

drop policy if exists moderation_policy_read on public.moderation_policy_versions;
create policy moderation_policy_read
  on public.moderation_policy_versions for select to authenticated
  using (active or public.can_view_trust_safety());

revoke insert, update, delete on public.moderation_policy_versions from anon, authenticated;
grant select on public.moderation_policy_versions to authenticated;

-- La politique initiale est une **donnée**, pas une constante du code.
-- Le serveur a un repli identique dans `lib/trust-safety/policy.ts` :
-- une base sans cette ligne ne doit pas laisser l'application sans
-- politique, mais la version affichée reste celle de la base.
insert into public.moderation_policy_versions (version, active, categories, thresholds, notes, activated_at)
values (
  '2026.11.1',
  true,
  jsonb_build_object(
    'insult',    jsonb_build_object('severity', 'warning',  'auto', 'block'),
    'hate',      jsonb_build_object('severity', 'critical', 'auto', 'block'),
    'sexual',    jsonb_build_object('severity', 'critical', 'auto', 'block'),
    'violence',  jsonb_build_object('severity', 'critical', 'auto', 'hold'),
    'threat',    jsonb_build_object('severity', 'critical', 'auto', 'hold'),
    'self_harm', jsonb_build_object('severity', 'critical', 'auto', 'review'),
    'scam',      jsonb_build_object('severity', 'warning',  'auto', 'review'),
    'spam',      jsonb_build_object('severity', 'warning',  'auto', 'review'),
    'minor_safety', jsonb_build_object('severity', 'critical', 'auto', 'hold'),
    'secret',    jsonb_build_object('severity', 'critical', 'auto', 'hold'),
    'malware',   jsonb_build_object('severity', 'critical', 'auto', 'hold'),
    'doxxing',   jsonb_build_object('severity', 'critical', 'auto', 'review'),
    'other',     jsonb_build_object('severity', 'info',     'auto', 'review')
  ),
  jsonb_build_object(
    'hold_at', 0.85,
    'review_at', 0.45,
    'escalate_reports', 3,
    'auto_remove', false,
    'auto_ban', false
  ),
  'Politique initiale : blocage des catégories critiques, revue des catégories ambiguës, aucune suppression ni sanction automatique.',
  now()
)
on conflict (version) do nothing;

-- ── 2. Dossiers ──────────────────────────────────────────────

create table if not exists public.moderation_cases (
  id                uuid primary key default gen_random_uuid(),
  target_type       text not null
                      check (target_type in (
                        'post', 'comment', 'message', 'group_message',
                        'direct_message', 'story', 'profile', 'media', 'user'
                      )),
  target_id         text not null check (char_length(target_id) between 1 and 240),
  content_author_id uuid references public.users(id) on delete set null,
  status            text not null default 'open'
                      check (status in ('open', 'triaged', 'investigating', 'actioned', 'no_violation', 'closed')),
  priority          text not null default 'normal'
                      check (priority in ('low', 'normal', 'high', 'urgent')),
  policy_version    text not null default '2026.11.1',
  assigned_to       uuid references public.users(id) on delete set null,
  summary           text not null default '' check (char_length(summary) <= 1000),
  internal_note     text not null default '' check (char_length(internal_note) <= 8000),
  last_decision     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  resolved_at       timestamptz
);

create unique index if not exists moderation_cases_one_open
  on public.moderation_cases (target_type, target_id)
  where status in ('open', 'triaged', 'investigating');

create index if not exists moderation_cases_status_idx
  on public.moderation_cases (status, priority, created_at desc);
create index if not exists moderation_cases_author_idx
  on public.moderation_cases (content_author_id, created_at desc);
create index if not exists moderation_cases_assigned_idx
  on public.moderation_cases (assigned_to, created_at desc)
  where status not in ('actioned', 'no_violation', 'closed');

alter table public.moderation_cases enable row level security;

drop policy if exists moderation_cases_read on public.moderation_cases;
create policy moderation_cases_read
  on public.moderation_cases for select to authenticated
  using (public.can_view_trust_safety());

revoke insert, update, delete on public.moderation_cases from anon, authenticated;
grant select on public.moderation_cases to authenticated;

comment on table public.moderation_cases is
  'Dossier de modération : un signal ou un constat, une cible, une décision humaine. Ne contient jamais le contenu complet.';

create table if not exists public.moderation_case_events (
  id          bigserial primary key,
  case_id     uuid not null references public.moderation_cases(id) on delete cascade,
  actor_id    uuid references public.users(id) on delete set null,
  event       text not null check (char_length(event) between 1 and 80),
  from_status text,
  to_status   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists moderation_case_events_case_idx
  on public.moderation_case_events (case_id, created_at);

alter table public.moderation_case_events enable row level security;

drop policy if exists moderation_case_events_read on public.moderation_case_events;
create policy moderation_case_events_read
  on public.moderation_case_events for select to authenticated
  using (public.can_view_trust_safety());

revoke insert, update, delete on public.moderation_case_events from anon, authenticated;
grant select on public.moderation_case_events to authenticated;

-- ── 3. Constats, preuves, exécutions ─────────────────────────

create table if not exists public.moderation_findings (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references public.moderation_cases(id) on delete cascade,
  engine           text not null
                     check (engine in ('text', 'vision', 'video', 'link', 'behavior', 'secret')),
  provider         text not null default 'local',
  provider_version text not null default '',
  category         text not null,
  score            numeric(4,3) not null default 1.000
                     check (score >= 0 and score <= 1),
  severity         text not null default 'warning'
                     check (severity in ('info', 'warning', 'critical')),
  explanation_code text not null default '',
  evidence         jsonb not null default '{}'::jsonb,
  latency_ms       integer check (latency_ms is null or latency_ms >= 0),
  created_at       timestamptz not null default now()
);

create index if not exists moderation_findings_case_idx
  on public.moderation_findings (case_id, created_at);
create index if not exists moderation_findings_engine_idx
  on public.moderation_findings (engine, category, created_at desc);

alter table public.moderation_findings enable row level security;

drop policy if exists moderation_findings_read on public.moderation_findings;
create policy moderation_findings_read
  on public.moderation_findings for select to authenticated
  using (public.can_view_trust_safety());

revoke insert, update, delete on public.moderation_findings from anon, authenticated;
grant select on public.moderation_findings to authenticated;

create table if not exists public.moderation_evidence (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references public.moderation_cases(id) on delete cascade,
  content_table   text not null,
  content_id      text not null,
  content_snapshot jsonb not null,
  content_sha256  text not null default '',
  media_path      text not null default '',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '180 days')
);

create index if not exists moderation_evidence_case_idx
  on public.moderation_evidence (case_id, created_at desc);
create index if not exists moderation_evidence_expiry_idx
  on public.moderation_evidence (expires_at);

alter table public.moderation_evidence enable row level security;

drop policy if exists moderation_evidence_read on public.moderation_evidence;
create policy moderation_evidence_read
  on public.moderation_evidence for select to authenticated
  using (public.can_view_trust_safety());

revoke insert, update, delete on public.moderation_evidence from anon, authenticated;
grant select on public.moderation_evidence to authenticated;

create table if not exists public.moderation_engine_runs (
  id             uuid primary key default gen_random_uuid(),
  target_type    text not null,
  target_id      text not null,
  case_id        uuid references public.moderation_cases(id) on delete set null,
  engine         text not null,
  policy_version text not null default '',
  decision       text not null default 'review'
                   check (decision in ('allow', 'review', 'hold')),
  score          numeric(4,3) not null default 0,
  latency_ms     integer,
  status         text not null default 'ok'
                   check (status in ('ok', 'partial', 'failed', 'skipped')),
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists moderation_engine_runs_created_idx
  on public.moderation_engine_runs (created_at desc);
create index if not exists moderation_engine_runs_engine_idx
  on public.moderation_engine_runs (engine, created_at desc);

alter table public.moderation_engine_runs enable row level security;

drop policy if exists moderation_engine_runs_read on public.moderation_engine_runs;
create policy moderation_engine_runs_read
  on public.moderation_engine_runs for select to authenticated
  using (public.can_view_trust_safety());

revoke insert, update, delete on public.moderation_engine_runs from anon, authenticated;
grant select on public.moderation_engine_runs to authenticated;

create table if not exists public.moderation_blocked_domains (
  domain     text primary key check (char_length(domain) between 3 and 253),
  category   text not null default 'phishing'
               check (category in ('phishing', 'malware', 'scam', 'other')),
  reason     text not null default '' check (char_length(reason) <= 500),
  added_by   uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.moderation_blocked_domains enable row level security;

drop policy if exists moderation_blocked_domains_read on public.moderation_blocked_domains;
create policy moderation_blocked_domains_read
  on public.moderation_blocked_domains for select to authenticated
  using (public.can_view_trust_safety());

revoke insert, update, delete on public.moderation_blocked_domains from anon, authenticated;
grant select on public.moderation_blocked_domains to authenticated;

-- ── 4. Ouverture d'un dossier ────────────────────────────────
--  Une seule fonction décide quelle ligne de contenu porte l'auteur.
--  Le dossier ne recopie jamais le texte : il garde le type et
--  l'identifiant, et les preuves sont stockées à part.

create or replace function public.safe_uuid(p_value text)
returns uuid
language plpgsql
immutable
as $$
begin
  if p_value is null or p_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.moderation_target_author(p_type text, p_id text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case p_type
    when 'post'           then (select author_id from public.posts where id = public.safe_uuid(p_id))
    when 'comment'        then (select author_id from public.comments where id = public.safe_uuid(p_id))
    when 'message'        then coalesce(
                                (select author_id from public.group_messages where id = public.safe_uuid(p_id)),
                                (select author_id from public.direct_messages where id = public.safe_uuid(p_id))
                              )
    when 'group_message'  then (select author_id from public.group_messages where id = public.safe_uuid(p_id))
    when 'direct_message' then (select author_id from public.direct_messages where id = public.safe_uuid(p_id))
    when 'story'          then (select author_id from public.stories where id = public.safe_uuid(p_id))
    when 'user'           then public.safe_uuid(p_id)
    when 'profile'        then public.safe_uuid(p_id)
    when 'media'          then (select owner_id from public.media_files where path = p_id)
    else null
  end;
$$;

create or replace function public.open_moderation_case(
  p_target_type text,
  p_target_id   text,
  p_priority    text default 'normal',
  p_summary     text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_priority text;
begin
  if p_target_type not in (
    'post', 'comment', 'message', 'group_message', 'direct_message',
    'story', 'profile', 'media', 'user'
  ) then
    raise exception 'type de cible inconnu' using errcode = '22023';
  end if;

  v_priority := case
    when p_priority in ('low', 'normal', 'high', 'urgent') then p_priority
    else 'normal'
  end;

  select id into v_id
    from public.moderation_cases
   where target_type = p_target_type
     and target_id = left(p_target_id, 240)
     and status in ('open', 'triaged', 'investigating')
   limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.moderation_cases
    (target_type, target_id, content_author_id, priority, summary)
  values
    (p_target_type, left(p_target_id, 240),
     public.moderation_target_author(p_target_type, p_target_id),
     v_priority, left(coalesce(p_summary, ''), 1000))
  returning id into v_id;

  insert into public.moderation_case_events (case_id, event, to_status, details)
  values (v_id, 'case.opened', 'open', jsonb_build_object('target_type', p_target_type));

  return v_id;
exception
  when unique_violation then
    select id into v_id
      from public.moderation_cases
     where target_type = p_target_type
       and target_id = left(p_target_id, 240)
       and status in ('open', 'triaged', 'investigating')
     limit 1;
    return v_id;
end;
$$;

revoke all on function public.safe_uuid(text) from public, anon;
revoke all on function public.moderation_target_author(text, text) from public, anon;
revoke all on function public.open_moderation_case(text, text, text, text) from public, anon;
grant execute on function public.safe_uuid(text) to authenticated;
grant execute on function public.moderation_target_author(text, text) to authenticated;
grant execute on function public.open_moderation_case(text, text, text, text) to authenticated;

-- ── 5. Signaux existants reliés aux dossiers ─────────────────

alter table public.moderation_flags
  add column if not exists case_id uuid references public.moderation_cases(id) on delete set null;

create index if not exists moderation_flags_case_idx
  on public.moderation_flags (case_id);

create or replace function public.open_case_from_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case uuid;
  v_priority text;
begin
  v_priority := case new.severity
    when 'critical' then 'high'
    when 'warning' then 'normal'
    else 'low'
  end;

  v_case := public.open_moderation_case(
    new.target_type,
    new.target_id,
    v_priority,
    'Signal automatique : ' || left(new.reason, 200)
  );

  update public.moderation_flags set case_id = v_case where id = new.id;

  insert into public.moderation_case_events (case_id, event, details)
  values (v_case, 'flag.linked', jsonb_build_object(
    'flag_id', new.id, 'source', new.source, 'severity', new.severity
  ));

  return new;
end;
$$;

drop trigger if exists open_case_from_flag on public.moderation_flags;
create trigger open_case_from_flag
  after insert on public.moderation_flags
  for each row execute function public.open_case_from_flag();

-- ── 6. Paramètres de protection utilisateur ──────────────────

create table if not exists public.user_safety_settings (
  user_id             uuid primary key references public.users(id) on delete cascade,
  who_can_message     text not null default 'everyone'
                        check (who_can_message in ('everyone', 'followers', 'nobody')),
  who_can_comment     text not null default 'everyone'
                        check (who_can_comment in ('everyone', 'followers', 'nobody')),
  who_can_mention     text not null default 'everyone'
                        check (who_can_mention in ('everyone', 'followers', 'nobody')),
  filter_offensive    boolean not null default true,
  hide_sensitive_media boolean not null default false,
  blocked_words       text[] not null default '{}'
                        check (cardinality(blocked_words) <= 100),
  updated_at          timestamptz not null default now()
);

alter table public.user_safety_settings enable row level security;

drop policy if exists user_safety_settings_read on public.user_safety_settings;
create policy user_safety_settings_read
  on public.user_safety_settings for select to authenticated
  using (user_id = auth.uid() or public.can_view_trust_safety());

revoke insert, update, delete on public.user_safety_settings from anon, authenticated;
grant select on public.user_safety_settings to authenticated;

create or replace function public.ensure_safety_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_safety_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists ensure_safety_settings on public.users;
create trigger ensure_safety_settings
  after insert on public.users
  for each row execute function public.ensure_safety_settings();

insert into public.user_safety_settings (user_id)
select id from public.users
on conflict (user_id) do nothing;

create or replace function public.set_safety_settings(
  p_who_can_message text default null,
  p_who_can_comment text default null,
  p_who_can_mention text default null,
  p_filter_offensive boolean default null,
  p_hide_sensitive_media boolean default null,
  p_blocked_words text[] default null
)
returns public.user_safety_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  row public.user_safety_settings;
begin
  if actor is null then
    raise exception 'session requise' using errcode = '42501';
  end if;

  if p_who_can_message is not null and p_who_can_message not in ('everyone', 'followers', 'nobody') then
    raise exception 'visibilité des messages invalide' using errcode = '22023';
  end if;
  if p_who_can_comment is not null and p_who_can_comment not in ('everyone', 'followers', 'nobody') then
    raise exception 'visibilité des commentaires invalide' using errcode = '22023';
  end if;
  if p_who_can_mention is not null and p_who_can_mention not in ('everyone', 'followers', 'nobody') then
    raise exception 'visibilité des mentions invalide' using errcode = '22023';
  end if;
  if p_blocked_words is not null and cardinality(p_blocked_words) > 100 then
    raise exception 'trop de mots filtrés (100 maximum)' using errcode = '22023';
  end if;

  insert into public.user_safety_settings (user_id)
  values (actor)
  on conflict (user_id) do nothing;

  update public.user_safety_settings
     set who_can_message = coalesce(p_who_can_message, who_can_message),
         who_can_comment = coalesce(p_who_can_comment, who_can_comment),
         who_can_mention = coalesce(p_who_can_mention, who_can_mention),
         filter_offensive = coalesce(p_filter_offensive, filter_offensive),
         hide_sensitive_media = coalesce(p_hide_sensitive_media, hide_sensitive_media),
         blocked_words = coalesce(
           (select array_agg(left(word, 60) order by word)
              from unnest(p_blocked_words) as word
             where btrim(word) <> ''),
           blocked_words
         ),
         updated_at = now()
   where user_id = actor
   returning * into row;

  return row;
end;
$$;

revoke all on function public.set_safety_settings(text, text, text, boolean, boolean, text[]) from public, anon;
grant execute on function public.set_safety_settings(text, text, text, boolean, boolean, text[]) to authenticated;

-- ── 7. Le signalement accepte story et message privé ─────────
--  Les quatre colonnes historiques restent ; deux colonnes
--  s'ajoutent et la colonne générée est reconstruite pour les
--  inclure. Aucune donnée n'est réécrite.

alter table public.reports
  add column if not exists story_id uuid references public.stories(id) on delete cascade;
alter table public.reports
  add column if not exists direct_message_id uuid references public.direct_messages(id) on delete cascade;
alter table public.reports
  add column if not exists case_id uuid references public.moderation_cases(id) on delete set null;

alter table public.reports drop constraint if exists reports_one_target;
alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports drop column if exists target_type;

alter table public.reports
  add column target_type text generated always as (
    case
      when post_id           is not null then 'post'
      when comment_id        is not null then 'comment'
      when message_id        is not null then 'group_message'
      when story_id          is not null then 'story'
      when direct_message_id is not null then 'direct_message'
      else 'user'
    end
  ) stored;

alter table public.reports
  add constraint reports_one_target
    check (num_nonnulls(post_id, comment_id, message_id, reported_user, story_id, direct_message_id) = 1);

alter table public.reports
  add constraint reports_reason_check
    check (reason in (
      'harassment', 'spam', 'hate', 'scam', 'other',
      'threat', 'sexual', 'self_harm', 'doxxing', 'impersonation',
      'malware', 'minor_safety', 'intellectual_property'
    ));

create unique index if not exists reports_unique_story
  on public.reports (reporter_id, story_id) where story_id is not null;
create unique index if not exists reports_unique_direct_message
  on public.reports (reporter_id, direct_message_id) where direct_message_id is not null;

create index if not exists reports_case_idx on public.reports (case_id);

create or replace function public.can_see_report(r public.reports)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    r.reporter_id = auth.uid()
    or exists (select 1 from public.posts p
                where p.id = r.post_id and p.author_id = auth.uid())
    or exists (select 1 from public.comments c
                where c.id = r.comment_id and c.author_id = auth.uid())
    or exists (select 1 from public.group_messages m
                where m.id = r.message_id and m.author_id = auth.uid())
    or exists (select 1 from public.stories s
                where s.id = r.story_id and s.author_id = auth.uid())
    or exists (select 1 from public.direct_messages m
                where m.id = r.direct_message_id and m.author_id = auth.uid())
    or r.reported_user = auth.uid()
    or exists (
      select 1
      from public.group_messages m
      join public.groups g on g.id = m.group_id
      where m.id = r.message_id and g.created_by = auth.uid()
    )
    or public.can_view_trust_safety();
$$;

drop policy if exists "reports_insert" on public.reports;
create policy "reports_insert" on public.reports
  for insert with check (
    auth.role() = 'authenticated'
    and reporter_id = auth.uid()
    and not exists (select 1 from public.posts p
                    where p.id = reports.post_id and p.author_id = auth.uid())
    and not exists (select 1 from public.comments c
                    where c.id = reports.comment_id and c.author_id = auth.uid())
    and not exists (select 1 from public.group_messages m
                    where m.id = reports.message_id and m.author_id = auth.uid())
    and not exists (select 1 from public.stories s
                    where s.id = reports.story_id and s.author_id = auth.uid())
    and not exists (select 1 from public.direct_messages m
                    where m.id = reports.direct_message_id and m.author_id = auth.uid())
    and (reported_user is null or reported_user <> auth.uid())
    and (
      reports.direct_message_id is null
      or exists (
        select 1
        from public.direct_messages m
        join public.conversation_members cm on cm.conversation_id = m.conversation_id
        where m.id = reports.direct_message_id and cm.user_id = auth.uid()
      )
    )
  );

create or replace function public.open_case_from_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case uuid;
  v_priority text;
begin
  v_priority := case new.reason
    when 'minor_safety' then 'urgent'
    when 'threat' then 'high'
    when 'sexual' then 'high'
    when 'hate' then 'high'
    when 'doxxing' then 'high'
    when 'malware' then 'high'
    when 'harassment' then 'normal'
    else 'normal'
  end;

  v_case := public.open_moderation_case(
    new.target_type,
    case
      when new.target_type = 'post' then new.post_id::text
      when new.target_type = 'comment' then new.comment_id::text
      when new.target_type = 'group_message' then new.message_id::text
      when new.target_type = 'story' then new.story_id::text
      when new.target_type = 'direct_message' then new.direct_message_id::text
      else new.reported_user::text
    end,
    v_priority,
    'Signalement : ' || new.reason
  );

  update public.reports set case_id = v_case where id = new.id;

  insert into public.moderation_case_events (case_id, actor_id, event, details)
  values (v_case, new.reporter_id, 'report.linked', jsonb_build_object(
    'report_id', new.id, 'reason', new.reason
  ));

  return new;
end;
$$;

drop trigger if exists open_case_from_report on public.reports;
create trigger open_case_from_report
  after insert on public.reports
  for each row execute function public.open_case_from_report();

-- ── 8. Restrictions par capacité ────────────────────────────
--  `restrict` sans capacité ne fait rien : c'est une décision
--  volontairement inoffensive tant que l'écran n'a pas dit quoi
--  restreindre.

alter table public.user_sanctions
  add column if not exists capabilities text[] not null default '{}';

alter table public.user_sanctions
  drop constraint if exists user_sanctions_capabilities_check;
alter table public.user_sanctions
  add constraint user_sanctions_capabilities_check
    check (capabilities <@ array['post', 'comment', 'message', 'story', 'live']::text[]);

create or replace function public.enforce_active_sanction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capability text;
begin
  v_capability := case TG_TABLE_NAME
    when 'posts' then 'post'
    when 'comments' then 'comment'
    when 'stories' then 'story'
    when 'group_messages' then 'message'
    when 'direct_messages' then 'message'
    else null
  end;

  if exists (
    select 1
      from public.user_sanctions s
     where s.user_id = new.author_id
       and s.status = 'active'
       and (
         s.kind in ('suspend', 'ban')
         or (s.kind = 'restrict' and v_capability = any(s.capabilities))
       )
       and (s.ends_at is null or s.ends_at > now())
  ) then
    raise exception 'compte suspendu, banni ou restreint : publication refusée'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_sanction_direct_messages on public.direct_messages;
create trigger enforce_sanction_direct_messages
  before insert on public.direct_messages
  for each row execute function public.enforce_active_sanction();

create or replace function public.is_login_blocked(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_sanctions s
     where s.user_id = p_user
       and s.status = 'active'
       and s.kind in ('suspend', 'ban')
       and (s.ends_at is null or s.ends_at > now())
  );
$$;

revoke all on function public.is_login_blocked(uuid) from public, anon;
grant execute on function public.is_login_blocked(uuid) to authenticated;

-- ── 9. Sanctions : capacités et notification ────────────────
--  La signature gagne un argument ; les appels à six arguments
--  continuent de fonctionner grâce à la valeur par défaut.

drop function if exists public.issue_sanction(uuid, text, text, text, integer, uuid);

create or replace function public.issue_sanction(
  p_user         uuid,
  p_kind         text,
  p_reason_code  text,
  p_note         text default '',
  p_days         integer default null,
  p_source_flag  uuid default null,
  p_capabilities text[] default '{}'
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
  if p_capabilities is not null and not (p_capabilities <@ array['post', 'comment', 'message', 'story', 'live']::text[]) then
    raise exception 'capacité de restriction inconnue' using errcode = '22023';
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
    (user_id, kind, reason_code, note, source_flag, issued_by, ends_at, capabilities)
  values
    (p_user, p_kind, p_reason_code, left(coalesce(p_note, ''), 2000),
     p_source_flag, actor, ends_at, coalesce(p_capabilities, '{}'))
  returning id into new_id;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (
    actor, 'sanction.issue', 'user', p_user::text,
    jsonb_build_object(
      'sanction_id', new_id,
      'kind', p_kind,
      'reason', p_reason_code,
      'capabilities', coalesce(p_capabilities, '{}'),
      'ends_at', ends_at
    )
  );

  insert into public.notifications (recipient_id, actor_id, kind, sanction_id)
  values (p_user, actor, 'moderation', new_id);

  return new_id;
end;
$$;

revoke all on function public.issue_sanction(uuid, text, text, text, integer, uuid, text[]) from public, anon;
grant execute on function public.issue_sanction(uuid, text, text, text, integer, uuid, text[]) to authenticated;

-- ── 10. Notifications de décision ───────────────────────────
--  Le centre de notifications accepte deux nouveaux types. Ils ne
--  portent ni publication ni conversation : ils pointent vers une
--  sanction, et l'écran ouvre la page de protection.

alter table public.notifications
  add column if not exists sanction_id uuid references public.user_sanctions(id) on delete cascade;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
    check (kind in ('like', 'follow', 'mention', 'message', 'moderation', 'appeal'));

alter table public.notifications drop constraint if exists notifications_shape;
alter table public.notifications
  add constraint notifications_shape
    check (
      (kind in ('like', 'mention') and post_id is not null)
      or (kind = 'follow')
      or (kind = 'message' and conversation_id is not null)
      or (kind in ('moderation', 'appeal') and sanction_id is not null)
    );

drop index if exists public.notifications_event_uidx;
create unique index notifications_event_uidx
  on public.notifications (
    recipient_id,
    kind,
    coalesce(actor_id::text, ''),
    coalesce(post_id::text, ''),
    coalesce(comment_id::text, ''),
    coalesce(conversation_id, ''),
    coalesce(sanction_id::text, '')
  );

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
  target_user uuid;
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

  select user_id into target_user
    from public.user_sanctions where id = target_sanction;

  insert into public.notifications (recipient_id, actor_id, kind, sanction_id)
  values (target_user, actor, 'appeal', target_sanction)
  on conflict do nothing;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (actor, 'sanction.appeal.review', 'appeal', p_id::text,
          jsonb_build_object('decision', p_decision, 'sanction_id', target_sanction));
end;
$$;

revoke all on function public.review_appeal(uuid, text, text) from public, anon;
grant execute on function public.review_appeal(uuid, text, text) to authenticated;

-- ── 11. RLS de lecture des dossiers pour les modérateurs ─────
--  `moderation_flags` et `reports` restent lisibles par leurs
--  propriétaires historiques ; les nouvelles tables sont réservées
--  aux rôles T&S. Un analyste lit, ne décide pas.

comment on table public.user_safety_settings is
  'Préférences de protection : qui peut écrire, filtre offensant, médias sensibles, mots filtrés.';
comment on table public.moderation_evidence is
  'Copie d''une preuve avant suppression, lisible par la modération seulement, expirée à 180 jours.';
comment on function public.open_moderation_case(text, text, text, text) is
  'Ouvre ou retrouve le dossier actif d''une cible. Aucun contenu brut n''est stocké.';
