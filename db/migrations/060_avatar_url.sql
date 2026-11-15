-- ============================================================
-- 060 — Photo de profil
--
-- Une seule URL publique par compte. Le fichier lui-même vit dans le
-- stockage média ; la ligne `users` ne porte que l'adresse. Vide signifie
-- « utiliser les initiales et la couleur d'avatar ».
-- ============================================================

alter table public.users
  add column if not exists avatar_url text not null default '';

comment on column public.users.avatar_url is
  'URL publique de la photo de profil ; vide = avatar à initiales.';
