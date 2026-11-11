-- 043 — La boîte d'envoi des événements du cœur.
--
-- Un événement n'est **pas** publié par un appel réseau après coup : il est
-- écrit dans la même transaction que le fait qui le produit, par un
-- déclencheur. Si la publication échoue, le fait n'existe pas ; si le fait
-- existe, l'événement existe. C'est la seule façon d'éviter les deux mensonges
-- classiques du bus en mémoire : l'événement d'un fait annulé, et le fait
-- silencieux dont l'événement s'est perdu.
--
-- `event_deliveries` matérialise le couple (événement, plugin). La clé primaire
-- rend la livraison idempotente au niveau du stockage ; un gestionnaire peut
-- être rappelé après une panne, il doit donc l'être aussi côté plugin.
--
-- Aucune donnée privée ici : les déclencheurs ne copient que des identifiants
-- et le strict minimum (nature de la preuve, présence de code). Jamais le
-- texte d'une publication, un e-mail ou un pseudo.
--
-- Accès : la RLS est activée sans aucune politique, et les privilèges sont
-- retirés à `anon` et `authenticated`. Seul le rôle serveur qui exécute le
-- drainage (connexion PostgreSQL directe) lit et écrit ces tables.

create table if not exists public.event_outbox (
  id             uuid primary key default gen_random_uuid(),
  type           text not null
                   check (type ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$'),
  version        integer not null default 1 check (version > 0),
  actor          uuid references public.users(id) on delete set null,
  subject        jsonb not null default '{}'::jsonb,
  data           jsonb not null default '{}'::jsonb,
  correlation_id text,
  occurred_at    timestamptz not null default now(),
  available_at   timestamptz not null default now(),
  attempts       integer not null default 0 check (attempts >= 0),
  status         text not null default 'pending'
                   check (status in ('pending', 'processing', 'dispatched', 'failed')),
  locked_at      timestamptz,
  last_error     text,
  created_at     timestamptz not null default now()
);

comment on table public.event_outbox is
  'Événements du cœur écrits dans la transaction du fait qui les produit.';

create index if not exists event_outbox_due_idx
  on public.event_outbox (status, available_at, occurred_at)
  where status in ('pending', 'processing');

create index if not exists event_outbox_type_idx
  on public.event_outbox (type, version);

create table if not exists public.event_deliveries (
  event_id    uuid not null references public.event_outbox(id) on delete cascade,
  plugin_id   text not null
                check (plugin_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  status      text not null default 'pending'
                check (status in ('pending', 'delivered', 'failed')),
  attempts    integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  last_error  text,
  delivered_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (event_id, plugin_id)
);

comment on table public.event_deliveries is
  'Livraisons par plugin ; la clé (event_id, plugin_id) garantit l''idempotence du stockage.';

create index if not exists event_deliveries_due_idx
  on public.event_deliveries (status, available_at)
  where status = 'pending';

create index if not exists event_deliveries_plugin_idx
  on public.event_deliveries (plugin_id, status);

alter table public.event_outbox enable row level security;
alter table public.event_deliveries enable row level security;

revoke all on public.event_outbox from anon, authenticated;
revoke all on public.event_deliveries from anon, authenticated;

-- ------------------------------------------------------------
--  1. Les déclencheurs d'écriture
--
--  `security definer` est indispensable : la transaction est ouverte par un
--  utilisateur `authenticated`, qui n'a aucun privilège sur l'outbox. Le
--  déclencheur écrit avec les droits de son propriétaire (le rôle de
--  migration) et `search_path` est figé pour qu'un objet temporaire ne puisse
--  pas détourner l'insertion. L'exécution directe est révoquée : ces fonctions
--  ne sont pas une API.
-- ------------------------------------------------------------

create or replace function public.event_on_post_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.event_outbox (type, version, actor, subject, data)
  values (
    'post.created',
    1,
    new.author_id,
    jsonb_strip_nulls(jsonb_build_object(
      'postId', new.id::text,
      'authorId', new.author_id::text
    )),
    jsonb_strip_nulls(jsonb_build_object(
      'postId', new.id::text,
      'authorId', new.author_id::text,
      'hasCode', coalesce(new.has_code, false)
    ))
  );
  return new;
end;
$$;

create or replace function public.event_on_proof_verified()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.event_outbox (type, version, actor, subject, data)
  values (
    'proof.verified',
    1,
    new.user_id,
    jsonb_build_object(
      'proofId', new.id::text,
      'userId', new.user_id::text
    ),
    jsonb_strip_nulls(jsonb_build_object(
      'proofId', new.id::text,
      'userId', new.user_id::text,
      'kind', new.kind,
      'projectId', new.project_id::text
    ))
  );
  return new;
end;
$$;

create or replace function public.event_on_user_registered()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.event_outbox (type, version, actor, subject, data)
  values (
    'user.registered',
    1,
    new.id,
    jsonb_build_object('userId', new.id::text),
    jsonb_build_object('userId', new.id::text)
  );
  return new;
end;
$$;

revoke all on function public.event_on_post_created() from public, anon, authenticated;
revoke all on function public.event_on_proof_verified() from public, anon, authenticated;
revoke all on function public.event_on_user_registered() from public, anon, authenticated;

drop trigger if exists event_post_created on public.posts;
create trigger event_post_created
  after insert on public.posts
  for each row execute function public.event_on_post_created();

drop trigger if exists event_proof_verified on public.proofs;
create trigger event_proof_verified
  after insert on public.proofs
  for each row execute function public.event_on_proof_verified();

drop trigger if exists event_user_registered on public.users;
create trigger event_user_registered
  after insert on public.users
  for each row execute function public.event_on_user_registered();
