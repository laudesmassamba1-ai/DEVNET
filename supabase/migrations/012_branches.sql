-- ============================================================
--  DEVNET — migration v12 : les branches ont leur propre état
--  Supabase → SQL Editor → Run
--  (après 011_reports.sql)
--
--  ## Le trou
--
--  `git_refs` existe depuis la migration 004 : le dépôt a des branches.
--  Mais `git_files` n'avait **pas de colonne `branch`** — l'état de
--  travail était commun à tout le projet.
--
--  Concrètement, une branche ne pouvait rien contenir de différent
--  d'une autre : « basculer » ne changeait que l'étiquette affichée,
--  et l'historique lui-même était commun. Sans cela, deux notions de
--  git manquent entièrement :
--
--  - **une pull request** n'a rien à comparer : si toutes les branches
--    ont les mêmes fichiers, leur différence est vide ;
--  - **l'isolation** est fausse : un commit écrit sur une branche
--    apparaît sur toutes les autres, ce qui n'est pas du travail
--    parallèle, c'est du travail *écrit ailleurs*.
--
--  ## Le choix de modèle
--
--  Git a un seul arbre de travail : on « checkout » une branche et les
--  fichiers changent sur place. C'est juste pour un poste local, où
--  personne d'autre ne regarde. Ici, plusieurs personnes travaillent
--  sur le même dépôt **en même temps**, et chacune voit l'écran, pas le
--  disque de quelqu'un d'autre.
--
--  On donne donc à chaque branche son propre jeu de fichiers. C'est un
--  écart assumé : `git_files` est le contenu de la branche, pas un
--  arbre de travail partagé. Le prix est du doublonnage entre branches,
--  le bénéfice est qu'une branche peut être lisible sans être écrite.
--
--  `git_commit_files` n'est **pas** touché : un instantané appartient à
--  un commit, et un sha est unique dans tout le dépôt. Lui ajouter une
--  branche n'aurait aucun sens.
-- ============================================================

alter table public.git_files
  add column if not exists branch text not null default 'main';

-- La clé doit inclure la branche : c'est elle qui rend deux fichiers
-- au même chemin sur deux branches **deux fichiers** au lieu d'un seul
-- écrasé. C'est le genre d'erreur qui ne se voit pas — le dépôt
-- fonctionne, il perd simplement des fichiers en silence.
alter table public.git_files drop constraint if exists git_files_pkey;
alter table public.git_files add primary key (project_id, branch, path);

create index if not exists git_files_branch_idx
  on public.git_files(project_id, branch);

-- ------------------------------------------------------------
--  Le filet SQL
--
--  Volontairement **grossier**. `lib/git/refs.ts` applique les règles
--  complètes de `git check-ref-format`, et c'est lui qui fait autorité.
--
--  On ne les recopie pas ici : une contrainte SQL qui refuse ce que
--  l'écran vient d'accepter est pire qu'une contrainte absente — elle
--  rend une erreur que personne ne sait expliquer, dans un endroit où
--  la règle n'est pas écrite. Ce filet ne sert qu'à ce qu'aucun code
--  n'ait validé : un nom vide, un nom qui n'est que des espaces.
--
alter table public.git_files
  drop constraint if exists git_files_branch_not_blank;

alter table public.git_files
  add constraint git_files_branch_not_blank
  check (length(branch) between 1 and 255 and branch = btrim(branch));

comment on column public.git_files.branch is
  'Branche à laquelle appartient ce fichier. Une branche a son propre jeu de fichiers : c''est ce qui rend possible une pull request.';

comment on table public.git_commit_files is
  'État des fichiers à chaque commit. Volontairement sans colonne `branch` : un commit est identifié par son sha, unique dans tout le dépôt.';

-- ------------------------------------------------------------
--  Données existantes
--
--  Les lignes d'avant la migration appartiennent à `main`, ce que la
--  valeur par défaut a déjà fait. L'instruction explicite est là pour
--  qu'une réapplication soit sans effet, et pour qu'un lecteur puisse
--  voir où le report s'est produit.
--
update public.git_files set branch = 'main' where branch is null or branch = '';

-- ------------------------------------------------------------
--  RLS
--
--  Inchangée, et c'est voulu : `can_read_project` et `can_write_project`
--  portent sur le **projet**, pas sur la branche. Une branche n'est pas
--  une frontière de sécurité — quelqu'un qui peut écrire dans le dépôt
--  peut créer une branche et y écrire.
--
--  La lecture est donc faite par `(projet, branche)` : on filtre sur la
--  branche **après** que la RLS a déjà tranché l'accès au projet.