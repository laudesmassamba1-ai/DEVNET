-- ============================================================
--  DEVNET — migration 078 : lecture de la file par les rôles T&S
--
--  La 073 réservait la lecture de `moderation_flags`, des termes et des
--  empreintes à `is_admin()`. Un modérateur nommé pouvait donc ouvrir la
--  console et voir une file vide. La lecture suit désormais
--  `can_view_trust_safety()` : elle inclut les rôles nommés, sans leur
--  donner les pouvoirs d'administration.
--
--  Aucune écriture n'est ouverte : les fonctions serveur restent seules
--  à écrire. Rollback : recréer les politiques de la 073.
-- ============================================================

drop policy if exists moderation_flags_admin_read on public.moderation_flags;
create policy moderation_flags_admin_read
  on public.moderation_flags for select to authenticated
  using (public.can_view_trust_safety());

drop policy if exists moderation_blocked_media_admin_read on public.moderation_blocked_media;
create policy moderation_blocked_media_admin_read
  on public.moderation_blocked_media for select to authenticated
  using (public.can_view_trust_safety());

drop policy if exists moderation_terms_admin_read on public.moderation_terms;
create policy moderation_terms_admin_read
  on public.moderation_terms for select to authenticated
  using (public.can_view_trust_safety());

drop policy if exists moderation_blocked_domains_read on public.moderation_blocked_domains;
create policy moderation_blocked_domains_read
  on public.moderation_blocked_domains for select to authenticated
  using (public.can_view_trust_safety());
