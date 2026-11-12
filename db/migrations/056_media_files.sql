-- ============================================================
--  DEVNET — migration 56 : photos et vidéos
--
--  Les migrations 52-54 ont ouvert le GIF (un **lien** vers un
--  fournisseur) et le sticker (une **référence** au catalogue). Ici,
--  c'est un fichier : une publication, un message privé ou un message
--  de canal peut porter une photo ou une courte vidéo.
--
--  Le fichier est stocké dans `public.media_files` et servi par
--  `/api/media/<chemin>`. La base garde l'URL, son type et les octets :
--  pas de fournisseur de stockage objet, pas de secret supplémentaire.
--  Le chemin est un UUID imprévisible, comme l'ancien bucket public.
--
--  ## La préférence de réception
--
--  `users.dm_media` dit si l'on accepte les photos et vidéos dans ses
--  messages privés. Par défaut `true` — on ne prive personne de la
--  fonctionnalité au premier jour — et l'interface de messagerie
--  refuse l'envoi au contact qui l'a coupée.
-- ============================================================

alter table public.posts
  add column if not exists media_url text not null default '',
  add column if not exists media_type text not null default '';

alter table public.direct_messages
  add column if not exists media_url text not null default '',
  add column if not exists media_type text not null default '';

alter table public.group_messages
  add column if not exists media_url text not null default '',
  add column if not exists media_type text not null default '';

alter table public.users
  add column if not exists dm_media boolean not null default true;

-- Garde-fous : une URL posée en base est https (ou http local en dev), et le type ne
-- peut être qu'une photo ou une vidéo — une chaîne arbitraire finirait
-- par choisir une balise de rendu imprévue.
alter table public.posts drop constraint if exists posts_media_url_https;
alter table public.posts
  add constraint posts_media_url_https
  check (media_url = '' or media_url ~ '^(https://|http://localhost|http://127\.0\.0\.1)[^[:space:]]*$');

alter table public.posts drop constraint if exists posts_media_type_allowed;
alter table public.posts
  add constraint posts_media_type_allowed
  check (media_type in ('', 'image', 'video'));

alter table public.direct_messages drop constraint if exists direct_messages_media_url_https;
alter table public.direct_messages
  add constraint direct_messages_media_url_https
  check (media_url = '' or media_url ~ '^(https://|http://localhost|http://127\.0\.0\.1)[^[:space:]]*$');

alter table public.direct_messages drop constraint if exists direct_messages_media_type_allowed;
alter table public.direct_messages
  add constraint direct_messages_media_type_allowed
  check (media_type in ('', 'image', 'video'));

alter table public.group_messages drop constraint if exists group_messages_media_url_https;
alter table public.group_messages
  add constraint group_messages_media_url_https
  check (media_url = '' or media_url ~ '^(https://|http://localhost|http://127\.0\.0\.1)[^[:space:]]*$');

alter table public.group_messages drop constraint if exists group_messages_media_type_allowed;
alter table public.group_messages
  add constraint group_messages_media_type_allowed
  check (media_type in ('', 'image', 'video'));

-- ── Les octets ────────────────────────────────────────────────────
--  Une ligne par fichier. Le chemin est la clé publique (`/api/media/<path>`).
--  `kind` restreint le rendu à une balise image ou vidéo, jamais un type
--  arbitraire choisi par l'appelant.
create table if not exists public.media_files (
  path       text primary key,
  owner_id   uuid not null references public.users(id) on delete cascade,
  mime       text not null,
  kind       text not null,
  bytes      bytea not null,
  byte_size  integer not null,
  created_at timestamptz not null default now(),
  constraint media_files_kind_allowed check (kind in ('image', 'video')),
  constraint media_files_size_positive check (byte_size > 0),
  constraint media_files_path_safe check (path ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$')
);

alter table public.media_files enable row level security;

-- Lecture : le chemin est un UUID non devinable, et une publication peut
-- être lue sans session. On retrouve donc la sémantique du bucket public.
drop policy if exists "media_files_read" on public.media_files;
create policy "media_files_read" on public.media_files
  for select using (true);

drop policy if exists "media_files_insert" on public.media_files;
create policy "media_files_insert" on public.media_files
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "media_files_delete" on public.media_files;
create policy "media_files_delete" on public.media_files
  for delete to authenticated using (owner_id = auth.uid());

grant select on public.media_files to anon, authenticated, service_role;
grant insert, delete on public.media_files to authenticated;

comment on table public.media_files is
  'Photos et vidéos des publications et messages, servies par /api/media.';

comment on column public.posts.media_url is
  'Photo ou vidéo de la publication : URL publique du bucket media. Vide si aucune.';
comment on column public.users.dm_media is
  'Préférence : accepter les photos et vidéos dans les messages privés. Vrai par défaut.';
