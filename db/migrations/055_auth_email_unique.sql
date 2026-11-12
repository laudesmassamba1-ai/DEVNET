-- ============================================================
--  055 — Une adresse email ne désigne qu'un compte
--
--  `auth.users` est la table d'identité créée par 000_compat.sql.
--  Sans index unique, deux inscriptions simultanées pouvaient créer
--  deux comptes avec la même adresse, puis `findCredentialsByEmail`
--  en choisissait un au hasard.
--
--  L'index est insensible à la casse : `Alice@…` et `alice@…` sont
--  la même adresse. Les adresses vides restent autorisées pour les
--  comptes techniques qui n'en portent pas.
-- ============================================================

create unique index if not exists auth_users_email_lower_uidx
  on auth.users (lower(email))
  where email <> '';
