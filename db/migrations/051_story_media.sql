-- ============================================================
--  DEVNET — migration 51 : images et vidéos en statut
--
--  Une story était un texte. `media_url` existait déjà, mais rien ne
--  l'alimentait : publier une image ou une vidéo n'était pas possible.
--
--  Le média vit dans une table **séparée** de `stories` :
--
--   1. la liste des stories ne peut pas le transporter par accident —
--      un `select *` sur `stories` reste léger ;
--   2. ses droits sont ceux de la story (vivante, ou la sienne) ;
--   3. il disparaît avec elle, par la clé étrangère.
--
--  Stockage en base faute de stockage objet : assumé, documenté, et
--  servi par une route dédiée avec cache privé.
-- ============================================================

create table if not exists public.story_media (
  story_id    uuid primary key references public.stories(id) on delete cascade,
  mime        text not null,
  bytes       bytea not null,
  byte_size   integer not null,
  width       integer,
  height      integer,
  duration_ms integer,
  created_at  timestamptz not null default now()
);

alter table public.story_media enable row level security;

drop policy if exists "story_media_read" on public.story_media;
create policy "story_media_read" on public.story_media
  for select using (
    public.story_is_live(story_media.story_id)
    or public.story_author(story_media.story_id) = auth.uid()
  );

drop policy if exists "story_media_insert" on public.story_media;
create policy "story_media_insert" on public.story_media
  for insert with check (public.story_author(story_media.story_id) = auth.uid());

grant select, insert on public.story_media to authenticated;

-- La story d'un média ne se réécrit pas ; le média non plus.
comment on table public.story_media is
  'Média re-encodé d''une story (image/GIF en WebP, vidéo en MP4), stocké en base.';
