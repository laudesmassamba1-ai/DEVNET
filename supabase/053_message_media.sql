-- ============================================================
--  DEVNET — migration 53 : stickers et GIF dans les messages
--
--  Un message était du texte, ou du code. Les deux messageries — le
--  privé (`direct_messages`) et les canaux de groupe
--  (`group_messages`) — reçoivent ici les mêmes trois colonnes, pour
--  que le geste soit identique des deux côtés.
--
--  Trois choix :
--
--  1. Un sticker est **référencé**, pas recopié : `sticker_id` pointe
--     vers le catalogue. Retirer un sticker ne réécrit pas l'histoire
--     des messages (`on delete set null`), il laisse un message qui
--     n'affiche plus d'image mais garde sa place.
--  2. Un GIF est un **lien** https vers le fournisseur, comme dans une
--     publication (migration 52). Aucun binaire en base.
--  3. Un message peut n'avoir ni texte ni code : `text` reste vide et
--     le média porte le message. On ne pose pas de contrainte
--     « contenu obligatoire » — l'interface l'impose déjà, et une
--     contrainte SQL casserait les messages système existants.
-- ============================================================

alter table public.group_messages
  add column if not exists sticker_id uuid references public.stickers(id) on delete set null,
  add column if not exists gif_url text not null default '',
  add column if not exists gif_alt text not null default '';

alter table public.direct_messages
  add column if not exists sticker_id uuid references public.stickers(id) on delete set null,
  add column if not exists gif_url text not null default '',
  add column if not exists gif_alt text not null default '';

-- Mêmes garde-fous que pour les publications : https seulement, et une
-- description bornée (c'est un texte lu par un lecteur d'écran).
alter table public.group_messages drop constraint if exists group_messages_gif_url_https;
alter table public.group_messages
  add constraint group_messages_gif_url_https
  check (gif_url = '' or gif_url ~ '^https://[^[:space:]]{8,900}$');
alter table public.group_messages drop constraint if exists group_messages_gif_alt_len;
alter table public.group_messages
  add constraint group_messages_gif_alt_len check (char_length(gif_alt) <= 300);

alter table public.direct_messages drop constraint if exists direct_messages_gif_url_https;
alter table public.direct_messages
  add constraint direct_messages_gif_url_https
  check (gif_url = '' or gif_url ~ '^https://[^[:space:]]{8,900}$');
alter table public.direct_messages drop constraint if exists direct_messages_gif_alt_len;
alter table public.direct_messages
  add constraint direct_messages_gif_alt_len check (char_length(gif_alt) <= 300);

comment on column public.direct_messages.sticker_id is
  'Sticker du catalogue joint au message. Null si aucun, ou si le sticker a été retiré.';
comment on column public.group_messages.gif_url is
  'Lien https vers un GIF (Tenor, Giphy). Vide si aucun.';
