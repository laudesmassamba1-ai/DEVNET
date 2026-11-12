-- ============================================================
--  DEVNET — migration 58 : médias sur stockage objet
--
--  Les octets peuvent désormais vivre chez un fournisseur S3-compatible
--  (Cloudflare R2). `url` garde l'adresse publique ; `bytes` reste rempli
--  pour les médias déjà en base et pour le repli quand R2 n'est pas
--  configuré. La route `/api/media/<chemin>` redirige vers `url` lorsqu'elle
--  est renseignée, sinon elle sert les octets comme avant.
-- ============================================================

alter table public.media_files
  alter column bytes drop not null;

alter table public.media_files
  add column if not exists url text not null default '';

alter table public.media_files
  drop constraint if exists media_files_url_https;

alter table public.media_files
  add constraint media_files_url_https
  check (url = '' or url ~ '^https://[^[:space:]]+$');

comment on column public.media_files.url is
  'URL publique du fournisseur objet ; vide quand les octets sont en base.';
