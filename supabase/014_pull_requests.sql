-- ============================================================
--  DEVNET — migration v14 : les pull requests
--  Supabase → SQL Editor → Run
--  (après 013_issues.sql)
--
--  Une issue dit ce qui manque. Une pull request montre ce qui a été
--  fait. C'est la moitié qui manquait : un dépôt où l'on ne peut pas
--  proposer un travail à relire n'est pas un espace partagé, c'est un
--  espace privé à plusieurs.
--
--  ## Ce que cette table ne contient pas
--
--  Pas de diff. Le nombre de fichiers, le nombre de lignes ajoutées et
--  retirées ne sont **pas** des colonnes : ce sont des grandeurs
--  calculées, à partir de l'état des deux branches au moment où on les
--  demande. Les écrire ici les figerait — et une pull request dont le
--  résumé annonce « 3 fichiers » alors que la branche en affiche 5 est
--  pire qu'une pull request sans résumé, parce qu'elle affirme quelque
--  chose de faux avec assurance.
--
--  Même raison que `issues.number` : ce que le client écrit, la RLS ne
--  peut pas le protéger. Ce que la **base** dérive, elle peut.
--
--  ## Pourquoi les branches sont des noms, et non des sha
--
--  `source_branch` et `target_branch` sont des textes, pas des sha.
--  C'est un choix délibéré, et c'est le plus discutable de cette
--  migration :
--
--  - un sha figerait l'état au moment de l'ouverture, donc la pull
--    request décrirait un travail que la branche ne contient plus ;
--  - un nom suit ce que fait l'utilisateur : c'est la branche qu'il a
--    choisie dans le sélecteur, et il la reconnaît.
--
--  Le prix est qu'une branche supprimée laisse une pull request orpheline
--  — d'où le déclencheur `guard_pull_request_branches` plus bas, qui la
--  ferme au lieu de la laisserpointer un nom qui n'existe plus.
--
--  ## Une seule demande ouverte par couple de branches
--
--  L'index unique partiel l'impose. Deux demandes ouvertes de la même
--  branche vers la même destination n'ont pas de sens : la seconde est
--  soit un doublon, soit la reprise d'une première dont on a perdu la
--  trace. Refuser est plus honnête que d'afficher deux fois le même
--  travail, et l'écran peut alors dire « cette branche a déjà une
--  demande ouverte » au lieu d'en créer une seconde.
-- ============================================================


-- ------------------------------------------------------------
-- 1. La table
-- ------------------------------------------------------------

create table if not exists public.pull_requests (
  id             uuid primary key default gen_random_uuid(),

  project_id     uuid not null references public.projects(id) on delete cascade,
  author_id      uuid not null references public.users(id)    on delete cascade,

  -- Renseigné par le déclencheur `assign_pull_request_number`.
  -- Volontairement `null` à l'insertion, comme `issues.number` : une
  -- contrainte `not null` obligerait le client à écrire la valeur qu'on
  -- veut justement voir calculée.
  number         int,

  source_branch  text not null check (length(btrim(source_branch)) between 1 and 255),
  target_branch  text not null check (length(btrim(target_branch)) between 1 and 255),

  title          text not null check (char_length(btrim(title)) between 3 and 140),
  body           text not null default '' check (char_length(body) <= 8000),

  -- Vocabulaire fermé, comme `issues.status` : un compteur de demandes
  -- ouvertes n'est calculable que si les états sont connus d'avance.
  status         text not null default 'ouverte'
                   check (status in ('ouverte','fusionnee','fermee')),

  -- Dérivées du statut par le déclencheur `sync_pull_request_merge`.
  -- Une demande fusionnée porte sa date et son auteur ; une demande
  -- fermée n'en porte pas, et c'est cette différence qui distingue «
  -- refusée » de « intégrée ».
  merged_at      timestamptz,
  merged_by      uuid references public.users(id) on delete set null,
  closed_at      timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Une branche ne se fusionne pas dans elle-même. La contrainte est
  -- SQL et non applicative parce que c'est une tautologie : elle ne peut
  -- pas être fausse, donc elle ne peut pas être oubliée.
  constraint pull_requests_distinct_branches
    check (source_branch <> target_branch),

  -- Même principe que `issues_closure_dated` : l'écran ne doit pas
  -- deviner si une date vide a été oubliée ou n'a pas lieu d'être.
  constraint pull_requests_merge_dated
    check (status <> 'fusionnee' or merged_at is not null)
);

