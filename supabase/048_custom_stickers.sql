-- ============================================================
--  DEVNET — migration 48 : stickers créés par les utilisateurs
--
--  Le catalogue de la 047 était celui de la maison. Ici, on ouvre la
--  création : un sticker appartient à quelqu'un, il est privé par
--  défaut, et il porte soit un glyphe (sticker de texte), soit des
--  octets déjà **re-encodés par le serveur** (image).
--
--  Trois décisions :
--
--  1. Privé par défaut. Un sticker personnel n'a aucune raison d'être
--     visible par le réseau avant que son auteur ne le décide.
--  2. `status` sépare « retiré par son auteur » de « supprimé » : une
--     story qui référence un sticker retiré garde une trace, et la
--     modération peut le remettre en cause sans perdre la ligne.
--  3. Les octets vivent dans la ligne, faute de stockage objet à ce
--     jour. La lecture du catalogue ne les sélectionne **jamais** :
--     ils sont servis par une route dédiée, avec cache immuable.
-- ============================================================

alter table public.stickers
  add column if not exists owner_id uuid references public.users(id) on delete cascade,
  add column if not exists visibility text not null default 'prive',
  add column if not exists status text not null default 'actif',
  add column if not exists fg text not null default '',
  add column if not exists bg text not null default '',
  add column if not exists bytes bytea,
  add column if not exists mime text not null default '',
  add column if not exists sha256 text not null default '',
  add column if not exists updated_at timestamptz not null default now();

alter table public.stickers
  drop constraint if exists stickers_visibility_check;
alter table public.stickers
  add constraint stickers_visibility_check check (visibility in ('prive', 'public'));

alter table public.stickers
  drop constraint if exists stickers_status_check;
alter table public.stickers
  add constraint stickers_status_check check (status in ('actif', 'retire'));

-- Une image a des octets et un type ; elle n'a pas de glyphe.
alter table public.stickers
  drop constraint if exists stickers_image_a_des_octets;
alter table public.stickers
  add constraint stickers_image_a_des_octets
  check (kind <> 'image' or (bytes is not null and mime <> ''));

-- Un sticker d'image créé par un utilisateur doit avoir un
-- propriétaire ; le catalogue de la maison (owner NULL) garde ses
-- glyphes et reste public.
alter table public.stickers
  drop constraint if exists stickers_createur_pour_image;
alter table public.stickers
  add constraint stickers_createur_pour_image
  check (kind <> 'image' or owner_id is not null);

create index if not exists stickers_owner_idx
  on public.stickers (owner_id, created_at desc);
create index if not exists stickers_public_idx
  on public.stickers (visibility, status)
  where owner_id is not null;

-- ------------------------------------------------------------
--  RLS : le catalogue de la maison reste public, le reste appartient
--  à son auteur et ne sort qu'avec son accord.
-- ------------------------------------------------------------

drop policy if exists "stickers_read" on public.stickers;
create policy "stickers_read" on public.stickers
  for select using (
    owner_id = auth.uid()
    or (
      status = 'actif'
      and (owner_id is null or visibility = 'public')
    )
  );

drop policy if exists "stickers_insert" on public.stickers;
create policy "stickers_insert" on public.stickers
  for insert with check (owner_id = auth.uid());

drop policy if exists "stickers_update" on public.stickers;
create policy "stickers_update" on public.stickers
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "stickers_delete" on public.stickers;
create policy "stickers_delete" on public.stickers
  for delete using (owner_id = auth.uid());

-- La RLS filtre les lignes, pas les verbes : sans ces droits, la politique
-- d'insertion ne s'applique jamais et PostgreSQL refuse avant elle.
grant select, insert, update, delete on public.stickers to authenticated;
