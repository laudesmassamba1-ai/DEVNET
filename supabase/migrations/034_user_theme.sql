-- 034 — Le thème choisi dans le profil
--
-- L'écran de profil propose deux thèmes (`THEMES`, app/profile/page.tsx) et
-- `ProfilePatch` envoie `theme` à **chaque** enregistrement. La colonne
-- n'existait pas : PostgREST rejetait donc toute mise à jour du profil
-- (PGRST204, « Could not find the 'theme' column »), pas seulement le thème.

alter table public.users
  add column if not exists theme text not null default 'liquid-bleu';

alter table public.users
  drop constraint if exists users_theme_check;

alter table public.users
  add constraint users_theme_check
  check (theme in ('liquid-bleu', 'light'));
