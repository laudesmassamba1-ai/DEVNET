-- ============================================================
--  DEVNET — migration v9 : une publication peut appartenir à un projet
--  Supabase → SQL Editor → Run
--  (après 008_commit_files.sql)
--
--  `project_links` existe déjà, mais ce n'est pas ce dont on parle ici :
--  c'est le lien vers un dépôt **GitHub** (propriétaire, dépôt, branche).
--  Il manquait donc la table qui relie une publication à un projet
--  DevNet — celle qui permet de dire « cette idée vient de ce dépôt ».
--
--  C'est la table qui rend le produit tenable.
--
--  Sans elle, un recruteur qui regarde un profil voit des publications,
--  et doit deviner lesquelles correspondent à un vrai projet. Avec elle,
--  il lit « 3 publications · 12 révisions » et il sait qu'il y a un
--  travail derrière. La publication devient une **entrée dans le
--  dossier**, pas une phrase isolée.
--
--  Choix de schéma
--
--  Une table de jonction à deux colonnes, et non une colonne
--  `project_id` sur `posts`. Un post ne peut appartenir qu'à un projet :
--  rattacher la même publication à deux dépôts obligerait à se demander
--  lequel afficher, et le lecteur comprendrait mal. Si le jour où un post
--  concerne deux projets, on dupliquera la publication — ce qui est plus
--  honnête qu'un rattachement ambigu.
-- ============================================================

create table if not exists public.post_projects (
  post_id    uuid not null references public.posts(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (post_id, project_id)
);

-- La lecture va dans ce sens : « les publications de ce projet », qui est
-- la question que pose un recruteur.
create index if not exists post_projects_project_idx
  on public.post_projects(project_id);

create index if not exists post_projects_post_idx
  on public.post_projects(post_id);

alter table public.post_projects enable row level security;

drop policy if exists "post_projects_read" on public.post_projects;
create policy "post_projects_read" on public.post_projects
  for select using (true);

-- On ne rattache que si l'on peut écrire dans le projet **et** si l'on
-- est l'auteur du post. Le second point est celui qu'on oublie
-- facilement : sans lui, on pourrait attacher sa publication au projet
-- d'un autre — assez tentant pour transformer un dépôt crédible en
-- catalogue de publications empruntées.
drop policy if exists "post_projects_insert" on public.post_projects;
create policy "post_projects_insert" on public.post_projects
  for insert with check (
    public.can_write_project(project_id)
    and exists (
      select 1 from public.posts p
      where p.id = post_projects.post_id
        and p.author_id = auth.uid()
    )
  );

drop policy if exists "post_projects_delete" on public.post_projects;
create policy "post_projects_delete" on public.post_projects
  for delete using (
    public.can_write_project(project_id)
    and exists (
      select 1 from public.posts p
      where p.id = post_projects.post_id
        and p.author_id = auth.uid()
    )
  );

comment on table public.post_projects is
  'Rattachement d''une publication à un projet DevNet. Un post appartient à au plus un projet.';

-- ------------------------------------------------------------
--  Pas de realtime
-- ------------------------------------------------------------
--
--  Le compteur « N publications » d'une carte de projet se recalcule à la
--  lecture. C'est quelques lignes, et le rattacher en direct donnerait un
--  nombre qui bouge sous le doigt du lecteur sans qu'il ait rien fait.