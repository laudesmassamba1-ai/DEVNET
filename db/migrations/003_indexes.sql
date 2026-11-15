-- ============================================================
--  DEVNET — migration v3 : index de progression
--  Supabase → SQL Editor → Run
--  (après 001_schema.sql et 002_accounts.sql)
--
--  La gamification est **dérivée** : aucun score n'est stocké. On
--  recalcule depuis les événements réels. Cette migration ne fait
--  donc qu'accélérer les lectures dont la progression a besoin.
--
--  Elle est facultative : sans elle, tout fonctionne, seulement
--  plus lentement sur une base qui grossit.
-- ============================================================

-- La progression lit les posts d'un auteur, du plus récent au plus ancien.
create index if not exists posts_author_created_idx
  on public.posts(author_id, created_at desc);

-- La carte d'activité et le classement lisent une fenêtre de 7 jours :
-- cet index évite un scan séquentiel du fil complet.
create index if not exists posts_created_idx
  on public.posts(created_at desc);

-- Idem pour l'activité en groupe (score + messages des dernières 24 h).
create index if not exists group_messages_author_created_idx
  on public.group_messages(author_id, created_at desc);

create index if not exists group_messages_created_idx
  on public.group_messages(created_at desc);

-- Le rail de stories regroupe les posts par auteur sur 24 h glissantes.
create index if not exists posts_created_author_idx
  on public.posts(created_at desc, author_id);
