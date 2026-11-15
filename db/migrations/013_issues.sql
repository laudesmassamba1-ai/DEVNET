-- ============================================================
--  DEVNET — migration v13 : les issues
--  Supabase → SQL Editor → Run
--  (après 012_branches.sql)
--
--  Un dépôt sans issues n'est pas un dépôt, c'est un éditeur de texte
--  avec un historique. L'issue est l'autre moitié de l'outillage : elle
--  dit ce qui manque, elle se discute, elle se ferme.
--
--  ## Trois décisions
--
--  1. **Le numéro est calculé par la base**, jamais écrit par le
--     client. C'est le même raisonnement que `reports.target_type` et
--     `reports.resolved_at` (migration 011) : une donnée que le client
--     écrit est une donnée que la RLS ne peut pas protéger. Ici, écrire
--     son propre numéro est sans conséquence visible — mais laisser deux
--     personnes créer en même temps la première issue d'un projet
--     produirait « #1 » deux fois, et un compteur qui saute sans raison
--     est un compteur à qui on ne fait plus confiance.
--
--     Le déclencheur lit `max(number) + 1` dans le projet. La course
--     reste possible en théorie — deux insertions simultanées peuvent
--     lire le même maximum — mais l'index unique la transforme en erreur
--     **visible**, jamais en doublon silencieux. C'est exactement le
--     compromis voulu : mieux vaut un refus qu'un mensonge.
--
--  2. **Une issue appartient au projet, pas à une branche.** On en
--     discute sur `main` ce qui manque sur une branche de travail : une
--     issue liée à un commit serait vraie à cet instant et fausse le
--     lendemain, alors qu'un problème se constate indépendamment de
--     l'endroit où on le corrige.
--
--  3. **Fermer n'est pas supprimer.** Une issue fermée garde son
--     historique de commentaires. C'est ce qui distingue « réglé » de
--     « nié » — et c'est indispensable dès qu'un projet a une vie
--     publique : quelqu'un doit pouvoir vérifier qu'un problème signalé
--     a vraiment été traité.
--
--  Ce que cette migration ne fait **pas** : étiquettes, assignations,
--  jalons, relations entre issues. Ce sont des ajouts de colonnes, à
--  poser quand ils servent — pas des tables vides à l'avance, qui
-- onnullent les deux mois où personne ne les remplit.
-- ============================================================


-- ------------------------------------------------------------
-- 1. La table
-- ------------------------------------------------------------

create table if not exists public.issues (
  id          uuid primary key default gen_random_uuid(),

  project_id  uuid not null references public.projects(id) on delete cascade,
  author_id   uuid not null references public.users(id)   on delete cascade,

  -- Renseigné par le déclencheur `assign_issue_number`. Volontairement
  -- **non** `not null` : la colonne peut rester vide dans l'insertion,
  -- ce qui est la seule façon de garantir qu'elle est calculée et non
  -- reçue. Une contrainte `not null` ici obligerait le client à écrire
  -- une valeur — et c'est précisément ce qu'on refuse.
  number      int,

  title       text not null check (char_length(btrim(title)) between 3 and 140),
  body        text not null default '' check (char_length(body) <= 8000),

  -- Un vocabulaire fermé : un compteur d'issues ouvertes ne peut être
  -- calculé que si les états sont connus à l'avance.
  status      text not null default 'open'
                check (status in ('open','closed')),

  -- Dérivé du statut, comme `reports.resolved_at` (migration 011).
  closed_at   timestamptz,
  closed_by   uuid references public.users(id) on delete set null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Une issue fermée porte sa date et son auteur de fermeture ; une
  -- issue ouverte n'en porte aucun. Sans cette contrainte, l'écran doit
  -- deviner si une date vide a été oubliée ou n'a pas lieu d'être.
  constraint issues_closure_dated
    check (
      (status = 'open'   and closed_at is null) or
      (status = 'closed' and closed_at is not null)
    )
);

-- Le numéro est unique **par projet**, pas globalement : c'est « #3 du
-- dépôt », pas « #3 de DevNet ». L'index unique est aussi ce qui rend
-- visible la course évoquée plus haut.
create unique index if not exists issues_project_number_idx
  on public.issues (project_id, number)
  where number is not null;

-- La liste affichée est « ouvertes d'abord, puis les plus récentes ».
-- Un index qui ne correspond pas à cet ordre oblige la base à trier
-- toute la table à chaque ouverture d'écran.
create index if not exists issues_open_first_idx
  on public.issues (project_id, status, created_at desc);


-- ------------------------------------------------------------
-- 2. La numérotation
-- ------------------------------------------------------------

create or replace function public.assign_issue_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Une valeur déjà présente est **conservée** : c'est ce qui rend le
  -- déclencheur sûr à réappliquer. Un écrasement ici fixerait `null`
  -- par terre et ferait perdre le numéro de toutes les issues déjà
  -- créées si la fonction était rappelée sur une mise à jour.
  if new.number is null then
    select coalesce(max(i.number), 0) + 1
      into new.number
      from public.issues i
     where i.project_id = new.project_id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_issue_number on public.issues;
