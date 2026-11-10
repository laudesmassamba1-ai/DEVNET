-- 054 — un commentaire peut porter un sticker ou un GIF.
--
-- Même contrat que les messages (053) : un média tient lieu de texte, donc
-- `text` vide est autorisé **seulement** si un média est présent ; l'URL
-- d'un GIF est en `https` et son texte alternatif est borné ; un sticker est
-- une ligne du catalogue, jamais un caractère.
--
-- La règle « média seul » est portée par la contrainte ci-dessous : sans
-- elle, un commentaire vide pourrait exister et le fil afficherait une
-- ligne muette.

alter table public.comments
  add column if not exists gif_url text not null default '',
  add column if not exists gif_alt text not null default '',
  add column if not exists sticker_id uuid references public.stickers(id) on delete set null;

alter table public.comments
  drop constraint if exists comments_text_len,
  add constraint comments_text_len check (char_length(text) <= 1000);

alter table public.comments
  drop constraint if exists comments_gif_url_https,
  add constraint comments_gif_url_https
    check (gif_url = '' or gif_url ~ '^https://');

alter table public.comments
  drop constraint if exists comments_gif_alt_len,
  add constraint comments_gif_alt_len check (char_length(gif_alt) <= 300);

-- Un commentaire dit quelque chose : du texte, un GIF ou un sticker.
alter table public.comments
  drop constraint if exists comments_not_empty,
  add constraint comments_not_empty
    check (char_length(btrim(text)) > 0 or gif_url <> '' or sticker_id is not null);
