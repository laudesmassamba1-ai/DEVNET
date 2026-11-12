-- ============================================================
--  DEVNET — migration 52 : GIF dans une publication
--
--  Une publication pouvait porter du texte et du code, pas d'image.
--  Le GIF est un **lien** vers un fournisseur (Tenor ou Giphy), pas un
--  fichier recopié : on ne stocke ni binaire, ni cache, et le jour où
--  le fournisseur retire un GIF, la publication garde son texte.
--
--  Deux colonnes, deux garde-fous :
--
--   1. `gif_url` n'accepte que `https://` — une URL `javascript:` ou
--      `data:` posée en base deviendrait une exécution au rendu ;
--   2. `gif_alt` est bornée : c'est une description lue par un lecteur
--      d'écran, pas un paragraphe.
-- ============================================================

alter table public.posts
  add column if not exists gif_url text not null default '',
  add column if not exists gif_alt text not null default '';

alter table public.posts drop constraint if exists posts_gif_url_https;
alter table public.posts
  add constraint posts_gif_url_https
  check (gif_url = '' or gif_url ~ '^https://[^[:space:]]{8,900}$');

alter table public.posts drop constraint if exists posts_gif_alt_len;
alter table public.posts
  add constraint posts_gif_alt_len
  check (char_length(gif_alt) <= 300);

comment on column public.posts.gif_url is
  'Lien https vers un GIF hébergé par un fournisseur (Tenor, Giphy). Vide si aucun.';
comment on column public.posts.gif_alt is
  'Description du GIF, lue par les lecteurs d''écran. Vide si le fournisseur n''en donne pas.';
