-- ============================================================
--  025 — Le fork : greffer le dépôt d'un autre
--
--  La vision : le fork est un **hommage vérifiable**. Forker, c'est
--  déclarer « le travail de ce développeur est mon point de départ » ;
--  la table `project_forks` garde ce fil, génération après génération.
--
--  ## Pourquoi une table dédiée
--
--  La colonne `forked_from` sur `projects` suffirait au premier regard,
--  mais elle ne garde pas la *branche source* ni le *commit exact* du
--  clonage — informations qu'il faut pour une pull request « du fork
--  vers la source » plus tard. Une table par relation est aussi ce que
--  fait GitHub (fork réseau), et elle permet les requêtes du genre :
--  « quels projets descendent de celui-ci ? »
--
--  ## Le fil d'héritage
--
--  `root_project_id` est le sommet de l'arbre : le fork d'un fork
--  remonte droit à la racine, pas au parent intermédiaire. Ça évite la
--  requête récursive dans les écrans (« arbre des descendants ») et le
--  cycle improbable mais possible — un fork A→B→A est impossible par
--  construction : forker son propre arbre n'a aucun sens.
-- ============================================================

create table if not exists public.project_forks (
  id              uuid primary key default gen_random_uuid(),
  -- Le nouveau projet, créé par le fork.
  fork_id         uuid not null unique references public.projects(id) on delete cascade,
  -- Le parent direct.
  source_id       uuid not null references public.projects(id) on delete cascade,
  -- La racine de l'arbre : le parent si le parent n'est pas lui-même
  -- un fork, sinon la racine du parent.
  root_project_id uuid not null references public.projects(id) on delete cascade,
  -- L'instantané cloné : branche et commit de la source au moment du fork.
  source_branch   text not null default 'main',
  source_sha      text not null default '',
  -- Qui fork, quand.
  forked_by       uuid not null references public.users(id) on delete cascade,
  forked_at       timestamptz not null default now()
);

create index if not exists forks_source_idx   on public.project_forks (source_id);
create index if not exists forks_root_idx     on public.project_forks (root_project_id);
create index if not exists forks_forked_by_idx on public.project_forks (forked_by, forked_at desc);

alter table public.project_forks enable row level security;

-- Les forks sont publics : c'est leur but d'être vus.
drop policy if exists "forks_read" on public.project_forks;
create policy "forks_read" on public.project_forks
  for select using (true);

-- Chacun déclare son propre fork.
drop policy if exists "forks_insert" on public.project_forks;
create policy "forks_insert" on public.project_forks
  for insert with check (auth.uid() = forked_by);

-- ------------------------------------------------------------ 
--  La preuve de fork
--
--  Un fork réussi produit une preuve `fork` pour l'auteur — la table
--  `proofs` (023) l'accepte via une extension de la liste des kinds.
-- ------------------------------------------------------------

alter table public.proofs drop constraint if exists proofs_kind_check;
alter table public.proofs add constraint proofs_kind_check
  check (kind in (
    'commit', 'github', 'review', 'task',
    'project', 'snippet', 'execution', 'fork'
  ));

-- ------------------------------------------------------------ 
--  La colonne de synthèse sur `projects`
--
--  Les écrans de liste affichent « forké de X » sans jointure : on
--  dénormalise le parent direct dans une colonne lisible, tenue à jour
--  à l'insertion du fork. (source de vérité : `project_forks`).
-- ------------------------------------------------------------

alter table public.projects
  add column if not exists forked_from uuid references public.projects(id) on delete set null;
