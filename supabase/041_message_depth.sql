-- =============================================================
-- 041 — Profondeur des messages privés
--
-- Deux manques que la messagerie de groupe n'avait pas :
--
-- 1. **Le code.** Un message de groupe porte `is_code` depuis la
--    migration 001 ; un message privé, non. Sur un réseau de
--    développeurs, c'est exactement là qu'on colle un extrait — et le
--    privé est le lieu où l'on partage ce qu'on ne publie pas encore.
--    La colonne est le même booléen que celle des canaux : on ne
--    devine pas le langage, on ne colore pas, on isole le bloc.
--
-- 2. **La correction.** Un message publié peut se modifier, mais
--    l'historique ne se réécrit pas en silence : `edited_at` dit
--    qu'une correction a eu lieu, et l'écran l'affiche. Un message
--    sans `edited_at` est un message d'origine.
--
-- La politique `dm_update` existe depuis la 005 (`auth.uid() =
-- author_id`) : on ne la recrée pas. Ce qui manquait est la borne de
-- **colonnes** — comme pour `conversation_members` en 017. Sans le
-- `revoke` ci-dessous, l'auteur pourrait réécrire `conversation_id`
-- ou `author_id` sur sa propre ligne et déplacer son message dans un
-- fil qu'il ne peut pas lire.
-- =============================================================

alter table public.direct_messages
  add column if not exists is_code boolean not null default false,
  add column if not exists edited_at timestamptz;

-- Une colonne ajoutée à une table déjà dans la publication realtime y
-- reste incluse : aucun `alter publication` n'est nécessaire. Les
-- écrans abonnés reçoivent la ligne complète à l'UPDATE.

-- ── Les colonnes que l'auteur peut corriger ──────────────────
-- On révoque d'abord la mise à jour de table, puis on rouvre
-- précisément le contenu et la marque de correction. `created_at`
-- reste fermé : antidater un message le ferait passer pour un fait
-- ancien qu'on n'a pas écrit à ce moment-là.
revoke update on public.direct_messages from authenticated, anon;
grant update (text, is_code, edited_at) on public.direct_messages to authenticated;

-- Index de lecture : l'écran ouvre les 100 derniers messages d'un fil
-- (`order by created_at desc limit 100`). Sans lui, la messagerie
-- privée devient un parcours complet de la table à mesure qu'elle
-- grossit — le même constat que les index de la 003, appliqué aux MP.
create index if not exists direct_messages_conversation_created_idx
  on public.direct_messages (conversation_id, created_at desc);

comment on column public.direct_messages.is_code is
  'Message présenté comme un bloc de code, jamais interprété.';
comment on column public.direct_messages.edited_at is
  'Instant de la dernière correction ; null pour un message d''origine.';
