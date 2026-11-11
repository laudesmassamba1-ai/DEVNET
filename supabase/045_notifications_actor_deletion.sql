-- ============================================================
--  045 — Supprimer un compte ne doit pas échouer
--
--  La migration 010 annonce « l'acteur disparaît, la notification
--  reste » (`actor_id … on delete set null`), puis ajoute
--  `constraint notifications_has_actor check (actor_id is not null)`.
--  Les deux ne peuvent pas être vrais ensemble : dès qu'un compte a
--  liké, suivi ou cité quelqu'un, le supprimer viole la contrainte et
--  la suppression échoue — alors que toutes les tables promettent
--  `on delete cascade`.
--
--  Constat mesuré (base locale, 2026-11-08) :
--    delete from auth.users where …
--    → 23514 « new row for relation "notifications" violates check
--      constraint "notifications_has_actor" »
--  C'est-à-dire : un compte qui a reçu de l'activité ne peut plus être
--  effacé, ni par l'utilisateur, ni par l'administration.
--
--  On remplace la contrainte par l'invariant réellement voulu : une
--  notification ne s'adresse pas à son propre acteur. Le déclencheur
--  `public.notify()` le garantit déjà (`p_recipient = p_actor` →
--  `return`), la contrainte le rend vrai pour tout futur chemin
--  d'écriture.
--
--  `not valid` : les lignes existantes ne sont pas rescannées, la
--  contrainte s'applique aux écritures suivantes. Aucune donnée n'est
--  modifiée par cette migration.
-- ============================================================

alter table public.notifications
  drop constraint if exists notifications_has_actor;

alter table public.notifications
  drop constraint if exists notifications_actor_distinct;

alter table public.notifications
  add constraint notifications_actor_distinct
  check (actor_id is null or actor_id <> recipient_id) not valid;

comment on column public.notifications.actor_id is
  'Auteur de l''événement. Null après suppression de son compte : la notification reste, l''écran affiche « compte supprimé ».';
