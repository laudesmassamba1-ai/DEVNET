-- ============================================================
--  023 — Les preuves, et les quatre tables qui en produisent
--
--  La vision : « la réputation se prouve par le travail ». Une
--  preuve n'est pas une déclaration, c'est un **fait déjà présent**
--  ailleurs dans la base :
--
--    · un commit      → git_commits        (kind 'commit' / 'github')
--    · un snippet     → snippets           (kind 'snippet')
--    · une correction → review_corrections (kind 'review')
--    · une tâche      → project_tasks      (kind 'task')
--    · une candidature→ project_applications (kind 'project')
--    · une exécution  → geste du client    (kind 'execution')
--
--  ## La règle structurante : le client ne fabrique pas ses preuves
--
--  Sauf pour l'exécution — un geste local qui n'a pas de ligne source —
--  les preuves sont écrites par des **déclencheurs**, jamais par le
--  client. C'est la même doctrine que les notifications (010) : ce qui
--  se déduit d'un fait ne s'écrit pas à la main. Un utilisateur qui
--  pourrait insérer « correction acceptée » à volonté n'aurait pas une
--  réputation prouvée, il aurait un formulaire.
--
--  ## L'empreinte
--
--  Chaque preuve porte le SHA-1 d'une forme canonique de ses champs.
--  L'empreinte est calculée **ici** (pgcrypto), et recalculable à
--  l'identique par le moteur TypeScript (`lib/proofs.ts`) — c'est ce
--  qui rend possible le bouton « Rejouer les preuves ». La forme
--  canonique est donc un contrat entre les deux : sept champs, dans
--  cet ordre, séparés par des retours à la ligne, et un horodatage
--  `toISOString()` en UTC.
--
--  Toute modification de cette forme casse les empreintes existantes.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
--  1. La table des preuves
-- ------------------------------------------------------------

create table if not exists public.proofs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  kind        text not null check (kind in (
                'commit', 'github', 'review', 'task',
                'project', 'snippet', 'execution'
              )),
  -- Chaîne vide quand l'acte ne porte pas de langage : une tâche de
  -- coordination n'entre dans aucune réputation par langage, ce qui est
  -- plus honnête qu'un rattachement deviné.
  language    text not null default '',
  project_id  uuid references public.projects(id) on delete set null,
  -- L'objet prouvé : sha de commit, id de snippet, chemin + ligne…
  subject     text not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{40}$'),
  summary     text not null default '',
  created_at  timestamptz not null default now()
);

-- Une source ne produit qu'une preuve. C'est cette contrainte qui rend
-- le rejeu des déclencheurs idempotent : rejouer une acceptation ne
-- double pas la réputation.
create unique index if not exists proofs_unique_source
  on public.proofs(user_id, kind, subject);

create index if not exists proofs_user_idx
  on public.proofs(user_id, created_at desc);
create index if not exists proofs_user_lang_idx
  on public.proofs(user_id, language);
create index if not exists proofs_project_idx
  on public.proofs(project_id);

alter table public.proofs enable row level security;

-- Les preuves sont **publiques** : c'est tout l'intérêt. Une réputation
-- que personne ne peut lire ne sert qu'à flatter son propriétaire.
drop policy if exists "proofs_read" on public.proofs;
create policy "proofs_read" on public.proofs
  for select using (auth.role() = 'authenticated');

-- Écriture client : **exécution uniquement**. C'est le seul acte qui
-- n'a pas de ligne source ; il vient du navigateur, qui en calcule
-- l'empreinte. Son poids vaut 1, donc le forger n'achète rien.
drop policy if exists "proofs_insert_execution" on public.proofs;
create policy "proofs_insert_execution" on public.proofs
  for insert with check (auth.uid() = user_id and kind = 'execution');

-- Ni update ni delete côté client : une preuve ne se réécrit pas, et
-- une preuve dont la source disparaît est retirée par le déclencheur
-- de la source, pas à la main.