-- Le numéro est unique **par projet** : c'est « #3 du dépôt ».
create unique index if not exists pull_requests_project_number_idx
  on public.pull_requests (project_id, number)
  where number is not null;

-- L'ordre de la liste : ouvertes d'abord, puis les plus récentes. Un
-- index qui ne correspond pas à cet ordre fait trier toute la table à
-- chaque ouverture de l'onglet.
create index if not exists pull_requests_open_first_idx
  on public.pull_requests (project_id, status, created_at desc);

-- Une seule demande ouverte par couple de branches. `where status` est ce
-- qui rend l'index *partiel* : les demandes closes et fusionnées peuvent
-- s'accumuler sur les mêmes noms de branche sans jamais se marcher
-- dessus.
create unique index if not exists pull_requests_one_open_per_branch_idx
  on public.pull_requests (project_id, source_branch, target_branch)
  where status = 'ouverte';


-- ------------------------------------------------------------
-- 2. La numérotation
-- ------------------------------------------------------------

-- Reprise exacte de `assign_issue_number` (migration 013), triggers
-- compris : une valeur déjà présente est conservée, pour qu'une
-- réapplication de la migration ne fasse pas perdre les numéros acquis.
create or replace function public.assign_pull_request_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.number is null then
    select coalesce(max(p.number), 0) + 1
      into new.number
      from public.pull_requests p
     where p.project_id = new.project_id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_pull_request_number on public.pull_requests;
create trigger on_pull_request_number
  before insert on public.pull_requests
  for each row execute function public.assign_pull_request_number();


-- ------------------------------------------------------------
-- 3. La fusion, et sa date
-- ------------------------------------------------------------

-- Reprise de `sync_issue_closure` : la date est écrite par la base, et
-- la réouverture **redate**. Un travail dé-mergé puis re-mergé est un
-- nouveau travail, pas la même fusion rejouée deux fois.
--
-- `merged_by` vient de `auth.uid()` : c'est la personne qui a cliqué,
-- et non celle que l'écran croit avoir vue. Le client n'envoie que
-- `status`.
create or replace function public.sync_pull_request_merge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ouverte' then
    new.merged_at := null;
    new.merged_by := null;
    new.closed_at := null;
  elsif new.status = 'fusionnee' and new.merged_at is null then
    new.merged_at := now();
    new.merged_by := auth.uid();
    new.closed_at := null;
  elsif new.status = 'fermee' then
    new.merged_at := null;
    new.merged_by := null;
    if new.closed_at is null then
      new.closed_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_pull_request_merge on public.pull_requests;
create trigger on_pull_request_merge
  before update of status on public.pull_requests
  for each row execute function public.sync_pull_request_merge();


-- ------------------------------------------------------------
-- 4. Une branche disparaît
--
-- `git_refs` est supprimé quand une branche l'est, et une pull request
-- ouverte pointe un nom de branche. Sans ce déclencheur, la demande
-- reste ouverte et propose une fusion vers un nom qui n'existe plus :
-- l'écran afficherait un bouton qui échoue.
--
-- On **ferme** la demande au lieu de la supprimer : elle raconte un
-- travail réel, et « fermé » avec sa date dit pourquoi.
-- ------------------------------------------------------------

create or replace function public.guard_pull_request_branches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and old.kind = 'branch' then
    update public.pull_requests p
       set status = 'fermee', updated_at = now()
     where p.project_id = old.project_id
       and p.source_branch = old.name
       and p.status = 'ouverte';
  end if;

  return null;
end;
$$;

