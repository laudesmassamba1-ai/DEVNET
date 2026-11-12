-- 024 — Géographie du profil.
--
-- Deux écrans de la plateforme ont besoin de savoir **d'où** vient un
-- développeur :
--
--  · l'accueil public affiche une carte d'Afrique où chaque point est une
--    preuve vérifiée (fonctionnalité 1) ;
--  · le profil annonce la ville et le pays (fonctionnalité 3).
--
-- On ne stocke que le texte — ville, pays. Les coordonnées ne sont pas une
-- donnée de la personne : elles se déduisent de la ville par une table de
-- correspondance côté écran, et une ville mal orthographiée ne doit pas
-- déplacer quelqu'un sur la carte au mauvais endroit.

alter table public.users
  add column if not exists ville text not null default '',
  add column if not exists pays  text not null default '';

comment on column public.users.ville is
  'Ville déclarée, affichée sur le profil et placée sur la carte d''accueil.';
comment on column public.users.pays is
  'Pays déclaré, affiché sur le profil.';

-- Les preuves alimentent la carte publique : un visiteur non connecté doit
-- pouvoir voir où le travail est prouvé, sinon la carte d'accueil serait
-- vide pour exactement ceux à qui elle s'adresse. La lecture était réservée
-- aux comptes connectés (`auth.role() = 'authenticated'`) ; on l'ouvre.
drop policy if exists "proofs_read" on public.proofs;
create policy "proofs_read" on public.proofs
  for select using (true);
