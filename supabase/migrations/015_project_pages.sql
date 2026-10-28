-- ============================================================
--  DEVNET — migration v15 : les pages de dépôt (le wiki)
--  Supabase → SQL Editor → Run
--  (après 014_pull_requests.sql)
--
--  Un dépôt qui n'a que du code ne s'explique pas. Le README répond
--  à « comment l'utiliser », pas à « pourquoi c'est fait comme ça »,
--  ni à « où on va ». Le wiki est la mémoire écrite du projet : un
--  ensemble de pages ordonnées, rattachées au dépôt, que les personnes
--  qui écrivent le code peuvent tenir à jour.
--
--  ## Trois décisions
--
--  1. **Une page appartient au projet, pas à une branche.** Une note
--     d'architecture décrit l'intention, qui survit aux branches de
--     travail. La lier à une branche ferait qu'elle disparaîtrait à la
--     fusion — exactement au moment où elle devient vraie.
--
--  2. **L'ordre est explicite** (`position`), pas l'ordre de création.
--     Un sommaire se range : « Démarrage » avant « Architecture », même
--     si la seconde a été écrite en premier. Trier par date ferait
--     remonter la page la plus récente en tête, ce qui n'est pas un
--     sommaire mais un fil d'actualité.
--
--  3. **Le corps est du texte**, avec des conventions légères (titres
--     `#`, listes `-`, blocs de code ```). Pas de sous-table de blocs,
--     pas de schéma de document : ce serait trois tables pour un besoin
--     que le texte satisfait. Si un jour on veut des blocs typés, ce
--     sera une migration, pas une devinette.
--
--  Ce que cette migration ne fait **pas** : historique de version par
--  page, imbrication de pages, commentaires de page. Ce sont des
--  fonctionnalités réelles, mais qui n'ont de valeur qu'une fois que
--  les pages existent — et une page sans son enfant est plus utile
--  qu'un enfant sans page.
-- ============================================================


-- ------------------------------------------------------------
-- 1. La table
-- ------------------------------------------------------------

create table if not exists public.project_pages (
  id          uuid primary key default gen_random_uuid(),

  project_id  uuid not null references public.projects(id) on delete cascade,
  author_id   uuid not null references public.users(id)    on delete cascade,

  title       text not null check (char_length(btrim(title)) between 1 and 120),
  body        text not null default '' check (char_length(body) <= 20000),

  -- Rang dans le sommaire. Les valeurs peuvent être égales : le départage
  -- se fait alors sur `created_at`, ce qui garantit un ordre stable même
  -- si deux pages reçoivent la même position.
  position    int not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- La lecture est « les pages d'un projet, dans l'ordre du sommaire ».
-- L'index suit cet ordre exactement, pour que la base n'ait pas à trier
-- la table à chaque ouverture.
create index if not exists project_pages_project_idx
  on public.project_pages (project_id, position, created_at);


-- ------------------------------------------------------------
-- 2. La date de dernière écriture
--
-- `updated_at` est écrit par la base, jamais par le client. Un client qui
-- fournit lui-même sa date de modification peut la figer, et une page
-- « modifiée il y a un instant » qui ne bouge plus trompe exactement la
-- personne à qui la date sert : celle qui cherche ce qui a changé.
-- ------------------------------------------------------------

create or replace function public.touch_project_page()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists on_project_page_touch on public.project_pages;
create trigger on_project_page_touch
  before update on public.project_pages
  for each row execute function public.touch_project_page();


-- ------------------------------------------------------------
-- 3. Qui lit, qui écrit
--
-- Mêmes capacités que le reste du dépôt : lire une page exige de pouvoir
-- lire le projet, l'écrire exige de pouvoir y écrire. On ne documente pas
-- un dépôt qu'on ne peut pas modifier — sinon le wiki devient un canal
-- d'écriture déguisé.
--
-- L'auteur ne peut créer que **sa propre** page : `author_id = auth.uid()`
-- à l'insertion, comme pour une issue. Modifier une page est en revanche
-- une capacité partagée : un wiki qu'une seule personne peut corriger
-- n'est pas un wiki.
-- ------------------------------------------------------------

alter table public.project_pages enable row level security;

drop policy if exists "project_pages_read" on public.project_pages;
create policy "project_pages_read" on public.project_pages
  for select using (public.can_read_project(project_id));

drop policy if exists "project_pages_insert" on public.project_pages;
create policy "project_pages_insert" on public.project_pages
  for insert with check (
    public.can_write_project(project_id)
    and author_id = auth.uid()
  );

drop policy if exists "project_pages_update" on public.project_pages;
create policy "project_pages_update" on public.project_pages
  for update
  using (public.can_write_project(project_id))
  with check (public.can_write_project(project_id));

drop policy if exists "project_pages_delete" on public.project_pages;
create policy "project_pages_delete" on public.project_pages
  for delete using (public.can_write_project(project_id));


comment on table public.project_pages is
  'Page de wiki rattachée à un dépôt. Le corps est du texte à conventions légères (titres, listes, blocs de code).';


-- ------------------------------------------------------------
--  REALTIME
--
--  Pas de realtime. Une page se relit à l'ouverture, comme une issue.
--  Un texte qui se réécrit tout seul pendant qu'on le lit est un texte
--  sur lequel on ne peut pas travailler.
-- ------------------------------------------------------------
