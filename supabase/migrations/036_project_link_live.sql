-- 036 — La synchronisation GitHub « live »
--
-- Le panneau GitHub (components/GithubPanel.tsx) ne connaissait que trois
-- modes, tous **manuels** : rien ne se passait sans un clic. On ajoute une
-- synchro automatique (polling) pilotée depuis le navigateur — le seul
-- mécanisme possible sans serveur applicatif (MEMO §9).
--
-- Trois colonnes suffisent à la rendre sûre :
--
--   * `remote_sha` — le dernier sha de branche **vu sur GitHub**. C'est la
--     seule façon de dire « GitHub a avancé » : les sha DevNet sont
--     recalculés par notre moteur et ne sont pas ceux de GitHub.
--   * `local_sha` — la tête DevNet au moment de la dernière synchro. Elle
--     permet de distinguer « l'utilisateur a commité » de « GitHub a
--     commité » sans confondre les deux.
--   * `sync_interval_seconds` — la cadence du polling, choisie par
--     l'utilisateur dans les paramètres associés.

alter table public.project_links
  add column if not exists remote_sha text not null default '';

alter table public.project_links
  add column if not exists local_sha text not null default '';

alter table public.project_links
  add column if not exists sync_interval_seconds integer not null default 30;

alter table public.project_links
  drop constraint if exists project_links_interval_check;

alter table public.project_links
  add constraint project_links_interval_check
  check (sync_interval_seconds between 10 and 3600);
