-- ============================================================
--  DEVNET — migration v8 : l'état des fichiers par commit
--  Supabase → SQL Editor → Run
--  (après 007_search.sql)
--
--  Le moteur de dépôt (`lib/git/history.ts`) sait fabriquer un commit
--  dont le sha est **exactement** celui de `git`. Mais il exige qu'on lui
--  donne l'état des fichiers au commit parent, et jusqu'ici rien ne le
--  stockait.
--
--  Pourquoi c'est nécessaire, et pas un raffinement :
--
--  Un commit ne contient que le sha de son arbre, pas le contenu des
--  fichiers. C'est le principe même de git — les objets sont adressés par
--  leur contenu, et le commit ne *référence* que des noms. Sans les
--  blobs, on ne peut pas reconstituer un commit passé.
--
--  Concrètement, deux choses cassent sans cette table :
--
--  - **« Y a-t-il des changements à committer ? »** Le moteur compare
--    l'état courant à celui du parent. Sans le parent, tout paraît modifié,
--    et un clic « Enregistrer » ajoute une entrée vide. L'historique
--    devient illisible en une semaine.
--
--  - **Le diff entre deux commits.** Sans l'état du parent, il n'y a rien
--    à comparer. L'écran d'historique ne pourrait afficher qu'un message et
--    un nombre, ce qui ne prouve rien.
--
--  Choix : on stocke le **contenu** dans l'instantané, plutôt que de
--  référencer un magasin d'objets séparé. Un dépôt git réel déduplique
--  les blobs entre tous les commits ; ici, on aurait une ligne par fichier
--  et par commit. Le doublonnage est réel, mais il est borné : quelques
--  fichiers, quelques dizaines de commits, et la simplification supprime
--  une table, une lecture et une indirection. Dupliquer ici coûte
--  est un arbitrage : on le refait quand un dépôt devient volumineux.
-- ============================================================

create table if not exists public.git_commit_files (
  project_id uuid not null references public.projects(id) on delete cascade,
  sha         text not null,
  path        text not null,
  content     text default '',
  blob_sha    text default '',
  primary key (sha, path)
);

create index if not exists git_commit_files_project_idx
  on public.git_commit_files(project_id);

create index if not exists git_commit_files_sha_idx
  on public.git_commit_files(sha);

alter table public.git_commit_files enable row level security;

drop policy if exists "git_commit_files_read" on public.git_commit_files;
create policy "git_commit_files_read" on public.git_commit_files
  for select using (public.can_read_project(project_id));

drop policy if exists "git_commit_files_write" on public.git_commit_files;
create policy "git_commit_files_write" on public.git_commit_files
  for all using (public.can_write_project(project_id))
  with check (public.can_write_project(project_id));

-- La lecture ne se limite pas à ses propres commits : c'est l'historique
-- du projet qui doit être lisible, sinon un Contributeur ne verrait que
-- ses propres lignes. C'est la raison d'être de `can_read_project`, et
-- elle est déjà utilisée par `git_files` et `git_commits`.

-- ------------------------------------------------------------
--  Report : les commits de démonstration ont déjà des fichiers
-- ------------------------------------------------------------
--
--  On rattache l'état courant au dernier commit de chaque branche, ce qui
--  est faux dans un sens — ce commit décrivait peut-être un état
--  différent. Mais c'est le seul état qu'on possède, et le reconstruire
--  autrement demanderait de rejouer chaque diff. Le snapshot du sommet
--  est exact par construction ; ceux d'en dessous le resteront dès le
--  prochain commit, où ils seront écrits avec le contenu réel.

insert into public.git_commit_files (project_id, sha, path, content, blob_sha)
select f.project_id, r.sha, f.path, f.content, f.blob_sha
from public.git_files f
join public.git_refs r
  on r.project_id = f.project_id
where r.kind = 'branch'
  and not exists (
    select 1 from public.git_commit_files c where c.sha = r.sha
  );

comment on table public.git_commit_files is
  'État des fichiers à chaque commit — ce qui permet de comparer deux commits et de dire s''il y a des changements à enregistrer.';

-- ------------------------------------------------------------
--  REALTIME
-- ------------------------------------------------------------
--
-- Pas de realtime ici : un commit est un acte deliberé, pas un flux. Deux
-- personnes qui écrivent le même fichier doivent se le voir, et ça se
-- règle à la lecture — voir `project_sessions`, qui porte déjà la présence.