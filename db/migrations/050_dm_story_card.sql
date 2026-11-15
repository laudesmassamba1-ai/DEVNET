-- ============================================================
--  DEVNET — migration 50 : la story d'origine d'un message privé
--
--  Une réponse de story arrivait dans la conversation privée comme un
--  message ordinaire : « Réponse à ta story : … » sans la story. Le lien
--  manquait, et avec lui le contexte.
--
--  `story_id` porte ce lien. Il est facultatif (on écrit aussi des messages
--  sans story), et il s'efface si la story est supprimée — la story expire
--  d'elle-même par sa date, la ligne privée, elle, reste.
-- ============================================================

alter table public.direct_messages
  add column if not exists story_id uuid references public.stories(id) on delete set null;

create index if not exists direct_messages_story_idx
  on public.direct_messages (story_id)
  where story_id is not null;
