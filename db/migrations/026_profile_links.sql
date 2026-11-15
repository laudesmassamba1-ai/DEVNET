-- 026 — Liens externes du profil.
--
-- Un développeur ne se prouve pas seulement par ce qu'il publie ici : il a
-- souvent un portfolio, un dépôt, un site. On donne donc au profil une liste
-- de liens plutôt qu'un champ unique — « site web » finissait toujours par
-- contenir plusieurs adresses collées à la main, non cliquables.
--
-- Le format est un tableau JSON d'objets `{ label, url }`. On garde `jsonb`
-- (et non des colonnes séparées) parce que le nombre de liens est libre et
-- que la lecture est toujours « toute la liste » : aucun besoin de filtrer
-- par lien côté base. La contrainte ci-dessous empêche seulement d'y écrire
-- autre chose qu'un tableau — c'est le seul invariant dont le client dépend
-- (`profile.links ?? []` reste vrai, mais un objet ferait planter le rendu
-- sans cette garde).

alter table public.users
  add column if not exists links jsonb not null default '[]'::jsonb;

alter table public.users
  drop constraint if exists users_links_is_array;
alter table public.users
  add constraint users_links_is_array check (jsonb_typeof(links) = 'array');

comment on column public.users.links is
  'Liens externes déclarés sur le profil : tableau JSON [{ label, url }].';
