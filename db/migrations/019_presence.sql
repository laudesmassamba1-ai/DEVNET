-- ============================================================
--  DEVNET — 019_presence.sql
--
--  Deux corrections sur `project_sessions`, devenue la table de la
--  **présence** : qui travaille sur quoi, dans quel projet.
--
--  Exécute dans Supabase → SQL Editor → Run.
-- ============================================================

-- ── 1. La clé ────────────────────────────────────────────────
--
--  La 004 déclarait `id text primary key` avec le commentaire
--  « project_id:chemin ». La session appartenait donc à un **fichier**, pas
--  à une **personne** — et c'est faux dans les deux sens :
--
--   · deux membres qui ouvrent le même fichier se disputaient une seule
--     ligne, et le second effaçait la présence du premier. C'est-à-dire
--     exactement ce que la table existe pour montrer ;
--   · un membre qui ouvre deux fichiers n'avait qu'une ligne, dont le
--     `file_path` changeait — le tableau de la présence devenait un
--     dernier-clic plutôt qu'une vue d'ensemble.
--
--  Une session est (projet, personne) : c'est la paire qui l'identifie.
--  `file_path` devient une **colonne** que l'on met à jour, plus une clé.
alter table public.project_sessions drop constraint project_sessions_pkey;
alter table public.project_sessions drop column id;

--  Une session sans personne n'est pas une session. La 004 laissait
--  `user_id` nullable avec `on delete set null` : une ligne dont
--  `user_id` vaut `null` resterait dans la table, invisible pour tout le
--  monde et comptée nulle part — un reste qu'aucune politique ne
--  nettoie. On préfère la cascade : la disparition du compte emporte sa
--  présence.
alter table public.project_sessions alter column user_id set not null;
alter table public.project_sessions drop constraint project_sessions_user_id_fkey;
alter table public.project_sessions add constraint project_sessions_user_id_fkey
  foreign key (user_id) references public.users(id) on delete cascade;

alter table public.project_sessions add primary key (project_id, user_id);

-- ── 2. Le droit de partir ────────────────────────────────────
--
--  La 004 n'ouvrait que `select`, `insert` et `update`. On peut donc
--  écrire sa présence et la rafraîchir, mais **jamais la retirer**. Tant
--  que le délai d'expiration n'est pas écoulé, quelqu'un qui a fermé son
--  écran reste affiché comme présent, et rien n'y peut rien.
--
--  Le geste est naturel et strictement personnel : on ne supprime que sa
--  ligne. La politique reprend donc l'égalité des autres, appliquée à la
--  suppression.
create policy "sessions_delete" on public.project_sessions for delete
  using (user_id = auth.uid());
