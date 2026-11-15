-- ============================================================
--  029 — La notation par les pairs : une étoile, un votant
--
--  La 025 a posé la lignée des forks et `lib/rating.ts` a posé le
--  moteur ; la table qui **porte** les votes manquait. `lib/rating-data.ts`
--  interrogeait donc `project_ratings` dans le vide : PostgREST répondait
--  404 à chaque ouverture de profil (le journal du navigateur en portait
--  la trace), et un projet restait « pas encore noté » même après un vote.
--  Le côté démo, lui, avait déjà la table (`lib/demo/store.ts`) : les deux
--  modes divergeaient sur une fonctionnalité visible.
--
--  ## Pourquoi une clé composée, pas un `id`
--
--  Une ligne n'est pas « une notation », c'est **le vote d'une personne
--  sur un projet**. La paire (projet, votant) est l'identité de la ligne :
--  la nommer clé primaire rend le double vote impossible *par le schéma*,
--  pas par une vérification applicative qu'un client plus ancien
--  contournerait. C'est exactement ce que refuse le moteur de notation :
--  une moyenne gonflée par des voix qui n'existent pas.
--
--  ## `voter_lang` — le votant, pas seulement sa note
--
--  Le moteur (`lib/rating.ts`) pondère la provenance des votes : un jury
--  de deux personnes du même langage dit moins qu'un jury large et divers.
--  Le langage du votant doit donc être **écrit** au moment du vote ; le
--  relire plus tard depuis le profil donnerait la réponse d'aujourd'hui à
--  une question d'hier.
--
--  ## Mise à jour, pas de seconde ligne
--
--  Changer d'avis est légitime — se remplacer en secret ne l'est pas : le
--  client fait un `upsert` sur (projet, votant), donc la table doit ouvrir
--  l'`insert` **et** l'`update` à son votant. Il n'y a en revanche aucun
--  geste de retrait dans l'interface : on n'ouvre pas de politique de
--  suppression, plutôt que d'offrir un droit que rien n'utilise.
-- ============================================================

create table if not exists public.project_ratings (
  project_id uuid not null references public.projects(id) on delete cascade,
  voter_id   uuid not null references public.users(id) on delete cascade,
  -- 1 à 5, et rien d'autre : le moteur lit cette valeur comme une étoile,
  -- pas comme un score libre.
  stars      smallint not null,
  -- Le langage du votant au moment du vote (prime de diversité du jury).
  voter_lang text not null default '',
  created_at timestamptz not null default now(),
  constraint project_ratings_pkey primary key (project_id, voter_id),
  constraint project_ratings_stars_check check (stars between 1 and 5)
);

-- La lecture par votant (compteurs d'une personne, défis du jour) et la
-- lecture par projet (la moyenne d'un dépôt) sont les deux seules.
create index if not exists ratings_voter_idx
  on public.project_ratings (voter_id, created_at desc);
create index if not exists ratings_project_idx
  on public.project_ratings (project_id);

alter table public.project_ratings enable row level security;

-- Les votes sont publics : c'est ce qui rend la moyenne vérifiable. Un
-- jury dont on ne peut pas lire les voix est une note sur parole.
drop policy if exists "ratings_read" on public.project_ratings;
create policy "ratings_read" on public.project_ratings
  for select using (true);

-- Chacun pose sa propre étoile, et seulement la sienne.
drop policy if exists "ratings_insert" on public.project_ratings;
create policy "ratings_insert" on public.project_ratings
  for insert with check (auth.uid() = voter_id);

-- Changer d'avis : on réécrit **sa** ligne. `using` borne la ligne,
-- `with check` borne la valeur écrite — sans lui, un votant pourrait
-- déplacer son vote sur `voter_id` et signer à la place d'un autre.
drop policy if exists "ratings_update" on public.project_ratings;
create policy "ratings_update" on public.project_ratings
  for update using (auth.uid() = voter_id)
  with check (auth.uid() = voter_id);