drop trigger if exists on_branch_deleted_pull_requests on public.git_refs;
create trigger on_branch_deleted_pull_requests
  after delete on public.git_refs
  for each row execute function public.guard_pull_request_branches();


-- ------------------------------------------------------------
-- 5. RLS
-- ------------------------------------------------------------

alter table public.pull_requests enable row level security;

-- Lire : même population que le code et les issues. Une pull request
-- n'est pas plus confidentielle que l'historique qu'elle montre.
--
-- Écrire : `can_write_project`, comme partout. Ouvrir une demande exige
-- donc le droit d'écrire dans le dépôt — on ne demande pas la relecture
-- d'un travail dans un dépôt qu'on regarde seulement.
--
-- Le détail qui compte : on ne redirige pas une demande existante vers
-- une autre branche. La fusion proposée changerait de sens, et
-- l'historique de la demande dirait alors deux choses différentes.
-- Refermer et rouvrir est le geste correct.
--
-- Cette interdiction n'est **pas** écrite dans la politique, parce
-- qu'une politique `with check` ne voit que la ligne **nouvelle** : elle
-- ne peut pas comparer avec l'ancienne, et une clause qui pretend le
-- faire serait une clause qui ne protège rien. Elle est donc dans un
-- déclencheur, `guard_pull_request_identity`, qui a les deux versions.
-- ------------------------------------------------------------

drop policy if exists "pull_requests_read" on public.pull_requests;
create policy "pull_requests_read" on public.pull_requests
  for select using (public.can_read_project(project_id));

drop policy if exists "pull_requests_insert" on public.pull_requests;
create policy "pull_requests_insert" on public.pull_requests
  for insert with check (
    public.can_write_project(project_id)
    and author_id = auth.uid()
  );

drop policy if exists "pull_requests_update" on public.pull_requests;
create policy "pull_requests_update" on public.pull_requests
  for update
  using (public.can_write_project(project_id))
  with check (public.can_write_project(project_id));

drop policy if exists "pull_requests_delete" on public.pull_requests;
create policy "pull_requests_delete" on public.pull_requests
  for delete using (
    author_id = auth.uid()
    or public.can_write_project(project_id)
  );


-- ------------------------------------------------------------
-- 6. Ce qu'une demande ne peut pas devenir
-- ------------------------------------------------------------

create or replace function public.guard_pull_request_identity()
returns trigger
language plpgsql
as $$
begin
  if new.source_branch is distinct from old.source_branch
     or new.target_branch is distinct from old.target_branch
     or new.author_id   is distinct from old.author_id
     or new.project_id  is distinct from old.project_id then
    raise exception
      'pull request #% : une demande existante ne peut pas changer de branches, ni d''auteur, ni de projet',
      coalesce(old.number, 0)
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists on_pull_request_identity on public.pull_requests;
create trigger on_pull_request_identity
  before update on public.pull_requests
  for each row execute function public.guard_pull_request_identity();


comment on table public.pull_requests is
  'Demande d''intégration d''une branche dans une autre. Aucun diff n''y est stocké : il se calcule à la lecture, à partir de l''état des deux branches au moment où on le demande.';

comment on column public.pull_requests.number is
  'Calculé par le déclencheur `assign_pull_request_number`, jamais écrit par le client.';

comment on column public.pull_requests.merged_at is
  'Dérivé du statut par `sync_pull_request_merge`. Une demande fusionnée porte une date, une demande fermée n''en porte pas.';


-- ------------------------------------------------------------
--  REALTIME
--
--  Pas de realtime, comme pour les issues. Une demande qui se met à
--  jour toute seule pendant qu'on la relit est une demande qu'on ne
--  relit plus : la page se relit à chaque ouverture.
--
--  La seule exception admise est celle de l'écran suivant : une demande
--  de revue qui arrive **dans** le dépôt est un événement qui concerne
--  celui qui regarde, et il doit se voir. Cela passe par
--  `notifications`, qui est déjà branchée (migration 010) — pas par une
--  seconde source de vérité.
--
