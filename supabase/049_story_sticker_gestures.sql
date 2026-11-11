-- ============================================================
--  DEVNET — migration 49 : déplacer et retirer un sticker posé
--
--  La 047 permettait de poser un sticker, jamais de le reprendre : une
--  faute de doigt restait gravée jusqu'à l'expiration de la story.
--
--  Deux gestes, une même règle : seul l'auteur de la story, et seulement
--  tant qu'elle est vivante, peut modifier ce qu'il a posé. Le déplacement
--  ne change ni le sticker, ni la story, ni l'empilement — seulement la
--  position, l'échelle et la rotation, déjà bornées par la table.
-- ============================================================

drop policy if exists "story_stickers_update" on public.story_stickers;
create policy "story_stickers_update" on public.story_stickers
  for update using (
    placed_by = auth.uid()
    and public.story_is_live(story_stickers.story_id)
  ) with check (
    placed_by = auth.uid()
    and public.story_is_live(story_stickers.story_id)
  );

-- La politique de suppression existe depuis la 047 ; ce sont les droits de
-- table qui manquaient pour que le navigateur authentifié l'exerce.
grant select, insert, update, delete on public.story_stickers to authenticated;
