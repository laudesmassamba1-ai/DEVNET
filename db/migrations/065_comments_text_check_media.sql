-- ============================================================
-- 065 — Un commentaire avec média n'a pas à porter de texte
--
-- La migration 054 a ajouté `gif_url`, `gif_alt` et `sticker_id`, posé
-- `comments_not_empty` (« du texte, un GIF ou un sticker ») et assoupli
-- `comments_text_len` à `<= 1000`. Mais la contrainte posée en 005,
-- `comments_text_check` — `char_length(trim(text)) between 1 and 1000` —
-- est restée : un commentaire qui ne porte qu'un GIF a un texte vide et
-- se voit refusé alors même qu'il a un média.
--
-- On retire cette garde devenue trop stricte. Les bornes qui restent
-- suffisent : `comments_not_empty` impose qu'il y ait *quelque chose*,
-- `comments_text_len` borne la longueur quand il y a du texte, et les
-- contraintes de média (054) valident l'URL et le texte alternatif.
-- ============================================================

alter table public.comments
  drop constraint if exists comments_text_check;
