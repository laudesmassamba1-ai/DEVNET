-- ============================================================
--  DEVNET — migration 67 : confidentialité des fichiers média
--
--  La migration 56 rendait `media_files` lisible par `anon` sans
--  condition (`media_files_read using (true)`), avec un commentaire qui
--  supposait un bucket public. C'était vrai pour une photo de
--  publication, faux pour une photo envoyée dans un message privé : le
--  chemin UUID n'était pas devinable, mais il apparaissait dans la
--  conversation, dans l'historique du navigateur et dans les caches. Un
--  participant qui quitte la conversation, ou un destinataire qui
--  supprime le message, ne perdait pas l'accès aux octets.
--
--  La règle est désormais portée par la base, pas seulement par l'écran :
--
--   1. un fichier **non référencé** par une conversation (publication,
--      profil) reste lisible comme avant ;
--   2. un fichier référencé par `direct_messages` n'est lisible que par
--      un participant de la conversation ;
--   3. un fichier référencé par `group_messages` n'est lisible que par
--      un membre du groupe ;
--   4. l'auteur du fichier le lit toujours (il peut le supprimer).
--
--  `security definer` est nécessaire : les politiques de `direct_messages`
--  et `group_messages` masquent leurs lignes au lecteur, donc une
--  sous-requête ordinaire ne verrait rien et refuserait tout. La fonction
--  ne rend qu'un booléen, jamais une ligne, et son `search_path` est fixé.
--
--  Aucune donnée n'est réécrite : la migration est additive et peut être
--  annulée en rétablissant l'ancienne politique (voir le journal).
-- ============================================================

create or replace function public.media_file_is_private(target_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1 from public.direct_messages dm
            where dm.media_url like '%/api/media/' || target_path
         )
      or exists (
           select 1 from public.group_messages gm
            where gm.media_url like '%/api/media/' || target_path
         );
$$;

create or replace function public.can_read_media_file(target_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.media_file_is_private(target_path)
      or exists (
           select 1 from public.media_files mf
            where mf.path = target_path
              and mf.owner_id = auth.uid()
         )
      or exists (
           select 1
             from public.direct_messages dm
             join public.conversations c on c.id = dm.conversation_id
            where dm.media_url like '%/api/media/' || target_path
              and auth.uid() = any(c.participants)
         )
      or exists (
           select 1
             from public.group_messages gm
             join public.group_members m on m.group_id = gm.group_id
            where gm.media_url like '%/api/media/' || target_path
              and m.user_id = auth.uid()
         );
$$;

revoke all on function public.media_file_is_private(text) from public;
revoke all on function public.can_read_media_file(text) from public;
grant execute on function public.media_file_is_private(text) to anon, authenticated, service_role;
grant execute on function public.can_read_media_file(text) to anon, authenticated, service_role;

drop policy if exists "media_files_read" on public.media_files;
create policy "media_files_read" on public.media_files
  for select using (public.can_read_media_file(path));

comment on function public.media_file_is_private(text) is
  'Vrai si le média est référencé par un message privé ou de groupe.';
comment on function public.can_read_media_file(text) is
  'Décide la lecture d''un média : public, auteur, participant ou membre du groupe.';
comment on policy "media_files_read" on public.media_files is
  'Un média privé n''est lisible que par les personnes autorisées par la conversation.';