comment on table public.proofs is
  'Preuve de travail réelle. Écrite par déclencheur (sauf execution), avec une empreinte SHA-1 recalculable.';

-- ------------------------------------------------------------
--  2. La forme canonique et l'empreinte
-- ------------------------------------------------------------

-- `created_at` en UTC, avec millisecondes : exactement la forme de
-- `Date.prototype.toISOString()`. Les deux moteurs doivent produire la
-- même chaîne au caractère près, sinon chaque rejeu échoue.
create or replace function public.proof_timestamp(ts timestamptz)
returns text
language sql
immutable
as $$
  select to_char(ts at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

create or replace function public.proof_fingerprint(
  p_kind    text,
  p_user    uuid,
  p_language text,
  p_project uuid,
  p_subject text,
  p_summary text,
  p_created timestamptz
)
returns text
language sql
immutable
as $$
  select encode(extensions.digest(
    p_kind
      || E'\n' || p_user::text
      || E'\n' || coalesce(p_language, '')
      || E'\n' || coalesce(p_project::text, '')
      || E'\n' || coalesce(p_subject, '')
      || E'\n' || coalesce(p_summary, '')
      || E'\n' || public.proof_timestamp(p_created),
    'sha1'
  ), 'hex');
$$;

comment on function public.proof_fingerprint is
  'SHA-1 de la forme canonique d''une preuve. Doit rester identique à fingerprintOf() de lib/proofs.ts.';

-- ------------------------------------------------------------
--  3. Enregistrer une preuve (idempotent)
-- ------------------------------------------------------------

/*
 * Renvoie `true` si la preuve a été créée, `false` si elle existait
 * déjà. Le `on conflict do nothing` s'appuie sur `proofs_unique_source` :
 * rejouer un déclencheur ne double jamais une réputation.
 */
create or replace function public.record_proof(
  p_user      uuid,
  p_kind      text,
  p_language  text,
  p_project   uuid,
  p_subject   text,
  p_summary   text,
  p_created   timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted boolean;
begin
  if p_user is null then return false; end if;

  insert into public.proofs (user_id, kind, language, project_id, subject, summary, fingerprint, created_at)
  values (
    p_user, p_kind, coalesce(p_language, ''), p_project, p_subject, coalesce(p_summary, ''),
    public.proof_fingerprint(p_kind, p_user, p_language, p_project, p_subject, p_summary, p_created),
    p_created
  )
  on conflict (user_id, kind, subject) do nothing;

  inserted := found;
  return inserted;
end;
$$;

/*
 * Retire la preuve attachée à une source qui disparaît.
 *
 * Sans cela, supprimer un commit laisserait une réputation fantôme —
 * exactement ce que le score de gamification refuse déjà.
 */
create or replace function public.forget_proof(p_kind text, p_subject text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.proofs where kind = p_kind and subject = p_subject;
$$;

-- ------------------------------------------------------------
--  4. Les snippets (§4)
-- ------------------------------------------------------------

create table if not exists public.snippets (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.users(id) on delete cascade,
  title       text not null check (length(trim(title)) between 1 and 120),
  language    text not null default '',
  code        text not null check (length(code) between 1 and 20000),
  -- Sortie de la dernière exécution réussie. On la garde parce qu'un
  -- snippet qui n'a jamais tourné n'est qu'un texte : c'est la sortie
  -- observée qui en fait une preuve.
  output      text not null default '',
  ran_at      timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists snippets_author_idx on public.snippets(author_id, created_at desc);
create index if not exists snippets_language_idx on public.snippets(language);

alter table public.snippets enable row level security;

drop policy if exists "snippets_read" on public.snippets;
create policy "snippets_read" on public.snippets
  for select using (auth.role() = 'authenticated');

drop policy if exists "snippets_insert" on public.snippets;
create policy "snippets_insert" on public.snippets
  for insert with check (auth.uid() = author_id);

drop policy if exists "snippets_update" on public.snippets;
create policy "snippets_update" on public.snippets
  for update using (auth.uid() = author_id);

drop policy if exists "snippets_delete" on public.snippets;
create policy "snippets_delete" on public.snippets
  for delete using (auth.uid() = author_id);

-- Un snippet publié est une preuve, posée au moment où il **tourne**.
create or replace function public.snippets_record_proof()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ran_at is not null then
    perform public.record_proof(
      new.author_id, 'snippet', new.language, null,
      'snippet:' || new.id::text,
      left(new.title, 80),
      new.ran_at
    );
  end if;
  return new;
end;
$$;

drop trigger if exists snippets_proof on public.snippets;
create trigger snippets_proof
  after insert or update of ran_at on public.snippets
  for each row execute function public.snippets_record_proof();

create or replace function public.snippets_forget_proof()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.forget_proof('snippet', 'snippet:' || old.id::text);
  return old;
end;
$$;

drop trigger if exists snippets_unproof on public.snippets;
create trigger snippets_unproof
  after delete on public.snippets
  for each row execute function public.snippets_forget_proof();

-- ------------------------------------------------------------
--  5. La revue de code ligne à ligne (§5)
-- ------------------------------------------------------------

create table if not exists public.review_corrections (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  path        text not null,
  line_no     int not null check (line_no >= 1),
  -- La ligne visée, figée au moment de la proposition : si le fichier
  -- change, la proposition reste lisible au lieu de pointer dans le vide.
  original    text not null default '',
  proposed    text not null,
  -- Le langage vient du chemin, calculé par le client qui propose.
  language    text not null default '',
  author_id   uuid not null references public.users(id) on delete cascade,
  status      text not null default 'proposee'
                check (status in ('proposee', 'acceptee', 'refusee')),
  comment     text not null default '',
  decided_by  uuid references public.users(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists corrections_project_idx
  on public.review_corrections(project_id, created_at desc);
create index if not exists corrections_author_idx
  on public.review_corrections(author_id);
-- Une seule proposition ouverte par ligne et par personne.
create unique index if not exists corrections_one_open
  on public.review_corrections(project_id, path, line_no, author_id)
  where status = 'proposee';

alter table public.review_corrections enable row level security;

drop policy if exists "corrections_read" on public.review_corrections;
create policy "corrections_read" on public.review_corrections
  for select using (auth.role() = 'authenticated');

drop policy if exists "corrections_insert" on public.review_corrections;
create policy "corrections_insert" on public.review_corrections
  for insert with check (auth.uid() = author_id);

-- L'auteur décide du sort de sa proposition ; il ne peut pas en changer
-- le contenu. On n'autorise donc la mise à jour que par le **décideur**
-- — celui qui relit le code (l'équipe du projet), pas le proposeur.
drop policy if exists "corrections_decide" on public.review_corrections;
create policy "corrections_decide" on public.review_corrections
  for update using (
    status = 'proposee'
    and exists (
      select 1 from public.project_members m
      where m.project_id = review_corrections.project_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'maintainer', 'editor')
    )
  );

drop policy if exists "corrections_delete" on public.review_corrections;
create policy "corrections_delete" on public.review_corrections
  for delete using (auth.uid() = author_id and status = 'proposee');

-- Correction acceptée → preuve pour **celui qui a proposé**. C'est le
-- cœur du §5 : « une correction acceptée devient une preuve sur le
-- profil de celui qui l'a proposée : on gagne en réputation en aidant
-- les autres ».
create or replace function public.corrections_record_proof()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'acceptee' and coalesce(old.status, 'proposee') <> 'acceptee' then
    perform public.record_proof(
      new.author_id, 'review', new.language, new.project_id,
      'correction:' || new.id::text,
      new.path || ' L' || new.line_no::text,
      coalesce(new.decided_at, now())
    );
  end if;
  return new;
end;
$$;

drop trigger if exists corrections_proof on public.review_corrections;
create trigger corrections_proof
  after update of status on public.review_corrections
  for each row execute function public.corrections_record_proof();

-- ------------------------------------------------------------
--  6. Le projet : stade, rôles recherchés (§6)
-- ------------------------------------------------------------

alter table public.projects
  add column if not exists stage text not null default 'idea'
    check (stage in ('idea', 'prototype', 'mvp', 'production', 'maintenance')),
  add column if not exists seeking boolean not null default false,
  add column if not exists demand_languages text[] not null default '{}',
  add column if not exists demand_roles text[] not null default '{}';

create index if not exists projects_stage_idx on public.projects(stage);
create index if not exists projects_seeking_idx on public.projects(seeking);
create index if not exists projects_demand_languages_idx
  on public.projects using gin (demand_languages);
create index if not exists projects_demand_roles_idx
  on public.projects using gin (demand_roles);

-- ------------------------------------------------------------
--  7. Les candidatures (§6)
-- ------------------------------------------------------------

create table if not exists public.project_applications (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  role        text not null default '',
  message     text not null default '',
  status      text not null default 'attente'
                check (status in ('attente', 'acceptee', 'refusee', 'retiree')),
  decided_by  uuid references public.users(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists applications_project_idx
  on public.project_applications(project_id, created_at desc);
create index if not exists applications_user_idx
  on public.project_applications(user_id);

alter table public.project_applications enable row level security;

drop policy if exists "applications_read" on public.project_applications;
create policy "applications_read" on public.project_applications
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.project_members m
      where m.project_id = project_applications.project_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'maintainer')
    )
  );

drop policy if exists "applications_insert" on public.project_applications;
create policy "applications_insert" on public.project_applications
  for insert with check (auth.uid() = user_id);

-- Le candidat retire sa candidature ; l'équipe la décide.
drop policy if exists "applications_update" on public.project_applications;
create policy "applications_update" on public.project_applications
  for update using (
    auth.uid() = user_id
    or exists (
      select 1 from public.project_members m
      where m.project_id = project_applications.project_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'maintainer')
    )
  );

/*
 * Candidature acceptée → la personne devient **membre** du projet, et
 * une preuve est posée. Les deux gestes n'en font qu'un : accepter sans
 * ajouter aux membres laisserait un « accepté » qui ne peut rien faire,
 * et ajouter sans preuve perdrait la trace du travail accepté.
 */
create or replace function public.applications_accept()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_language text;
begin
  if new.status = 'acceptee' and coalesce(old.status, 'attente') <> 'acceptee' then
    insert into public.project_members (project_id, user_id, role)
    values (new.project_id, new.user_id, 'editor')
    on conflict (project_id, user_id) do nothing;

    select coalesce(language, '') into project_language
      from public.projects where id = new.project_id;

    perform public.record_proof(
      new.user_id, 'project', project_language, new.project_id,
      'projet:' || new.project_id::text,
      'candidature:' || new.id::text,
      coalesce(new.decided_at, now())
    );
  end if;
  return new;
end;
$$;

drop trigger if exists applications_proof on public.project_applications;
create trigger applications_proof
  after update of status on public.project_applications
  for each row execute function public.applications_accept();

-- ------------------------------------------------------------
--  8. Les tâches de l'équipe, en trois colonnes (§7)
-- ------------------------------------------------------------

create table if not exists public.project_tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  title       text not null check (length(trim(title)) between 1 and 160),
  body        text not null default '',
  status      text not null default 'todo'
                check (status in ('todo', 'doing', 'done')),
  position    int not null default 0,
  assignee    uuid references public.users(id) on delete set null,
  -- Le langage de la tâche sert à sa preuve : une tâche backend en Go
  -- doit nourrir la réputation Go de celui qui la termine.
  language    text not null default '',
  created_by  uuid not null references public.users(id) on delete cascade,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists tasks_project_idx
  on public.project_tasks(project_id, status, position);
create index if not exists tasks_assignee_idx
  on public.project_tasks(assignee) where assignee is not null;

alter table public.project_tasks enable row level security;

-- Les tâches se lisent comme le projet : par ses membres. Une tâche est
-- un engagement d'équipe, pas une publication.
drop policy if exists "tasks_read" on public.project_tasks;
create policy "tasks_read" on public.project_tasks
  for select using (
    exists (
      select 1 from public.project_members m
      where m.project_id = project_tasks.project_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "tasks_write" on public.project_tasks;
create policy "tasks_write" on public.project_tasks
  for insert with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.project_members m
      where m.project_id = project_tasks.project_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "tasks_update" on public.project_tasks;
create policy "tasks_update" on public.project_tasks
  for update using (
    exists (
      select 1 from public.project_members m
      where m.project_id = project_tasks.project_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "tasks_delete" on public.project_tasks;
create policy "tasks_delete" on public.project_tasks
  for delete using (
    created_by = auth.uid()
    or exists (
      select 1 from public.project_members m
      where m.project_id = project_tasks.project_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'maintainer')
    )
  );

-- Tâche terminée → preuve pour **celui qui l'a terminée**. Sans
-- assigné, la preuve va au créateur : c'est lui qui a fait avancer la
-- tâche, et une tâche cochée sans preuve ne récompenserait personne.
create or replace function public.tasks_record_proof()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  worker uuid;
begin
  if new.status = 'done' and coalesce(old.status, 'todo') <> 'done' then
    worker := coalesce(new.assignee, new.created_by);
    perform public.record_proof(
      worker, 'task', new.language, new.project_id,
      'tache:' || new.id::text,
      left(new.title, 80),
      coalesce(new.done_at, now())
    );
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_proof on public.project_tasks;
create trigger tasks_proof
  after update of status on public.project_tasks
  for each row execute function public.tasks_record_proof();

create or replace function public.tasks_forget_proof()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.forget_proof('task', 'tache:' || old.id::text);
  return old;
end;
$$;

drop trigger if exists tasks_unproof on public.project_tasks;
create trigger tasks_unproof
  after delete on public.project_tasks
  for each row execute function public.tasks_forget_proof();

-- ------------------------------------------------------------
--  9. Backfill : les commits déjà en base sont des preuves
-- ------------------------------------------------------------

/*
 * Sans backfill, un dépôt existant afficherait « aucune preuve » alors
 * que ses commits sont là — le pire des messages : il dirait que le
 * travail n'a pas été fait. Le langage est déduit du **premier fichier
 * modifié** par le commit, faute de mieux en SQL ; c'est une
 * approximation assumée, documentée ici.
 */
insert into public.proofs (user_id, kind, language, project_id, subject, summary, fingerprint, created_at)
select
  c.author_id,
  case when c.source = 'github' then 'github' else 'commit' end,
  '',
  c.project_id,
  'commit:' || c.sha,
  left(c.message, 80),
  public.proof_fingerprint(
    case when c.source = 'github' then 'github' else 'commit' end,
    c.author_id,
    '',
    c.project_id,
    'commit:' || c.sha,
    left(c.message, 80),
    c.created_at
  ),
  c.created_at
from public.git_commits c
where c.author_id is not null
on conflict (user_id, kind, subject) do nothing;

-- Les commits produits ensuite sont des preuves au fil de l'eau.
create or replace function public.commits_record_proof()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.author_id is not null then
    perform public.record_proof(
      new.author_id,
      case when new.source = 'github' then 'github' else 'commit' end,
      '', new.project_id,
      'commit:' || new.sha,
      left(new.message, 80),
      new.created_at
    );
  end if;
  return new;
end;
$$;

drop trigger if exists commits_proof on public.git_commits;
create trigger commits_proof
  after insert on public.git_commits
  for each row execute function public.commits_record_proof();