create trigger on_issue_number
  before insert on public.issues
  for each row execute function public.assign_issue_number();


-- ------------------------------------------------------------
-- 3. La fermeture, et sa date
-- ------------------------------------------------------------

-- Reprendre le raisonnement de `sync_report_resolution` : la date est
-- écrite par la base, et une réouverture suivie d'une nouvelle
-- fermeture **redate** — contrairement à un reclassement de
-- signalement, où l'on voulait garder la première date.
create or replace function public.sync_issue_closure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'open' then
    new.closed_at := null;
    new.closed_by := null;
  elsif new.closed_at is null then
    new.closed_at := now();
    new.closed_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists on_issue_closure on public.issues;
create trigger on_issue_closure
  before update of status on public.issues
  for each row execute function public.sync_issue_closure();


-- ------------------------------------------------------------
-- 4. Les commentaires
-- ------------------------------------------------------------

create table if not exists public.issue_comments (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null references public.issues(id) on delete cascade,
  author_id   uuid not null references public.users(id)  on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists issue_comments_issue_idx
  on public.issue_comments (issue_id, created_at);

alter table public.issues         enable row level security;
alter table public.issue_comments enable row level security;


-- ------------------------------------------------------------
-- 5. Qui lit
--
-- Toute personne qui peut lire le projet lit ses issues : c'est la même
-- population que celle qui voit l'arbre de fichiers. Une issue
-- confidentielle n'a pas de sens dans un dépôt dont on affiche déjà
-- l'historique.
--
-- Les commentaires suivent l'issue : ils passent par `can_read_project`
-- sur `issues`, et non par une jointure dans la politique — une RLS qui
-- raisonne en jointures est une RLS dont l'index ne sert à rien et dont
-- la correction se fait en deux endroits.
-- ------------------------------------------------------------

drop policy if exists "issues_read" on public.issues;
create policy "issues_read" on public.issues
  for select using (public.can_read_project(project_id));

drop policy if exists "issue_comments_read" on public.issue_comments;
create policy "issue_comments_read" on public.issue_comments
  for select using (
    exists (
      select 1 from public.issues i
      where i.id = issue_comments.issue_id
        and public.can_read_project(i.project_id)
    )
  );


-- ------------------------------------------------------------
-- 6. Qui écrit
--
-- Créer une issue, commenter ou fermer exige `can_write_project` — la
-- capacité d'écrire dans le dépôt. On ne crée pas d'issue sur un dépôt
-- qu'on regarde seulement : ce serait un canal d'écriture déguisé.
--
-- L'auteur ne peut écrire que **son propre** commentaire. Sans cette
-- clause, commenter à la place de quelqu'un d'autre serait possible, et
-- une conversation dont on ne sait plus qui dit quoi ne vaut plus rien.
-- ------------------------------------------------------------

drop policy if exists "issues_insert" on public.issues;
create policy "issues_insert" on public.issues
  for insert with check (
    public.can_write_project(project_id)
    and author_id = auth.uid()
  );

drop policy if exists "issues_update" on public.issues;
create policy "issues_update" on public.issues
  for update
  using (public.can_write_project(project_id))
  with check (public.can_write_project(project_id));

drop policy if exists "issue_comments_insert" on public.issue_comments;
create policy "issue_comments_insert" on public.issue_comments
  for insert with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.issues i
      where i.id = issue_comments.issue_id
        and public.can_write_project(i.project_id)
    )
  );


-- ------------------------------------------------------------
-- 7. Suppression
--
-- L'auteur retire la sienne ; qui peut écrire dans le dépôt retire
-- n'importe laquelle. La seconde clause n'est pas un privilège de
-- modération — c'est la capacité habituelle de tenir un dépôt, celle que
-- `can_write_project` accorde déjà partout ailleurs dans ce schéma.
--
-- Fermer, lui, ne supprime rien : c'est le point 3 de l'en-tête.
-- ------------------------------------------------------------

drop policy if exists "issues_delete" on public.issues;
create policy "issues_delete" on public.issues
  for delete using (
    author_id = auth.uid()
    or public.can_write_project(project_id)
  );

drop policy if exists "issue_comments_delete" on public.issue_comments;
create policy "issue_comments_delete" on public.issue_comments
  for delete using (
    author_id = auth.uid()
    or exists (
      select 1 from public.issues i
      where i.id = issue_comments.issue_id
        and public.can_write_project(i.project_id)
    )
  );


comment on table public.issues is
  'Problème signalé sur un dépôt. Le numéro est calculé par la base, jamais écrit par le client.';

comment on table public.issue_comments is
  'Discussion sous une issue. Un commentaire ne se réécrit pas : la RLS n''ouvre aucune politique de mise à jour, comme pour `comments` (migration 005).';


-- ------------------------------------------------------------
--  REALTIME
--
--  Pas de realtime. Une issue est un acte délibéré, comme un commit :
--  deux personnes qui traitent le même signalement à la seconde
--  d'écart se voient, parce que la page se relit à chaque ouverture.
--  Une file d'issues qui bouge tout seule pendant qu'on la lit est
--  surtout une file qu'on ne lit plus.
--