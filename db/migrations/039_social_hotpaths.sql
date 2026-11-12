-- ============================================================
--  DEVNET — migration 039 : index des chemins chauds
--  Supabase → SQL Editor → Run
--  (après 038_rls_select_fold.sql)
--
--  Trois lectures se font à chaque écran et n'avaient aucun index :
--
--   · la boîte de réception trie `conversations` par `last_message_at`
--     et filtre par `.contains("participants", [moi])` — un tableau
--     `uuid[]`, donc un GIN, pas un btree ;
--   · un fil de discussion lit les 100 derniers `direct_messages`
--     d'une conversation, du plus récent au plus ancien ;
--   · les commentaires et messages privés portent une clé étrangère
--     vers `users` : sans index, supprimer un compte balaie la table.
--
--  Les index d'activité qui servent au calcul d'XP existaient déjà
--  (`posts_author_created_idx`, `group_messages_author_created_idx`).
-- ============================================================

create index if not exists conversations_recent_idx
  on public.conversations (last_message_at desc);

create index if not exists conversations_participants_idx
  on public.conversations using gin (participants);

create index if not exists direct_messages_conv_created_idx
  on public.direct_messages (conversation_id, created_at desc);

create index if not exists direct_messages_author_idx
  on public.direct_messages (author_id);

create index if not exists comments_author_idx
  on public.comments (author_id);
